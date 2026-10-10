export interface SourceFile { content: string; rev: string }
export interface FileChange { path: string; content: string; baseRev: string; diff: string; encoding?: 'utf8' | 'base64' }
export interface PublishResult { committed: boolean; commit?: string; branch?: string; pr?: string; prNumber?: number; previewUrl?: string; state?: string; message?: string }
export interface Sink {
  read(path: string): Promise<SourceFile>;
  list(): Promise<string[]>;
  write(changes: FileChange[], message: string): Promise<PublishResult>;
}
export type LiteralKind = 'jsx' | 'jsx-attribute' | 'string' | 'template' | 'json' | 'astro-text' | 'astro-attribute';
export interface Candidate {
  id: string; path: string; start: number; end: number; line: number; column: number;
  kind: LiteralKind; value: string; raw: string; baseRev: string; attribute?: string;
}
export interface EditRequest {
  src: string; oldText: string; newText: string; baseRev?: string; candidateId?: string;
  attribute?: string; textNodeIndex?: number; locale?: string;
}
export type Resolution = { status: 'resolved'; candidate: Candidate } | { status: 'ambiguous'; candidates: Candidate[] } | { status: 'unresolved'; candidates: [] };
export interface ElementContext {
  src: string; ancestors: string[]; pageUrl: string; outerHTML: string; oldText: string;
  instruction: string; candidates?: Candidate[]; screenshot?: string;
}
export interface AgentProposal { changes: FileChange[]; message: string }
export class ConflictError extends Error { constructor(message: string) { super(message); this.name = 'ConflictError'; } }
export class ResolutionError extends Error {
  constructor(public resolution: Resolution, public edit: EditRequest) { super('Text must resolve to exactly one source literal'); this.name = 'ResolutionError'; }
}
