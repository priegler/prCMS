import { createHash } from 'crypto';

/**
 * Build a structural path from AST ancestry information.
 *
 * Format: filePath::ComponentName>tag>tag#attribute
 * Example: app/page.tsx::Home>main>h1#children
 *
 * @param filePath - Relative path to the source file
 * @param componentName - Name of the enclosing component function
 * @param elementPath - Array of tag names from component root to the target element
 * @param attribute - "children" for text content, or the attribute name (e.g. "alt")
 * @param index - Optional disambiguation index when siblings share the same tag
 */
export function generateKey(
  filePath: string,
  componentName: string,
  elementPath: string[],
  attribute: string,
  index?: number,
): string {
  const pathSegment = elementPath.join('>');
  const suffix = index !== undefined ? `[${index}]` : '';
  return `${filePath}::${componentName}>${pathSegment}${suffix}#${attribute}`;
}

/**
 * Build the element path by walking up from a JSX element through its ancestors.
 * This is called during AST traversal.
 *
 * @param ancestors - Array of { tag: string; indexAmongSiblings?: number } from root to current
 * @returns The tag path segments with sibling disambiguation
 */
export function buildStructuralPath(
  ancestors: Array<{ tag: string; indexAmongSameTag?: number }>,
): string[] {
  return ancestors.map((a) => {
    if (a.indexAmongSameTag !== undefined && a.indexAmongSameTag > 0) {
      return `${a.tag}[${a.indexAmongSameTag}]`;
    }
    return a.tag;
  });
}

/**
 * Compute a short content hash for drift detection.
 * Used in the manifest to detect when source text has changed
 * without a corresponding content.json update.
 */
export function contentHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}
