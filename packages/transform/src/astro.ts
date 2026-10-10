import { relative, resolve } from 'node:path';
import { parse } from '@astrojs/compiler';
import type { Node } from '@astrojs/compiler/types';
import MagicString from 'magic-string';
import { byteToIndex, configWith, isEnabled, isIncluded } from '@inlinecms/core';
import type { TransformOptions } from './locator.js';

export async function transformAstro(code: string, id: string, options: TransformOptions = {}) {
  if (!(options.enabled ?? isEnabled())) return null;
  const path = relative(resolve(options.root ?? process.cwd()), id.split('?')[0]).replace(/\\/g, '/');
  if (!path.endsWith('.astro') || !isIncluded(path, configWith(options))) return null;
  const { ast } = await parse(code, { position: true });
  const output = new MagicString(code);
  function visit(node: Node) {
    if ((node.type === 'element' || node.type === 'custom-element') && node.position) {
      const point = node.position.start, index = byteToIndex(code, point.offset) + 1 + node.name.length;
      // Preserve this element's existing attribute, but always traverse its children.
      if (!node.attributes.some(a => a.name === 'data-src')) output.appendLeft(index, ` data-src="${path.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}:${point.line}:${point.column}"`);
    }
    if ('children' in node) node.children.forEach(visit);
  }
  visit(ast);
  return output.hasChanged() ? { code: output.toString(), map: output.generateMap({ hires: true, source: id, includeContent: true }) } : null;
}
export default function inlineCMSAstro(options: TransformOptions = {}) {
  return { name: 'inlinecms', hooks: { 'astro:config:setup': ({ updateConfig }: { updateConfig: (config: unknown) => void }) => {
    updateConfig({ vite: { plugins: [{ name: 'inlinecms-astro-locator', enforce: 'pre', transform: (code: string, id: string) => transformAstro(code, id, options) }] } });
  } } };
}
