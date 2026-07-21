---
name: codex-cdp-static-assets-skill
description: Use when Codex must automatically exercise an authorized Workshop widget catalog through visible Chrome UI and capture naturally loaded JS, CSS, WASM, fonts, images, and approved document HTML with CDP after one consolidated authorization.
---

# Automated Workshop Asset Capture with CDP

## Purpose

After metadata-only discovery and a **single consolidated authorization**, automatically enumerate visible Workshop widgets, add them to dedicated capture pages, exercise the approved state matrix, and retain only response bodies already present in Chrome's Network record.

This is an evidence workflow, not a source-code recovery claim. It covers only widgets and states visible to the approved test account.

## Mandatory preparation

1. Read [references/scope-config.md](references/scope-config.md), [references/cdp-boundaries.md](references/cdp-boundaries.md), [references/mcp-autoconnect.md](references/mcp-autoconnect.md), and [references/workshop-runbook.md](references/workshop-runbook.md).
2. Require Chrome 144+, Chrome DevTools MCP `--autoConnect`, and explicit Chrome approval at `chrome://inspect/#remote-debugging`.
3. Confirm case ID, exact page host and Module, test account, time/traffic limits, stop contact, asset types, autosave permission, page-creation permission, and approved synthetic fixture mappings.
4. Never transfer cookies, tokens, passwords, request bodies, or browser profiles. Close unrelated sensitive tabs where practical.

## Authorization model

Before authorization, use only metadata-preserving discovery: `list_pages`, exact-page `select_page`, `take_snapshot`, and `list_network_requests`. Do not read response bodies or mutate the Module.

Present one consolidated Scope containing exact host candidates and all intended actions: reload the exact page, open Add Widget, scroll the visible catalog/canvas, add widgets, create deterministic capture pages when authorized, open configuration, select only mapped synthetic fixtures, accept autosave, enter preview, and read completed approved response bodies.

After the user approves that Scope once, run automatically without per-widget or per-batch confirmations. A new host, new write type, missing authority, ambiguous add result, authentication challenge, or owner limit is a new boundary and stops the run.

## Automated workflow

1. Validate Scope with `automation-policy.mjs validate-scope`.
2. Select the unique page matching `pageHosts`. Never inspect unrelated pages.
3. Capture and import the `baseline`; in automation mode, a `preloaded` baseline is classified as shared evidence and does not stop widget traversal.
4. Open Add Widget with visible UI. Repeatedly use `take_snapshot` and visible scroll/End operations until the catalog tracker reports two consecutive bottom observations with no new canonical widget key. Cross-snapshot repeats are deduplicated; two indistinguishable same-key entries in one snapshot stop as `catalog-identity-ambiguity`.
5. Process widgets in deterministic catalog order. Keep at most `maxWidgetsPerPage` on `CDP Capture 001`, `CDP Capture 002`, and so on. Full-catalog mode may create pages only when `allowCreateCapturePages: true`; single-page mode records `blocked-page-capacity` at the limit.
6. Locate an existing instance by capture page, canonical widget key, and recorded visible label before adding. Resume only missing states. Multiple matches stop as `blocked-existing-instance-ambiguous`; never add a duplicate to guess.
7. Exercise each applicable state with visible tools and a stable marker:
   - `editor-mounted`: add the widget and verify its visible instance.
   - `viewport-visible`: scroll the canvas until the instance is visibly in the viewport; this triggers virtualization/IntersectionObserver paths naturally.
   - `config-opened`: open visible widget configuration.
   - `data-bound`: if no data-source capability exists, record `not-applicable`; if data is optional and no mapping is approved, record `not-requested`; if required and no approved mapping exists, record `blocked-missing-fixture`; otherwise select only the exact mapped synthetic Profile and allow the approved autosave.
   - `preview-visible`: enter visible preview and scroll the widget into view.
8. At every state, inspect the complete request list first. Stop before body access on an unknown host, `401`, `403`, `429`, repeated `5xx`, CAPTCHA/MFA, logout, account warning, or unexpected write. Wait for three identical request/status observations: baseline plus two unchanged observations.
9. For each approved completed request, call `get_network_request` once by request ID, import the staged body immediately, and delete staging through the importer. Record `body-unavailable` when Chrome cannot supply the body; never refetch the URL.
10. Record every state attempt with `record-component-state.mjs`. Audit each run, merge once with `merge-captures.mjs`, then audit the delivery and `component-assets.json`.

## HTML boundary

Retain HTML only when the observed resource type is `Document`, MIME is `text/html` or `application/xhtml+xml`, the exact response host is approved, the request is a completed bodyless `GET` with status 200–399, and the visible context is `top-level` or `widget-iframe`.

Never retain HTML from XHR, fetch, GraphQL, or an API. JavaScript/CSS bodies that contain HTML remain invalid. Pass `--request-method`, `--request-has-body`, and `--document-context` to the importer; missing metadata fails closed.

## Hard boundaries

Never use `evaluate_script`. Never set `requestFilePath`; `get_network_request` may receive only a response output path under the resolved `os.tmpdir()` staging root. Never clear/disable cache, bypass Service Workers, intercept requests, replay URLs, enumerate chunks, probe sourcemaps, expose hidden routes, change permissions, publish, execute actions/workflows, export data, or create/modify/delete data sources.

Use only visible, authorized controls. `click`, `drag`, `fill`, `press_key`, `wait_for`, `take_snapshot`, and exact-page reload are allowed only after the consolidated Scope is approved.

## Output and claims

Each run contains content-addressed assets, redacted manifest entries, state attempts, risk/invalid events, and summary counters. The merged delivery contains `metadata/manifest.ndjson`, `metadata/component-events.ndjson`, `metadata/source-manifest.ndjson`, `metadata/component-assets.json`, and assets at their redacted delivery paths.

`component-assets.json` distinguishes `baseline/shared`, per-widget `firstObservedAssets`, `bodyUnavailable`, failures, and complete/partial state coverage. First observation is evidence of timing, not proof that a bundle belongs exclusively to that widget.
