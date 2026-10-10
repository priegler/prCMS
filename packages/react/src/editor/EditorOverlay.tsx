'use client';
import React, { useEffect, useRef, useState } from 'react';
import { useCMSContext } from '../runtime/provider.js';
import { Toolbar, panelStyle, buttonStyle } from './Toolbar.js';
const attributes = ['alt', 'title', 'placeholder', 'aria-label', 'src'];
const identities = new WeakMap<Element, number>(); let nextIdentity = 0;
function identity(el: Element, suffix = 'text') {
  if (!identities.has(el)) identities.set(el, ++nextIdentity);
  return `${identities.get(el)}:${suffix}`;
}
function textOf(node: Node) { return (node.textContent ?? '').replace(/\s+/g, ' ').trim(); }
export function EditorOverlay() {
  const { previewEdit, askAgent, busy, uploadImage, attachImage } = useCMSContext();
  const [selected, setSelected] = useState<HTMLElement | null>(null), [hovered, setHovered] = useState<HTMLElement | null>(null);
  const [instruction, setInstruction] = useState(''), [fields, setFields] = useState<Record<string, string>>({});
  const [mixedText, setMixedText] = useState<Record<number, string>>({}), [localError, setLocalError] = useState<string | null>(null);
  const [inlineActive, setInlineActive] = useState(false);
  const editing = useRef<{ el: HTMLElement; original: string; editable: string; outline: string } | null>(null);
  const imagePreviews = useRef<string[]>([]);
  const current = selected ?? hovered;
  const previewRef = useRef(previewEdit); previewRef.current = previewEdit;
  function finish(cancel = false) {
    const active = editing.current; if (!active) return;
    editing.current = null; setInlineActive(false);
    const value = active.el.textContent ?? '';
    active.el.contentEditable = active.editable; active.el.style.outline = active.outline;
    if (cancel) { active.el.textContent = active.original; return; }
    if (value !== active.original) {
      active.el.textContent = active.original;
      void previewRef.current({ src: active.el.dataset.src!, oldText: active.original, newText: value }, identity(active.el),
        () => { active.el.textContent = value; }, () => { active.el.textContent = active.original; });
    }
  }
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || e.target.closest('[data-inlinecms-ui]')) return;
      setHovered(e.target.closest<HTMLElement>('[data-src]'));
    };
    const click = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || e.target.closest('[data-inlinecms-ui]')) return;
      const target = e.target.closest<HTMLElement>('[data-src]'); if (!target) return;
      if (editing.current?.el === target) return;
      e.preventDefault(); e.stopPropagation(); finish(); setSelected(target);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { finish(true); setSelected(null); } };
    const blur = (e: FocusEvent) => { if (e.target === editing.current?.el) finish(); };
    document.addEventListener('mousemove', move, true); document.addEventListener('click', click, true);
    document.addEventListener('keydown', key, true); document.addEventListener('blur', blur, true);
    return () => {
      document.removeEventListener('mousemove', move, true); document.removeEventListener('click', click, true);
      document.removeEventListener('keydown', key, true); document.removeEventListener('blur', blur, true);
      finish(true);
      imagePreviews.current.forEach(url => URL.revokeObjectURL(url));
    };
  }, []);
  useEffect(() => {
    if (!current) return;
    const original = current.style.outline, offset = current.style.outlineOffset;
    current.style.outline = '2px solid #3b82f6'; current.style.outlineOffset = '2px';
    setFields(Object.fromEntries(attributes.filter(a => current.hasAttribute(a)).map(a => [a, current.getAttribute(a)!])));
    setMixedText(Object.fromEntries([...current.childNodes].filter(n => n.nodeType === Node.TEXT_NODE && textOf(n)).map((n, i) => [i, n.textContent ?? ''])));
    return () => { current.style.outline = original; current.style.outlineOffset = offset; };
  }, [current]);
  function activateInline() {
    if (!current || current.children.length || !textOf(current) || busy) return;
    finish(); setSelected(current);
    editing.current = { el: current, original: current.textContent ?? '', editable: current.contentEditable, outline: current.style.outline };
    setInlineActive(true); current.contentEditable = 'plaintext-only'; current.focus();
    const selection = window.getSelection(), range = document.createRange(); range.selectNodeContents(current); selection?.removeAllRanges(); selection?.addRange(range);
  }
  async function editAttribute(attr: string, value: string, onResolved?: () => void, previewValue = value) {
    if (!current) return false;
    const oldText = current.getAttribute(attr) ?? '';
    return previewEdit({ src: current.dataset.src!, oldText, newText: value, attribute: attr }, identity(current, attr),
      () => { current.setAttribute(attr, previewValue); onResolved?.(); }, () => current.setAttribute(attr, oldText));
  }
  function agent() {
    if (!current || !instruction.trim()) return;
    const ancestors: string[] = []; let parent = current.parentElement;
    while (parent && ancestors.length < 20) { if (parent.dataset.src) ancestors.push(parent.dataset.src); parent = parent.parentElement; }
    void askAgent({ src: current.dataset.src!, oldText: textOf(current), outerHTML: current.outerHTML.slice(0, 16000), pageUrl: location.href, ancestors, instruction });
  }
  const mixed = current?.children.length ? [...current.childNodes].filter(n => n.nodeType === Node.TEXT_NODE && textOf(n)) : [];
  return <div data-inlinecms-ui>
    <Toolbar />
    {current && <aside data-inlinecms-ui style={{ ...panelStyle, right: 16, top: 16, width: 'min(320px, calc(100vw - 64px))', maxHeight: '70vh', overflow: 'auto' }} aria-label="Element editor">
      <strong>{current.tagName.toLowerCase()}</strong> <button style={buttonStyle} onClick={() => { finish(); setSelected(null); setHovered(null); }}>×</button>
      <p style={{ fontSize: 11, overflowWrap: 'anywhere' }}>{current.dataset.src}</p>
      {!current.children.length && textOf(current) && <button style={buttonStyle} disabled={busy} onClick={activateInline}>{inlineActive ? 'Click outside to preview · Esc to cancel' : 'Edit text inline'}</button>}
      {mixed.map((node, index) => <label key={index} style={{ display: 'block' }}>Text fragment {index + 1}
        <textarea value={mixedText[index] ?? node.textContent ?? ''} style={{ width: '100%', boxSizing: 'border-box' }} onChange={e => setMixedText(prev => ({ ...prev, [index]: e.target.value }))} />
        <button style={buttonStyle} disabled={busy} onClick={() => {
          const original = node.textContent ?? '', value = mixedText[index] ?? original;
          void previewEdit({ src: current.dataset.src!, oldText: original, newText: value, textNodeIndex: index }, identity(current, `text:${index}`), () => { node.textContent = value; }, () => { node.textContent = original; });
        }}>Preview fragment</button></label>)}
      {attributes.filter(a => current.hasAttribute(a)).map(attr => <label key={attr} style={{ display: 'block', marginTop: 8 }}>{attr}
        <input value={fields[attr] ?? ''} style={{ width: '100%', boxSizing: 'border-box' }} onChange={e => setFields(prev => ({ ...prev, [attr]: e.target.value }))} />
        <button style={buttonStyle} disabled={busy} onClick={() => void editAttribute(attr, fields[attr])}>Preview attribute</button></label>)}
      {current.tagName === 'IMG' && <label style={{ display: 'block' }}>Replace image
        <input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif" disabled={busy} onChange={async e => {
          const file = e.target.files?.[0]; if (!file) return;
          try {
            if (file.size > 5 * 1024 * 1024) throw new Error('Images must be under 5 MB');
            const upload = await uploadImage(file);
            const preview = URL.createObjectURL(file); imagePreviews.current.push(preview);
            await editAttribute('src', upload.src, () => attachImage(identity(current, 'src'), upload.token, upload.change), preview);
          } catch (error) { setLocalError((error as Error).message); }
        }} /></label>}
      <label style={{ display: 'block', marginTop: 12 }}>Ask AI<textarea value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="Shorten this paragraph, or add a fourth feature card…" style={{ width: '100%', boxSizing: 'border-box' }} /></label>
      <button style={buttonStyle} disabled={busy || !instruction.trim()} onClick={agent}>Ask AI</button>
      {localError && <p role="alert">{localError}</p>}
    </aside>}
  </div>;
}
