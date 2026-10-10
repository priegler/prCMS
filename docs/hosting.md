# Edit deployments

Keep production untouched. Create a Vercel or Netlify branch/preview deployment with `INLINECMS_ENABLED=1`. Do not set that flag on the normal production deployment. Install the transform wrapper, server `InlineCMS` component and Node catch-all API route from the README.

Set these server-only environment variables in the edit deployment:

| Variable | Value |
| --- | --- |
| `INLINECMS_ENABLED` | `1` |
| `INLINECMS_SINK` | `github` |
| `INLINECMS_ORIGIN` | Exact HTTPS origin of the editor deployment (no trailing slash) |
| `INLINECMS_SESSION_SECRET` | Strong random signing/encryption secret |
| `INLINECMS_GITHUB_REPO` | `owner/repository` |
| `INLINECMS_GITHUB_CLIENT_ID` | GitHub OAuth app client ID |
| `INLINECMS_GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret |
| `INLINECMS_DEPLOYED_SHA` | Exact deployed 40-character SHA; optional when the host supplies one |
| `INLINECMS_BASE_BRANCH` | Optional PR target, otherwise the repository's default branch |
| `INLINECMS_SOURCE_PREFIX` | Optional repository subdirectory, e.g. `apps/site` |

Vercel's `VERCEL_GIT_COMMIT_SHA` and Netlify's `COMMIT_REF` are used when an explicit deployed SHA is absent. Ensure host Git environment metadata is available to the server functions. On a monorepo deployment, locators are relative to the app root and `INLINECMS_SOURCE_PREFIX` maps them to the repository subdirectory.

Register a GitHub OAuth app with callback `https://editor.example.com/api/cms/callback`. Use a stable editor hostname so callback and Origin checks stay consistent. The app requests the `repo` scope; only users whose GitHub identity has push permission can edit. Access tokens are encrypted inside signed, expiring HttpOnly Secure SameSite cookies; permissions are rechecked on each request. No personal access token goes to the browser JavaScript.

Publishing reads source from GitHub at the deployed SHA, re-resolves edits against the current editor branch, creates one Git Data commit and opens/reuses a PR on `cms/YYYY-MM-DD-username`. Concurrent ref updates use non-forced fast-forward updates. A conflict keeps pending changes in the editor so you can retry or select a fresh candidate. The browser polls PR/deployment statuses for the preview URL. Your host must publish GitHub deployment statuses with an `environment_url` for preview polling; the PR link remains available otherwise.

Image replacement stages a raster upload under `public/inlinecms/` and patches its `src` literal in the same publish. Images are limited to 5 MB. The returned upload token is a one-hour signed proposal; nothing writes before Publish. Next Image or a CDN may rewrite a rendered URL, in which case use Ask AI to edit the original `src` value.

## Hosted agents

Copy [the scoped workflow](../agent-kit/inlinecms-agent.yml) to `.github/workflows/inlinecms-agent.yml`, and [its runner](../agent-kit/hosted-agent.mjs) to `agent-kit/hosted-agent.mjs` on the trusted default branch. The workflow requires a published `@inlinecms/core@0.2.0` (pin the released version you deploy). Match its trusted include/exclude values and source prefix to the editor configuration. Configure `ANTHROPIC_API_KEY` for the proposal job. Do not use a generic write-enabled `@claude` workflow for InlineCMS requests.

Ask AI creates an isolated `cms/*-agent-*` branch and draft PR containing a JSON request. The `/inlinecms-agent` comment triggers `anthropics/claude-code-action`. The workflow checks the commenter's write permission, the repository/branch and the untouched request. It builds a bounded source snapshot without loading configuration or running code from the PR.

The action runs with built-in tools, MCP, hooks and project customizations disabled and a read-only GitHub token. It returns structured file contents; it cannot edit files, run commands or push. A separate job installs a trusted core runtime, checks all proposed paths against the workflow's allowlist, rejects symlinks and invalid source syntax, rechecks the PR head and creates one non-forced Git Data commit. The trusted runner removes the request file. The model never receives repository write credentials. Keep other generic agent workflows from matching this trigger, and run unreviewed agent-branch builds/previews without deployment or CI secrets.

The editor polls for a changed PR head and displays its diffs. Publish revalidates changed and renamed paths and marks the draft ready for review; Revert closes the draft. The branch remains recoverable. Normal GitHub review/merge and preview deployment finish the workflow. Workflow failures are visible in GitHub Actions; the external action and deployment still need live validation in your repository.

Reference contracts: [action structured output](https://github.com/anthropics/claude-code-action/blob/main/action.yml), [Claude CLI tool and customization controls](https://code.claude.com/docs/en/cli-reference).

Local server SDK requests can be long-running. Configure your own deployment limits if using the local bridge on a persistent Node server; use the PR/action bridge for serverless edit deployments.
