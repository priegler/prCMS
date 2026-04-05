# InlineCMS

Zero-config inline editing for Next.js. Edit any text on your site directly in the browser — no admin panel, no external CMS. Changes are stored in JSON content files and optionally committed to Git.

## How It Works

```
Source (.tsx)  ──>  Babel Plugin  ──>  content.json + rewritten JSX
                                            │
                                            ▼
                               Browser (editor overlay)
                                            │
                                            ▼
                               API route  ──>  Git commit
```

1. **Build time:** A Babel plugin extracts static strings from your JSX and rewrites them to read from `content.json` via a `cms()` runtime function.
2. **Browser:** When an admin activates edit mode, a floating editor overlay lets them click any text to edit it inline.
3. **Save:** Changes are POSTed to an API route that writes `content.json` to disk and optionally commits to Git.

## Quick Start

### Install

```bash
npm install @inlinecms/react @inlinecms/babel-plugin
```

### 1. Wrap your layout with the provider

```tsx
// app/layout.tsx
import { InlineCMSProvider } from '@inlinecms/react';

export default function Layout({ children }) {
  return (
    <html>
      <body>
        <InlineCMSProvider defaultLocale="en" locales={['en', 'de']}>
          {children}
        </InlineCMSProvider>
      </body>
    </html>
  );
}
```

### 2. Mount the API route

```ts
// app/api/cms/[...action]/route.ts
export { GET, POST } from '@inlinecms/react/api';
```

### 3. Register the Babel plugin (optional — for automatic JSX rewriting)

```js
// next.config.js
const withInlineCMS = require('@inlinecms/babel-plugin/next').default;
module.exports = withInlineCMS({ /* your next config */ });
```

### 4. Set the auth secret

```bash
# .env.local
INLINE_CMS_SECRET=your-secret-here
```

That's it. Open your site with `?cms=edit` in the URL to activate the editor.

## Packages

This is a monorepo with two packages:

| Package | Description |
|---------|-------------|
| `@inlinecms/babel-plugin` | Babel transform for string extraction and JSX rewriting, plus core types, key generation, content I/O, and CLI |
| `@inlinecms/react` | React runtime (`cms()`, `getCms()`, `useCms()`), editor overlay, toolbar, language switcher, and API route handlers |

## Architecture

### Content Keys

Every extractable string gets a structural key based on its position in the component tree:

```
app/page.tsx::Home>main>h1#children
app/page.tsx::Home>main>img#alt
```

Format: `filePath::ComponentName>tag>tag#attribute`

Keys are stable across line number changes. Sibling disambiguation uses indices (`p[1]`, `p[2]`).

### Runtime Functions

| Function | Context | How it works |
|----------|---------|-------------|
| `cms(key, fallback)` | Server Components (RSC) | Reads `content.{locale}.json` from disk at request time |
| `getCms(key, fallback)` | Client Components | Plain function reading from a module-level store synced by the provider. Safe in conditionals, loops, `.map()` |
| `useCms(key, fallback)` | Client Components | React hook variant (reads from context). Use directly if you prefer hooks at the component top level |

### JSX Rewriting

The Babel plugin transforms this:

```tsx
export default function Home() {
  return <h1>Welcome to my site</h1>;
}
```

Into this (at compile time, source files untouched):

```tsx
import { cms as __inlinecms_cms } from "@inlinecms/react";

export default function Home() {
  return (
    <h1 data-cms="app/page.tsx::Home>h1#children">
      {__inlinecms_cms("app/page.tsx::Home>h1#children", "Welcome to my site")}
    </h1>
  );
}
```

For client components (`'use client'`), it emits `getCms()` instead of `cms()` to avoid React hook-order violations.

### Editor Overlay

When edit mode is active:
- **Hover** any element with `[data-cms]` to see a blue highlight
- **Click** to enable inline editing via `contentEditable`
- **Escape** to discard changes to the active element
- **Toolbar** at the bottom: Save, Discard, Commit to Git, Language Switcher

Activation methods:
- `?cms=edit` query parameter
- `Ctrl+Shift+E` keyboard shortcut

The editor overlay is lazy-loaded and tree-shaken in production — zero overhead when not active.

### API Routes

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/cms/auth` | POST | Validate `INLINE_CMS_SECRET`, set httpOnly auth cookie |
| `/api/cms/auth` | GET | Check if current session is authenticated |
| `/api/cms/content?locale=en` | GET | Return full content map for a locale |
| `/api/cms/save` | POST | Merge changes into `content.{locale}.json` |
| `/api/cms/commit` | POST | `git add` + `git commit` + `git push` the content directory |

### i18n

Content is stored per locale: `content/content.en.json`, `content/content.de.json`, etc.

Fallback chain: **requested locale** -> **default locale** -> **hardcoded fallback** (from source)

The editor toolbar includes a language switcher when multiple locales are configured.

## Configuration

Create `inlinecms.config.ts` at your project root (optional — sensible defaults are used otherwise):

```ts
export default {
  include: ['app/**/*.tsx', 'components/**/*.tsx'],
  exclude: ['**/node_modules/**', '**/*.test.*'],
  defaultLocale: 'en',
  locales: ['en', 'de'],
  contentDir: './content',
  attributes: ['alt', 'title', 'placeholder', 'aria-label'],
};
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `INLINE_CMS_SECRET` | Yes (for editing) | Secret for admin authentication |
| `INLINECMS_CONTENT_DIR` | No | Override content directory (default: `./content`) |
| `INLINECMS_DEFAULT_LOCALE` | No | Override default locale (default: `en`) |

## CLI

The `@inlinecms/babel-plugin` package includes a CLI for offline content management:

```bash
# Extract strings from JSX into content.json (without build-time rewriting)
npx inlinecms extract

# Audit for orphaned keys, missing translations, and content drift
npx inlinecms audit

# Specify a custom project root
npx inlinecms extract --root ./my-app
```

## Project Structure

```
packages/
  babel-plugin/
    src/
      core/          # Types, config, key generation, content I/O
      transform/     # Babel plugin (extraction + JSX rewrite)
      cli/           # CLI commands (extract, audit)
  react/
    src/
      runtime/       # cms(), getCms(), useCms(), InlineCMSProvider
      editor/        # EditorOverlay, Toolbar, LanguageSwitcher
      api/           # Next.js API route handlers
demo/                # Next.js App Router demo app
```

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Run the demo app
pnpm dev
```

## License

MIT
