'use client';

import React, { useCallback, useState } from 'react';
import { useCMSContext } from '../runtime/provider.js';
import { LanguageSwitcher } from './LanguageSwitcher.js';

/**
 * Floating toolbar for the CMS editor.
 * Shows Save / Discard / Commit buttons, language switcher, and a pending changes count.
 */
export function Toolbar() {
  const { dirtyKeys, saveChanges, discardChanges, locale, locales, setLocale, isEditing, setEditing } = useCMSContext();
  const [saving, setSaving] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const pendingCount = Object.keys(dirtyKeys).length;

  const handleSave = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    try {
      await saveChanges();
      setMessage('Saved!');
      setTimeout(() => setMessage(null), 2000);
    } catch {
      setMessage('Save failed');
    } finally {
      setSaving(false);
    }
  }, [saveChanges]);

  const handleDiscard = useCallback(() => {
    // Revert all contentEditable elements to their original text
    document.querySelectorAll('[data-cms][data-cms-original]').forEach((el) => {
      const htmlEl = el as HTMLElement;
      const original = htmlEl.dataset.cmsOriginal;
      if (original !== undefined) {
        htmlEl.textContent = original;
        delete htmlEl.dataset.cmsOriginal;
      }
    });
    discardChanges();
    setMessage('Discarded');
    setTimeout(() => setMessage(null), 2000);
  }, [discardChanges]);

  const handleCommit = useCallback(async () => {
    setCommitting(true);
    setMessage(null);
    try {
      const res = await fetch('/api/cms/commit', { method: 'POST' });
      if (res.ok) {
        setMessage('Committed & pushed!');
      } else {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }));
        setMessage(`Commit failed: ${data.error}`);
      }
      setTimeout(() => setMessage(null), 3000);
    } catch {
      setMessage('Commit failed');
    } finally {
      setCommitting(false);
    }
  }, []);

  const handleClose = useCallback(() => {
    setEditing(false);
  }, [setEditing]);

  return (
    <div style={toolbarStyle}>
      <div style={leftSection}>
        <span style={logoStyle}>CMS</span>
        {pendingCount > 0 && (
          <span style={badgeStyle}>{pendingCount} change{pendingCount !== 1 ? 's' : ''}</span>
        )}
      </div>

      <div style={centerSection}>
        {message && <span style={messageStyle}>{message}</span>}
      </div>

      <div style={rightSection}>
        <LanguageSwitcher />
        <button
          onClick={handleSave}
          disabled={saving || pendingCount === 0}
          style={pendingCount > 0 ? primaryButtonStyle : buttonStyle}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button
          onClick={handleDiscard}
          disabled={pendingCount === 0}
          style={buttonStyle}
        >
          Discard
        </button>
        <button
          onClick={handleCommit}
          disabled={committing}
          style={buttonStyle}
        >
          {committing ? 'Committing...' : 'Commit'}
        </button>
        <button onClick={handleClose} style={closeButtonStyle} title="Exit edit mode">
          &times;
        </button>
      </div>
    </div>
  );
}

// ─── Inline styles (no CSS dependency) ──────────────────

const toolbarStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: '20px',
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 999999,
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '8px 16px',
  background: '#1e293b',
  color: '#f1f5f9',
  borderRadius: '12px',
  boxShadow: '0 4px 24px rgba(0, 0, 0, 0.3)',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontSize: '13px',
  userSelect: 'none',
};

const leftSection: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};

const centerSection: React.CSSProperties = {
  flex: 1,
  textAlign: 'center',
  minWidth: '80px',
};

const rightSection: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
};

const logoStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: '14px',
  letterSpacing: '0.5px',
  color: '#60a5fa',
};

const badgeStyle: React.CSSProperties = {
  background: '#3b82f6',
  color: 'white',
  borderRadius: '10px',
  padding: '2px 8px',
  fontSize: '11px',
  fontWeight: 600,
};

const messageStyle: React.CSSProperties = {
  color: '#94a3b8',
  fontSize: '12px',
};

const buttonStyle: React.CSSProperties = {
  padding: '4px 12px',
  borderRadius: '6px',
  border: '1px solid #475569',
  background: 'transparent',
  color: '#e2e8f0',
  cursor: 'pointer',
  fontSize: '12px',
  fontWeight: 500,
};

const primaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: '#3b82f6',
  border: '1px solid #3b82f6',
  color: 'white',
};

const closeButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  border: 'none',
  fontSize: '18px',
  lineHeight: 1,
  padding: '2px 6px',
  color: '#94a3b8',
};
