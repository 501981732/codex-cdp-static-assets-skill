# Codex CDP Workshop Widget Asset Automation Skill

[中文](README.md)

This Skill uses one consolidated authorization to enumerate every visible Widget in an approved Workshop, add widgets through real visible UI, scroll them into view, open configuration, bind only approved synthetic fixtures when applicable, enter preview, and save naturally loaded JS, CSS, WASM, fonts, images, and strictly approved Document HTML from Chrome's completed Network record.

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
Use only my approved existing synthetic data sources; never create, modify, or delete a data source.
First perform metadata-only host and entry-point discovery. Present exact hosts, actions, limits, and fixture mappings for one approval; then run automatically.
Capture js, css, wasm, font, image, and naturally loaded top-level/Widget-iframe Document HTML.
```

## Workflow

Before approval, only `list_pages`, exact-page `select_page`, `take_snapshot`, and `list_network_requests` metadata discovery are used. Codex then presents the exact hosts, actions, limits, five states, and synthetic fixture mapping as a **single consolidated authorization**.

After approval it automatically:

1. Captures `baseline`; preloaded assets remain `baseline/shared` and do not stop catalog traversal.
2. Opens Add Widget and scrolls to the bottom until two consecutive observations reveal no new canonical key.
3. Places 5–10 widgets per deterministic `CDP Capture 001`, `CDP Capture 002`, etc.
4. Covers `editor-mounted`, `viewport-visible`, `config-opened`, `data-bound`, and `preview-visible`.
5. At every state, checks all hosts/statuses, waits for three identical request ID/status observations, reads completed response bodies by request ID, and imports immediately.
6. Records resumable attempts and only fills missing states after interruption.
7. Exports the Widget registry from retained baseline JS, audits each run, merges by SHA-256/URL, and creates a separate baseline plus per-Widget reverse-engineering views.

The viewport state is mandatory because canvas virtualization or IntersectionObserver rendering can delay natural loads until a Widget is visible. After data configuration, the workflow scrolls back to the Widget and waits for rendering again.

## Data-source semantics

- No data-source capability: `data-bound = not-applicable`; completeness is unaffected.
- Optional source without a Scope mapping: `not-requested`; the no-data state remains valid.
- Required source without an approved mapping: `blocked-missing-fixture`; coverage is partial.
- Approved mapping: select only that visible existing synthetic fixture, accept authorized autosave, and capture the visible rendered state.

There is no first-option selection, real-data fallback, or data-source creation/modification/deletion.

## HTML boundary

HTML is retained only for `Document` plus `text/html` or `application/xhtml+xml`, an exact approved response host, a completed bodyless `GET`, status 200–399, and an approved `top-level` or `widget-iframe` context.

XHR/fetch/GraphQL/API HTML is excluded. HTML masquerading as JavaScript or CSS is invalid. Missing Chrome bodies are `body-unavailable` and are never refetched.

## Safety boundary

Visible automation may use `take_snapshot`, `click`, `drag`, `fill`, `press_key`, and waiting on the approved Module. Never use `evaluate_script`. Never set `requestFilePath`; response staging may use only `responseFilePath` below runtime `os.tmpdir()`.

Stop on an unknown host, `401`, `403`, `429`, repeated `5xx`, CAPTCHA/MFA, logout, account warning, page/Module drift, unexpected write, ambiguous add/resume result, owner limits, or owner/SOC instruction.

Publishing, actions/workflows, export, permission changes, production writes, hidden routes, chunk enumeration, sourcemap probing, cache changes, Service Worker bypass, interception, and credential extraction are prohibited.

## Output

Runs contain content-addressed assets, a baseline-derived Widget inventory, redacted manifests, component attempts, optional authorized element screenshots, risks/invalid bodies, and summaries. The merged delivery keeps globally deduplicated `assets/`, `metadata/widget-inventory.json`, the aggregate `metadata/component-assets.json`, shared evidence in `metadata/baseline-assets.json`, one reverse-engineering view per interacted Widget in `metadata/components/`, and optional screenshots under `evidence/`.

`firstObservedAssets` excludes baseline and assigns each `(sha256, URL)` to only the earliest non-baseline Widget marker. It is timing evidence, not exclusive ownership.
