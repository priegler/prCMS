# prCMS v2 — Source-First Inline Editing for Agent-Built Sites

> Supersedes the content-layer architecture in `plan.md` / `tasks.md`.
> v1 extracted copy into `content.{locale}.json` behind structural keys. v2 drops that layer:
> **every edit is written back into the source file it came from.**

---

## Why v2

v1 adds a second source of truth that fights how agents build sites:

| v1 problem | Consequence for agent-built sites |
|---|---|
| Structural keys (`Home>main>section[1]>p[1]`) | Agents wrap, extract and reorder JSX constantly → keys change → edited copy is orphaned and the page silently reverts to the source fallback. The demo already shows it (`section[2]>img#alt` orphan, `section[1]>p[1]` drift). |
| `content.json` overrides source | The agent reads `page.tsx`, edits a string, and nothing changes on the page. The agent's model of the product (the code) is wrong. |
| Only literal JSX text/attrs extracted | Agent-generated copy mostly lives in arrays + `.map()`, props, `metadata` exports — exactly the deferred cases. |
| webpack `babel-loader` rule | Doesn't run under Turbopack; Next-only. |
| `fs` writes + `execSync('git push')` | Doesn't work on Vercel/Netlify/Lovable hosting, where these sites live. |

## Vision

Click any text on your site, change it, publish. The change lands as a minimal diff in the
source file that produced it — as a commit or PR with a preview deploy. Anything that isn't a
simple text swap ("make this punchier", "add a third testimonial") is handed to a coding agent
with the exact element and source location as context.

**Principles**

1. **Code is the only source of truth.** No content store, no keys, no runtime lookup.
2. **Zero production footprint.** The transform, overlay and API exist only in dev / edit deployments.
3. **Deterministic first, agent second.** Plain text swaps are AST splices (instant, cheap, reviewable). The agent handles the rest.
4. **Git is the CMS backend.** History, review, rollback and preview deploys come for free.
5. **Framework-agnostic core.** Next.js first, but nothing in the core is Next-specific.

---

## Architecture

```
                 BUILD (dev / edit deployment only)
 Source (.tsx/.jsx/.astro)
        │
        ▼
 ┌──────────────────────┐
 │ Locator transform     │  injects data-src="app/page.tsx:12:7" on host elements
 │ (unplugin + Turbopack │  no-op in production builds
 │  loader rule)         │
 └──────────┬───────────┘
            ▼
                 BROWSER
 ┌──────────────────────┐
 │ Editor overlay        │  hover/click [data-src], contentEditable for leaf text,
 │                       │  "Ask AI" on any element, pending-changes panel
 └──────────┬───────────┘
            │  EditRequest { src, oldText, newText | instruction, baseRev }
            ▼
                 SERVER (API route)
 ┌──────────────────────┐      ┌──────────────────────┐
 │ Resolver              │ ───▶ │ Patcher               │  splice literal at byte offsets,
 │ element loc + text →  │      │                       │  escape per node kind, re-parse
 │ exactly one literal   │      └──────────┬───────────┘
 └──────────┬───────────┘                  │
   0 or >1 matches                         ▼
            ▼                    ┌──────────────────────┐
 ┌──────────────────────┐        │ Sink                  │  fs (local dev, HMR)
 │ Agent bridge          │ ─────▶│                       │  github (branch + PR → preview)
 │ (Claude Agent SDK /   │        └──────────────────────┘
 │  claude-code-action)  │
 └──────────────────────┘
```

### Where editing happens

- **Local dev:** `next dev` with the transform on. Edits write to disk; HMR shows them instantly.
- **Edit deployment:** a branch/preview deployment with `INLINECMS_ENABLED=1` (e.g. Vercel
  preview of `main` or a long-lived `cms` branch). Edits go to GitHub; the PR's preview deploy shows them.
- **Production:** untouched. No `data-src`, no overlay bundle, API route returns 404.

---

## Components

### 1. Locator transform (`packages/transform`)

Injects source locations so a clicked DOM node maps back to code.

- Add `data-src="<relPath>:<line>:<col>"` to **host elements only** (lowercase JSX tags).
  Custom components don't reliably forward unknown props.
- Implementation: a single Babel-parser-based transform exposed as
  - an **unplugin** (Vite, webpack, rspack, esbuild)
  - a **webpack-style loader**, registered under `turbopack.rules` for Next.js + Turbopack
  - `withInlineCMS()` for Next.js picks the right one automatically
- Gate: active only when `INLINECMS_ENABLED=1` or `NODE_ENV=development`. Otherwise it returns the input unchanged.
- Same transform runs for server and client bundles → no hydration mismatch.
- Later: an Astro integration (`.astro` templates), then Svelte/Vue if there is demand.

### 2. Resolver (`packages/core`)

Turns `{ src, oldText }` into exactly one editable source node.

1. **Direct hit:** parse the file at `src`, find the element at line:col. If its children are a
   single `JSXText` / `StringLiteral` whose normalized value equals `oldText` → done.
   Same for an attribute edit (`alt`, `title`, `placeholder`, `aria-label`, `src`).
2. **Text search:** otherwise search string-literal nodes (`JSXText`, `StringLiteral`,
   expression-free `TemplateLiteral`, JSON string values) for the normalized `oldText`, in order:
   the file at `src` → files it imports (depth 2) → all files in `include`.
   This covers `.map()` over data arrays, props passed into components (`<Button>Buy</Button>`
   renders inside `Button.tsx` but the literal is in `page.tsx`), and i18n message JSON.
3. **Outcome:** exactly one match → patch. Several → return candidates (UI lets the user pick,
   or hands off to the agent). None → agent.

Normalization reuses v1's `normalizeJSXWhitespace`, plus HTML-entity decoding and trimming.

### 3. Patcher (`packages/core`)

- Splices the new value into the original source at the node's `start`/`end` offsets. No
  reprinting, so formatting stays exactly as it was (no recast needed).
- Encodes per node kind:
  - `JSXText`: escape `{ } < >`, keep the original leading/trailing whitespace
  - `StringLiteral`: keep the original quote character, escape it and `\`
  - `TemplateLiteral`: escape `` ` `` and `${`
  - JSON: `JSON.stringify`
- Re-parses the result; refuses the patch if it no longer parses.
- Emits a unified diff for the pending-changes panel and the commit.

### 4. Sinks (`packages/core`)

```ts
interface Sink {
  read(path: string): Promise<{ content: string; rev: string }>;
  write(changes: FileChange[], message: string): Promise<PublishResult>;
}
```

- **`fs` sink:** local dev. Reads and writes the working tree; optional local `git commit`.
- **`github` sink:** hosted. Serverless bundles don't contain the source, so it reads files from
  GitHub at the deployed commit (`VERCEL_GIT_COMMIT_SHA` or the equivalent). Writes go through
  the Git Data API as one commit per publish to `cms/<yyyy-mm-dd>-<user>`, and it opens or updates a PR.
- **Conflicts:** optimistic, using a per-file `baseRev`. On mismatch, re-run the resolver against
  the new head. Text-based resolution survives most concurrent code changes.

### 5. Agent bridge (`packages/core`)

For instructions and unresolved or ambiguous edits.

- **Payload:** page URL, element `outerHTML` (truncated), `data-src` of the element and its
  ancestors, `oldText`, the user's instruction or desired text, resolver candidates, and an
  optional screenshot.
- **Local:** runs the Claude Agent SDK in the project directory with edit tools scoped to the
  `include` globs. The model is configurable (default `claude-opus-5-5`).
- **Hosted:** opens or updates a PR comment that triggers `claude-code-action` on the `cms/*`
  branch. No compute is needed in the site's own runtime.
- The agent's result is a normal diff, shown in the same pending-changes panel before publishing.

### 6. Editor UI (`packages/react`)

Mostly reused from v1, retargeted:

- Target `[data-src]` instead of `[data-cms]`.
- Inline `contentEditable` only on **leaf text** (elements without element children). Mixed
  content (`Hello <strong>world</strong>`) offers per-text-node editing or "Ask AI".
- **Ask AI** button on every hovered element.
- **Pending changes** panel: list of diffs, revert one, "Publish".
- **Status:** committed → PR link → preview URL ready.
- Keep the login dialog. Drop the language switcher from core (see i18n below).

### 7. Auth

- Replace the raw-secret cookie with an HMAC-signed, expiring session token, compared in
  constant time. Check `Origin` on every POST (on top of `SameSite=Strict`).
- **Hosted mode:** "Sign in with GitHub", and require write access to the repo. Repo permissions
  become CMS permissions.

### 8. Agent-readiness kit

Make the sites agents produce easy to edit:

- An **`AGENTS.md` snippet + Claude skill** (`inlinecms`) with conventions: keep user-visible copy
  as plain string literals; don't build copy by concatenation; put repeated or structured copy in
  `content/*.ts` data modules with semantic names.
- **`inlinecms doctor`:** renders the routes and reports the **editability score**, the share of
  visible text nodes the resolver maps to exactly one literal. It lists the offenders with file:line.

### i18n

Not a core feature in v2. If the site already uses message files (next-intl, i18next), the
resolver finds strings in the JSON for the active locale and the patcher edits them in place.
"Translate missing keys" becomes an agent task (later milestone).

---

## Package Layout

| Package | Contents | Runs in |
|---|---|---|
| `@inlinecms/transform` | locator transform, unplugin, Turbopack loader, `withInlineCMS()` | build |
| `@inlinecms/core` | resolver, patcher, sinks, agent bridge, CLI (`doctor`, `migrate`) | Node server / CLI |
| `@inlinecms/react` | provider (edit-mode only), overlay, toolbar, API route handlers | browser + route |

### Reused from v1
`EditorOverlay`, `Toolbar`, `LoginDialog`, provider shell, API handler routing, config loading,
`normalizeJSXWhitespace`, CLI scaffolding, test setup, demo app.

### Removed
`cms()` / `getCms()` / `useCms()` runtime, `useContentVersion` injection, structural keys
(`core/keys.ts`), JSX rewriting, `content.{locale}.json`, manifest, `audit` CLI.

---

## Milestones

### M0 — Spikes (de-risk, ~2–3 days)

- [ ] Locator transform runs under **Next 15/16 Turbopack** (`turbopack.rules` loader), Next
      webpack, and Vite React. Confirm `data-src` appears in both RSC and client output with no hydration warnings.
- [ ] Resolver prototype: run it against 5–10 **real agent-generated sites** (v0, Lovable, Bolt,
      Claude Code) and measure the editability score. This is the go/no-go metric for the approach.
      Target: ≥80% of visible text resolves uniquely without the agent.
- [ ] Patcher round-trip on edge cases: quotes, `{}` in JSX text, entities, multiline JSXText, emoji.

**Exit:** a written spike report with the measured score and the Turbopack result. If Turbopack
loaders can't do it, fall back to an SWC Wasm plugin (decide here).

### M1 — Local dev loop (~1 week)

- [ ] `packages/transform` with the Next.js + Vite integrations
- [ ] Resolver (direct hit + text search) and patcher in `packages/core`, with unit tests per node kind
- [ ] `fs` sink
- [ ] Overlay retargeted to `[data-src]`, leaf-text editing, attribute editing (`alt`, `title`, …)
- [ ] Pending-changes panel with diffs; Publish = write + optional local commit
- [ ] Signed session auth + Origin check
- [ ] Demo rewritten as a typical agent-style page: hero, `features.map()`, `<Button>` with a children prop, `metadata`, image `alt`

**Exit:** in the demo, every visible string on the page is editable in the browser and produces a
one-line `git diff` in the right file.

### M2 — Ambiguity + local agent (~1 week)

- [ ] Candidate picker UI when several literals match
- [ ] Agent bridge (local): Claude Agent SDK, scoped tools, diff returned to the panel
- [ ] "Ask AI" on any element, with free-text instructions
- [ ] Mixed-content elements: edit individual text nodes

**Exit:** "add a fourth feature card" and "shorten this paragraph" work from the browser and land as reviewable diffs.

### M3 — Hosted publishing (~1–1.5 weeks)

- [ ] `github` sink: read at the deployed SHA, commit via the Git Data API, branch + PR management
- [ ] GitHub OAuth sign-in, with repo write permission as authorization
- [ ] Edit-deployment setup guide for Vercel and Netlify (env vars, `INLINECMS_ENABLED`)
- [ ] Publish status: commit → PR → preview URL (poll the deployment status API)
- [ ] Conflict handling: rebase the edit via a resolver re-run on head
- [ ] Image replace: upload into `public/` in the same commit and patch the `src` literal

**Exit:** a non-developer edits text on a Vercel preview, clicks Publish, and gets a PR with a preview link. No local tooling involved.

### M4 — Hosted agent (~1 week)

- [ ] Agent requests on hosted deployments via a PR comment that triggers `claude-code-action`
- [ ] Results stream back into the pending-changes panel (poll the PR)

### M5 — Agent-readiness + breadth (~1–2 weeks)

- [ ] `inlinecms doctor` (editability score + offender list)
- [ ] `AGENTS.md` snippet and `inlinecms` Claude skill
- [ ] i18n message-file support in the resolver (next-intl, i18next JSON)
- [ ] Astro integration
- [ ] `inlinecms migrate`: one-time tool that writes v1 `content.json` overrides back into source literals and removes the v1 wiring

### Later

- Agent-driven translation of missing message keys
- Rich text (bold/italic/links) inside JSX text via an agent-backed edit
- MDX/Markdown collections (blog posts) edited through the same source-first pipeline
- Hosted service (GitHub App + agent compute) as the paid tier

---

## Success Metrics

- **Editability score** ≥80% on the agent-generated fixture corpus without the agent, ≥95% with it
- **Diff quality:** 100% of deterministic edits produce a diff touching only the changed literal
- **Production cost:** 0 bytes of JS and 0 attributes added to production builds
- **Time to first edit** in a fresh agent-built Next.js site: under 5 minutes (install, wrap config, set env)

## Non-Goals (v2)

- A content database, schemas or an admin panel
- Live editing on production URLs
- Real-time multi-user collaboration (git branches + PRs cover concurrent editors)
- Pages Router-specific support beyond what the locator transform gives for free

## Open Questions

1. **In-site API route vs hosted service** for the GitHub sink + agent. The in-site route is
   simpler to start with; a hosted GitHub App removes token setup and is the natural paid tier.
2. **Default publish granularity:** a commit straight to a `cms/*` branch, or always a PR? Should
   there be an optional auto-merge for trusted editors?
3. **GitLab / Bitbucket** sinks: when, and for whom?
4. **Naming:** prCMS vs InlineCMS, and the npm scope.
