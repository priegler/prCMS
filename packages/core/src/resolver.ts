import { posix } from 'node:path';
import { isIncluded, assertIncluded, type InlineCMSConfig } from './config.js';
import { normalizeText } from './normalize.js';
import { scanSource } from './source.js';
import { scanAstro } from './astro.js';
import type { Candidate, EditRequest, Resolution, Sink } from './types.js';

export function parseLocator(src: string) {
  const match = /^(.*):(\d+):(\d+)$/.exec(src);
  if (!match || +match[2] < 1 || +match[3] < 1) throw new Error('Invalid source locator');
  return { path: match[1], line: +match[2], column: +match[3] };
}
function outcome(candidates: Candidate[]): Resolution {
  return candidates.length === 1 ? { status: 'resolved', candidate: candidates[0] }
    : candidates.length ? { status: 'ambiguous', candidates } : { status: 'unresolved', candidates: [] };
}
export async function resolveEdit(sink: Sink, config: InlineCMSConfig, edit: EditRequest): Promise<Resolution> {
  const loc = parseLocator(edit.src);
  assertIncluded(loc.path, config);
  if (edit.attribute && !config.attributes.includes(edit.attribute)) throw new Error('Attribute is not editable');
  const files = (await sink.list()).filter(path => isIncluded(path, config));
  const paths = new Set(files);
  const cache = new Map<string, ReturnType<typeof scanSource>>();
  async function scan(path: string): Promise<ReturnType<typeof scanSource>> {
    if (cache.has(path)) return cache.get(path)!;
    const file = await sink.read(path);
    const scanned = path.endsWith('.astro') ? await scanAstro(path, file) : scanSource(path, file);
    cache.set(path, scanned); return scanned;
  }
  const normalized = normalizeText(edit.oldText);
  if (!normalized && !edit.attribute) return outcome([]);
  const matches = (list: Candidate[]) => list.filter(c => (edit.attribute ? c.attribute === edit.attribute : !c.attribute || c.attribute === 'children') && normalizeText(c.value) === normalized && (!edit.locale || !c.path.endsWith('.json') || c.path.split(/[/.]/).includes(edit.locale)));
  const source = await scan(loc.path);
  const suffix = edit.attribute ? `#${edit.attribute}` : edit.textNodeIndex !== undefined ? `#text:${edit.textNodeIndex}` : '';
  const direct = matches(source.elements.get(`${loc.line}:${loc.column}${suffix}`) ?? []);
  // A locator is authoritative only while its source revision is unchanged. On drift,
  // search for old text rather than accidentally editing a newly inserted duplicate.
  if (direct.length === 1 && (!edit.baseRev || direct[0].baseRev === edit.baseRev) && (!edit.candidateId || direct[0].id === edit.candidateId)) return outcome(direct);
  function choose(list: Candidate[]): Resolution {
    if (edit.candidateId) {
      const selected = list.filter(c => c.id === edit.candidateId && (!edit.baseRev || c.baseRev === edit.baseRev));
      if (selected.length === 1) return outcome(selected);
    }
    return outcome(list);
  }
  const local = matches(source.candidates);
  if (local.length) return choose(local);
  const visited = new Set([loc.path]);
  let level = [loc.path];
  for (let depth = 0; depth < 2; depth++) {
    const next: string[] = [];
    for (const path of level) {
      for (let specifier of (await scan(path)).imports) {
        let base: string | undefined;
        if (specifier.startsWith('.')) base = posix.normalize(posix.join(posix.dirname(path), specifier));
        else for (const [alias, target] of Object.entries(config.importAliases)) {
          if (specifier.startsWith(alias)) { base = posix.normalize(posix.join(target, specifier.slice(alias.length))); break; }
        }
        if (!base) continue;
        const imported = [base, ...['.tsx', '.jsx', '.ts', '.js', '.json', '.astro'].flatMap(ext => [base + ext, `${base}/index${ext}`])].find(p => paths.has(p));
        if (imported && !visited.has(imported)) { visited.add(imported); next.push(imported); }
      }
    }
    const found = (await Promise.all(next.map(async path => matches((await scan(path)).candidates)))).flat();
    if (found.length) return choose(found);
    level = next;
  }
  const found: Candidate[] = [];
  for (const path of files) {
    if (visited.has(path)) continue;
    // Ignore unrelated unsupported/generated syntax, but never hide failure in the clicked source.
    try { found.push(...matches((await scan(path)).candidates)); } catch { continue; }
  }
  return choose(found);
}
