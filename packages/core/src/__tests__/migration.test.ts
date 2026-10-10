import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { migrate } from '../cli/migrate.js';
import { configWith } from '../config.js';
import { scoreEditability } from '../cli/doctor.js';
import { FsSink } from '../sinks/fs.js';
describe('readiness CLI', () => {
  it('migrates both build-time and hand-wired overrides, removing v1 calls', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cms-migrate-'));
    try {
      await mkdir(join(root, 'app')); await mkdir(join(root, 'content'));
      await writeFile(join(root, 'app/page.tsx'), 'import {getCms, useContentVersion} from "@inlinecms/react";\nexport default function Home(){useContentVersion();return <main><h1 data-cms="old">{getCms("old", "Original")}</h1><p>Unwired</p></main>;}');
      await writeFile(join(root, 'app/layout.tsx'), 'import {InlineCMSProvider} from "@inlinecms/react"; export default function Layout({children}){return <InlineCMSProvider defaultLocale="en" locales={["en"]}>{children}</InlineCMSProvider>}');
      const overrides = { old: 'Saved copy', 'app/page.tsx::Home>main>p#children': 'Persisted paragraph' };
      await writeFile(join(root, 'content/content.en.json'), JSON.stringify(overrides));
      const preview = await migrate(root, configWith(), 'content/content.en.json'); expect(preview.written).toBe(false); expect(preview.unmatched).toEqual([]);
      expect((await readFile(join(root, 'app/page.tsx'), 'utf8'))).toContain('getCms');
      await migrate(root, configWith(), 'content/content.en.json', true);
      const source = await readFile(join(root, 'app/page.tsx'), 'utf8');
      expect(source).toContain('Saved copy'); expect(source).toContain('Persisted paragraph'); expect(source).not.toContain('getCms'); expect(source).not.toContain('data-cms');
      const layout = await readFile(join(root, 'app/layout.tsx'), 'utf8');expect(layout).toContain("InlineCMS as InlineCMSProvider");expect(layout).toContain("@inlinecms/react/server");expect(layout).not.toContain('defaultLocale');
      await expect(access(join(root, 'content/content.en.json'))).rejects.toThrow();
      const score = await scoreEditability(new FsSink(root, configWith()), configWith(), [{ src: 'app/page.tsx:1:1', text: 'Saved copy' }, { src: '(no locator)', text: 'Unknown' }]);
      expect(score.score).toBe(50); expect(score.offenders).toHaveLength(1);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it.each(['mjs', 'js', 'cjs', 'ts'])('migrates root Next %s configuration outside the content globs', async extension => {
    const root = await mkdtemp(join(tmpdir(), 'cms-config-migrate-'));
    try {
      await mkdir(join(root, 'content')); await writeFile(join(root, 'content/content.en.json'), '{}');
      const name = `next.config.${extension}`;
      const code = extension === 'cjs' ? "const cms = require('@inlinecms/babel-plugin/next'); module.exports=cms({});" : "import cms from '@inlinecms/babel-plugin/next'; export default cms({});";
      await writeFile(join(root, name), code);
      const preview = await migrate(root, configWith(), 'content/content.en.json');
      expect(preview.changes[0].path).toBe(name);
      await migrate(root, configWith(), 'content/content.en.json', true);
      expect(await readFile(join(root, name), 'utf8')).toBe(code.replace('@inlinecms/babel-plugin/next', '@inlinecms/transform/next'));
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('preserves unmatched v1 overrides and source without partial writes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cms-migrate-'));
    try {
      await mkdir(join(root, 'app')); await mkdir(join(root, 'content'));
      const source = 'export default function Home(){return <p>Original</p>}';
      await writeFile(join(root, 'app/page.tsx'), source);
      await writeFile(join(root, 'content/content.en.json'), JSON.stringify({ 'app/page.tsx::Home>p#children': 'Saved', orphan: 'Important copy' }));
      await expect(migrate(root, configWith(), 'content/content.en.json', true)).rejects.toThrow('Refusing');
      expect(await readFile(join(root, 'app/page.tsx'), 'utf8')).toBe(source);
      await access(join(root, 'content/content.en.json'));
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
