import { resolveEdit } from './resolver.js';
import { patchSource } from './patcher.js';
import { ConflictError, ResolutionError, type EditRequest, type Sink, type Candidate, type FileChange } from './types.js';
import type { InlineCMSConfig } from './config.js';

/** Resolve every edit against one snapshot, then splice from right to left. */
export async function prepareEdits(sink: Sink, config: InlineCMSConfig, edits: EditRequest[]): Promise<FileChange[]> {
  const snapshots = new Map<string, Awaited<ReturnType<Sink['read']>>>();
  const snapshotSink: Sink = { ...sink, list: () => sink.list(), write: (c, m) => sink.write(c, m), read: async path => {
    if (!snapshots.has(path)) snapshots.set(path, await sink.read(path));
    return snapshots.get(path)!;
  } };
  const groups = new Map<string, { candidate: Candidate; newText: string }[]>();
  for (const edit of edits) {
    const resolution = await resolveEdit(snapshotSink, config, edit);
    if (resolution.status !== 'resolved') throw new ResolutionError(resolution, edit);
    const candidate = resolution.candidate;
    const group = groups.get(candidate.path) ?? [];
    const existing = group.find(e => e.candidate.id === candidate.id);
    if (existing && existing.newText !== edit.newText) throw new ConflictError('Two edits change the same literal differently');
    if (!existing) group.push({ candidate, newText: edit.newText });
    groups.set(candidate.path, group);
  }
  return Promise.all([...groups].map(([path, group]) => patchSource(path, snapshots.get(path)!.content, group)));
}
