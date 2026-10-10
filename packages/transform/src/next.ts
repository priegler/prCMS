import { createRequire } from 'node:module';
import { isEnabled } from '@inlinecms/core/config';
import type { TransformOptions } from './locator.js';
const require = createRequire(import.meta.url);
type Config = Record<string, any>;

export default function withInlineCMS(nextConfig: Config = {}, options: TransformOptions = {}): Config {
  // Next loads config with NODE_ENV set for dev/build. No CMS rule in a normal build.
  const serverConfig = { ...nextConfig, serverExternalPackages: [...new Set([...(nextConfig.serverExternalPackages ?? []), '@inlinecms/core'])] };
  const projectRequire = createRequire(`${options.root ?? process.cwd()}/package.json`);
  const version = projectRequire('next/package.json').version as string;
  const [major, minor] = version.split('.').map(Number);
  const modern = major > 15 || (major === 15 && minor >= 3);
  const turbo = modern ? nextConfig.turbopack ?? {} : nextConfig.experimental?.turbo ?? {};
  if (!(options.enabled ?? isEnabled())) {
    // Remove the client reference at build time. A runtime-only server gate still
    // causes Next to preload the editor's client chunk in production layouts.
    const aliases = { '@inlinecms/react/server': '@inlinecms/react/production', '@inlinecms/react/api': '@inlinecms/react/disabled-api' };
    return {
      ...serverConfig,
      ...(modern ? { turbopack: { ...turbo, resolveAlias: { ...turbo.resolveAlias, ...aliases } } }
        : { experimental: { ...nextConfig.experimental, turbo: { ...turbo, resolveAlias: { ...turbo.resolveAlias, ...aliases } } } }),
      webpack(config: Config, context: Config) {
        config = typeof nextConfig.webpack === 'function' ? nextConfig.webpack(config, context) : config;
        config.resolve ??= {}; config.resolve.alias ??= {};
        for (const [from, to] of Object.entries(aliases)) config.resolve.alias[from + '$'] = to;
        return config;
      },
    };
  }
  const loader = require.resolve('@inlinecms/transform/loader');
  const rules = { ...turbo.rules };
  for (const ext of ['tsx', 'jsx']) {
    const key = `*.${ext}`;
    // Output remains TSX/JSX. Setting `as` appends a virtual suffix and breaks
    // extensionless component imports in Turbopack; its native parser handles it.
    const own = { loaders: [{ loader, options: { root: process.cwd(), ...options } }] };
    const existing = rules[key];
    rules[key] = existing ? [...(Array.isArray(existing) ? existing : [existing]), own] : own;
  }
  return {
    ...serverConfig,
    ...(modern ? { turbopack: { ...turbo, rules } } : { experimental: { ...nextConfig.experimental, turbo: { ...turbo, rules } } }),
    webpack(config: Config, context: Config) {
      config.module ??= {}; config.module.rules ??= [];
      config.module.rules.push({ test: /\.[jt]sx$/, exclude: /node_modules/, enforce: 'pre', use: [{ loader, options: { root: context.dir ?? process.cwd(), ...options } }] });
      return typeof nextConfig.webpack === 'function' ? nextConfig.webpack(config, context) : config;
    },
  };
}
