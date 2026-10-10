'use client';
import React, { createContext, lazy, Suspense, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Candidate, EditRequest, FileChange, ElementContext, PublishResult } from '@inlinecms/core';
import { LoginDialog } from '../editor/LoginDialog.js';
const EditorOverlay = lazy(() => import('../editor/EditorOverlay.js').then(m => ({ default: m.EditorOverlay })));

export interface PendingChange {
  id: string; label: string; edit?: EditRequest; changes: Pick<FileChange, 'path' | 'diff'>[];
  proposalToken?: string; restore?: () => void; waiting?: boolean;
}
interface Ambiguity { edit: EditRequest; candidates: Candidate[]; apply?: () => void; restore?: () => void; id: string }
interface CMSContextValue {
  apiPath: string; isEditing: boolean; setEditing: (value: boolean) => void;
  pending: PendingChange[]; busy: boolean; error: string | null; status: PublishResult | null;
  ambiguity: Ambiguity | null; setAmbiguity: (value: Ambiguity | null) => void;
  previewEdit: (edit: EditRequest, id: string, apply?: () => void, restore?: () => void) => Promise<boolean>;
  chooseCandidate: (candidate: Candidate) => Promise<void>;
  revert: (id: string) => void; publish: () => Promise<void>;
  askAgent: (context: ElementContext) => Promise<void>;
  uploadImage: (file: File) => Promise<{ src: string; token: string; change: Pick<FileChange, 'path' | 'diff'> }>;
  attachImage: (id: string, token: string, change: Pick<FileChange, 'path' | 'diff'>) => void;
}
const CMSContext = createContext<CMSContextValue | null>(null);
export interface InlineCMSProviderProps { children: React.ReactNode; apiPath?: string }
export function InlineCMSProvider({ children, apiPath = '/api/cms' }: InlineCMSProviderProps) {
  const [isEditing, setEditing] = useState(false), [showLogin, setShowLogin] = useState(false), [mode, setMode] = useState('fs');
  const [pending, setPending] = useState<PendingChange[]>([]), pendingRef = useRef(pending);
  pendingRef.current = pending;
  const [busyCount, setBusyCount] = useState(0), [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<PublishResult | null>(null);
  const [ambiguity, setAmbiguity] = useState<Ambiguity | null>(null);
  const jobs = useRef(new Set<Promise<unknown>>());
  const [agentCommit, setAgentCommit] = useState<string | null>(null);
  async function post(action: string, data: unknown) {
    const response = await fetch(`${apiPath}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error ?? 'CMS request failed'), { result });
    return result;
  }
  const requestEdit = useCallback(async () => {
    try {
      const response = await fetch(`${apiPath}/auth`);
      if (!response.ok) throw new Error('Editor is unavailable in this deployment');
      const result = await response.json(); setMode(result.mode);
      if (result.authenticated) setEditing(true); else setShowLogin(true);
    } catch (e) { setError((e as Error).message); }
  }, [apiPath]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('cms') === 'edit') void requestEdit();
  }, [requestEdit]);
  useEffect(() => {
    const shortcut = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'e') { e.preventDefault(); if (isEditing) setEditing(false); else void requestEdit(); }
    };
    document.addEventListener('keydown', shortcut); return () => document.removeEventListener('keydown', shortcut);
  }, [isEditing, requestEdit]);
  // Poll deployments and agent commits; a PR's new SHA is the completion signal.
  useEffect(() => {
    if (!isEditing || !status?.prNumber || status.state === 'closed' || (!agentCommit && status.previewUrl)) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`${apiPath}/status?pr=${status.prNumber}&branch=${encodeURIComponent(status.branch ?? '')}`);
        if (!response.ok) return;
        const result = await response.json(); if (cancelled) return;
        setStatus(prev => prev ? { ...prev, ...result } : prev);
        if (agentCommit && result.commit !== agentCommit) {
          setPending(prev => [...prev.filter(c => c.id !== 'hosted-agent'), { id: 'hosted-agent', label: 'Agent source proposal (draft PR)', changes: result.diffs }]);
        }
      } catch { /* Keep the existing PR link usable while polling is unavailable. */ }
    };
    // Keep a reviewed agent diff fresh at a lower rate; normal publishes stop
    // once the preview is available, and closing the editor cancels all polling.
    const interval = agentCommit && status.commit !== agentCommit ? 60000 : 5000;
    void poll(); const timer = setInterval(poll, interval);
    return () => { cancelled = true; clearInterval(timer); };
  }, [apiPath, isEditing, status?.prNumber, status?.branch, status?.state, status?.previewUrl, status?.commit, agentCommit]);
  async function work<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusyCount(n => n + 1); setError(null);
    const job = fn(); jobs.current.add(job);
    try { return await job; }
    catch (e) {
      const result = (e as Error & { result?: { status: string; edit?: EditRequest; candidates: Candidate[] } }).result;
      if (result?.status === 'ambiguous' && result.edit) {
        const change = pendingRef.current.find(p => p.edit?.src === result.edit!.src && p.edit?.oldText === result.edit!.oldText && p.edit?.attribute === result.edit!.attribute && p.edit?.textNodeIndex === result.edit!.textNodeIndex);
        if (change) setAmbiguity({ edit: result.edit, candidates: result.candidates, id: change.id, restore: change.restore });
      }
      setError((e as Error).message); return undefined;
    }
    finally { jobs.current.delete(job); setBusyCount(n => n - 1); }
  }
  async function previewEdit(edit: EditRequest, id: string, apply?: () => void, restore?: () => void) {
    const existing = pendingRef.current.find(p => p.id === id);
    const request = existing?.edit ? { ...existing.edit, newText: edit.newText, ...(edit.candidateId ? { candidateId: edit.candidateId, baseRev: edit.baseRev } : {}) } : edit;
    const result = await work(async () => {
      if (agentCommit) throw new Error('Finish or discard the hosted agent proposal before editing');
      const result = await post('preview', request);
      if (result.status !== 'resolved') {
        if (result.status === 'ambiguous') setAmbiguity({ edit: request, candidates: result.candidates, apply, restore: existing?.restore ?? restore, id });
        else setError('No unique source literal found. Use Ask AI for this element.');
        return false;
      }
      const resolvedEdit = { ...request, candidateId: result.candidate.id, baseRev: result.candidate.baseRev };
      const pendingChange: PendingChange = { id, label: request.attribute ?? 'Text', edit: resolvedEdit, changes: result.changes, restore: existing?.restore ?? restore };
      setPending(prev => [...prev.filter(p => p.id !== id), pendingChange]);
      apply?.(); setAmbiguity(null); return true;
    });
    return result ?? false;
  }
  async function chooseCandidate(candidate: Candidate) {
    if (!ambiguity) return;
    await previewEdit({ ...ambiguity.edit, candidateId: candidate.id, baseRev: candidate.baseRev }, ambiguity.id, ambiguity.apply, ambiguity.restore);
  }
  function revert(id: string) {
    if (id === 'hosted-agent') {
      void work(async () => { await post('discard-agent', { pr: status?.prNumber, branch: status?.branch }); setAgentCommit(null); setStatus(null); setPending(prev => prev.filter(p => p.id !== id)); });
      return;
    }
    const sourceId = id.startsWith('image:') ? id.slice('image:'.length) : id;
    pendingRef.current.find(p => p.id === sourceId)?.restore?.();
    setPending(prev => prev.filter(p => p.id !== sourceId && p.id !== `image:${sourceId}`));
  }
  async function publish() {
    // Wait for an inline edit's blur preview before taking the publishing snapshot.
    await Promise.allSettled([...jobs.current]);
    await work(async () => {
      const changes = pendingRef.current;
      if (!changes.length) return;
      if (changes.some(c => c.id === 'hosted-agent')) {
        if (changes.length !== 1 || changes[0].waiting) throw new Error('Wait for the agent diff and review it before publishing');
        const result = await post('approve-agent', { pr: status?.prNumber, commit: status?.commit, branch: status?.branch });
        setStatus(result); setAgentCommit(null); setPending([]); return;
      }
      const result = await post('publish', { edits: changes.flatMap(p => p.edit ? [p.edit] : []), proposals: changes.flatMap(p => p.proposalToken ? [p.proposalToken] : []) });
      setStatus(result); setPending([]);
    });
  }
  async function askAgent(context: ElementContext) {
    await work(async () => {
      if (agentCommit || pendingRef.current.length) throw new Error('Publish or revert pending changes before asking AI');
      const result = await post('agent', context);
      if (result.hosted) { setStatus(result); setAgentCommit(result.commit); setPending([{ id: 'hosted-agent', label: 'Waiting for agent source proposal', changes: [], waiting: true }]); }
      else setPending(prev => [...prev, { id: `agent:${Date.now()}`, label: result.message, changes: result.changes, proposalToken: result.proposalToken }]);
    });
  }
  async function uploadImage(file: File) {
    if (agentCommit) throw new Error('Finish or discard the hosted agent proposal before editing');
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file);
    });
    const result = await post('image', { base64 });
    return { src: result.src, token: result.proposalToken, change: result.change };
  }
  function attachImage(id: string, token: string, change: Pick<FileChange, 'path' | 'diff'>) {
    setPending(prev => [...prev.filter(p => p.id !== `image:${id}`), { id: `image:${id}`, label: 'Image upload', changes: [change], proposalToken: token }]);
  }
  return <CMSContext.Provider value={{ apiPath, isEditing, setEditing, pending, busy: busyCount > 0, error, status, ambiguity, setAmbiguity, previewEdit, chooseCandidate, revert, publish, askAgent, uploadImage, attachImage }}>
    {children}
    {isEditing && <Suspense fallback={null}><EditorOverlay /></Suspense>}
    {showLogin && <LoginDialog apiPath={apiPath} mode={mode} onSuccess={() => { setShowLogin(false); setEditing(true); }} onCancel={() => setShowLogin(false)} />}
    {!isEditing && error && <div data-inlinecms-ui role="alert" style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 999999, background: '#fee2e2', padding: 12 }}>{error}</div>}
  </CMSContext.Provider>;
}
export function useCMSContext() {
  const context = useContext(CMSContext); if (!context) throw new Error('InlineCMSProvider is required'); return context;
}
