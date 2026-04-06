import { describe, it, expect } from 'vitest';
import * as babel from '@babel/core';
import { inlineCMSBabelPlugin } from '../transform/plugin.js';
import type { InlineCMSConfig } from '../core/config.js';

const DEFAULT_CONFIG: InlineCMSConfig = {
  include: ['**/*.tsx'],
  exclude: [],
  defaultLocale: 'en',
  locales: ['en'],
  contentDir: './content',
  attributes: ['alt', 'title', 'placeholder', 'aria-label'],
};

function transform(code: string, options?: { extractOnly?: boolean; filename?: string }) {
  const filename = options?.filename ?? '/project/app/page.tsx';
  const result = babel.transformSync(code, {
    filename,
    plugins: [
      [inlineCMSBabelPlugin, {
        config: DEFAULT_CONFIG,
        projectRoot: '/project',
        extractOnly: options?.extractOnly ?? false,
      }],
    ],
    parserOpts: { plugins: ['jsx'] },
  });
  return result?.code ?? '';
}

describe('inlineCMSBabelPlugin — extraction mode', () => {
  it('does not modify code in extractOnly mode', () => {
    const input = `
function Home() {
  return <h1>Hello World</h1>;
}`;
    const output = transform(input, { extractOnly: true });
    expect(output).toContain('Hello World');
    expect(output).not.toContain('cms');
    expect(output).not.toContain('data-cms');
  });
});

describe('inlineCMSBabelPlugin — rewrite mode', () => {
  it('rewrites text children to cms() calls', () => {
    const input = `
function Home() {
  return <h1>Hello World</h1>;
}`;
    const output = transform(input);
    expect(output).toContain('__inlinecms_cms');
    expect(output).toContain('"Hello World"');
    expect(output).toContain('data-cms');
  });

  it('rewrites extractable attributes', () => {
    const input = `
function Home() {
  return <img alt="A nice photo" />;
}`;
    const output = transform(input);
    expect(output).toContain('__inlinecms_cms');
    expect(output).toContain('"A nice photo"');
    expect(output).toContain('data-cms');
  });

  it('skips non-extractable attributes', () => {
    const input = `
function Home() {
  return <div className="test" id="main">Hello</div>;
}`;
    const output = transform(input);
    expect(output).toContain('className="test"');
    expect(output).toContain('id="main"');
    // className and id should not be wrapped in cms()
    expect(output).not.toContain('cms("app/page.tsx::Home>div#className"');
  });

  it('skips empty/whitespace-only text', () => {
    const input = `
function Home() {
  return <div>   </div>;
}`;
    const output = transform(input);
    expect(output).not.toContain('__inlinecms_cms');
  });

  it('uses getCms (non-hook) for client components', () => {
    const input = `'use client';
function Counter() {
  return <p>Click me</p>;
}`;
    const output = transform(input);
    expect(output).toContain('__inlinecms_getCms');
    // Should NOT use hook-based useCms — getCms is a plain function
    expect(output).not.toContain('useCms');
    expect(output).not.toContain('__inlinecms_cms(');
  });

  it('injects useContentVersion() call in client component body', () => {
    const input = `'use client';
function Counter() {
  return <p>Click me</p>;
}`;
    const output = transform(input);
    expect(output).toContain('__inlinecms_useContentVersion()');
    expect(output).toContain('import { getCms as __inlinecms_getCms, useContentVersion as __inlinecms_useContentVersion }');
  });

  it('does not inject useContentVersion() in server components', () => {
    const input = `
function Home() {
  return <h1>Hello World</h1>;
}`;
    const output = transform(input);
    expect(output).not.toContain('useContentVersion');
  });

  it('injects import statement', () => {
    const input = `
function Home() {
  return <h1>Title</h1>;
}`;
    const output = transform(input);
    expect(output).toContain('from "@inlinecms/react"');
  });

  it('handles nested elements', () => {
    const input = `
function Home() {
  return (
    <main>
      <section>
        <h1>Nested Title</h1>
      </section>
    </main>
  );
}`;
    const output = transform(input);
    expect(output).toContain('__inlinecms_cms');
    expect(output).toContain('Home>main>section>h1#children');
  });

  it('handles multiple elements', () => {
    const input = `
function Home() {
  return (
    <div>
      <h1>Title</h1>
      <p>Body text</p>
    </div>
  );
}`;
    const output = transform(input);
    expect(output).toContain('h1#children');
    expect(output).toContain('p#children');
  });

  it('resolves component name from arrow function', () => {
    const input = `
const Hero = () => {
  return <h1>Hero Title</h1>;
};`;
    const output = transform(input);
    expect(output).toContain('Hero>h1#children');
  });
});
