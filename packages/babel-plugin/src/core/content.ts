import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import type { ContentMap, ContentManifest } from './types.js';

/**
 * Read a content JSON file. Returns empty map if file doesn't exist.
 */
export function readContentFile(contentDir: string, locale: string): ContentMap {
  const filePath = resolve(contentDir, `content.${locale}.json`);
  if (!existsSync(filePath)) {
    return {};
  }
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as ContentMap;
}

/**
 * Write a content map to disk with stable key ordering.
 */
export function writeContentFile(contentDir: string, locale: string, content: ContentMap): void {
  const filePath = resolve(contentDir, `content.${locale}.json`);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const sorted = sortKeys(content);
  writeFileSync(filePath, JSON.stringify(sorted, null, 2) + '\n', 'utf-8');
}

/**
 * Merge new changes into an existing content map.
 * New values overwrite existing ones. Keys not in `changes` are preserved.
 */
export function mergeContent(existing: ContentMap, changes: ContentMap): ContentMap {
  return { ...existing, ...changes };
}

/**
 * Read the manifest file. Returns empty manifest if it doesn't exist.
 */
export function readManifest(contentDir: string): ContentManifest {
  const filePath = resolve(contentDir, '.inlinecms-manifest.json');
  if (!existsSync(filePath)) {
    return {};
  }
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as ContentManifest;
}

/**
 * Write the manifest file with stable key ordering.
 */
export function writeManifest(contentDir: string, manifest: ContentManifest): void {
  const filePath = resolve(contentDir, '.inlinecms-manifest.json');
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const sorted = sortKeys(manifest);
  writeFileSync(filePath, JSON.stringify(sorted, null, 2) + '\n', 'utf-8');
}

/**
 * Sort an object's keys alphabetically for stable JSON output.
 */
function sortKeys<T>(obj: Record<string, T>): Record<string, T> {
  const sorted: Record<string, T> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return sorted;
}
