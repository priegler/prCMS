// Run from a trusted base checkout, using an isolated installation of core.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
const runtime = process.env.INLINECMS_RUNTIME;
if (!runtime) throw new Error('Set INLINECMS_RUNTIME to the isolated package installation');
const core = createRequire(resolve(runtime, 'package.json'))('@inlinecms/core');
const config = core.configWith({ include: JSON.parse(process.env.INLINECMS_INCLUDE), exclude: JSON.parse(process.env.INLINECMS_EXCLUDE) });
const [command, root, input] = process.argv.slice(2);
if (command === 'snapshot') console.log(JSON.stringify(await core.hostedSnapshot(root, config, input)));
else if (command === 'validate') console.log(JSON.stringify(await core.validateHostedProposal(root, config, JSON.parse(await readFile(input, 'utf8')))));
else throw new Error('Expected snapshot or validate');
