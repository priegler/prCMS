/**
 * Client-side CMS content accessor — NOT a React hook.
 *
 * This is a plain function that reads from a module-level content store
 * populated by the InlineCMSProvider. It's safe to call anywhere:
 * inside conditionals, loops, callbacks, and .map() iterators.
 *
 * The Babel plugin emits getCms() calls (not useCms()) for client components
 * to avoid React hook-order violations.
 */

type ContentMap = Record<string, string>;

interface ClientCmsStore {
  content: ContentMap;
  dirtyKeys: ContentMap;
}

/** Module-level store — written by the provider, read by getCms */
const store: ClientCmsStore = {
  content: {},
  dirtyKeys: {},
};

/**
 * Update the module-level store. Called by InlineCMSProvider on every render.
 */
export function __updateClientCmsStore(content: ContentMap, dirtyKeys: ContentMap): void {
  store.content = content;
  store.dirtyKeys = dirtyKeys;
}

/**
 * Plain function content accessor for client components.
 * Reads from the module-level store populated by the provider.
 *
 * Priority: dirty (unsaved edit) → persisted content → fallback
 */
export function getCms(key: string, fallback: string): string {
  return store.dirtyKeys[key] ?? store.content[key] ?? fallback;
}
