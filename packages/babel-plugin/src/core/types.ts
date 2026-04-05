/**
 * A flat map of content keys to string values.
 * This is what gets stored in content.{locale}.json.
 */
export type ContentMap = Record<string, string>;

/**
 * Metadata for a single extracted content key.
 */
export interface ManifestEntry {
  /** The structural key (e.g. "app/page.tsx::Home>main>h1#children") */
  key: string;
  /** Hash of the original source string for drift detection */
  contentHash: string;
  /** Source file path relative to project root */
  filePath: string;
  /** Line number in source (informational, not used for keying) */
  line: number;
  /** Column number in source */
  column: number;
  /** The element tag name (e.g. "h1", "p", "img") */
  elementTag: string;
  /** "children" or the attribute name (e.g. "alt", "src") */
  attribute: string;
  /** ISO timestamp of when this entry was last extracted */
  lastExtracted: string;
}

/**
 * The full manifest file (.inlinecms-manifest.json).
 * Maps content keys to their metadata.
 */
export type ContentManifest = Record<string, ManifestEntry>;
