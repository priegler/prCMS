import { defineConfig } from 'tsup';
export default defineConfig([
  { entry: ['src/index.ts'], format: ['esm'], dts: true, clean: false, sourcemap: true,
    external: ['react', 'react-dom', '@inlinecms/core'], banner: { js: "'use client';" } },
  { entry: ['src/server.ts', 'src/production.ts', 'src/disabled-api.ts'], format: ['esm'], dts: true, sourcemap: true,
    external: ['react', 'react-dom', '@inlinecms/core', './index.js'] },
  { entry: { 'api/index': 'src/api/index.ts' }, format: ['esm'], dts: true, sourcemap: true,
    external: ['react', 'react-dom', '@inlinecms/core'] },
]);
