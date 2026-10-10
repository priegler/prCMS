import { describe, expect, it } from 'vitest';
import { GitHubSink } from '../sinks/github.js';
import { configWith } from '../config.js';
function setup(race = false) {
  const calls: { path: string; init: RequestInit }[] = []; let head = 'deployed';
  const http = (async (url: string, init: RequestInit = {}) => {
    const path = url.split('/repos/team/site')[1]; calls.push({ path, init });
    const json = (data: unknown, status = 200) => Response.json(data, { status });
    if (path === '/git/trees/deployed?recursive=1') return json({ truncated: false, tree: [{ path: 'app/page.tsx', type: 'blob', mode: '100644', sha: 'blob-old' }] });
    if (path === '/git/blobs/blob-old') return json({ content: Buffer.from('const text="Hello";').toString('base64'), encoding: 'base64' });
    if (path === '/git/refs') { if (race) head = 'other-commit'; return json({ ref: 'cms' }, 201); }
    if (path.startsWith('/git/ref/heads/')) return json({ object: { sha: head } });
    if (path === '/git/commits/deployed') return json({ tree: { sha: 'tree-old' } });
    if (path === '/git/blobs') return json({ sha: 'blob-new' }, 201);
    if (path === '/git/trees') return json({ sha: 'tree-new' }, 201);
    if (path === '/git/commits') return json({ sha: 'new-commit' }, 201);
    if (path.startsWith('/git/refs/heads/')) { head = 'new-commit'; return json({ object: { sha: head } }); }
    if (path === '') return json({ default_branch: 'main' });
    if (path.startsWith('/pulls?')) return json([]);
    if (path === '/pulls') return json({ html_url: 'https://github.com/team/site/pull/7', number: 7 }, 201);
    throw new Error(`Unexpected GitHub call ${path}`);
  }) as unknown as typeof fetch;
  const sink = new GitHubSink({ owner: 'team', repo: 'site', token: 'test-token-placeholder', deployedSha: 'deployed', user: 'editor', branch: 'cms/test-editor', config: configWith(), fetch: http });
  return { sink, calls };
}
describe('GitHub sink', () => {
  it('reads deployed source and publishes multiple files through a single Git Data commit', async () => {
    const { sink, calls } = setup(); expect((await sink.read('app/page.tsx')).rev).toBe('blob-old');
    const result = await sink.write([{ path: 'app/page.tsx', baseRev: 'blob-old', content: 'const text="New";', diff: '' }, { path: 'public/inlinecms/image.png', baseRev: '', encoding: 'base64', content: 'cG5n', diff: '' }], 'CMS update');
    expect(result.prNumber).toBe(7); expect(result.committed).toBe(true);
    const commits = calls.filter(c => c.path === '/git/commits'); expect(commits).toHaveLength(1);
    expect(JSON.parse(commits[0].init.body as string).parents).toEqual(['deployed']);
    const tree = calls.find(c => c.path === '/git/trees')!; expect(JSON.parse(tree.init.body as string).tree).toHaveLength(2);
    const ref = calls.find(c => c.path.startsWith('/git/refs/heads/'))!; expect(JSON.parse(ref.init.body as string).force).toBe(false);
    expect(calls.some(c => c.path === '/git/blobs' && JSON.parse(c.init.body as string).encoding === 'base64')).toBe(true);
  });
  it('refuses stale file revisions and concurrent branch creation', async () => {
    const { sink, calls } = setup();
    await expect(sink.write([{ path: 'app/page.tsx', baseRev: 'stale', content: 'New', diff: '' }], 'CMS')).rejects.toThrow('Source changed');
    expect(calls.some(c => c.init.method === 'POST')).toBe(false);
    const racing = setup(true).sink;
    await expect(racing.write([{ path: 'app/page.tsx', baseRev: 'blob-old', content: 'New', diff: '' }], 'CMS')).rejects.toThrow('advanced');
  });
  it('validates both rename paths before approving an agent draft', async () => {
    const { sink } = setup();
    sink.api = (async (path: string) => {
      if (path === '/pulls/7') return { head: { ref: sink.branch, sha: 'reviewed' }, state: 'open', draft: true };
      if (path.startsWith('/deployments')) return [];
      if (path.startsWith('/pulls/7/files')) return [{ filename: 'content/package.ts', previous_filename: 'package.json', status: 'renamed', patch: 'rename' }];
      throw new Error('Unexpected call');
    }) as typeof sink.api;
    await expect(sink.approveAgent(7, 'reviewed')).rejects.toThrow('scope');
    sink.options.prefix = 'site';
    sink.api = (async (path: string) => {
      if (path === '/pulls/7') return { head: { ref: sink.branch, sha: 'reviewed' }, state: 'open' };
      if (path.startsWith('/deployments')) return [];
      if (path.startsWith('/pulls/7/files')) return [{ filename: 'site/content/copy.ts', previous_filename: 'outside/content/copy.ts', status: 'renamed' }];
      throw new Error('Unexpected call');
    }) as typeof sink.api;
    await expect(sink.approveAgent(7, 'reviewed')).rejects.toThrow('outside the source project');
  });
  it('uses one existing PR and preserves its base branch', async () => {
    const { sink } = setup();
    sink.options.fetch = undefined;
    const originalApi = sink.api.bind(sink);
    sink.api = (async (path: string, init?: RequestInit) => path.startsWith('/pulls?') ? [{ html_url: 'https://github.com/team/site/pull/3', number: 3 }] : originalApi(path, init)) as typeof sink.api;
    const result = await sink.write([{ path: 'app/page.tsx', baseRev: 'blob-old', content: 'New', diff: '' }], 'CMS');
    expect(result.prNumber).toBe(3);
  });
});
