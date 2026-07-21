# Codex CDP Workshop Widget Asset Automation Skill

[中文](README.md)

This Skill uses one consolidated authorization to enumerate every visible Widget in an approved Workshop, add widgets through real visible UI, open configuration only when needed, use compatible variables already defined in the current Module, enter preview, and save naturally loaded JS, CSS, WASM, images, and strictly approved Document HTML from Chrome's completed Network record.

It never retrieves a resource URL again, executes page-context scripts, transfers login credentials, or treats first observation as proof of source ownership.

## Install

```bash
npx skills add https://github.com/501981732/codex-cdp-static-assets-skill \
  --skill codex-cdp-static-assets-skill \
  --agent codex \
  --global \
  --yes
```

Start a new Codex task after installation or update and invoke `$codex-cdp-static-assets-skill`.

## Chrome prerequisite

Reuse the signed-in default Chrome profile with Chrome 144+:

```bash
codex mcp remove chrome-devtools
codex mcp add chrome-devtools -- \
  npx -y chrome-devtools-mcp@latest \
  --autoConnect \
  --no-usage-statistics \
  --no-performance-crux
```

Restart Codex, enable remote debugging at `chrome://inspect/#remote-debugging`, and keep the approved Workshop open. Approve Chrome's connection dialog when Codex connects.

Because `autoConnect` can enumerate the profile's windows, close unrelated sensitive pages where practical. The Skill selects only the unique exact authorized host and never persists other tab metadata. It pauses rather than copying profiles/cookies/tokens or opening a replacement login session when prerequisites are unavailable.

## Quick start

```text
Use $codex-cdp-static-assets-skill to automatically capture every visible Widget resource from:
https://workshop.example.com/module/edit/...

Case ID: SEC-2026-001
Allow deterministic CDP Capture pages, Widget addition/configuration, and autosave in this dedicated test Module.
Allow variables already defined in this Module when the Widget's visible typed selector marks them compatible; never create, modify, or delete variables or data sources.
First perform metadata-only host and entry-point discovery. Present exact hosts, actions, limits, and the data-source policy for one approval; then run automatically.
Capture js, css, wasm, image, and naturally loaded top-level/Widget-iframe Document HTML. Fonts are excluded by default.
```

## Workflow

Before approval, only `list_pages`, exact-page `select_page`, `take_snapshot`, and `list_network_requests` metadata discovery are used. Codex then presents the exact hosts, actions, limits, the three-state matrix, and existing Module variable policy as a **single consolidated authorization**.

After approval it automatically:

1. Captures `baseline`; preloaded assets remain `baseline/shared` and do not stop catalog traversal.
2. Opens Add Widget and scrolls to the bottom until two consecutive observations reveal no new canonical key.
3. Places Widgets up to the Scope limit per deterministic `CDP Capture 001`, `CDP Capture 002`, etc.; an eight-Widget page is supported.
4. Captures Catalog previews/icons as shared `baseline:catalog` evidence before covering `editor-mounted`, applicable `data-bound`, and `preview-visible` per Widget.
5. Checks hosts/statuses after baseline, Catalog, Widget addition, successful data binding, or preview entry. It waits for three identical request ID/status observations only when that action changed the request set.
6. Records resumable attempts and only fills missing states after interruption.
7. Exports the Widget registry from retained baseline JS, audits each run, merges by SHA-256/URL, and creates a separate baseline plus per-Widget reverse-engineering views.

Viewport visibility is an execution guard rather than a separate coverage state because canvas virtualization or IntersectionObserver rendering can delay natural loads until a Widget is visible. Preview remains separate because it can load a distinct runtime bundle.

## Existing Module variables

- No data-source capability: `data-bound = not-applicable`; completeness is unaffected.
- With `allowExistingModuleVariables: true`, prefer a manually prepared and exactly mapped test variable; otherwise keep a compatible current selection or use the first enabled compatible variable exposed by the Widget's visible typed selector.
- An exact fixture mapping overrides automatic selection for that Widget.
- With no compatible variable, an optional source is `not-requested`; a required source is `blocked-missing-fixture`. Both continue with remaining states and Widgets.

The workflow never inspects hidden candidates, creates/modifies/deletes variables or data sources, or persists variable names or rendered data.

## HTML boundary

HTML is retained only for `Document` plus `text/html` or `application/xhtml+xml`, an exact approved response host, a completed bodyless `GET`, status 200–399, and an approved `top-level` or `widget-iframe` context.

XHR/fetch/GraphQL/API HTML is excluded. HTML masquerading as JavaScript or CSS is invalid. Missing Chrome bodies are `body-unavailable` and are never refetched.

## Safety boundary

Visible automation may use `take_snapshot`, `click`, `drag`, `fill`, `press_key`, and waiting on the approved Module. Never use `evaluate_script`. Never set `requestFilePath`; response staging may use only `responseFilePath` below runtime `os.tmpdir()`.

Stop on an unknown host, `401`, `403`, `429`, repeated `5xx`, CAPTCHA/MFA, logout, account warning, page/Module drift, unexpected write, ambiguous add/resume result, owner limits, or owner/SOC instruction.

Publishing, actions/workflows, export, permission changes, production writes, hidden routes, chunk enumeration, sourcemap probing, cache changes, Service Worker bypass, interception, and credential extraction are prohibited.

## Output

Runs contain content-addressed assets, a baseline-derived Widget inventory, redacted manifests, component attempts, optional authorized element screenshots, risks/invalid bodies, and summaries. The merged delivery keeps globally deduplicated `assets/`, `metadata/widget-inventory.json`, the aggregate `metadata/component-assets.json` with separate `assetCoverageStatus` and `behaviorCoverageStatus`, shared evidence in `metadata/baseline-assets.json`, one reverse-engineering view per interacted Widget in `metadata/components/`, and optional screenshots under `evidence/`. The merged inventory adds `retainedEvidence` so declared Chunk/module IDs can be distinguished from implementation bodies actually retained in the delivery.

`firstObservedAssets` excludes `baseline` and `baseline:catalog`, and assigns each `(sha256, URL)` to only the earliest non-shared Widget marker. It is timing evidence, not exclusive ownership; a missing fixture does not downgrade retained implementation bodies.
