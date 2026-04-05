#!/usr/bin/env node

import { resolve } from 'path';
import { loadConfig } from '../core/config.js';
import { extract } from './extract.js';
import { audit } from './audit.js';

const USAGE = `
inlinecms — CLI for inline CMS content management

Commands:
  extract   Extract content strings from JSX files into content.json
  audit     Report orphaned keys, missing keys, and content drift
  migrate   Interactively remap old keys to new ones (not yet implemented)

Options:
  --help    Show this help message
  --root    Project root directory (default: current directory)
`;

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE);
    process.exit(0);
  }

  const rootIndex = args.indexOf('--root');
  const projectRoot = rootIndex !== -1 && args[rootIndex + 1]
    ? resolve(args[rootIndex + 1])
    : process.cwd();

  const config = await loadConfig(projectRoot);

  switch (command) {
    case 'extract':
      await extract(projectRoot, config);
      break;
    case 'audit':
      await audit(projectRoot, config);
      break;
    case 'migrate':
      console.log('migrate command is not yet implemented');
      process.exit(1);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.log(USAGE);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
