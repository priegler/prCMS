import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createHandlers } from '../api/handlers.js';
import { configWith, signToken, revision, type Sink } from '@inlinecms/core';
let files: Record<string, string>, writes: number;
const secret = 'placeholder', loginSecret = 'dummy';
const url = 'https://site.test/api/cms/';
const authed = `inlinecms-session=${signToken({ user: 'local' }, secret)}`;
function request(action: string, data?: unknown, cookie = authed, origin = 'https://site.test') {
  return new Request(url + action, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: origin }, body: data === undefined ? undefined : JSON.stringify(data) });
}
function handlers(enabled = true) {
  const sink: Sink = { async list() { return Object.keys(files); }, async read(path) { return { content: files[path], rev: revision(files[path]) }; }, async write(changes) { writes++; changes.forEach(c => { files[c.path] = c.content; }); return { committed: false, message: 'Saved' }; } };
  return createHandlers({ enabled, secret, config: configWith(), sink, agent: async () => ({ changes: [{ path: 'app/page.tsx', baseRev: revision(files['app/page.tsx']), content: 'export default () => <p>AI copy</p>;', diff: 'proposed diff' }], message: 'Shortened copy' }) });
}
beforeEach(() => { files = { 'app/page.tsx': 'export default () => <p>Hello</p>;' }; writes = 0; vi.stubEnv('INLINECMS_SINK', 'fs'); vi.stubEnv('INLINE_CMS_SECRET', loginSecret); vi.stubEnv('INLINECMS_ORIGIN', 'https://site.test'); });
afterEach(() => vi.unstubAllEnvs());
describe('source API', () => {
  it('is inaccessible in production, including auth', async () => {
    expect((await handlers(false).GET(request('auth'))).status).toBe(404);
    expect((await handlers(false).POST(request('auth', { secret: loginSecret }))).status).toBe(404);
  });
  it('requires exact signed cookies and same-Origin POSTs', async () => {
    const api = handlers();
    expect((await api.POST(request('preview', { src: 'app/page.tsx:1:22', oldText: 'Hello', newText: 'Bye' }, 'inlinecms-auth=' + secret))).status).toBe(401);
    expect((await api.POST(request('auth', { secret: loginSecret }, '', 'https://evil.test'))).status).toBe(403);
    const response = await api.POST(request('auth', { secret: loginSecret }, '')); expect(response.status).toBe(200);
    const setCookie = response.headers.get('set-cookie')!; expect(setCookie).toContain('HttpOnly'); expect(setCookie).toContain('Secure'); expect(setCookie).toContain('SameSite=Strict'); expect(setCookie).not.toContain(secret);
    expect((await api.GET(request('auth', undefined, setCookie.split(';')[0]))).status).toBe(200);
    expect((await api.GET(request('auth', undefined, 'inlinecms-session=forged'))).headers.get('cache-control')).toBe('no-store');
  });
  it('uses an independent development signing key and refuses password-forged proposals', async () => {
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('INLINECMS_SESSION_SECRET', undefined);
    const api = createHandlers({ enabled: true, config: configWith() });
    const loggedIn = await api.POST(request('auth', { secret: loginSecret }, ''));
    expect(loggedIn.status).toBe(200);
    const session = loggedIn.headers.get('set-cookie')!.split(';')[0];
    expect((await api.GET(request('auth', undefined, session))).status).toBe(200);
    const forgedSession = 'inlinecms-session=' + signToken({ user: 'local' }, loginSecret);
    expect((await api.POST(request('publish', { proposals: [] }, forgedSession))).status).toBe(401);
    const forged = signToken({ user: 'local', changes: [{ path: 'app/page.tsx', content: 'arbitrary code', baseRev: revision(files['app/page.tsx']), diff: '' }] }, loginSecret);
    expect((await api.POST(request('publish', { proposals: [forged] }, session))).status).toBe(403);
    const badConfig = createHandlers({ enabled: true, secret: loginSecret, loginSecret });
    expect((await badConfig.POST(request('auth', { secret: loginSecret }, ''))).status).toBe(503);
    expect(writes).toBe(0);
  });
  it('rejects empty agent proposals before signing or publishing them', async () => {
    const api = createHandlers({ enabled: true, secret, config: configWith(), sink: { async list() { return Object.keys(files); }, async read(path) { return { content: files[path], rev: revision(files[path]) }; }, async write() { writes++; return { committed: false }; } }, agent: async () => ({ changes: [], message: 'No edits' }) });
    const response = await api.POST(request('agent', { src: 'app/page.tsx:1:22', oldText: 'Hello', instruction: 'Shorten', outerHTML: '<p>Hello</p>', ancestors: [], pageUrl: 'https://site.test' }));
    expect(response.status).toBe(422); expect(await response.json()).not.toHaveProperty('proposalToken'); expect(writes).toBe(0);
  });
  it('previews without writes, then patches the source at publish time', async () => {
    const api = handlers(), edit = { src: 'app/page.tsx:1:22', oldText: 'Hello', newText: 'Bye' };
    const response = await api.POST(request('preview', edit)); expect(response.status).toBe(200);
    const preview = await response.json(); expect(preview.changes[0].diff).toContain('Bye'); expect(writes).toBe(0);
    const result = await api.POST(request('publish', { edits: [{ ...edit, baseRev: preview.candidate.baseRev }] })); expect(result.status).toBe(200); expect(writes).toBe(1); expect(files['app/page.tsx']).toContain('Bye');
  });
  it('re-resolves text after concurrent non-copy changes', async () => {
    const api = handlers(), edit = { src: 'app/page.tsx:1:22', oldText: 'Hello', newText: 'Bye', baseRev: revision(files['app/page.tsx']) };
    files['app/page.tsx'] = '// concurrent change\n' + files['app/page.tsx'];
    const result = await api.POST(request('publish', { edits: [edit] })); expect(result.status).toBe(200); expect(files['app/page.tsx']).toContain('// concurrent change');
  });
  it('rejects malformed and out-of-scope requests', async () => {
    const api = handlers(); expect((await api.POST(request('preview', { src: 4 }))).status).toBe(400);
    expect((await api.POST(request('preview', { src: '../private.tsx:1:1', oldText: 'Hi', newText: 'Bye' }))).status).not.toBe(200); expect(writes).toBe(0);
  });
  it('returns an agent diff signed for publishing and rejects forged proposals', async () => {
    const api = handlers();
    const context = { src: 'app/page.tsx:1:22', oldText: 'Hello', instruction: 'Shorten', outerHTML: '<p>Hello</p>', ancestors: [], pageUrl: 'https://site.test' };
    const proposal = await (await api.POST(request('agent', context))).json(); expect(writes).toBe(0); expect(proposal.proposalToken).toBeDefined();
    expect((await api.POST(request('publish', { proposals: [proposal.proposalToken + 'tamper'] }))).status).toBe(403);
    expect((await api.POST(request('publish', { proposals: [proposal.proposalToken] }))).status).toBe(200); expect(files['app/page.tsx']).toContain('AI copy');
  });
  it('stages a validated image upload for the same publish as its source patch', async () => {
    const api = handlers();
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2]).toString('base64');
    const response = await api.POST(request('image', { base64: png })); expect(response.status).toBe(200); const result = await response.json();
    expect(result.src).toMatch(/^\/inlinecms\/.*\.png$/); expect(writes).toBe(0);
    expect((await api.POST(request('image', { base64: Buffer.from('<svg onload="bad()"/>').toString('base64') }))).status).toBe(400);
  });
});

describe('hosted authorization', () => {
  it('checks repository push permission, rejects invalid OAuth state and encrypts the session credential', async () => {
    vi.stubEnv('INLINECMS_SINK', 'github'); vi.stubEnv('INLINECMS_GITHUB_REPO', 'team/site');
    vi.stubEnv('INLINECMS_GITHUB_CLIENT_ID', 'test-client'); vi.stubEnv('INLINECMS_GITHUB_CLIENT_SECRET', 'test-oauth-key');
    let push = true;
    const http = (async (target: string) => {
      if (target.includes('/login/oauth/access_token')) return Response.json({ access_token: 'test-token-placeholder' });
      if (target.endsWith('/repos/team/site')) return Response.json({ permissions: { push } });
      if (target.endsWith('/user')) return Response.json({ login: 'writer' });
      throw new Error('Unexpected provider request');
    }) as unknown as typeof fetch;
    const api = createHandlers({ enabled: true, secret, fetch: http });
    const login = await api.GET(request('login', undefined, '')); expect(login.status).toBe(302);
    const location = new URL(login.headers.get('location')!), state = location.searchParams.get('state')!;
    const stateCookie = login.headers.get('set-cookie')!.split(';')[0];
    expect((await api.GET(request('callback?code=code&state=wrong', undefined, stateCookie))).status).toBe(403);
    const response = await api.GET(request(`callback?code=code&state=${state}`, undefined, stateCookie)); expect(response.status).toBe(302);
    const sessionHeader = response.headers.get('set-cookie')!; expect(sessionHeader).not.toContain('test-token-placeholder');
    const sessionCookie = sessionHeader.split(';')[0];
    const auth = await api.GET(request('auth', undefined, sessionCookie)); expect((await auth.json()).authenticated).toBe(true);
    push = false; expect((await api.GET(request('auth', undefined, sessionCookie))).status).toBe(403);
  });
  it('allows a legitimate loopback Host while still refusing cross-Origin writes', async () => {
    vi.stubEnv('INLINECMS_ORIGIN', ''); vi.unstubAllEnvs(); vi.stubEnv('INLINECMS_SINK', 'fs');
    const api = handlers();
    vi.stubEnv('INLINE_CMS_SECRET', loginSecret);
    const good = new Request('http://localhost:3000/api/cms/auth', { method: 'POST', headers: { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: loginSecret }) });
    expect((await api.POST(good)).status).toBe(200);
    const bad = new Request('http://localhost:3000/api/cms/auth', { method: 'POST', headers: { Host: '127.0.0.1:3000', Origin: 'https://evil.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: loginSecret }) });
    expect((await api.POST(bad)).status).toBe(403);
  });
});
