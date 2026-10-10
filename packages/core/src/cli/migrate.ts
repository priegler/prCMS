import { readFile, unlink } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import * as t from '@babel/types';
import { FsSink } from '../sinks/fs.js';
import { parseSource, scanSource, walk } from '../source.js';
import { encodeLiteral, unifiedDiff } from '../patcher.js';
import type { InlineCMSConfig } from '../config.js';
import type { FileChange } from '../types.js';

/** Dry-run first. Unmatched overrides prevent writes, so stale keys cannot silently lose copy. */
export async function migrate(root: string, config: InlineCMSConfig, contentPath: string, write = false) {
  const absolute = resolve(root, contentPath);
  const contentRelative = relative(resolve(root), absolute).replace(/\\/g, '/');
  if (!contentRelative || contentRelative === '..' || contentRelative.startsWith('../') || isAbsolute(contentRelative)) throw new Error('Content file must be inside the project');
  const nextConfigs = ['next.config.js', 'next.config.mjs', 'next.config.cjs', 'next.config.ts'];
  const sink = new FsSink(root, { ...config, include: [...config.include, ...nextConfigs], localCommit: false });
  await sink.path(contentRelative);
  const overrides: Record<string, string> = JSON.parse(await readFile(absolute, 'utf8'));
  if (!overrides || Object.values(overrides).some(value => typeof value !== 'string')) throw new Error('Expected a v1 string content map');
  const unused = new Set(Object.keys(overrides)), changes: FileChange[] = [];
  for (const path of await sink.list()) {
    if (!/\.(?:[jt]sx?|[mc]js)$/.test(path)) continue;
    const file = await sink.read(path), ast = parseSource(file.content, path);
    const parents = new Map<t.Node, t.Node>(), calls = new Set<string>(), hooks = new Set<string>();
    walk(ast, (node, parent) => { if (parent) parents.set(node, parent); });
    const splices: { start: number; end: number; text: string }[] = [];
    const splice = (node: t.Node, text: string) => splices.push({ start: node.start!, end: node.end!, text });
    walk(ast, node => {
      if (t.isImportDeclaration(node) && /^@inlinecms\/react(?:\/server)?$/.test(node.source.value)) {
        const remove = node.specifiers.filter(s => t.isImportSpecifier(s) && t.isIdentifier(s.imported) && ['cms', 'getCms', 'useCms', 'useContentVersion'].includes(s.imported.name));
        for (const spec of remove) if (t.isImportSpecifier(spec) && t.isIdentifier(spec.imported)) (spec.imported.name === 'useContentVersion' ? hooks : calls).add(spec.local.name);
        const retained = node.specifiers.filter(s => !remove.includes(s));
        const provider = retained.find(s => t.isImportSpecifier(s) && t.isIdentifier(s.imported) && s.imported.name === 'InlineCMSProvider');
        const serverFile = !ast.program.directives.some(d => d.value.value === 'use client');
        if (provider && serverFile && retained.length === 1) {
          // Preserve its local JSX name while switching to the production-gated wrapper.
          splice(node, `import { InlineCMS as ${provider.local.name} } from '@inlinecms/react/server';`);
          return;
        }
        if (remove.length === node.specifiers.length) splice(node, '');
        else if (remove.length) {
          // Rewrite only this import; retain the provider and other unrelated imports.
          const names = retained.map(s => t.isImportSpecifier(s) ? `${t.isIdentifier(s.imported) ? s.imported.name : s.imported.value}${s.local.name !== (t.isIdentifier(s.imported) ? s.imported.name : s.imported.value) ? ` as ${s.local.name}` : ''}` : s.local.name);
          if (node.specifiers.some(s => !t.isImportSpecifier(s))) throw new Error(`Mixed default CMS import needs manual migration: ${path}`);
          splice(node, `import { ${names.join(', ')} } from ${JSON.stringify(node.source.value)};`);
        }
      }
      if (t.isImportDeclaration(node) && node.source.value === '@inlinecms/babel-plugin/next') splice(node.source, "'@inlinecms/transform/next'");
      if (t.isCallExpression(node) && t.isIdentifier(node.callee, { name: 'require' }) && t.isStringLiteral(node.arguments[0], { value: '@inlinecms/babel-plugin/next' })) splice(node.arguments[0], "'@inlinecms/transform/next'");
    });
    walk(ast, node => {
      if (t.isCallExpression(node) && t.isIdentifier(node.callee) && calls.has(node.callee.name)) {
        const [key, fallback] = node.arguments;
        if (!t.isStringLiteral(key) || !t.isStringLiteral(fallback)) throw new Error(`Dynamic v1 CMS call needs manual migration: ${path}`);
        const value = overrides[key.value] ?? fallback.value; unused.delete(key.value); splice(node, JSON.stringify(value));
      }
      if (t.isExpressionStatement(node) && t.isCallExpression(node.expression) && t.isIdentifier(node.expression.callee) && hooks.has(node.expression.callee.name)) splice(node, '');
      if (t.isJSXAttribute(node) && t.isJSXIdentifier(node.name) && (node.name.name === 'data-cms' || node.name.name === 'data-cms-key')) splice(node, '');
      if (t.isJSXAttribute(node) && t.isJSXIdentifier(node.name) && ['defaultLocale', 'locales'].includes(node.name.name)) {
        const parent = parents.get(node); if (t.isJSXOpeningElement(parent) && t.isJSXIdentifier(parent.name) && parent.name.name === 'InlineCMSProvider') splice(node, '');
      }
    });
    // v1 usually injected calls at build time; recover its structural keys for untouched JSX.
    const scanned = scanSource(path, file);
    walk(ast, node => {
      if (!t.isJSXText(node) && !t.isStringLiteral(node)) return;
      const candidate = scanned.candidates.find(c => c.start === node.start && c.end === node.end);
      if (!candidate || (candidate.kind !== 'jsx' && !candidate.attribute)) return;
      let current = parents.get(node), component = 'Anonymous'; const tags: string[] = [];
      while (current) {
        if (t.isJSXElement(current)) {
          const name = t.isJSXIdentifier(current.openingElement.name) ? current.openingElement.name.name : 'unknown';
          const parent = parents.get(current);
          const siblings = t.isJSXElement(parent) || t.isJSXFragment(parent) ? parent.children : [];
          const same = siblings.filter(c => t.isJSXElement(c) && t.isJSXIdentifier(c.openingElement.name) && c.openingElement.name.name === name);
          const index = same.indexOf(current);
          tags.unshift(name + (index > 0 ? `[${index}]` : ''));
        }
        if (t.isFunction(current)) {
          if ((t.isFunctionDeclaration(current) || t.isFunctionExpression(current)) && current.id) component = current.id.name;
          else { const parent = parents.get(current); if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) component = parent.id.name; }
          break;
        }
        current = parents.get(current);
      }
      const key = `${path}::${component}>${tags.join('>')}#${candidate.attribute ?? 'children'}`;
      if (tags.length && key in overrides) { unused.delete(key); splice(node, encodeLiteral(candidate, overrides[key])); }
    });
    let output = file.content, end = output.length;
    for (const edit of splices.sort((a, b) => b.start - a.start)) {
      if (edit.end > end) throw new Error(`Overlapping v1 wiring in ${path}; migrate manually`);
      output = output.slice(0, edit.start) + edit.text + output.slice(edit.end); end = edit.start;
    }
    parseSource(output, path);
    if (output !== file.content) changes.push({ path, content: output, baseRev: file.rev, diff: unifiedDiff(path, file.content, output) });
  }
  if (write && unused.size) throw new Error(`Refusing migration: ${unused.size} overrides have no source match. Inspect the dry-run report first.`);
  if (write) { await sink.write(changes, 'Migrate InlineCMS content to source'); await unlink(absolute); }
  return { changes: changes.map(c => ({ path: c.path, diff: c.diff })), unmatched: [...unused], written: write };
}
