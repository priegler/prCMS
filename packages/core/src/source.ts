import { parse } from '@babel/parser';
import * as t from '@babel/types';
import type { Candidate, SourceFile } from './types.js';
import { normalizeJSXWhitespace } from './normalize.js';

export function parseSource(content: string, path: string) {
  if (path.endsWith('.json')) JSON.parse(content);
  return parse(path.endsWith('.json') ? `(${content})` : content, {
    sourceType: 'unambiguous', plugins: ['jsx', 'typescript'],
  });
}
export function walk(node: t.Node, visit: (node: t.Node, parent?: t.Node) => void, parent?: t.Node) {
  visit(node, parent);
  for (const key of t.VISITOR_KEYS[node.type] ?? []) {
    const value = (node as unknown as Record<string, unknown>)[key];
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child === 'object' && 'type' in child) walk(child as t.Node, visit, node);
    }
  }
}
export function candidateId(path: string, start: number, end: number) { return `${path}:${start}:${end}`; }
export function scanSource(path: string, file: SourceFile): { candidates: Candidate[]; imports: string[]; elements: Map<string, Candidate[]> } {
  const ast = parseSource(file.content, path);
  const candidates: Candidate[] = [];
  const byNode = new Map<t.Node, Candidate>();
  const elements = new Map<string, Candidate[]>();
  const imports: string[] = [];
  const json = path.endsWith('.json');
  const offset = json ? 1 : 0;
  walk(ast, (node, parent) => {
    if (t.isImportDeclaration(node) || t.isExportNamedDeclaration(node) || t.isExportAllDeclaration(node)) {
      if (node.source) imports.push(node.source.value);
    }
    if (t.isCallExpression(node) && node.callee.type === 'Import' && t.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].value);
    let value: string | undefined;
    let kind: Candidate['kind'] = 'string';
    if (t.isJSXText(node)) { value = normalizeJSXWhitespace(node.value); kind = 'jsx'; }
    if (t.isStringLiteral(node)) {
      if (t.isImportDeclaration(parent) || t.isExportNamedDeclaration(parent) || t.isExportAllDeclaration(parent) || t.isTSLiteralType(parent)) return;
      if ((t.isObjectProperty(parent) || t.isObjectMethod(parent)) && parent.key === node && !parent.computed) return;
      value = node.value; kind = json ? 'json' : t.isJSXAttribute(parent) ? 'jsx-attribute' : 'string';
    }
    if (t.isTemplateLiteral(node) && node.expressions.length === 0) { value = node.quasis[0].value.cooked ?? undefined; kind = 'template'; }
    if (value === undefined || node.start == null || node.end == null || !node.loc) return;
    const start = node.start - offset, end = node.end - offset;
    const attribute = t.isJSXAttribute(parent) && t.isJSXIdentifier(parent.name) ? parent.name.name : undefined;
    const candidate: Candidate = { id: candidateId(path, start, end), path, start, end, line: node.loc.start.line,
      column: node.loc.start.column + 1 - (json && node.loc.start.line === 1 ? 1 : 0), kind, value,
      raw: file.content.slice(start, end), baseRev: file.rev, attribute };
    candidates.push(candidate); byNode.set(node, candidate);
  });
  walk(ast, node => {
    if (!t.isJSXElement(node) || !node.loc) return;
    const key = `${node.loc.start.line}:${node.loc.start.column + 1}`;
    const direct: Candidate[] = [];
    const visible = node.children.filter(n => !(t.isJSXText(n) && !n.value.trim()) && !(t.isJSXExpressionContainer(n) && t.isJSXEmptyExpression(n.expression)));
    // Direct text nodes are exposed separately for mixed-content editing.
    let textIndex: number | undefined = 0;
    const nonText = (node: t.Node): boolean => t.isJSXElement(node) || t.isNullLiteral(node) || t.isBooleanLiteral(node)
      || (t.isConditionalExpression(node) && nonText(node.consequent) && nonText(node.alternate));
    for (const child of visible) {
      const literal = t.isJSXExpressionContainer(child) ? child.expression : child;
      const candidate = byNode.get(literal);
      if (candidate) {
        if (textIndex !== undefined) elements.set(`${key}#text:${textIndex}`, [candidate]);
        if (visible.length === 1) direct.push(candidate);
      }
      // Unknown expressions can render text, elements or nothing. Stop assigning
      // indices after them; duplicate text must then go through the candidate picker.
      if (textIndex !== undefined) {
        if (t.isJSXText(child) || candidate || t.isNumericLiteral(literal)) textIndex++;
        else if (t.isJSXExpressionContainer(child) && !nonText(literal)) textIndex = undefined;
      }
    }
    elements.set(key, direct);
    for (const attr of node.openingElement.attributes) {
      if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name) || !attr.value) continue;
      const literal = t.isJSXExpressionContainer(attr.value) ? attr.value.expression : attr.value;
      const candidate = byNode.get(literal);
      if (candidate) { candidate.attribute = attr.name.name; elements.set(`${key}#${attr.name.name}`, [candidate]); }
    }
  });
  return { candidates, imports, elements };
}
