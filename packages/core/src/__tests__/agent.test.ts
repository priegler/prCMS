import { describe, expect, it, vi } from 'vitest';
import { runLocalAgent } from '../agent.js';
import { configWith } from '../config.js';
import type { Sink } from '../types.js';
const observed = vi.hoisted(() => ({ options: null as any, tools: [] as any[], empty: false }));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (value: any) => { observed.tools = value.tools; return value; },
  tool: (name: string, description: string, schema: unknown, handler: any) => ({ name, handler }),
  query: async function* ({ options }: any) {
    observed.options = options;
    if (observed.empty) { yield { type: 'result', subtype: 'success', result: 'No changes needed' }; return; }
    const read = observed.tools.find(t => t.name === 'read').handler;
    const write = observed.tools.find(t => t.name === 'write').handler;
    await expect(read({ path: '../.env' })).rejects.toThrow('scope');
    await expect(write({ path: 'content/copy.ts', content: 'const =' })).rejects.toThrow();
    await write({ path: 'content/copy.ts', content: 'export const features = ["One", "Two", "Three", "Four"];' });
    await write({ path: 'components/New.tsx', content: 'export const New = () => <p>Created copy</p>;' });
    yield { type: 'result', subtype: 'success', result: 'Added a fourth feature and a component' };
  },
}));
describe('scoped agent proposals', () => {
  it('rejects a successful SDK result without source changes', async () => {
    observed.empty = true;
    try {
      const sink: Sink = { async list() { return []; }, async read() { throw new Error('Unexpected read'); }, async write() { throw new Error('Unexpected write'); } };
      await expect(runLocalAgent('/project', sink, configWith(), { src: 'app/page.tsx:1:1', ancestors: [], oldText: 'One', pageUrl: 'http://site.test', outerHTML: '<p>One</p>', instruction: 'Improve it' })).rejects.toThrow('no source changes');
    } finally { observed.empty = false; }
  });
  it('denies built-in tools, protects source scope and stages valid new/existing files without writing', async () => {
    let writes = 0;
    const sink: Sink = { async list() { return ['content/copy.ts']; }, async read() { return { content: 'export const features = ["One", "Two", "Three"];', rev: 'original' }; }, async write() { writes++; return { committed: false }; } };
    const result = await runLocalAgent('/project', sink, configWith(), { src: 'app/page.tsx:1:1', ancestors: [], oldText: 'One', pageUrl: 'http://site.test', outerHTML: '<p>One</p>', instruction: 'Add a fourth feature' });
    expect(writes).toBe(0); expect(result.changes).toHaveLength(2); expect(result.changes[0].diff).toContain('Four'); expect(result.changes[1].baseRev).toBe('');
    expect(observed.options.settingSources).toEqual([]); expect(observed.options.tools).toEqual([]);
    expect((await observed.options.canUseTool('Bash', { command: 'echo unsafe' })).behavior).toBe('deny');
  });
});
