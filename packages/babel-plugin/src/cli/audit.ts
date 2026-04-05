import { resolve } from 'path';
import type { InlineCMSConfig } from '../core/config.js';
import { readContentFile } from '../core/content.js';
import { readManifest } from '../core/content.js';
import { contentHash } from '../core/keys.js';

/**
 * Audit content files for issues:
 * - Orphaned keys: in content.json but not in manifest (likely removed from source)
 * - Missing keys: in manifest but not in content.json (likely new, not yet translated)
 * - Drift: content hash in manifest doesn't match current content.json value
 */
export async function audit(projectRoot: string, config: InlineCMSConfig): Promise<void> {
  const contentDir = resolve(projectRoot, config.contentDir);
  const manifest = readManifest(contentDir);
  const manifestKeys = new Set(Object.keys(manifest));

  console.log(`Auditing content in ${contentDir}...\n`);

  let hasIssues = false;

  for (const locale of config.locales) {
    const content = readContentFile(contentDir, locale);
    const contentKeys = new Set(Object.keys(content));

    console.log(`--- Locale: ${locale} ---`);

    // Orphaned keys: in content but not in manifest
    const orphaned = [...contentKeys].filter((k) => !manifestKeys.has(k));
    if (orphaned.length > 0) {
      hasIssues = true;
      console.log(`\n  Orphaned keys (${orphaned.length}):`);
      for (const key of orphaned) {
        console.log(`    - ${key}`);
      }
    }

    // Missing keys: in manifest but not in content for this locale
    const missing = [...manifestKeys].filter((k) => !contentKeys.has(k));
    if (missing.length > 0) {
      hasIssues = true;
      console.log(`\n  Missing keys (${missing.length}):`);
      for (const key of missing) {
        console.log(`    - ${key}`);
      }
    }

    // Drift: content hash mismatch (only for default locale)
    if (locale === config.defaultLocale) {
      const drifted: string[] = [];
      for (const [key, entry] of Object.entries(manifest)) {
        const currentValue = content[key];
        if (currentValue !== undefined) {
          const currentHash = contentHash(currentValue);
          if (currentHash !== entry.contentHash) {
            drifted.push(key);
          }
        }
      }
      if (drifted.length > 0) {
        hasIssues = true;
        console.log(`\n  Content drift (${drifted.length}):`);
        for (const key of drifted) {
          console.log(`    - ${key} (source and content.json differ)`);
        }
      }
    }

    if (!orphaned.length && !missing.length) {
      console.log('  All keys OK');
    }
    console.log('');
  }

  if (!hasIssues) {
    console.log('No issues found.');
  }
}
