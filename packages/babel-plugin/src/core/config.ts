import { existsSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

export interface InlineCMSConfig {
  /** Glob patterns for files to process */
  include: string[];
  /** Glob patterns for files to skip */
  exclude: string[];
  /** Default locale code */
  defaultLocale: string;
  /** All supported locales */
  locales: string[];
  /** Directory where content JSON files are stored (relative to project root) */
  contentDir: string;
  /** JSX attributes to extract (besides text children) */
  attributes: string[];
}

const DEFAULT_CONFIG: InlineCMSConfig = {
  include: ['app/**/*.tsx', 'app/**/*.jsx', 'components/**/*.tsx', 'components/**/*.jsx'],
  exclude: ['**/node_modules/**', '**/*.test.*', '**/*.spec.*'],
  defaultLocale: 'en',
  locales: ['en'],
  contentDir: './content',
  attributes: ['alt', 'title', 'placeholder', 'aria-label'],
};

/**
 * Load config from inlinecms.config.ts (or .js/.mjs) at the project root.
 * Falls back to defaults if no config file exists.
 */
export async function loadConfig(projectRoot: string = process.cwd()): Promise<InlineCMSConfig> {
  const configNames = ['inlinecms.config.ts', 'inlinecms.config.js', 'inlinecms.config.mjs'];

  for (const name of configNames) {
    const configPath = resolve(projectRoot, name);
    if (existsSync(configPath)) {
      const imported = await import(pathToFileURL(configPath).href);
      const userConfig = imported.default ?? imported;
      return { ...DEFAULT_CONFIG, ...userConfig };
    }
  }

  return { ...DEFAULT_CONFIG };
}

export { DEFAULT_CONFIG };
