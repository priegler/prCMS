#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { loadConfig } from '../config.js';
import { FsSink } from '../sinks/fs.js';
import { doctor } from './doctor.js';
import { migrate } from './migrate.js';
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { root: { type: 'string' }, url: { type: 'string' }, content: { type: 'string' }, write: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help || !positionals.length) { console.log('inlinecms doctor --url http://localhost:3000 [--root project]\ninlinecms migrate --content content/content.en.json [--write] [--root project]\n\nDoctor renders configured routes. Migrate previews diffs unless --write is set.'); return; }
  const root = resolve(values.root ?? process.cwd()), config = await loadConfig(root);
  switch (positionals[0]) {
    case 'doctor': {
      const result = await doctor(new FsSink(root, config), config, values.url ?? 'http://localhost:3000');
      console.log(JSON.stringify(result, null, 2)); if (result.score < 80 || !result.total) process.exitCode = 1; break;
    }
    case 'migrate': console.log(JSON.stringify(await migrate(root, config, values.content ?? 'content/content.en.json', values.write), null, 2)); break;
    default: throw new Error(`Unknown command: ${positionals[0]}`);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
