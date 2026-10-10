import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, realpath, rename, unlink, mkdir, open } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { glob } from 'glob';
import { assertIncluded, safePath, type InlineCMSConfig } from '../config.js';
import { ConflictError, type Sink, type FileChange, type PublishResult } from '../types.js';
const exec = promisify(execFile);
export function revision(content: string | Buffer) { return createHash('sha256').update(content).digest('hex'); }
export function assertWritable(path: string, config: InlineCMSConfig) {
  safePath(path);
  if (/^public\/inlinecms\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|gif|webp|avif)$/.test(path)) return;
  assertIncluded(path, config);
}
export class FsSink implements Sink {
  constructor(public root: string, public config: InlineCMSConfig) { this.root = resolve(root); }
  async path(path: string, newFile = false) {
    safePath(path);
    const target = resolve(this.root, path);
    const root = await realpath(this.root);
    let physical: string;
    try { physical = await realpath(target); }
    catch (error) {
      if (!newFile || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      let ancestor = dirname(target);
      while (true) {
        try { physical = resolve(await realpath(ancestor), relative(ancestor, target)); break; }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          const next = dirname(ancestor); if (next === ancestor) throw error; ancestor = next;
        }
      }
    }
    const rel = relative(root, physical);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Source symlinks cannot leave the project');
    if (rel.replace(/\\/g, '/') !== path) throw new Error('Symlinked source paths cannot be edited');
    return target;
  }
  async read(path: string) {
    assertIncluded(path, this.config);
    const content = await readFile(await this.path(path), 'utf8');
    return { content, rev: revision(content) };
  }
  async list() {
    return (await glob(this.config.include, { cwd: this.root, ignore: this.config.exclude, nodir: true, follow: false })).sort();
  }
  async write(changes: FileChange[], message: string): Promise<PublishResult> {
    if (!changes.length) return { committed: false, message: 'No changes' };
    if (new Set(changes.map(c => c.path)).size !== changes.length) throw new Error('Duplicate file changes');
    const lockPath = resolve(this.root, '.inlinecms-write.lock');
    const lock = await open(lockPath, 'wx').catch(() => { throw new ConflictError('Another publish is running; retry shortly'); });
    const prepared: { target: string; temp: string; before?: Buffer; after: Buffer; moved: boolean }[] = [];
    try {
      for (const change of changes) {
        assertWritable(change.path, this.config);
        const target = await this.path(change.path, change.baseRev === '');
        const before = await readFile(target).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
        if ((before ? revision(before) : '') !== change.baseRev) throw new ConflictError(`Source changed: ${change.path}`);
        await mkdir(dirname(target), { recursive: true });
        // Recheck after directory creation, before writing through a potential symlink.
        await this.path(change.path, change.baseRev === '');
        const temp = `${target}.inlinecms-${randomUUID()}`;
        const after = Buffer.from(change.content, change.encoding === 'base64' ? 'base64' : 'utf8');
        prepared.push({ target, temp, before, after, moved: false });
        await writeFile(temp, after, { flag: 'wx' });
      }
      for (const item of prepared) {
        const current = await readFile(item.target).catch(e => { if (e.code === 'ENOENT') return undefined; throw e; });
        if ((current ? revision(current) : '') !== (item.before ? revision(item.before) : '')) throw new ConflictError('Source changed during publish');
        await rename(item.temp, item.target); item.moved = true;
      }
      if (!this.config.localCommit) return { committed: false, message: 'Written to source; HMR will refresh the page' };
      try {
        const paths = changes.map(c => c.path);
        await exec('git', ['add', '--', ...paths], { cwd: this.root });
        await exec('git', ['commit', '--only', '-m', message, '--', ...paths], { cwd: this.root });
        const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: this.root });
        return { committed: true, commit: stdout.trim() };
      } catch { return { committed: false, message: 'Source saved, but the optional local commit failed. Commit it manually.' }; }
    } catch (error) {
      for (const item of prepared.filter(p => p.moved)) {
        const current = await readFile(item.target).catch(() => undefined);
        if (current && revision(current) === revision(item.after)) {
          if (item.before) await writeFile(item.target, item.before); else await unlink(item.target);
        }
      }
      throw error;
    } finally {
      for (const item of prepared) await unlink(item.temp).catch(() => {});
      await lock.close(); await unlink(lockPath);
    }
  }
}
