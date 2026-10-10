import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import picomatch from 'picomatch';

export interface InlineCMSConfig {
  include: string[]; exclude: string[]; attributes: string[];
  importAliases: Record<string, string>; routes: string[]; localCommit: boolean;
  agentModel: string;
}
export const DEFAULT_CONFIG: InlineCMSConfig = {
  include: ['app/**/*.{tsx,jsx,ts,js}', 'pages/**/*.{tsx,jsx,ts,js}', 'components/**/*.{tsx,jsx,ts,js}', 'content/**/*.{ts,js,json}', 'messages/**/*.json', 'locales/**/*.json', 'src/**/*.{tsx,jsx,ts,js,json,astro}'],
  exclude: ['**/node_modules/**', '**/.*/**', '**/dist/**', '**/*.test.*', '**/*.spec.*', '**/api/**'],
  attributes: ['alt', 'title', 'placeholder', 'aria-label', 'src'],
  importAliases: { '@/': './', '~/': './src/' }, routes: ['/'], localCommit: false,
  agentModel: 'claude-opus-5-5',
};
export function configWith(overrides: Partial<InlineCMSConfig> = {}): InlineCMSConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}
export async function loadConfig(root = process.cwd()): Promise<InlineCMSConfig> {
  // Native Node imports .js/.mjs; use a JS config for Node versions without TS stripping.
  for (const name of ['inlinecms.config.mjs', 'inlinecms.config.js', 'inlinecms.config.ts']) {
    const path = resolve(root, name);
    if (existsSync(path)) {
      // Preserve registered TypeScript require hooks; JS/MJS use native ESM loading.
      const loaded = name.endsWith('.ts')
        ? createRequire(resolve(root, 'package.json'))(path)
        : await import(/* webpackIgnore: true */ pathToFileURL(path).href);
      // Native import wraps CommonJS module.exports, which can itself contain exports.default.
      const imported = name.endsWith('.ts') ? loaded : loaded.default ?? loaded;
      return configWith(imported.default ?? imported);
    }
  }
  return configWith();
}
export function safePath(path: string): string {
  if (!path || path.includes('\\') || path.startsWith('/') || path.includes(':') || path.split('/').some(s => !s || s === '.' || s === '..' || s.startsWith('.')))
    throw new Error('Expected a safe project-relative path');
  return path;
}
export function isIncluded(path: string, config: InlineCMSConfig): boolean {
  try { safePath(path); } catch { return false; }
  return !/(^|\/)(node_modules|dist)(\/|$)/.test(path) && !/(^|\/)(?:credentials|secrets)(?:\.|\/|$)/i.test(path)
    && picomatch(config.include)(path) && !picomatch(config.exclude)(path);
}
export function assertIncluded(path: string, config: InlineCMSConfig): void {
  if (!isIncluded(path, config)) throw new Error('Source path is outside the configured include scope');
}
export function isEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.INLINECMS_ENABLED === '1' || env.NODE_ENV === 'development';
}
