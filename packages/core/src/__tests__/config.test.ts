import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'tsup';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG } from '../config.js';

const exec = promisify(execFile);
let output: string;
beforeAll(async () => {
  output = await mkdtemp(join(tmpdir(), 'cms-config-build-'));
  // Exercise native Node loading in both published formats, without Vite's import rewriting.
  await build({ entry: [fileURLToPath(new URL('../config.ts', import.meta.url))], outDir: output,
    format: ['esm', 'cjs'], outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' }),
    noExternal: ['picomatch'], config: false, silent: true });
});
afterAll(async () => { if (output) await rm(output, { recursive: true, force: true }); });

describe.each(['mjs', 'cjs'])('Node configuration loading from the %s build', format => {
  it.each([
    ['mjs', 'commonjs', 'await Promise.resolve(); export default { routes: ["/esm"], localCommit: true };'],
    ['js', 'module', 'await Promise.resolve(); export default { routes: ["/esm"], localCommit: true };'],
    ['js', 'commonjs', 'module.exports = { routes: ["/esm"], localCommit: true };'],
    ['js', 'commonjs', 'exports.__esModule = true; exports.default = { routes: ["/esm"], localCommit: true };'],
    ['ts', 'commonjs', 'module.exports = { routes: ["/esm"], localCommit: true };'],
  ])('loads %s configuration in a %s project', async (extension, type, source) => {
    const root = await mkdtemp(join(tmpdir(), 'cms config #'));
    try {
      await writeFile(join(root, 'package.json'), JSON.stringify({ type }));
      await writeFile(join(root, `inlinecms.config.${extension}`), source);
      const moduleURL = pathToFileURL(join(output, `config.${format}`)).href;
      const { stdout } = await exec(process.execPath, ['--input-type=module', '--eval',
        'const { loadConfig } = await import(process.argv[1]); console.log(JSON.stringify(await loadConfig(process.argv[2])));', moduleURL, root]);
      const config = JSON.parse(stdout);
      expect(config.routes).toEqual(['/esm']);
      expect(config.localCommit).toBe(true);
      expect(config.include).toEqual(DEFAULT_CONFIG.include);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
