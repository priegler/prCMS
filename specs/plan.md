# prCMS — Zero-Config Inline Editing for Next.js

## Vision

A drop-in package that lets you visually edit any text or image on your Next.js site directly in the browser. No schemas, no admin panel, no external CMS. Changes are stored in a generated content file and synced back to your Git repo.

---

## Core Architecture

Three layers, each independently useful:

1. **Build Plugin** — SWC/Babel transform that extracts static strings from JSX and injects edit markers
2. **Editor Runtime** — Client-side overlay that enables inline editing when authenticated
3. **Persistence API** — Next.js API route that writes changes to the content file and optionally commits to Git

```
Source Files (.tsx)
       │
       ▼
┌─────────────────────┐
│  Build Plugin        │  Compile time
│  - AST parse         │
│  - Extract strings   │
│  - Generate content  │
│  - Rewrite JSX       │
│  - Inject markers    │
└────────┬────────────┘
         ▼
   content.json        ← single source of truth after first extraction
   content.de.json     ← i18n variants (created manually or via translate action)
         │
         ▼
┌─────────────────────┐
│  Editor Runtime      │  Browser (admin only)
│  - Highlight editables│
│  - contentEditable   │
│  - Image picker      │
│  - Language switcher  │
└────────┬────────────┘
         ▼
┌─────────────────────┐
│  Persistence API     │  Server (API route)
│  - Write content.json│
│  - Git commit/push   │
│  - Optional: write   │
│    back to source    │
└─────────────────────┘
```

---

## Phase 1: Build Plugin

### Goal
Parse all JSX files in the project, extract static strings, generate a `content.json`, and rewrite the JSX to read from it.

### Input
```tsx
// app/page.tsx
export default function Home() {
  return (
    <main>
      <h1>Welcome to my site</h1>
      <p>We build great software.</p>
      <img src="/hero.jpg" alt="Hero image" />
    </main>
  );
}
```

### Output — content.json
```json
{
  "app/page.tsx:5:h1:children": "Welcome to my site",
  "app/page.tsx:6:p:children": "We build great software.",
  "app/page.tsx:7:img:alt": "Hero image",
  "app/page.tsx:7:img:src": "/hero.jpg"
}
```

### Output — Rewritten JSX (at compile time, not touching source)
```tsx
import { cms } from '@inlinecms/runtime';

export default function Home() {
  return (
    <main>
      <h1 data-cms="app/page.tsx:5:h1:children">
        {cms("app/page.tsx:5:h1:children", "Welcome to my site")}
      </h1>
      <p data-cms="app/page.tsx:6:p:children">
        {cms("app/page.tsx:6:p:children", "We build great software.")}
      </p>
      <img
        data-cms="app/page.tsx:7:img:src"
        src={cms("app/page.tsx:7:img:src", "/hero.jpg")}
        alt={cms("app/page.tsx:7:img:alt", "Hero image")}
      />
    </main>
  );
}
```

The `cms()` function at runtime:
- In production with no content.json overrides: returns the fallback (zero overhead, tree-shaken)
- In production with content.json present: returns the override from content.json
- In editor mode: returns the override AND registers the node for editing

### Implementation

- **Tool:** Babel plugin (broader compatibility) with potential SWC port later for speed
- **AST library:** `@babel/traverse` + `@babel/types` for parsing, `recast` for source-preserving write-back
- **Key generation:** `relativeFilePath:lineNumber:elementTag:attributeOrChildren`
  - Must be stable across minor edits (line numbers shift — see Stability section below)
- **Extraction targets:**
  - JSX text children (string literals)
  - JSX attribute string values: `alt`, `title`, `placeholder`, `aria-label`, `src` (for images)
  - Skip: `className`, `id`, `href` (configurable allowlist)
- **Config:** `inlinecms.config.ts` at project root

```ts
// inlinecms.config.ts
export default {
  include: ['app/**/*.tsx', 'components/**/*.tsx'],
  exclude: ['**/node_modules/**'],
  defaultLocale: 'en',
  locales: ['en', 'de'],
  contentDir: './content',    // where content.json lives
  attributes: ['alt', 'title', 'placeholder', 'src'], // which attrs to extract
};
```

### Key Stability Problem

Line-number-based keys break when you add/remove lines above. Solutions (pick one):

- **A) Content hash:** Key includes a hash of the original string — `app/page.tsx:h1:abc123`. Stable but breaks if you edit the source string directly.
- **B) Structural path:** Key based on AST position — `app/page.tsx:Home>main>h1:children`. Stable across line changes but breaks if you restructure the component tree.
- **C) Hybrid:** Use structural path as primary key, fall back to fuzzy matching on content when structure changes. Store both in metadata.

Recommendation: **Option C.** Use structural path as the key, store original content hash as metadata for conflict detection.

Revised key format:
```
app/page.tsx::Home>main>h1#children
```

---

## Phase 2: Editor Runtime

### Goal
A React component + client-side script that, when activated, overlays edit controls on all `[data-cms]` elements.

### Activation
```tsx
// app/layout.tsx
import { InlineCMSProvider } from '@inlinecms/react';

export default function Layout({ children }) {
  return (
    <html>
      <body>
        <InlineCMSProvider>{children}</InlineCMSProvider>
      </body>
    </html>
  );
}
```

The provider:
- Checks auth state (cookie, session, query param `?cms=edit`, or a keyboard shortcut)
- If not authenticated as admin: renders children with zero overhead
- If authenticated: injects the editor overlay

### Editor Behavior

1. **Highlight mode:** All `[data-cms]` elements get a subtle blue outline on hover
2. **Click to edit:** Clicking sets `contentEditable=true` on text nodes, or opens an image picker for `src` attributes
3. **Save:** A floating toolbar with Save / Discard / Language Picker
4. **Batch save:** Collects all changes as a diff (`{ key: newValue }`) and POSTs to `/api/cms`
5. **Language switcher:** Dropdown in the toolbar, switches which `content.{locale}.json` is active, reloads content

### Text Editing
- Simple text: native `contentEditable`
- Rich text (bold, links, etc.): embed Tiptap editor inline (future phase)

### Image Editing
- Click on `[data-cms]` image → file picker dialog
- Upload to `/public/cms/` or a configured asset path
- Update the `src` value in content.json

### Auth
Keep it simple for v1:
- Environment variable `INLINE_CMS_SECRET`
- Admin logs in via `/api/cms/auth` with the secret, gets an httpOnly cookie
- Provider checks the cookie

---

## Phase 3: Persistence API

### Goal
A set of Next.js API routes that handle content updates and Git sync.

### Endpoints

**`POST /api/cms/save`**
```json
{
  "locale": "en",
  "changes": {
    "app/page.tsx::Home>main>h1#children": "Welcome to our new site",
    "app/page.tsx::Home>main>p#children": "We build amazing software."
  }
}
```
- Reads `content/content.en.json`
- Merges changes
- Writes file
- Returns success

**`POST /api/cms/commit`**
- Runs `git add content/ && git commit -m "CMS update" && git push`
- Only available in environments where Git is accessible (local dev, self-hosted)
- For Vercel/serverless: trigger a GitHub API commit instead

**`POST /api/cms/auth`**
- Validates secret, sets session cookie

**`GET /api/cms/content?locale=en`**
- Returns the full content.json for the requested locale (used by editor to populate)

### Write-Back to Source (Optional)

For users who want changes reflected in their .tsx files (not just content.json):
- Use `recast` to parse the original source AST
- Find the node matching the key
- Replace the string literal
- Write back with preserved formatting
- This is opt-in and mainly useful for solo developers who want a single source of truth in code

---

## Phase 4: i18n

### Goal
Multi-language support as a first-class feature.

### How It Works

- `content/content.en.json` — default locale (auto-generated by build plugin)
- `content/content.de.json` — created by duplicating and translating
- The `cms()` runtime function reads the active locale from a React context or cookie
- Language switcher in the editor toolbar sets the locale and reloads content
- Missing keys fall back to the default locale

### Translation Workflow

1. Editor opens site in German
2. Sees English fallback text everywhere (with visual indicator for untranslated)
3. Edits directly in German
4. Saves → writes to `content.de.json`

Future: "Translate all" button that sends untranslated keys to an AI translation API.

---

## Package Structure

```
@inlinecms/core          — shared types, key generation, content file I/O
@inlinecms/babel-plugin  — the Babel transform
@inlinecms/react         — Provider, editor overlay, cms() runtime
@inlinecms/api           — API route handlers (export functions, user mounts them)
@inlinecms/cli           — CLI for manual extraction, write-back, key migration
```

---

## Integration (User-Facing Setup)

```bash
npm install @inlinecms/react @inlinecms/babel-plugin @inlinecms/api
```

```js
// next.config.js
const withInlineCMS = require('@inlinecms/babel-plugin/next');
module.exports = withInlineCMS({ /* next config */ });
```

```tsx
// app/layout.tsx
import { InlineCMSProvider } from '@inlinecms/react';
export default function Layout({ children }) {
  return <InlineCMSProvider>{children}</InlineCMSProvider>;
}
```

```ts
// app/api/cms/[...action]/route.ts
export { GET, POST } from '@inlinecms/api/next';
```

Three files. Done.

---

## Known Edge Cases (Deferred)

| Case | Issue | Likely Approach |
|---|---|---|
| Template literals | `{`Hello ${name}`}` — mixed static/dynamic | Extract static parts only, mark as partial |
| `.map()` over arrays | Multiple instances of same component, key collision | Index-aware keys or require `key` prop |
| Conditional rendering | String appears in one branch only | AST handles this (each branch has unique path) |
| Component composition | String is a prop passed through multiple components | Track through prop flow in AST (complex) |
| Third-party components | Strings inside imported components | Skip `node_modules`, only process user code |
| Rich text / Markdown | Need more than plain `contentEditable` | Tiptap integration in later phase |
| Server Components vs Client | `cms()` must work in both RSC and client contexts | Provide both sync (RSC) and hook-based (client) APIs |
| Concurrent editors | Two admins editing at once | Last-write-wins for v1, operational transform later |
| Large sites | Thousands of keys in one content.json | Split by route/page into separate files |
| Non-JSX content | Strings in API responses, metadata, `generateMetadata` | Extend extraction to non-JSX string assignments |

---

## Build Order (Recommended)

| Step | Deliverable | Effort |
|---|---|---|
| 1 | Babel plugin: extract strings, generate content.json | 2–3 days |
| 2 | `cms()` runtime function (read from content.json with fallback) | 1 day |
| 3 | Babel plugin: inject `data-cms` attributes + rewrite to `cms()` | 2 days |
| 4 | Editor overlay: highlight + contentEditable on `[data-cms]` | 2–3 days |
| 5 | API routes: save, auth | 1 day |
| 6 | Git commit integration | 1 day |
| 7 | i18n: locale-aware content loading + language switcher | 2 days |
| 8 | CLI: manual extract, write-back, key audit | 1–2 days |
| **Total MVP** | | **~2 weeks** |

---

## Open Questions

1. **SWC vs Babel?** Babel first (easier to prototype), SWC port for production speed
2. **App Router only or Pages Router too?** App Router first, Pages Router as follow-up
3. **Monetization?** Open-source core, paid cloud sync (GitHub commit via API, team auth, AI translation)
4. **Scope creep:** Should this handle structured/repeating content (blog posts, product lists) or stay focused on page content? Recommendation: page content only for v1.
