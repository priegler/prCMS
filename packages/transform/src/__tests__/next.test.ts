import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import withInlineCMS from '../next.js';
async function project(version: string) {
  const root = await mkdtemp(join(tmpdir(), 'inlinecms-next-'));
  await mkdir(join(root, 'node_modules/next'), { recursive: true });
  await writeFile(join(root, 'node_modules/next/package.json'), JSON.stringify({ version }));
  return root;
}
describe('Next wrapper', () => {
  it.each(['15.2.0', '15.5.14', '16.4.0'])('registers the loader for Next %s without virtual filename changes', async version => {
    const root = await project(version);
    try {
      const previous = { loaders: ['existing-loader'] };
      const original = { experimental: { turbo: { rules: { '*.tsx': previous } } }, turbopack: { rules: { '*.tsx': previous } }, webpack: (config: any) => { config.user = true; return config; } };
      const config = withInlineCMS(original, { root, enabled: true });
      const turbo = version === '15.2.0' ? config.experimental.turbo : config.turbopack;
      expect(turbo.rules['*.tsx'][0]).toEqual(previous); expect(turbo.rules['*.tsx'][1]).not.toHaveProperty('as');
      expect(turbo.rules['*.tsx'][1].loaders[0].options.root).toBe(root);
      const webpack = config.webpack({ module: { rules: [] } }, { dir: root });
      expect(webpack.user).toBe(true); expect(webpack.module.rules[0].enforce).toBe('pre');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it.each(['15.2.0', '15.5.14', '16.4.0'])('removes editor entries in production on Next %s', async version => {
    const root = await project(version);
    try {
      const original = { experimental: { turbo: { resolveAlias: { existing: 'kept' } } }, turbopack: { resolveAlias: { existing: 'kept' } }, webpack: (c: any) => { c.existing = true; return c; } };
      const config = withInlineCMS(original, { root, enabled: false });
      const turbo = version === '15.2.0' ? config.experimental.turbo : config.turbopack;
      expect(turbo.rules).toBeUndefined(); expect(turbo.resolveAlias.existing).toBe('kept');
      expect(turbo.resolveAlias['@inlinecms/react/server']).toBe('@inlinecms/react/production');
      expect(turbo.resolveAlias['@inlinecms/react/api']).toBe('@inlinecms/react/disabled-api');
      const webpack = config.webpack({}, {});
      expect(webpack.existing).toBe(true); expect(webpack.resolve.alias['@inlinecms/react/server$']).toBe('@inlinecms/react/production');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
