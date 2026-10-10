# InlineCMS v2

Click text in a development or preview site, preview its source diff, and publish it to the file that produced it. Source code is the only content store. Normal production builds add no locators and the API returns 404.

Requires Node 20.19+ and React 18+. Next.js 15/16 is the first integration; Vite and Astro use the same source-first core.

## Local Next.js setup

```sh
pnpm add @inlinecms/core @inlinecms/react @inlinecms/transform
```

```js
// next.config.mjs
import withInlineCMS from '@inlinecms/transform/next';
export default withInlineCMS({});
```

```tsx
// app/layout.tsx — server component
import { InlineCMS } from '@inlinecms/react/server';
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><InlineCMS>{children}</InlineCMS></body></html>;
}
```

```ts
// app/api/cms/[...action]/route.ts
export { GET, POST } from '@inlinecms/react/api';
export const runtime = 'nodejs';
```

Set `INLINE_CMS_SECRET` to a strong local login secret in `.env.local`. Development generates a private signing key for this server process; restarting invalidates sessions and proposals. Set a separate server-only `INLINECMS_SESSION_SECRET` for persistent sessions or any edit deployment. It must differ from the login password. Start `next dev` and open `/?cms=edit`, or press Ctrl/Cmd+Shift+E. Both webpack and Turbopack are supported; the wrapper preserves existing configuration and uses the older `experimental.turbo` key for Next 15.0–15.2.

Select an element, edit its leaf text inline, then click outside to preview. Mixed content offers individual text fragments. Attributes, image uploads, candidate selection and Ask AI are available in the element panel. The pending panel shows diffs and lets you revert each change. Publish writes the source; HMR refreshes the page. An optional local commit never pushes.

## Configuration

```js
// inlinecms.config.mjs — loaded by Node, never sent to the browser
export default {
  include: ['app/**/*.{tsx,jsx,ts,js}', 'components/**/*.{tsx,jsx}', 'content/**/*.{ts,json}', 'messages/**/*.json'],
  exclude: ['**/node_modules/**', '**/*.test.*', '**/api/**'],
  attributes: ['alt', 'title', 'placeholder', 'aria-label', 'src'],
  importAliases: { '@/': './', '~/': './src/' },
  routes: ['/', '/about'],
  localCommit: false,
  agentModel: 'claude-opus-5-5',
};
```

Pass the same include/exclude overrides to `withInlineCMS({}, config)` if you customize the transform scope. Use synchronous JS/MJS configuration on Node versions without TypeScript stripping. Paths are project-relative; absolute paths, traversal, dot directories and symlinked source paths are rejected. Exclude server-only code from editing.

The resolver first tries the clicked element, then the file, imports up to two levels deep, and the configured source corpus. Duplicate copy produces a candidate picker. Use an optional `locale` on API edit requests when several active-locale message files contain the same string; locale selection belongs to your site. Text searches exclude unrelated JSX attributes, and attribute searches stay within the requested attribute. Computed attributes and dynamic, concatenated or computed copy can be handed to an agent.

## Vite and Astro

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import inlineCMS from '@inlinecms/transform/vite';
export default defineConfig({ plugins: [inlineCMS(), react()] });
```

The unplugin entry also exposes `.webpack()`, `.rspack()` and `.esbuild()` adapters. For non-Next React apps, mount `InlineCMSProvider` only in development/edit builds and supply your own server route adapter for `createHandlers()` (standard Request/Response). Never mount the provider in a normal production bundle.

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import inlineCMS from '@inlinecms/transform/astro';
export default defineConfig({ integrations: [inlineCMS()] });
```

Astro templates receive locators, and the core edits static text, quoted attributes, literal expressions and frontmatter/data strings. Mount the React editor in a hydrated island on edit deployments and expose Node API handlers through your Astro server adapter.

## AI proposals

```sh
pnpm add @anthropic-ai/claude-agent-sdk
```

Configure the SDK's normal authentication and a model available to your account. Ask AI sends the selected element, source/ancestor locators, current copy, instruction and resolver candidates. Local agents use only scoped virtual source tools; they cannot run shell commands, read excluded files or write the working tree. The returned proposal is signed, expires after one hour and writes only on Publish. Structural content can be added to existing or new included source/data files. Publish or revert existing changes before requesting an agent proposal.

Hosted agents use separate draft PRs and `claude-code-action`, described in [hosting.md](docs/hosting.md). Agent result diffs appear in the pending panel; Publish marks a reviewed draft PR ready for review. It never merges a PR.

## Readiness tools

```sh
pnpm exec inlinecms doctor --url http://localhost:3000
pnpm exec inlinecms migrate --content content/content.en.json
pnpm exec inlinecms migrate --content content/content.en.json --write
```

Doctor uses optional Playwright (`pnpm add -D playwright`, `pnpm exec playwright install chromium`) to render configured routes. It scores visible text separately from editable attributes, reports each unresolved/ambiguous locator, and exits nonzero below 80% or when no text was measured. Run it on an edit/dev deployment so locators exist.

Migration previews diffs by default. It writes a chosen v1 locale's overrides into source, removes CMS calls, content-version calls, injected attributes and locale props, and updates root Next config imports/requires (JS, MJS, CJS and TS). It handles both build-time extraction and already rewritten JSX. `--write` refuses unmatched keys and removes the selected legacy content file only after successful writes. Review configuration/package dependencies, other locale files and the obsolete manifest manually; these are never silently discarded. Simple provider imports in server layouts are converted to `InlineCMS` automatically. Move providers in client components to a server layout manually to get the production bundle gate.

Use the [agent conventions](agent-kit/AGENTS.md) and [Claude skill](agent-kit/inlinecms/SKILL.md) in projects agents build.

## Development

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm dev
pnpm --filter demo dev:turbo
```

The packages are `@inlinecms/core` (Node source pipeline and CLI), `@inlinecms/transform` (build integrations), and `@inlinecms/react` (editor and Node API). The old content-map runtime and Babel extraction package have been removed. See [the v2 plan](specs/plan-v2.md) and [spike evidence](docs/spike-v2.md).
