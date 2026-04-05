import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/next.ts',
    'src/cli/index.ts',
  ],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  // Don't bundle @babel/* — they're dependencies
  external: ['@babel/core', '@babel/traverse', '@babel/types', '@babel/parser', '@babel/generator'],
});
