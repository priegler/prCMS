import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  FsSink, GitHubSink, isEnabled, loadConfig, configWith, prepareEdits, resolveEdit,
  ConflictError, ResolutionError, constantTimeEqual, signToken, verifyToken, seal, unseal,
  cookie, sessionCookie, validOrigin, runLocalAgent, assertWritable,
  type Sink, type Session, type InlineCMSConfig, type FileChange, type AgentProposal, type ElementContext,
} from '@inlinecms/core';

const editSchema = z.object({ src: z.string().max(1000), oldText: z.string().max(100000), newText: z.string().max(100000),
  baseRev: z.string().max(200).optional(), candidateId: z.string().max(1200).optional(),
  attribute: z.string().max(50).optional(), textNodeIndex: z.number().int().min(0).optional(), locale: z.string().max(30).optional() });
const contextSchema = z.object({ src: z.string().max(1000), ancestors: z.array(z.string().max(1000)).max(20), pageUrl: z.string().max(2000),
  outerHTML: z.string().max(16000), oldText: z.string().max(100000), instruction: z.string().min(1).max(10000), screenshot: z.string().max(1000000).optional() });
export interface HandlerOptions {
  root?: string; config?: Partial<InlineCMSConfig>; enabled?: boolean; secret?: string; loginSecret?: string;
  sink?: Sink; agent?: (context: ElementContext, sink: Sink, config: InlineCMSConfig) => Promise<AgentProposal>;
  fetch?: typeof fetch;
}
interface Proposal { user: string; changes: FileChange[] }
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
const json = (data: unknown, status = 200, headers?: HeadersInit) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
async function body(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'Expected JSON');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Missing body');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.length;
    if (size > 16 * 1024 * 1024) { await reader.cancel(); throw new HttpError(413, 'Request too large'); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON'); }
}
function imageExtension(data: Buffer): string {
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'jpg';
  if (/^GIF8[79]a$/.test(data.subarray(0, 6).toString())) return 'gif';
  if (data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP') return 'webp';
  if (data.subarray(4, 8).toString() === 'ftyp' && ['avif', 'avis'].includes(data.subarray(8, 12).toString())) return 'avif';
  throw new HttpError(400, 'Use a PNG, JPEG, GIF, WebP or AVIF image');
}
export function createHandlers(options: HandlerOptions = {}) {
  const http = options.fetch ?? fetch;
  // Local login credentials are known to editors; signing keys must stay server-only.
  const developmentKey = randomBytes(32).toString('base64url');
  async function handle(request: Request): Promise<Response> {
    if (!(options.enabled ?? isEnabled())) return new Response('Not found', { status: 404 });
    const url = new URL(request.url), action = url.pathname.split('/').filter(Boolean).at(-1);
    const mode = process.env.INLINECMS_SINK === 'github' ? 'github' : 'fs';
    const root = options.root ?? process.cwd();
    const config = options.config ? configWith(options.config) : await loadConfig(root);
    const loginSecret = options.loginSecret ?? process.env.INLINE_CMS_SECRET;
    const signingKey = options.secret ?? process.env.INLINECMS_SESSION_SECRET ?? (mode === 'fs' && process.env.NODE_ENV === 'development' ? developmentKey : undefined);
    if (mode === 'fs' && signingKey && loginSecret && constantTimeEqual(signingKey, loginSecret)) throw new HttpError(503, 'The server signing key must differ from the local login password');
    if (!signingKey) throw new HttpError(503, 'Configure INLINECMS_SESSION_SECRET (and INLINE_CMS_SECRET for local login)');
    // Next normalizes loopback request URLs to localhost; Host retains the actual
    // browser origin. Hosted deployments should set an explicit canonical origin.
    const origin = process.env.INLINECMS_ORIGIN ?? new URL(`${url.protocol}//${request.headers.get('host') ?? url.host}`).origin;
    if (request.method === 'POST' && !validOrigin(request, origin)) throw new HttpError(403, 'Origin does not match this editor');
    const session = verifyToken<Session>(cookie(request, 'inlinecms-session'), signingKey);
    const apiRoot = url.pathname.slice(0, url.pathname.lastIndexOf('/'));
    const callback = `${origin}${apiRoot}/callback`;
    const repo = process.env.INLINECMS_GITHUB_REPO;
    async function githubIdentity(accessToken: string) {
      if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new HttpError(503, 'Configure INLINECMS_GITHUB_REPO=owner/repo');
      const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' };
      const response = await http(`https://api.github.com/repos/${repo}`, { headers });
      if (!response.ok) throw new HttpError(403, 'GitHub repository access denied');
      const repository = await response.json();
      if (!repository.permissions?.push) throw new HttpError(403, 'GitHub write access is required');
      const userResponse = await http('https://api.github.com/user', { headers });
      if (!userResponse.ok) throw new HttpError(401, 'GitHub session expired');
      return (await userResponse.json()).login as string;
    }
    if (request.method === 'GET' && action === 'login' && mode === 'github') {
      const client = process.env.INLINECMS_GITHUB_CLIENT_ID;
      if (!client) throw new HttpError(503, 'Configure GitHub OAuth credentials');
      const state = randomBytes(32).toString('base64url');
      const target = new URL('https://github.com/login/oauth/authorize');
      target.search = new URLSearchParams({ client_id: client, redirect_uri: callback, scope: 'repo', state }).toString();
      return new Response(null, { status: 302, headers: { Location: target.href,
        'Set-Cookie': sessionCookie(request, signToken({ state }, signingKey, 600), 600, 'inlinecms-oauth', 'Lax'), 'Cache-Control': 'no-store' } });
    }
    if (request.method === 'GET' && action === 'callback' && mode === 'github') {
      const state = verifyToken<{ state: string }>(cookie(request, 'inlinecms-oauth'), signingKey);
      const code = url.searchParams.get('code');
      if (!state || !constantTimeEqual(state.state, url.searchParams.get('state') ?? '') || !code) throw new HttpError(403, 'Invalid OAuth state');
      const response = await http('https://github.com/login/oauth/access_token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: process.env.INLINECMS_GITHUB_CLIENT_ID, client_secret: process.env.INLINECMS_GITHUB_CLIENT_SECRET, code, redirect_uri: callback }) });
      const token = await response.json();
      if (!response.ok || typeof token.access_token !== 'string') throw new HttpError(401, 'GitHub sign-in failed');
      const user = await githubIdentity(token.access_token);
      const headers = new Headers({ Location: `${origin}/?cms=edit`, 'Cache-Control': 'no-store' });
      const branch = `cms/${new Date().toISOString().slice(0, 10)}-${user.replace(/[^a-zA-Z0-9-]/g, '-')}`;
      headers.append('Set-Cookie', sessionCookie(request, signToken({ user, branch, accessToken: seal(token.access_token, signingKey) }, signingKey, 28800)));
      headers.append('Set-Cookie', sessionCookie(request, '', 0, 'inlinecms-oauth', 'Lax'));
      return new Response(null, { status: 302, headers });
    }
    if (request.method === 'POST' && action === 'auth' && mode === 'fs') {
      if (!loginSecret) throw new HttpError(503, 'Configure INLINE_CMS_SECRET');
      const input = z.object({ secret: z.string().max(1000) }).parse(await body(request));
      if (!constantTimeEqual(input.secret, loginSecret)) throw new HttpError(401, 'Invalid secret');
      return json({ authenticated: true }, 200, { 'Set-Cookie': sessionCookie(request, signToken({ user: 'local' }, signingKey, 28800)) });
    }
    if (!session) return json({ authenticated: false, mode }, action === 'auth' ? 200 : 401);
    let accessToken: string | undefined;
    if (mode === 'github') {
      if (!session.accessToken) throw new HttpError(401, 'Sign in with GitHub');
      accessToken = unseal(session.accessToken, signingKey);
      const user = await githubIdentity(accessToken);
      if (user !== session.user) throw new HttpError(401, 'Invalid GitHub identity');
    }
    if (request.method === 'GET' && action === 'auth') return json({ authenticated: true, mode });
    if (request.method === 'POST' && action === 'logout') return json({ authenticated: false }, 200, { 'Set-Cookie': sessionCookie(request, '', 0) });
    const input = request.method === 'POST' ? await body(request) : undefined;
    let sink: Sink;
    if (options.sink) sink = options.sink;
    else if (mode === 'github') {
      if (!accessToken) throw new HttpError(401, 'Sign in with GitHub');
      const sha = process.env.INLINECMS_DEPLOYED_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.COMMIT_REF;
      if (!sha || !/^[a-f0-9]{40}$/i.test(sha)) throw new HttpError(503, 'Configure the exact deployed commit SHA');
      const [owner, name] = repo!.split('/');
      sink = new GitHubSink({ owner, repo: name, token: accessToken, deployedSha: sha, user: session.user, branch: session.branch, baseBranch: process.env.INLINECMS_BASE_BRANCH,
        prefix: process.env.INLINECMS_SOURCE_PREFIX, config, fetch: http });
      const requestedBranch = request.method === 'GET' ? url.searchParams.get('branch') : ['approve-agent', 'discard-agent'].includes(action ?? '') ? z.object({ branch: z.string().max(200) }).parse(input).branch : undefined;
      if (requestedBranch) {
        const initial = sink as GitHubSink;
        const agentSuffix = requestedBranch.slice((initial.branch + '-agent-').length);
        if (requestedBranch !== initial.branch && !(requestedBranch.startsWith(initial.branch + '-agent-') && /^[a-f0-9]{8}$/.test(agentSuffix))) throw new HttpError(403, 'Branch does not belong to this editor');
        sink = new GitHubSink({ ...initial.options, branch: requestedBranch });
      }
    } else sink = new FsSink(root, config);
    if (request.method === 'GET' && action === 'status' && sink instanceof GitHubSink) {
      const pr = Number(url.searchParams.get('pr'));
      if (!Number.isInteger(pr) || pr < 1) throw new HttpError(400, 'Invalid PR number');
      return json(await sink.status(pr));
    }
    if (request.method !== 'POST') throw new HttpError(404, 'Not found');
    switch (action) {
      case 'resolve': {
        const edit = editSchema.parse(input);
        return json(await resolveEdit(sink, config, edit));
      }
      case 'preview': {
        const edit = editSchema.parse(input);
        const resolution = await resolveEdit(sink, config, edit);
        if (resolution.status !== 'resolved') return json(resolution);
        const changes = await prepareEdits(sink, config, [edit]);
        return json({ ...resolution, changes });
      }
      case 'publish': {
        const data = z.object({ edits: z.array(editSchema).max(100).default([]), proposals: z.array(z.string().max(12000000)).max(10).default([]), message: z.string().min(1).max(300).default('CMS source update') }).parse(input);
        if (!data.edits.length && !data.proposals.length) throw new HttpError(400, 'No changes to publish');
        // Read at the current CMS branch for conflict-aware re-resolution.
        if (sink instanceof GitHubSink) await sink.useBranchHead();
        const changes = await prepareEdits(sink, config, data.edits);
        for (const token of data.proposals) {
          const proposal = verifyToken<Proposal>(token, signingKey);
          if (!proposal || proposal.user !== session.user) throw new HttpError(403, 'Proposal expired; request a new preview');
          for (const change of proposal.changes) {
            assertWritable(change.path, config);
            if (changes.some(c => c.path === change.path)) throw new ConflictError('Separate source edits and agent proposals for the same file into two publishes');
            changes.push(change);
          }
        }
        return json(await sink.write(changes, data.message));
      }
      case 'approve-agent': {
        if (!(sink instanceof GitHubSink)) throw new HttpError(400, 'Hosted agent only');
        const data = z.object({ pr: z.number().int().positive(), commit: z.string().regex(/^[a-f0-9]{40}$/i) }).parse(input);
        return json(await sink.approveAgent(data.pr, data.commit));
      }
      case 'discard-agent': {
        if (!(sink instanceof GitHubSink)) throw new HttpError(400, 'Hosted agent only');
        const data = z.object({ pr: z.number().int().positive() }).parse(input);
        await sink.discardAgent(data.pr);
        return json({ discarded: true });
      }
      case 'agent': {
        const context: ElementContext = contextSchema.parse(input);
        const resolution = await resolveEdit(sink, config, { src: context.src, oldText: context.oldText, newText: '' });
        context.candidates = resolution.status === 'ambiguous' ? resolution.candidates : resolution.status === 'resolved' ? [resolution.candidate] : [];
        if (sink instanceof GitHubSink) return json({ hosted: true, ...await sink.requestAgent(context) });
        const proposal = await (options.agent ? options.agent(context, sink, config) : runLocalAgent(root, sink, config, context));
        if (Buffer.byteLength(JSON.stringify(proposal)) > 6 * 1024 * 1024) throw new HttpError(413, 'Agent proposal is too large; ask for a smaller change');
        if (!proposal.changes.length) throw new HttpError(422, 'Agent proposed no source changes. Try a more specific instruction.');
        return json({ ...proposal, proposalToken: signToken({ user: session.user, changes: proposal.changes }, signingKey) });
      }
      case 'image': {
        const data = z.object({ base64: z.string().max(7000000) }).parse(input);
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data.base64)) throw new HttpError(400, 'Invalid image data');
        const image = Buffer.from(data.base64, 'base64');
        if (!image.length || image.length > 5 * 1024 * 1024) throw new HttpError(413, 'Images must be under 5 MB');
        const path = `public/inlinecms/${randomUUID()}.${imageExtension(image)}`;
        const change: FileChange = { path, content: image.toString('base64'), encoding: 'base64', baseRev: '', diff: `New image: ${path} (${image.length} bytes)` };
        return json({ src: path.slice('public'.length), change: { path, diff: change.diff }, proposalToken: signToken({ user: session.user, changes: [change] }, signingKey) });
      }
      default: throw new HttpError(404, 'Not found');
    }
  }
  async function safeHandle(request: Request) {
    try { return await handle(request); }
    catch (error) {
      if (error instanceof ResolutionError) return json({ ...error.resolution, error: error.message, edit: error.edit }, 409);
      if (error instanceof ConflictError) return json({ error: error.message }, 409);
      if (error instanceof z.ZodError) return json({ error: 'Invalid request', issues: error.issues.map(i => ({ path: i.path, message: i.message })) }, 400);
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      // Provider errors can contain credentials, source or internal paths; never echo them.
      return json({ error: 'CMS operation failed. Check server logs and configuration.' }, 500);
    }
  }
  return { GET: safeHandle, POST: safeHandle };
}
const handlers = createHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
