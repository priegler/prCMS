import type { PluginObj, NodePath } from '@babel/core';
import type * as BabelTypes from '@babel/types';
import { generateKey, buildStructuralPath, contentHash } from '../core/keys.js';
import type { ContentMap, ContentManifest, ManifestEntry } from '../core/types.js';
import type { InlineCMSConfig } from '../core/config.js';

type BabelNodePath<T = BabelTypes.Node> = NodePath<T>;

export interface PluginState {
  /** Accumulated content entries for this file */
  contentEntries: ContentMap;
  /** Accumulated manifest entries for this file */
  manifestEntries: ContentManifest;
  /** Relative path of the file being processed */
  filePath: string;
  /** Whether this file has any CMS-extractable content */
  hasContent: boolean;
  /** Whether the file has 'use client' directive */
  isClientComponent: boolean;
  /** Whether the cms import has been injected */
  importInjected: boolean;
}

interface PluginOptions {
  config: InlineCMSConfig;
  /** Project root for resolving relative paths */
  projectRoot?: string;
  /**
   * When true, only extract content (generate content.json) without rewriting JSX.
   * Used by the CLI extract command.
   */
  extractOnly?: boolean;
}

/** Attributes to always skip — never content */
const SKIP_ATTRIBUTES = new Set([
  'className', 'class', 'id', 'key', 'ref', 'href', 'style',
  'onClick', 'onChange', 'onSubmit', 'onBlur', 'onFocus',
  'onMouseEnter', 'onMouseLeave', 'onKeyDown', 'onKeyUp',
  'data-testid', 'data-cms', 'data-cms-key',
  'type', 'name', 'value', 'htmlFor', 'role', 'tabIndex',
  'width', 'height', 'loading', 'decoding', 'crossOrigin',
]);

/**
 * The main Babel plugin for inline CMS.
 *
 * In extract-only mode: walks the AST and collects content entries.
 * In full mode: also rewrites JSX to use cms() calls and injects data-cms attributes.
 */
export function inlineCMSBabelPlugin(
  { types: t }: { types: typeof BabelTypes },
  options: PluginOptions,
): PluginObj<PluginState> {
  const { config, projectRoot = process.cwd(), extractOnly = false } = options;
  const extractableAttrs = new Set(config.attributes);

  return {
    name: 'inline-cms',

    pre() {
      const filename = (this as unknown as { filename: string }).filename ?? 'unknown';
      const relative = filename.startsWith(projectRoot)
        ? filename.slice(projectRoot.length + 1)
        : filename;

      this.filePath = relative;
      this.contentEntries = {};
      this.manifestEntries = {};
      this.hasContent = false;
      this.isClientComponent = false;
      this.importInjected = false;
    },

    visitor: {
      // Detect 'use client' directive
      Program(path: BabelNodePath<BabelTypes.Program>, state: PluginState) {
        // Babel may represent 'use client' as a Directive or as an ExpressionStatement
        for (const directive of path.node.directives ?? []) {
          if (directive.value?.value === 'use client') {
            state.isClientComponent = true;
            return;
          }
        }
        const firstStmt = path.node.body[0];
        if (
          firstStmt &&
          t.isExpressionStatement(firstStmt) &&
          t.isStringLiteral(firstStmt.expression) &&
          firstStmt.expression.value === 'use client'
        ) {
          state.isClientComponent = true;
        }
      },

      // Extract and optionally rewrite JSX text children
      JSXText(path: BabelNodePath<BabelTypes.JSXText>, state: PluginState) {
        const text = normalizeJSXWhitespace(path.node.value);
        if (!text) return;

        const elementPath = getJSXElementPath(path, t);
        if (!elementPath) return;

        const { componentName, ancestors } = elementPath;
        const structuralPath = buildStructuralPath(ancestors);
        const key = generateKey(state.filePath, componentName, structuralPath, 'children');

        state.contentEntries[key] = text;
        state.manifestEntries[key] = buildManifestEntry(key, text, state.filePath, path.node.loc?.start);
        state.hasContent = true;

        if (!extractOnly) {
          injectCmsImport(path, t, state);

          // Add data-cms attribute to parent element
          const parent = path.parentPath;
          if (parent?.isJSXElement()) {
            addDataCmsAttribute(parent, key, t);
          }

          // Replace text with {cms("key", "fallback")}
          const cmsCall = buildCmsCall(t, key, text, state.isClientComponent);
          path.replaceWith(t.jsxExpressionContainer(cmsCall));
        }
      },

      // Extract and optionally rewrite JSX string attributes
      JSXAttribute(path: BabelNodePath<BabelTypes.JSXAttribute>, state: PluginState) {
        const attrName = t.isJSXIdentifier(path.node.name)
          ? path.node.name.name
          : null;

        if (!attrName) return;
        if (SKIP_ATTRIBUTES.has(attrName)) return;
        if (!extractableAttrs.has(attrName)) return;

        const value = path.node.value;
        if (!t.isStringLiteral(value)) return;

        const text = value.value;
        if (!text) return;

        const elementPath = getJSXElementPath(path, t);
        if (!elementPath) return;

        const { componentName, ancestors } = elementPath;
        const structuralPath = buildStructuralPath(ancestors);
        const key = generateKey(state.filePath, componentName, structuralPath, attrName);

        state.contentEntries[key] = text;
        state.manifestEntries[key] = buildManifestEntry(key, text, state.filePath, path.node.loc?.start);
        state.hasContent = true;

        if (!extractOnly) {
          injectCmsImport(path, t, state);

          // Add data-cms attribute to the parent element
          const attrParent = path.parentPath;
          if (attrParent?.isJSXOpeningElement()) {
            const elementParent = attrParent.parentPath;
            if (elementParent?.isJSXElement()) {
              addDataCmsAttribute(elementParent, key, t);
            }
          }

          // Replace string literal with {cms("key", "fallback")}
          const cmsCall = buildCmsCall(t, key, text, state.isClientComponent);
          path.node.value = t.jsxExpressionContainer(cmsCall) as unknown as BabelTypes.StringLiteral;
        }
      },
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────

interface ElementPathInfo {
  componentName: string;
  ancestors: Array<{ tag: string; indexAmongSameTag?: number }>;
}

/**
 * Walk up the AST from a node to find the enclosing component
 * and build the structural element path.
 */
function getJSXElementPath(
  path: BabelNodePath,
  t: typeof BabelTypes,
): ElementPathInfo | null {
  const ancestors: Array<{ tag: string; indexAmongSameTag?: number }> = [];
  let componentName = 'Anonymous';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = path.parentPath;

  while (current) {
    if (current.isJSXElement?.()) {
      const opening = current.node.openingElement;
      const tag = t.isJSXIdentifier(opening.name) ? opening.name.name : 'unknown';
      const index = getSameTagSiblingIndex(current, tag, t);
      ancestors.unshift({ tag, indexAmongSameTag: index > 0 ? index : undefined });
    }

    // Detect component function boundary
    if (
      current.isFunctionDeclaration?.() ||
      current.isFunctionExpression?.() ||
      current.isArrowFunctionExpression?.()
    ) {
      componentName = getComponentName(current, t);
      break;
    }

    current = current.parentPath;
  }

  if (ancestors.length === 0) return null;
  return { componentName, ancestors };
}

/**
 * Get the index of a JSX element among siblings with the same tag name.
 * Returns 0 if this is the only (or first) element with this tag.
 */
function getSameTagSiblingIndex(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  elementPath: any,
  tag: string,
  t: typeof BabelTypes,
): number {
  const parent = elementPath.parentPath;
  if (!parent?.isJSXElement?.() && !parent?.isJSXFragment?.()) return 0;

  const children = parent.node.children ?? [];
  let index = 0;
  for (const child of children) {
    if (child === elementPath.node) return index;
    if (
      t.isJSXElement(child) &&
      t.isJSXIdentifier(child.openingElement.name) &&
      child.openingElement.name.name === tag
    ) {
      index++;
    }
  }
  return 0;
}

/**
 * Extract the component name from a function declaration / expression.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getComponentName(funcPath: any, t: typeof BabelTypes): string {
  // function Home() { ... }
  if (funcPath.node.id && t.isIdentifier(funcPath.node.id)) {
    return funcPath.node.id.name;
  }

  // const Home = () => { ... }  or  const Home = function() { ... }
  const parent = funcPath.parentPath;
  if (parent?.isVariableDeclarator?.() && t.isIdentifier(parent.node.id)) {
    return parent.node.id.name;
  }

  // export default function() { ... }
  if (parent?.isExportDefaultDeclaration?.()) {
    return 'Default';
  }

  return 'Anonymous';
}

/**
 * Build a manifest entry for an extracted content key.
 */
function buildManifestEntry(
  key: string,
  value: string,
  filePath: string,
  loc?: { line: number; column: number } | null,
): ManifestEntry {
  return {
    key,
    contentHash: contentHash(value),
    filePath,
    line: loc?.line ?? 0,
    column: loc?.column ?? 0,
    elementTag: key.split('>').pop()?.split('#')[0] ?? 'unknown',
    attribute: key.split('#').pop() ?? 'children',
    lastExtracted: new Date().toISOString(),
  };
}

/**
 * Build a cms("key", "fallback") or __getCms("key", "fallback") call expression.
 *
 * For server components: cms() is a plain function — safe anywhere.
 * For client components: getCms() is a plain function (NOT a hook) that reads
 * from a module-level store populated by the provider. This avoids React
 * hook-order violations when the call site is inside conditionals or iterators.
 */
function buildCmsCall(
  t: typeof BabelTypes,
  key: string,
  fallback: string,
  isClientComponent: boolean,
): BabelTypes.CallExpression {
  const fnName = isClientComponent ? '__inlinecms_getCms' : '__inlinecms_cms';
  return t.callExpression(
    t.identifier(fnName),
    [t.stringLiteral(key), t.stringLiteral(fallback)],
  );
}

/**
 * Inject the cms import at the top of the file (once).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function injectCmsImport(path: any, t: typeof BabelTypes, state: PluginState): void {
  if (state.importInjected) return;
  state.importInjected = true;

  // Find the Program node
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let program: any = path;
  while (program && !program.isProgram?.()) {
    program = program.parentPath;
  }
  if (!program) return;

  const specifiers: BabelTypes.ImportSpecifier[] = [];

  if (state.isClientComponent) {
    // getCms is a plain function, not a hook — safe in conditionals/iterators
    specifiers.push(
      t.importSpecifier(
        t.identifier('__inlinecms_getCms'),
        t.identifier('getCms'),
      ),
    );
  } else {
    specifiers.push(
      t.importSpecifier(
        t.identifier('__inlinecms_cms'),
        t.identifier('cms'),
      ),
    );
  }

  const importDecl = t.importDeclaration(specifiers, t.stringLiteral('@inlinecms/react'));
  program.node.body.unshift(importDecl);
}

/**
 * Normalize JSX whitespace the same way React does:
 * - Collapse runs of whitespace (including newlines) into a single space
 * - But preserve the resulting string if it contains non-whitespace chars
 * - Return empty string if the result is only whitespace
 *
 * This avoids the original `trim()` which dropped meaningful boundary spaces
 * (e.g. text between <strong> and surrounding words).
 */
function normalizeJSXWhitespace(raw: string): string {
  // React's JSX whitespace rules:
  // 1. Lines that are only whitespace are removed
  // 2. Leading/trailing whitespace on each line is trimmed
  // 3. Newlines become spaces
  // 4. Multiple spaces collapse to one
  const lines = raw.split('\n');
  const processedLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    // Trim leading whitespace from all lines except the first
    if (i > 0) line = line.replace(/^\s+/, '');
    // Trim trailing whitespace from all lines except the last
    if (i < lines.length - 1) line = line.replace(/\s+$/, '');
    if (line) processedLines.push(line);
  }

  const result = processedLines.join(' ');
  return result.trim() || '';
}

/**
 * Add a data-cms="key" attribute to a JSX element (if not already present).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addDataCmsAttribute(elementPath: any, key: string, t: typeof BabelTypes): void {
  const opening = elementPath.node.openingElement;
  const hasDataCms = opening.attributes.some(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (attr: any) => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === 'data-cms',
  );
  if (hasDataCms) return;

  opening.attributes.push(
    t.jsxAttribute(
      t.jsxIdentifier('data-cms'),
      t.stringLiteral(key),
    ),
  );
}
