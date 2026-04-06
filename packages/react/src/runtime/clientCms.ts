/**
 * Client-side CMS content store with subscription support.
 *
 * getCms() is a plain function for reading values — safe in conditionals,
 * loops, and .map() callbacks. It reads from a module-level store that
 * is kept in sync by the InlineCMSProvider.
 *
 * useContentVersion() is a React hook that triggers re-renders when the
 * store changes. Components that use getCms() should also call
 * useContentVersion() once at the top level to stay reactive.
 * The Babel plugin handles this automatically.
 */

import { useSyncExternalStore } from 'react';

type ContentMap = Record<string, string>;

/** Module-level store — written by the provider, read by getCms */
let storeContent: ContentMap = {};
let storeDirtyKeys: ContentMap = {};
let version = 0;
const listeners = new Set<() => void>();

function emitChange() {
  version++;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return version;
}

/**
 * Update the module-level store. Called by InlineCMSProvider on every render.
 */
export function __updateClientCmsStore(content: ContentMap, dirtyKeys: ContentMap): void {
  const changed =
    content !== storeContent || dirtyKeys !== storeDirtyKeys;
  storeContent = content;
  storeDirtyKeys = dirtyKeys;
  if (changed) {
    emitChange();
  }
}

/**
 * Hook that triggers a re-render when the content store changes.
 * Call once at the top of any component that uses getCms().
 * The Babel plugin injects this automatically for client components.
 */
export function useContentVersion(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Plain function content accessor for client components.
 * Reads from the module-level store populated by the provider.
 *
 * Priority: dirty (unsaved edit) → persisted content → fallback
 *
 * Safe to call inside conditionals, loops, and .map() callbacks.
 * For reactivity, the containing component must call useContentVersion()
 * once at the top level (the Babel plugin does this automatically).
 */
export function getCms(key: string, fallback: string): string {
  return storeDirtyKeys[key] ?? storeContent[key] ?? fallback;
}
