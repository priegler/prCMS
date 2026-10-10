import { parse } from '@astrojs/compiler';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { transformLocator } from '../locator.js';
import { transformAstro } from '../astro.js';
import { inlineCMS } from '../index.js';
afterEach(() => vi.unstubAllEnvs());
describe('locator transform', () => {
  it('preserves server and client source and locates only host elements', () => {
    for (const prefix of ['', "'use client';\n"]) {
      const source = prefix + 'export const Page = () => <main><Card><p>Hello</p></Card><img alt="Photo"/></main>;';
      const output = transformLocator(source, '/project/app/page.tsx', { root: '/project', enabled: true })!;
      expect(output.code).toContain('<main data-src='); expect(output.code).toContain('<p data-src=');
      expect(output.code).toContain('<Card>'); expect(output.code).not.toContain('<Card data-src');
      expect(output.code.replace(/ data-src="[^"]+"/g, '')).toBe(source); expect(output.map.sourcesContent).toEqual([source]);
      expect(output.code).not.toContain('cms(');
    }
  });
  it('puts locators after spreads and replaces a supplied locator', () => {
    const source = 'const P = () => <p data-src="old" {...props}>Hello</p>;';
    const output = transformLocator(source, '/p/app/page.tsx', { root: '/p', enabled: true })!.code;
    expect(output.match(/data-src=/g)).toHaveLength(1); expect(output).toMatch(/\.\.\.props\} data-src=/);
  });
  it('is a production no-op unless explicitly enabled', () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('INLINECMS_ENABLED', '');
    const code = 'const P = () => <p>Hello</p>;';
    expect(transformLocator(code, '/p/app/page.tsx', { root: '/p' })).toBeNull();
    vi.stubEnv('INLINECMS_ENABLED', '1'); expect(transformLocator(code, '/p/app/page.tsx', { root: '/p' })).not.toBeNull();
    vi.stubEnv('NODE_ENV', 'development'); expect(transformLocator(code, '/p/app/page.tsx', { root: '/p', enabled: false })).toBeNull();
  });
  it('respects project roots, exclude globs and module query strings', () => {
    const code = 'const P = () => <p>Hello</p>;', options = { root: '/p', enabled: true };
    expect(transformLocator(code, '/outside/app/page.tsx', options)).toBeNull(); expect(transformLocator(code, '/p/app/page.test.tsx', options)).toBeNull();
    expect(transformLocator(code, '/p/app/page.tsx?import', options)).not.toBeNull();
  });
  it('exposes bundler adapters', () => {
    for (const adapter of ['vite', 'webpack', 'rspack', 'esbuild'] as const) expect(typeof inlineCMS[adapter]).toBe('function');
  });
  it('traverses descendants of an Astro element with an existing locator', async () => {
    const output = await transformAstro('<main data-src="existing"><p>Hi</p><img /></main>', '/p/src/pages/index.astro', { root: '/p', enabled: true });
    expect(output!.code).toContain('<main data-src="existing">');
    expect(output!.code).toContain('<p data-src="src/pages/index.astro:1:');
    expect(output!.code).toContain('<img data-src="src/pages/index.astro:1:');
  });
  it('escapes Astro locator paths as attribute values', async () => {
    const path = 'src/pages/a"&.astro';
    const output = await transformAstro('<p>Hi</p>', '/p/' + path, { root: '/p', enabled: true });
    expect(output!.code).toContain('a&quot;&amp;.astro');
    const { ast } = await parse(output!.code);
    const element = ast.children.find(n => n.type === 'element');
    expect(element && 'attributes' in element && element.attributes[0].value).toBe(path + ':1:1');
  });
  it('locates Astro host templates after emoji without changing frontmatter or components', async () => {
    const code = '---\nconst title = "Hello";\n---\n<p>🚀</p><Card><h1>{title}</h1></Card><img alt="A" />';
    const output = await transformAstro(code, '/p/src/pages/index.astro', { root: '/p', enabled: true });
    expect(output!.code).toContain('<h1 data-src="src/pages/index.astro:4:');
    expect(output!.code).toContain('<Card>'); expect(output!.code.replace(/ data-src="[^"]+"/g, '')).toBe(code);
  });
});
