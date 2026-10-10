import { relative, resolve } from 'node:path';
import { parse } from '@babel/parser';
import * as t from '@babel/types';
import MagicString from 'magic-string';
import { configWith, isEnabled, isIncluded, type InlineCMSConfig } from '@inlinecms/core/config';

export interface TransformOptions extends Partial<InlineCMSConfig> { root?: string; enabled?: boolean }
export function transformLocator(code: string, id: string, options: TransformOptions = {}) {
  if (!(options.enabled ?? isEnabled())) return null;
  const path = relative(resolve(options.root ?? process.cwd()), id.split('?')[0]).replace(/\\/g, '/');
  if (!/\.[jt]sx$/.test(path) || !isIncluded(path, configWith(options))) return null;
  const ast = parse(code, { sourceType: 'unambiguous', plugins: ['jsx', 'typescript'] });
  const output = new MagicString(code);
  function visit(node: t.Node) {
    if (t.isJSXOpeningElement(node) && t.isJSXIdentifier(node.name) && /^[a-z]/.test(node.name.name) && node.loc && node.name.end != null) {
      // The DOM must always retain the locator, including after a prop spread.
      const previous = node.attributes.filter(a => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === 'data-src');
      for (const attr of previous) output.remove(attr.start!, attr.end!);
      const last = node.attributes.filter(a => !previous.includes(a)).at(-1);
      const position = last?.end ?? node.name.end;
      const src = `${path}:${node.loc.start.line}:${node.loc.start.column + 1}`;
      output.appendLeft(position!, ` data-src="${src.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`);
    }
    for (const key of t.VISITOR_KEYS[node.type] ?? []) {
      const child = (node as unknown as Record<string, unknown>)[key];
      for (const item of Array.isArray(child) ? child : [child]) if (item && typeof item === 'object' && 'type' in item) visit(item as t.Node);
    }
  }
  visit(ast);
  if (!output.hasChanged()) return null;
  return { code: output.toString(), map: output.generateMap({ hires: true, source: id, includeContent: true }) };
}
