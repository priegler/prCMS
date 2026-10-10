import { defineConfig } from 'tsup';
const entry = ['src/index.ts', 'src/config.ts', 'src/cli/index.ts'];
export default defineConfig([
  { entry, format: ['esm'], dts: true, clean: false, sourcemap: true, external: ['@anthropic-ai/claude-agent-sdk', 'playwright'] },
  { entry, format: ['cjs'], clean: false, sourcemap: true, external: ['@anthropic-ai/claude-agent-sdk', 'playwright'],
    define: { 'import.meta.url': '__inlinecmsModuleURL' },
    banner: { js: "const __inlinecmsModuleURL = require('node:url').pathToFileURL(__filename).href;" } },
]);
