'use client';

import React from 'react';
import { useCMSContext } from '../runtime/provider.js';

/**
 * Dropdown language switcher for the editor toolbar.
 * Shows configured locales and indicates which is active.
 */
export function LanguageSwitcher() {
  const { locale, locales, setLocale } = useCMSContext();

  if (locales.length <= 1) return null;

  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value)}
      style={selectStyle}
      title="Switch language"
    >
      {locales.map((loc) => (
        <option key={loc} value={loc}>
          {loc.toUpperCase()}
        </option>
      ))}
    </select>
  );
}

const selectStyle: React.CSSProperties = {
  padding: '3px 8px',
  borderRadius: '6px',
  border: '1px solid #475569',
  background: '#334155',
  color: '#e2e8f0',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
};
