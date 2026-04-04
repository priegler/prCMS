import { defineConfig } from 'tsup';

export default defineConfig([
  {
    // Client entry — 'use client' components (provider, editor, hooks)
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    external: ['react', 'react-dom', 'next', '@inlinecms/babel-plugin'],
    banner: {
      js: "'use client';",
    },
  },
  {
    // Server entry — cms() function that reads from filesystem
    entry: ['src/server.ts'],
    format: ['esm'],
    dts: true,
    sourcemap: true,
    external: ['react', 'react-dom', 'next', '@inlinecms/babel-plugin'],
  },
  {
    // API route handlers — server-side only
    entry: ['src/api/index.ts'],
    format: ['esm'],
    dts: true,
    sourcemap: true,
    external: ['react', 'react-dom', 'next', '@inlinecms/babel-plugin'],
    outDir: 'dist/api',
  },
]);
