import { createRequire } from 'node:module';
import type { Node, TagLikeNode } from '@astrojs/compiler/types';
import { scanSource, candidateId } from './source.js';
import type { Candidate, SourceFile } from './types.js';
import { normalizeJSXWhitespace } from './normalize.js';

// The compiler's WASM/data-URL runtime must be loaded by Node, not a site's bundler.
const compiler = () => createRequire(import.meta.url)('@astrojs/compiler') as typeof import('@astrojs/compiler');

export const byteToIndex = (source: string, offset: number) => Buffer.from(source).subarray(0, offset).toString('utf8').length;
export async function validateAstro(content: string) {
  const result = await compiler().transform(content, { filename: 'source.astro' });
  if (result.diagnostics.some(d => d.severity === 1)) throw new Error('Patched Astro source does not compile');
}
export async function scanAstro(path: string, file: SourceFile) {
  const { ast } = await compiler().parse(file.content, { position: true });
  const candidates: Candidate[] = [], imports: string[] = [];
  const elements = new Map<string, Candidate[]>();
  const byNode = new Map<Node, Candidate[]>();
  function add(start: number, end: number, value: string, kind: Candidate['kind'], attribute?: string) {
    const before = file.content.slice(0, start), lines = before.split('\n');
    const candidate: Candidate = { id: candidateId(path, start, end), path, start, end, value, kind, raw: file.content.slice(start, end), line: lines.length, column: [...lines.at(-1)!].length + 1, baseRev: file.rev, attribute };
    candidates.push(candidate); return candidate;
  }
  function javascript(code: string, start: number) {
    const scanned = scanSource(path.replace(/\.astro$/, '.ts'), { content: code, rev: file.rev });
    imports.push(...scanned.imports);
    return scanned.candidates.map(c => add(c.start + start, c.end + start, c.value, c.kind));
  }
  function visit(node: Node, inExpression = false) {
    const point = node.position?.start;
    if (node.type === 'frontmatter' && point) {
      const index = file.content.indexOf(node.value, byteToIndex(file.content, point.offset) + 3);
      if (index >= 0) javascript(node.value, index);
    }
    if (node.type === 'text' && point && node.position?.end && !inExpression) {
      byNode.set(node, [add(byteToIndex(file.content, point.offset), byteToIndex(file.content, node.position.end.offset), normalizeJSXWhitespace(node.value), 'astro-text')]);
    }
    if (node.type === 'expression' && node.children.every(c => c.type === 'text') && node.children[0]?.position) {
      const code = node.children.map(c => c.type === 'text' ? c.value : '').join('');
      const start = byteToIndex(file.content, node.children[0].position.start.offset);
      try {
        const literal = javascript(`(${code})`, start - 1);
        if (literal.length === 1) byNode.set(node, literal);
      } catch { /* Nonliteral expressions are handled by text search / an agent. */ }
    }
    if ('children' in node) for (const child of node.children) visit(child, node.type === 'expression' || inExpression);
    if (!('attributes' in node) || !point) return;
    const tag = node as TagLikeNode, key = `${point.line}:${point.column}`;
    const visible = tag.children.filter(c => c.type !== 'comment' && !(c.type === 'text' && !c.value.trim()));
    const direct = visible.length === 1 ? byNode.get(visible[0]) ?? [] : [];
    elements.set(key, direct);
    let index = 0;
    for (const child of visible) if (child.type === 'text' || child.type === 'expression') elements.set(`${key}#text:${index++}`, byNode.get(child) ?? []);
    for (const attr of tag.attributes) {
      if (attr.kind !== 'quoted' || !attr.position) continue;
      const start = byteToIndex(file.content, attr.position.start.offset);
      const match = /^[^=\s]+\s*=\s*(["'])([\s\S]*?)\1/.exec(file.content.slice(start));
      if (!match) continue;
      const valueStart = start + match[0].indexOf(match[1]);
      const candidate = add(valueStart, start + match[0].length, attr.value, 'astro-attribute', attr.name);
      elements.set(`${key}#${attr.name}`, [candidate]);
    }
  }
  visit(ast); return { candidates, imports, elements };
}
