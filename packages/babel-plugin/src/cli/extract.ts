import { resolve } from 'path';
import { readFileSync } from 'fs';
import * as babel from '@babel/core';
import { glob } from 'glob';
import type { InlineCMSConfig } from '../core/config.js';
import { readContentFile, writeContentFile, mergeContent } from '../core/content.js';
import { readManifest, writeManifest } from '../core/content.js';
import { inlineCMSBabelPlugin } from '../transform/plugin.js';
import type { ContentMap, ContentManifest } from '../core/types.js';

/**
 * Run content extraction on all matching files.
 * Parses JSX, extracts strings, and writes content.json + manifest.
 */
export async function extract(projectRoot: string, config: InlineCMSConfig): Promise<void> {
  const contentDir = resolve(projectRoot, config.contentDir);
  const files = await findFiles(projectRoot, config);

  if (files.length === 0) {
    console.log('No matching files found. Check your include/exclude patterns.');
    return;
  }

  console.log(`Extracting from ${files.length} file(s)...`);

  let allContent: ContentMap = {};
  let allManifest: ContentManifest = {};

  for (const file of files) {
    const absolutePath = resolve(projectRoot, file);
    const source = readFileSync(absolutePath, 'utf-8');

    // We use a custom state collector to capture extracted entries
    const pluginState = { contentEntries: {} as ContentMap, manifestEntries: {} as ContentManifest };

    try {
      babel.transformSync(source, {
        filename: absolutePath,
        plugins: [
          [inlineCMSBabelPlugin, {
            config,
            projectRoot,
            extractOnly: true,
          }],
          // Custom plugin to capture state after processing
          function captureState() {
            return {
              post(state: Record<string, unknown>) {
                pluginState.contentEntries = (state as Record<string, ContentMap>).contentEntries ?? {};
                pluginState.manifestEntries = (state as Record<string, ContentManifest>).manifestEntries ?? {};
              },
            };
          },
        ],
        parserOpts: { plugins: ['jsx', 'typescript'] },
      });
    } catch (err) {
      console.warn(`  Warning: failed to parse ${file}: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    const entryCount = Object.keys(pluginState.contentEntries).length;
    if (entryCount > 0) {
      console.log(`  ${file}: ${entryCount} string(s)`);
      allContent = { ...allContent, ...pluginState.contentEntries };
      allManifest = { ...allManifest, ...pluginState.manifestEntries };
    }
  }

  const totalKeys = Object.keys(allContent).length;
  if (totalKeys === 0) {
    console.log('No extractable content found.');
    return;
  }

  // Merge with existing content (preserve manual edits)
  const existing = readContentFile(contentDir, config.defaultLocale);
  const merged = mergeContent(existing, allContent);

  writeContentFile(contentDir, config.defaultLocale, merged);
  writeManifest(contentDir, allManifest);

  console.log(`\nExtracted ${totalKeys} key(s) → ${contentDir}/content.${config.defaultLocale}.json`);
}

async function findFiles(projectRoot: string, config: InlineCMSConfig): Promise<string[]> {
  const files: string[] = [];
  for (const pattern of config.include) {
    const matches = await glob(pattern, {
      cwd: projectRoot,
      ignore: config.exclude,
    });
    files.push(...matches);
  }
  // Deduplicate
  return [...new Set(files)];
}
