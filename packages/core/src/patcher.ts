import { createPatch } from 'diff';
import { parseSource } from './source.js';
import { validateAstro } from './astro.js';
import type { Candidate, FileChange } from './types.js';

export function encodeJSX(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/{/g, '&#123;').replace(/}/g, '&#125;');
}
export function encodeLiteral(candidate: Candidate, value: string): string {
  const { kind, raw } = candidate;
  if (kind === 'json') return JSON.stringify(value);
  if (kind === 'jsx' || kind === 'astro-text') {
    const leading = raw.match(/^\s*/u)![0], trailing = raw.match(/\s*$/u)![0];
    const text = (leading ? value.replace(/^\s+/u, '') : value);
    return leading + encodeJSX(trailing ? text.replace(/\s+$/u, '') : text) + trailing;
  }
  if (kind === 'jsx-attribute' || kind === 'astro-attribute') {
    const quote = raw[0];
    return quote + encodeJSX(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;') + quote;
  }
  if (kind === 'template') return '`' + value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${') + '`';
  const quote = raw[0] === "'" ? "'" : '"';
  const encoded = JSON.stringify(value).slice(1, -1);
  return quote + (quote === "'" ? encoded.replace(/\\"/g, '"').replace(/'/g, "\\'") : encoded) + quote;
}
export function unifiedDiff(path: string, before: string, after: string): string {
  return createPatch(path, before, after, '', '', { context: 3 });
}
export async function patchSource(path: string, content: string, edits: { candidate: Candidate; newText: string }[]): Promise<FileChange> {
  const sorted = [...edits].sort((a, b) => b.candidate.start - a.candidate.start);
  let end = content.length, result = content;
  for (const { candidate, newText } of sorted) {
    if (candidate.path !== path || candidate.end > end || content.slice(candidate.start, candidate.end) !== candidate.raw) throw new Error('Overlapping or stale source edits');
    result = result.slice(0, candidate.start) + encodeLiteral(candidate, newText) + result.slice(candidate.end);
    end = candidate.start;
  }
  if (path.endsWith('.astro')) await validateAstro(result); else parseSource(result, path);
  return { path, content: result, baseRev: edits[0].candidate.baseRev, diff: unifiedDiff(path, content, result) };
}
