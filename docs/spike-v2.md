# v2 spike evidence

Verified on 9–10 October 2026 with Node 22.22.2. These results cover this repository's demo and an isolated compatibility fixture; they are not measurements of real v0/Lovable/Bolt sites.

| Check | Measured result |
| --- | --- |
| Next 15.5.14, Turbopack dev | 29 host locators, including RSC and client Button output; no browser/hydration errors |
| Next 15.5.14, webpack dev | 29 host locators; no browser/hydration errors |
| Next 16.4.0, Turbopack dev, React 19 | 29 host locators; no browser/hydration errors |
| Next 15.5.14 production webpack build/browser | No locators or editor UI; no loaded CMS client code; API returns 404 |
| Vite 6, React dev fixture | 3/3 host elements receive locators |
| Vite production build | No locator attributes in generated JS |
| Doctor on the agent-style demo | 17/17 visible text nodes resolve uniquely (100%); 4/4 editable attributes resolve uniquely |
| Browser editing loop | Inline preview, per-change revert, source/data-array/children-prop Publish, attribute and mixed-fragment previews, image Publish/Revert and conflict candidate retry pass; source restored after checks |
| Hosted workflow template | YAML and structured output schema parse; readonly proposal and isolated write job verified; scoped proposal validator tests pass |
| Hosted agent UI (mocked API) | Waiting disables Publish; direct edits are refused while the draft is active; Revert discards the draft; polling stops after preview/Close and backs off after the agent diff |
| Unit/API regression suite | 66 source/API tests pass, including rename scope, edit relocation, whitespace and local commit serialization |
| Patcher tests | JSX/entity/attribute, quote, backslash, template interpolation, newline, JSON, emoji and Astro cases round-trip; surrounding source preserved |

The Turbopack loader works without an SWC fallback. Its rules leave `as` unset because output remains TSX/JSX; setting a virtual `*.tsx` suffix broke extensionless imports. The wrapper supplies the application root explicitly because Turbopack's workspace root can differ in a monorepo. These regressions have unit coverage.

Production uses build-time aliases for the server provider and API entries. This removes the editor client reference from the production layout dependency graph. The server wrapper also has a runtime environment gate for other Node integrations.

## Reproduce

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm --filter demo exec next start --port 3310
# In a second terminal:
node scripts/verify-browser.mjs production http://localhost:3310
```

```sh
INLINE_CMS_SECRET=dummy pnpm --filter demo exec next dev --turbopack --port 3311
# In a second terminal (edits and restores the demo's page/data files):
node scripts/verify-browser.mjs editing http://localhost:3311
node scripts/verify-provider.mjs http://localhost:3311
node packages/core/dist/cli/index.js doctor --root demo --url http://localhost:3311
node scripts/verify-vite.mjs
```

Install Playwright Chromium first, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an existing compatible executable. For a Next 16 installation of the demo, run the browser script in `locators` mode with the fixture root as its final argument. The isolated Next 16 fixture used copied package distributions and a separate dependency installation, without changing the repository's Next 15 dependency.

## Remaining external validation

- The M0 go/no-go criterion requires 5–10 real agent-generated sites. None were supplied or available in this repository; the ≥80% corpus threshold is unverified.
- GitHub OAuth, Git Data commits, permission failures and conflicts have mocked API coverage. Actual OAuth/PR/preview deployment integration needs a configured repository and edit deployment.
- Local SDK proposals have scoped tool, new-file staging and API proposal tests; live model calls need provider credentials and an available configured model.
- Hosted agent behavior needs the supplied scoped `claude-code-action` workflow and a published core runtime; proposal validation, polling and draft approval are implemented, but no external action was triggered during implementation.
- Astro templates and patches are compiler-tested; a full Astro deployment and hydrated editor island were not exercised.

Reference contracts: [Next Turbopack loader configuration](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack), [unplugin adapters](https://unplugin.unjs.io/guide/), [GitHub Git Data trees](https://docs.github.com/en/rest/git/trees), and [Astro template syntax](https://docs.astro.build/en/reference/astro-syntax/).
