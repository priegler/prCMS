# prCMS — Development Tasks

> Ordered work packages for building the MVP. Each task builds on the previous ones.
> Scope adjustments from plan review are noted inline.

---

## Task 0: Project Scaffolding

**Goal:** Set up the monorepo, tooling, and package structure.

- [ ] Initialize monorepo with pnpm workspaces (or npm workspaces)
- [ ] Create two packages: `packages/babel-plugin` and `packages/react`
  - `babel-plugin` = core types + key generation + Babel transform + CLI entry point
  - `react` = `cms()` runtime + editor overlay + `InlineCMSProvider` + API route handlers
- [ ] Set up TypeScript with project references across packages
- [ ] Set up shared tsconfig, eslint, prettier
- [ ] Add a `demo/` Next.js app (App Router) for manual testing
- [ ] Add basic build scripts (tsup or unbuild for each package)

**Why 2 packages, not 5:** Fewer publish targets, simpler dependency graph. Internal boundaries via folders, not packages. Split later when real users need it.

---

## Task 1: Core Types & Key Generation

**Goal:** Define the shared types and the key generation logic that everything else depends on.

- [ ] Define core types: `ContentKey`, `ContentMap`, `ContentManifest`, `InlineCMSConfig`
- [ ] Implement config loading from `inlinecms.config.ts` (with sensible defaults)
- [ ] Implement key generation strategy:
  - Primary key: `filePath::componentName>element#attr` (structural path)
  - Store content hash alongside each key in a manifest for conflict/drift detection
  - Support explicit `data-cms-key="..."` override in source JSX (user escape hatch)
- [ ] Implement `content.json` read/write utilities (load, merge, write with stable key ordering)
- [ ] Implement manifest read/write (`.inlinecms-manifest.json` — maps keys to metadata: original content hash, source location, last-updated timestamp)
- [ ] Write unit tests for key generation (component nesting, renames, attribute types)

**Location:** `packages/babel-plugin/src/core/`

---

## Task 2: Babel Plugin — String Extraction

**Goal:** Parse JSX files, find extractable strings, and generate `content.json`.

- [ ] Set up Babel plugin scaffold (`visitor` pattern, plugin options)
- [ ] Implement JSX text children extraction (string literals only, skip expressions/template literals)
- [ ] Implement JSX attribute extraction (configurable allowlist: `alt`, `title`, `placeholder`, `aria-label`)
- [ ] Skip non-content attributes by default (`className`, `id`, `href`, `key`, `ref`, event handlers)
- [ ] Resolve component names from AST (function declarations, arrow functions, default exports)
- [ ] Build structural path by walking up the AST from each extracted node
- [ ] Generate `content.json` output from extraction results
- [ ] Generate/update `.inlinecms-manifest.json`
- [ ] Handle edge cases: fragments (`<>`), multiple return statements, conditional JSX branches
- [ ] Wire up file discovery via glob patterns from config (`include`/`exclude`)
- [ ] Write tests: basic extraction, nested components, attributes, skipped elements

**Location:** `packages/babel-plugin/src/transform/`

---

## Task 3: Babel Plugin — JSX Rewrite

**Goal:** Transform JSX at compile time to read from `content.json` via the `cms()` runtime.

- [ ] Rewrite JSX string children → `{cms("key", "fallback")}` calls
- [ ] Rewrite JSX string attributes → `{cms("key", "fallback")}` expressions
- [ ] Inject `data-cms="key"` attribute on each transformed element (for editor targeting)
- [ ] Auto-inject `import { cms } from '@inlinecms/react'` at top of transformed files
- [ ] Handle the `'use client'` directive: if present, import `useCms` hook variant instead
- [ ] Ensure untouched files pass through unmodified (no unnecessary transforms)
- [ ] Integrate with Next.js via `withInlineCMS()` wrapper for `next.config.js`
- [ ] Write tests: before/after AST snapshots, Next.js integration smoke test

**Location:** `packages/babel-plugin/src/transform/`

---

## Task 4: `cms()` Runtime Function

**Goal:** The runtime that resolves content keys to values, with different strategies per environment.

- [ ] Implement `cms(key, fallback)` — sync version for RSC / server components
  - Reads from `content.{locale}.json` at request time
  - Locale detection via `cookies()` / `headers()` from `next/headers`
  - Returns fallback if no override exists (zero overhead path)
- [ ] Implement `useCms(key, fallback)` — hook version for client components
  - Reads from a React context populated by `InlineCMSProvider`
  - In editor mode: registers the element for live editing
  - In production: identical to sync version (returns override or fallback)
- [ ] Implement `InlineCMSProvider` shell (context setup, content loading, no editor UI yet)
  - Fetches content from `/api/cms/content?locale=...` on mount
  - Provides content map + locale + edit state via context
- [ ] Write tests: fallback behavior, override behavior, locale switching

**Location:** `packages/react/src/runtime/`

---

## Task 5: Persistence API Routes

**Goal:** Next.js API routes for saving content and basic auth.

- [ ] `POST /api/cms/auth` — validate `INLINE_CMS_SECRET` env var, set httpOnly cookie
- [ ] `GET /api/cms/content?locale=en` — return full content map for requested locale
- [ ] `POST /api/cms/save` — accept `{ locale, changes }`, merge into `content.{locale}.json`, write to disk
  - Validate auth cookie
  - Read existing content file
  - Deep merge changes
  - Write with stable JSON key ordering
  - Return updated content map
- [ ] `POST /api/cms/commit` — run `git add content/ && git commit && git push`
  - Guard: only available when Git CLI is accessible (not serverless)
  - Configurable commit message template
- [ ] Export as `{ GET, POST }` from a single handler that routes on the action path segment
- [ ] Wire up the demo app to mount the route at `app/api/cms/[...action]/route.ts`
- [ ] Write tests: auth flow, save/merge logic, error cases

**Location:** `packages/react/src/api/`

---

## Task 6: Editor Overlay — Highlight & Edit

**Goal:** The in-browser editing experience for authenticated admins.

- [ ] Implement edit mode activation logic:
  - Check auth cookie on provider mount
  - Support `?cms=edit` query param as shortcut
  - Keyboard shortcut toggle (e.g., `Ctrl+Shift+E`)
- [ ] Highlight mode: on hover, show a subtle outline around `[data-cms]` elements
- [ ] Click-to-edit: set `contentEditable=true` on text elements with `[data-cms]` attribute
  - Track dirty state (changed vs. original value)
  - Handle blur/focus transitions cleanly
- [ ] Floating toolbar component:
  - Save button (POST all dirty changes to `/api/cms/save`)
  - Discard button (revert all dirty changes)
  - Commit button (POST to `/api/cms/commit`)
  - Visual indicator: number of pending changes
- [ ] Optimistic UI: update context immediately on save, roll back on error
- [ ] Style the overlay and toolbar (minimal, non-intrusive, high z-index)
- [ ] Ensure editor UI is tree-shaken / code-split so it adds zero weight in production

**Location:** `packages/react/src/editor/`

---

## Task 7: i18n — Locale-Aware Content

**Goal:** Multi-language content loading and switching.

- [ ] Locale-aware content file resolution: `content.{locale}.json`
  - Fallback chain: requested locale → default locale → hardcoded fallback
- [ ] Language switcher component in the editor toolbar
  - Dropdown listing configured locales from config
  - Switching locale reloads content via API
  - Visual indicator for untranslated keys (keys missing in current locale)
- [ ] Update `cms()` and `useCms()` to accept/resolve locale
- [ ] Update save endpoint to write to locale-specific files
- [ ] Update extraction to only generate the default locale file
- [ ] Write tests: locale fallback, switching, missing key detection

**Location:** Touches both packages (runtime + API)

---

## Task 8: CLI Tooling

**Goal:** A CLI for common tasks outside the build pipeline.

- [ ] `inlinecms extract` — run extraction manually (same logic as Babel plugin, standalone)
- [ ] `inlinecms audit` — report orphaned keys (in content.json but not in source), missing keys, drift between manifest and content
- [ ] `inlinecms migrate` — when keys change (component rename, restructure), interactively map old keys to new ones
- [ ] Wire up as `bin` entry in the babel-plugin package
- [ ] Write basic tests for each command

**Location:** `packages/babel-plugin/src/cli/`

---

## Task 9: Integration Testing & Demo

**Goal:** End-to-end validation with a real Next.js app.

- [ ] Build out the demo app with multiple pages, nested components, various text/attribute patterns
- [ ] Verify full flow: extraction → content.json generated → runtime reads overrides → editor edits → save → persist
- [ ] Test with App Router (RSC + client components)
- [ ] Test build output size (ensure zero overhead when editor not active)
- [ ] Test `next build` + `next start` production mode
- [ ] Document any edge cases discovered and file them as issues

**Location:** `demo/`

---

## Out of Scope for v1 (Deferred)

- Image upload/picker (editing `src` attributes for images)
- Rich text editing (Tiptap integration)
- Write-back to source files
- SWC port of the Babel plugin
- Pages Router support
- Concurrent editing / conflict resolution
- AI-powered translation
- Cloud sync / GitHub API commit (serverless-friendly git)
- Structured/repeating content (blog posts, product lists)
