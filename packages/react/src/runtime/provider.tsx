'use client';

import React, { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ContentMap } from '@inlinecms/babel-plugin';

const EditorOverlay = lazy(() => import('../editor/EditorOverlay.js').then(m => ({ default: m.EditorOverlay })));

interface CMSContextValue {
  /** Current content map for the active locale */
  content: ContentMap;
  /** Active locale */
  locale: string;
  /** All available locales */
  locales: string[];
  /** Whether the editor is active */
  isEditing: boolean;
  /** Pending changes not yet saved */
  dirtyKeys: ContentMap;
  /** Set a locale */
  setLocale: (locale: string) => void;
  /** Toggle edit mode */
  setEditing: (editing: boolean) => void;
  /** Register a content change from the editor */
  setDirty: (key: string, value: string) => void;
  /** Discard all pending changes */
  discardChanges: () => void;
  /** Save all pending changes */
  saveChanges: () => Promise<void>;
}

const CMSContext = createContext<CMSContextValue | null>(null);

export interface InlineCMSProviderProps {
  children: React.ReactNode;
  /** Default locale (defaults to "en") */
  defaultLocale?: string;
  /** All available locales (defaults to ["en"]) */
  locales?: string[];
}

export function InlineCMSProvider({ children, defaultLocale = 'en', locales = ['en'] }: InlineCMSProviderProps) {
  const [content, setContent] = useState<ContentMap>({});
  const [locale, setLocale] = useState(defaultLocale);
  const [isEditing, setEditing] = useState(false);
  const [dirtyKeys, setDirtyKeys] = useState<ContentMap>({});

  // Fetch content for the active locale
  useEffect(() => {
    fetchContent(locale).then(setContent).catch(console.error);
  }, [locale]);

  // Check auth status and activate editing if appropriate
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('cms') === 'edit') {
      checkAuth().then((authed) => {
        if (authed) setEditing(true);
      });
    }
  }, []);

  // Keyboard shortcut: Ctrl+Shift+E to toggle edit mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        checkAuth().then((authed) => {
          if (authed) setEditing((prev) => !prev);
        });
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const setDirty = useCallback((key: string, value: string) => {
    setDirtyKeys((prev) => ({ ...prev, [key]: value }));
  }, []);

  const discardChanges = useCallback(() => {
    setDirtyKeys({});
  }, []);

  const saveChanges = useCallback(async () => {
    if (Object.keys(dirtyKeys).length === 0) return;

    const res = await fetch('/api/cms/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale, changes: dirtyKeys }),
    });

    if (res.ok) {
      const updated = await res.json();
      setContent(updated.content);
      setDirtyKeys({});
    } else {
      console.error('Failed to save CMS changes:', await res.text());
    }
  }, [dirtyKeys, locale]);

  const value = useMemo<CMSContextValue>(
    () => ({
      content,
      locale,
      locales,
      isEditing,
      dirtyKeys,
      setLocale,
      setEditing,
      setDirty,
      discardChanges,
      saveChanges,
    }),
    [content, locale, locales, isEditing, dirtyKeys, setDirty, discardChanges, saveChanges],
  );

  return (
    <CMSContext.Provider value={value}>
      {children}
      {isEditing && (
        <Suspense fallback={null}>
          <EditorOverlay />
        </Suspense>
      )}
    </CMSContext.Provider>
  );
}

/**
 * Hook-based CMS content resolver for client components.
 * Returns the override value (including dirty edits) or the fallback.
 */
export function useCms(key: string, fallback: string): string {
  const ctx = useContext(CMSContext);
  if (!ctx) return fallback;

  // Dirty (unsaved edit) takes priority, then persisted content, then fallback
  return ctx.dirtyKeys[key] ?? ctx.content[key] ?? fallback;
}

/**
 * Access the full CMS context (for the editor overlay).
 */
export function useCMSContext(): CMSContextValue {
  const ctx = useContext(CMSContext);
  if (!ctx) {
    throw new Error('useCMSContext must be used within <InlineCMSProvider>');
  }
  return ctx;
}

// ─── Internal helpers ───────────────────────────────────────

async function fetchContent(locale: string): Promise<ContentMap> {
  try {
    const res = await fetch(`/api/cms/content?locale=${locale}`);
    if (res.ok) {
      const data = await res.json();
      return data.content ?? {};
    }
  } catch {
    // API not available — that's fine in dev without the route set up
  }
  return {};
}

async function checkAuth(): Promise<boolean> {
  try {
    const res = await fetch('/api/cms/auth', { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}
