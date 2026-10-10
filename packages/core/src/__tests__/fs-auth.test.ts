import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FsSink } from '../sinks/fs.js';
import { configWith } from '../config.js';
import { signToken, verifyToken, seal, unseal, validOrigin } from '../auth.js';
const dirs: string[] = []; afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); vi.useRealTimers(); });
async function setup() { const root = await mkdtemp(join(tmpdir(), 'inlinecms-')); dirs.push(root); await mkdir(join(root, 'app')); await writeFile(join(root, 'app/page.tsx'), 'const text = "Hello";'); return new FsSink(root, configWith()); }
describe('filesystem publish', () => {
  it('writes source and checks the per-file revision', async () => {
    const sink = await setup(), file = await sink.read('app/page.tsx');
    const change = { path: 'app/page.tsx', content: 'const text = "New";', baseRev: file.rev, diff: '' };
    await sink.write([change], 'CMS source update'); expect((await sink.read(change.path)).content).toBe(change.content);
    await expect(sink.write([change], 'Again')).rejects.toThrow('Source changed');
  });
  it('holds the publish lock until the optional Git commit finishes', async () => {
    const sink = await setup(), exec = promisify(execFile);
    for (const args of [['init', '-q'], ['config', 'user.name', 'CMS Test'], ['config', 'user.email', 'cms@example.test'], ['add', '.'], ['commit', '-qm', 'Initial']]) await exec('git', args, { cwd: sink.root });
    await writeFile(join(sink.root, '.git/hooks/pre-commit'), '#!/bin/sh\ntouch commit-started\nwhile test ! -f commit-continue; do sleep 0.05; done\ntest -f .inlinecms-write.lock\n', { mode: 0o755 });
    sink.config.localCommit = true;
    const file = await sink.read('app/page.tsx');
    const publishing = sink.write([{ path: 'app/page.tsx', content: 'const text="First";', baseRev: file.rev, diff: '' }], 'First publish');
    try {
      const deadline = Date.now() + 2000;
      while (!(await readFile(join(sink.root, 'commit-started')).catch(() => undefined))) {
        if (Date.now() > deadline) throw new Error('Commit hook did not run');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      const current = await sink.read('app/page.tsx');
      await expect(sink.write([{ path: 'app/page.tsx', content: 'const text="Second";', baseRev: current.rev, diff: '' }], 'Second publish')).rejects.toThrow('Another publish');
    } finally { await writeFile(join(sink.root, 'commit-continue'), ''); }
    expect((await publishing).committed).toBe(true);
    const { stdout } = await exec('git', ['show', 'HEAD:app/page.tsx'], { cwd: sink.root });
    expect(stdout).toBe('const text="First";');
  });
  it('preflights every file before changing the first', async () => {
    const sink = await setup(), file = await sink.read('app/page.tsx');
    await writeFile(join(sink.root, 'app/other.tsx'), 'Other');
    await expect(sink.write([{ path: 'app/page.tsx', content: 'Changed', baseRev: file.rev, diff: '' }, { path: 'app/other.tsx', content: 'Oops', baseRev: 'stale', diff: '' }], 'CMS')).rejects.toThrow('Source changed');
    expect((await sink.read('app/page.tsx')).content).toBe(file.content);
  });
  it('refuses symlinks escaping the project and arbitrary uploads', async () => {
    const sink = await setup(), outside = await mkdtemp(join(tmpdir(), 'inlinecms-outside-')); dirs.push(outside);
    await writeFile(join(outside, 'secret.tsx'), 'private'); await symlink(join(outside, 'secret.tsx'), join(sink.root, 'app/link.tsx'));
    await expect(sink.read('app/link.tsx')).rejects.toThrow('symlinks');
    await expect(sink.write([{ path: 'public/shell.js', content: 'bad', baseRev: '', diff: '' }], 'CMS')).rejects.toThrow('scope');
  });
  it('writes a new image together with its source edit', async () => {
    const sink = await setup(), file = await sink.read('app/page.tsx');
    await sink.write([{ path: 'app/page.tsx', content: 'const src="/inlinecms/image.png";', baseRev: file.rev, diff: '' }, { path: 'public/inlinecms/image.png', content: Buffer.from('png').toString('base64'), encoding: 'base64', baseRev: '', diff: '' }], 'Image');
    expect((await readFile(join(sink.root, 'public/inlinecms/image.png'))).toString()).toBe('png');
  });
});
describe('signed sessions', () => {
  it('refuses wrong signatures, raw secrets and expired tokens', () => {
    vi.useFakeTimers(); const token = signToken({ user: 'local' }, 'test-key', 2);
    expect(verifyToken(token, 'test-key')).toEqual({ user: 'local' });
    expect(verifyToken(token, 'other')).toBeNull(); expect(verifyToken('test-key', 'test-key')).toBeNull();
    expect(verifyToken(token + '.extra', 'test-key')).toBeNull(); vi.advanceTimersByTime(3000); expect(verifyToken(token, 'test-key')).toBeNull();
  });
  it('encrypts OAuth credentials and requires an exact Origin', () => {
    const ciphertext = seal('access-token', 'secret-key'); expect(ciphertext).not.toContain('access-token'); expect(unseal(ciphertext, 'secret-key')).toBe('access-token');
    expect(() => unseal(ciphertext, 'bad-key')).toThrow();
    expect(validOrigin(new Request('https://site.test/api/cms/auth', { headers: { Origin: 'https://site.test' } }))).toBe(true);
    expect(validOrigin(new Request('https://site.test/api/cms/auth', { headers: { Origin: 'https://site.test.evil' } }))).toBe(false);
  });
});
