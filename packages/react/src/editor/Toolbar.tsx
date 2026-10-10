'use client';
import React from 'react';
import { useCMSContext } from '../runtime/provider.js';
export const panelStyle: React.CSSProperties = { position: 'fixed', zIndex: 999999, background: '#0f172a', color: '#f8fafc', padding: 16, borderRadius: 12, boxShadow: '0 8px 40px #0005', fontFamily: 'system-ui, sans-serif', fontSize: 13 };
export const buttonStyle: React.CSSProperties = { padding: '7px 12px', margin: '4px 4px 4px 0', background: '#334155', color: 'white', border: '1px solid #64748b', borderRadius: 6, cursor: 'pointer' };
export function Toolbar() {
  const { pending, busy, error, status, revert, publish, setEditing, ambiguity, chooseCandidate, setAmbiguity } = useCMSContext();
  return <aside data-inlinecms-ui style={{ ...panelStyle, bottom: 16, left: 16, width: 'min(540px, calc(100vw - 64px))', maxHeight: '50vh', overflow: 'auto' }} aria-label="InlineCMS pending changes">
    <strong>InlineCMS · {pending.length} pending change{pending.length === 1 ? '' : 's'}</strong>
    <div><button style={buttonStyle} disabled={busy || pending.length === 0 || pending.some(p => p.waiting) || !!ambiguity} onClick={() => void publish()}>{busy ? 'Working…' : 'Publish'}</button>
      <button style={buttonStyle} disabled={busy} onClick={() => { pending.forEach(p => revert(p.id)); setEditing(false); }}>Close editor</button></div>
    {error && <p role="alert" style={{ color: '#fca5a5' }}>{error}</p>}
    {status && <p role="status">{status.message ?? (status.committed ? 'Committed' : 'Saved to source')}
      {status.pr && <> · <a style={{ color: '#93c5fd' }} href={status.pr} target="_blank" rel="noreferrer">Review PR</a></>}
      {status.previewUrl && <> · <a style={{ color: '#93c5fd' }} href={status.previewUrl} target="_blank" rel="noreferrer">Open preview</a></>}
    </p>}
    {pending.map(p => <section key={p.id} style={{ borderTop: '1px solid #334155', marginTop: 12 }}>
      <p>{p.label} <button style={buttonStyle} disabled={busy} onClick={() => revert(p.id)}>Revert</button></p>
      {p.changes.map((c, i) => <details key={`${c.path}:${i}`} open><summary>{c.path}</summary><pre style={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>{c.diff}</pre></details>)}
    </section>)}
    {ambiguity && <section role="dialog" aria-label="Choose source literal"><p>This text appears in several places. Choose the source to change:</p>
      {ambiguity.candidates.map(c => <button key={c.id} style={{ ...buttonStyle, display: 'block', textAlign: 'left' }} disabled={busy} onClick={() => void chooseCandidate(c)}>{c.path}:{c.line}:{c.column}<br /><code>{c.raw.slice(0, 160)}</code></button>)}
      <button style={buttonStyle} onClick={() => setAmbiguity(null)}>Cancel</button></section>}
  </aside>;
}
