import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { hostedSnapshot, validateHostedProposal } from '../hosted-proposal.js';
import { configWith } from '../config.js';

describe('hosted proposal isolation', () => {
  it('snapshots only included source and rejects unsafe model output before any write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cms-hosted-'));
    try {
      await mkdir(join(root, 'app')); await mkdir(join(root, 'content'));
      await writeFile(join(root, 'app/page.tsx'), 'export default () => <p>Hello</p>;');
      await writeFile(join(root, 'package.json'), '{"private":true}');
      const request = 'content/inlinecms-request-abcd.json';
      await writeFile(join(root, request), JSON.stringify({ instruction: 'Improve this copy', include: ['**/*'] }));
      const config = configWith();
      const snapshot = await hostedSnapshot(root, config, request);
      expect(snapshot.sources.map(s => s.path)).toEqual(['app/page.tsx']);
      const safe = await validateHostedProposal(root, config, { changes: [{ path: 'app/page.tsx', content: 'export default () => <p>New</p>;' }, { path: 'content/new.ts', content: 'export const copy="New";' }] });
      expect(safe).toHaveLength(2); expect(safe[0].baseRev).not.toBe(''); expect(safe[1].baseRev).toBe('');
      for (const path of ['package.json', '../outside.ts', '.github/workflows/run.yml', request]) {
        await expect(validateHostedProposal(root, config, { changes: [{ path, content: 'bad' }] })).rejects.toThrow();
      }
      await expect(validateHostedProposal(root, config, { changes: [{ path: 'app/page.tsx', content: 'const broken = <' }] })).rejects.toThrow();
      await symlink(join(root, 'package.json'), join(root, 'content/link.ts'));
      await expect(validateHostedProposal(root, config, { changes: [{ path: 'content/link.ts', content: 'export const copy="Bad";' }] })).rejects.toThrow('Symlinked');
      expect((await hostedSnapshot(root, { ...config, exclude: [...config.exclude, '**/link.ts'] }, request)).sources[0].content).toContain('Hello');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
