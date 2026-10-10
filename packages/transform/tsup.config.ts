import { defineConfig } from 'tsup';
export default defineConfig([
  { entry: ['src/index.ts', 'src/next.ts', 'src/vite.ts', 'src/astro.ts'], format: ['esm'], dts: true, clean: false, sourcemap: true },
  // Turbopack requires a webpack-style synchronous CommonJS loader.
  { entry: ['src/loader.ts'], format: ['cjs'], splitting: false, sourcemap: true, external: [], noExternal: [/@inlinecms\/core/], footer: { js: 'module.exports = module.exports.default;' } },
]);
