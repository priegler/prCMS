'use client';

import React, { useCallback, useState } from 'react';

interface LoginDialogProps {
  onSuccess: () => void;
  onCancel: () => void;
}

/**
 * Minimal login dialog for CMS admin authentication.
 * Shown when the user tries to enter edit mode without being authenticated.
 */
export function LoginDialog({ onSuccess, onCancel }: LoginDialogProps) {
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secret.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/cms/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret }),
      });

      if (res.ok) {
        onSuccess();
      } else {
        setError('Invalid secret');
      }
    } catch {
      setError('Could not connect to auth endpoint');
    } finally {
      setLoading(false);
    }
  }, [secret, onSuccess]);

  return (
    <div style={backdropStyle} onClick={onCancel}>
      <form
        style={dialogStyle}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div style={headerStyle}>InlineCMS Login</div>
        <input
          type="password"
          placeholder="Enter CMS secret"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          style={inputStyle}
          autoFocus
        />
        {error && <div style={errorStyle}>{error}</div>}
        <div style={buttonRowStyle}>
          <button type="button" onClick={onCancel} style={cancelButtonStyle}>
            Cancel
          </button>
          <button type="submit" disabled={loading || !secret.trim()} style={submitButtonStyle}>
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 999999,
  background: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

const dialogStyle: React.CSSProperties = {
  background: '#1e293b',
  borderRadius: '12px',
  padding: '24px',
  width: '320px',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
  color: '#f1f5f9',
};

const headerStyle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 700,
  marginBottom: '16px',
  color: '#60a5fa',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: '6px',
  border: '1px solid #475569',
  background: '#334155',
  color: '#f1f5f9',
  fontSize: '14px',
  outline: 'none',
  boxSizing: 'border-box',
};

const errorStyle: React.CSSProperties = {
  color: '#f87171',
  fontSize: '12px',
  marginTop: '8px',
};

const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '8px',
  marginTop: '16px',
};

const cancelButtonStyle: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: '6px',
  border: '1px solid #475569',
  background: 'transparent',
  color: '#94a3b8',
  fontSize: '13px',
  cursor: 'pointer',
};

const submitButtonStyle: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: '6px',
  border: 'none',
  background: '#3b82f6',
  color: 'white',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
};
