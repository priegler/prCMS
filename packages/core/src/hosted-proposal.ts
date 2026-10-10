import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { assertIncluded, type InlineCMSConfig } from './config.js';
import { FsSink } from './sinks/fs.js';
import { parseSource } from './source.js';
import { validateAstro } from './astro.js';
import { unifiedDiff } from './patcher.js';

const requestFile = /^content\/inlinecms-request-[a-f0-9-]+\.json$/;
const proposalSchema = z.object({ changes: z.array(z.object({ path: z.string(), content: z.string().max(500000) })).min(1).max(50) });

/** Build data for a tool-free hosted model; never load configuration from the PR. */
export async function hostedSnapshot(root: string, config: InlineCMSConfig, requestPath: string) {
  if (!requestFile.test(requestPath)) throw new Error('Invalid agent request path');
  const sink = new FsSink(root, config);
  const context = JSON.parse(await readFile(await sink.path(requestPath), 'utf8'));
  if (typeof context.instruction !== 'string') throw new Error('Missing agent instruction');
  const sources = [];
  let size = 0;
  for (const path of (await sink.list()).filter(path => !requestFile.test(path))) {
    assertIncluded(path, config);
    const file = await sink.read(path);
    size += file.content.length;
    if (size > 500000 || sources.length >= 250) throw new Error('Hosted snapshot too large; narrow its source scope');
    sources.push({ path, content: file.content });
  }
  return { context, sources };
}

/** Validate model output before any Git write credentials are used. */
export async function validateHostedProposal(root: string, config: InlineCMSConfig, input: unknown) {
  const proposal = proposalSchema.parse(input), sink = new FsSink(root, config);
  if (new Set(proposal.changes.map(c => c.path)).size !== proposal.changes.length) throw new Error('Duplicate proposal paths');
  const existing = new Set(await sink.list());
  let size = 0;
  const changes = [];
  for (const change of proposal.changes) {
    assertIncluded(change.path, config);
    if (requestFile.test(change.path)) throw new Error('The runner removes the agent request');
    size += change.content.length;
    if (size > 500000) throw new Error('Hosted proposal too large');
    await sink.path(change.path, !existing.has(change.path));
    const before = existing.has(change.path) ? await sink.read(change.path) : { content: '', rev: '' };
    if (change.path.endsWith('.astro')) await validateAstro(change.content); else parseSource(change.content, change.path);
    if (before.content !== change.content) changes.push({ ...change, baseRev: before.rev, diff: unifiedDiff(change.path, before.content, change.content) });
  }
  if (!changes.length) throw new Error('Agent proposed no source changes');
  return changes;
}
