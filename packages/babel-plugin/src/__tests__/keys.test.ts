import { describe, it, expect } from 'vitest';
import { generateKey, buildStructuralPath, contentHash } from '../core/keys.js';

describe('generateKey', () => {
  it('generates a structural key for text children', () => {
    const key = generateKey('app/page.tsx', 'Home', ['main', 'h1'], 'children');
    expect(key).toBe('app/page.tsx::Home>main>h1#children');
  });

  it('generates a key for an attribute', () => {
    const key = generateKey('app/page.tsx', 'Home', ['main', 'img'], 'alt');
    expect(key).toBe('app/page.tsx::Home>main>img#alt');
  });

  it('handles deeply nested elements', () => {
    const key = generateKey(
      'components/Card.tsx',
      'Card',
      ['div', 'header', 'h2', 'span'],
      'children',
    );
    expect(key).toBe('components/Card.tsx::Card>div>header>h2>span#children');
  });

  it('includes index for disambiguation', () => {
    const key = generateKey('app/page.tsx', 'Home', ['main', 'p'], 'children', 1);
    expect(key).toBe('app/page.tsx::Home>main>p[1]#children');
  });

  it('handles Anonymous component', () => {
    const key = generateKey('app/page.tsx', 'Anonymous', ['div'], 'children');
    expect(key).toBe('app/page.tsx::Anonymous>div#children');
  });
});

describe('buildStructuralPath', () => {
  it('builds a simple path', () => {
    const path = buildStructuralPath([
      { tag: 'main' },
      { tag: 'h1' },
    ]);
    expect(path).toEqual(['main', 'h1']);
  });

  it('includes sibling index when > 0', () => {
    const path = buildStructuralPath([
      { tag: 'main' },
      { tag: 'p', indexAmongSameTag: 2 },
    ]);
    expect(path).toEqual(['main', 'p[2]']);
  });

  it('omits index when 0', () => {
    const path = buildStructuralPath([
      { tag: 'div', indexAmongSameTag: 0 },
    ]);
    expect(path).toEqual(['div']);
  });
});

describe('contentHash', () => {
  it('produces a 12-char hex string', () => {
    const hash = contentHash('Hello world');
    expect(hash).toMatch(/^[a-f0-9]{12}$/);
  });

  it('is deterministic', () => {
    expect(contentHash('same input')).toBe(contentHash('same input'));
  });

  it('differs for different inputs', () => {
    expect(contentHash('hello')).not.toBe(contentHash('world'));
  });
});
