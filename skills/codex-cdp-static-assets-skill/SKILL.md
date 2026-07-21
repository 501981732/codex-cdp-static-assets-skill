---
name: codex-cdp-static-assets-skill
description: Use when Codex must automatically exercise an authorized Workshop widget catalog through visible Chrome UI and capture naturally loaded JS, CSS, WASM, images, and approved document HTML with CDP after one consolidated authorization.
---

# Automated Workshop Asset Capture with CDP

## Purpose

After metadata-only discovery and a **single consolidated authorization**, automatically enumerate visible Workshop widgets, add them to dedicated capture pages, exercise the approved state matrix, and retain only response bodies already present in Chrome's Network record.

This is an evidence workflow, not a source-code recovery claim. It covers only widgets and states visible to the approved test account.

## Mandatory preparation

1. Read [references/scope-config.md](references/scope-config.md), [references/cdp-boundaries.md](references/cdp-boundaries.md), [references/mcp-autoconnect.md](references/mcp-autoconnect.md), and [references/workshop-runbook.md](references/workshop-runbook.md).
2. Require Chrome 144+, Chrome DevTools MCP `--autoConnect`, and explicit Chrome approval at `chrome://inspect/#remote-debugging`.
3. Confirm case ID, exact page host and Module, test account, time/traffic limits, stop contact, asset types, autosave permission, capture-page permission, and whether `allowModuleVariables` is authorized. Exact synthetic fixture mappings remain optional overrides.
4. Never transfer cookies, tokens, passwords, request bodies, or browser profiles. Close unrelated sensitive tabs where practical.

## Authorization model

Before authorization, use only metadata-preserving discovery: `list_pages`, exact-page `select_page`, `take_snapshot`, and `list_network_requests`. Do not read response bodies or mutate the Module.

Present one consolidated Scope containing exact host candidates and all intended actions: reload the exact page, open Add Widget, scroll the visible catalog/canvas, add widgets, create deterministic capture pages when authorized, automatically handle Module variables when `allowModuleVariables: true`, open configuration, accept autosave, enter preview, optionally capture element-level state screenshots, and read completed approved response bodies.

After the user approves that Scope once, run automatically without per-widget or per-batch confirmations. A new host, new write type, missing authority, ambiguous add result, authentication challenge, or owner limit is a new boundary and stops the run.

## Automated workflow

1. Validate Scope with `automation-policy.mjs validate-scope`.
2. Select the unique page matching `pageHosts`. Never inspect unrelated pages.
3. Capture and import the `baseline`; in automation mode, a `preloaded` baseline is classified as shared evidence and does not stop widget traversal. Run `widget-inventory.mjs` against the retained baseline JS to export registry entries already present in those bodies. Treat them as expected inventory, not interaction evidence.
4. Open Add Widget with visible UI. Repeatedly use `take_snapshot` and visible scroll/End operations until the catalog tracker reports two consecutive bottom observations with no new canonical widget key. Cross-snapshot repeats are deduplicated; two indistinguishable same-key entries in one snapshot stop as `catalog-identity-ambiguity`.
5. Import natural Catalog preview/icon responses under the shared marker `baseline:catalog` before adding the first Widget. They are discovery evidence, never a Widget's `firstObservedAssets`.
6. Process widgets in deterministic catalog order. Keep at most `maxWidgetsPerPage` on `CDP Capture 001`, `CDP Capture 002`, and so on. Full-catalog mode may create pages only when `allowCreateCapturePages: true`; single-page mode records `blocked-page-capacity` at the limit.
7. Locate an existing instance by capture page, canonical widget key, and recorded visible label before adding. Resume only missing states. Multiple matches stop as `blocked-existing-instance-ambiguous`; never add a duplicate to guess.
8. Exercise the three-state matrix with visible tools and a stable marker:
   - `editor-mounted`: add the Widget and verify that its instance is visibly mounted. Scrolling into view is an action within this state, not a separate coverage state.
   - `data-bound`: only for Widgets with a visible variable-input capability. When `allowModuleVariables: true`, create, select, modify, or clean up variables through visible UI as needed for the Widget. Do not inspect request payloads or business data; observe only the Widget's natural resource loads. If the visible UI offers no compatible variable path, record `not-requested` for an optional input or `blocked-missing-fixture` for a required input, then continue. Opening configuration is an action within this state, not a separate coverage state. Allow only approved autosave.
   - `preview-visible`: enter visible preview and scroll the Widget into view; this remains separate because preview can load a distinct runtime bundle.
9. When `captureStateScreenshots` is authorized, capture at most one uniquely identified Widget or configuration panel per successful state to `evidence/components/<marker-base>/<state>--<attempt-number>.png`. Default to no screenshots. Do not persist DOM or full-page screenshots.
10. At the baseline, after Catalog opening, and after an action that can load a resource (add, successful data binding, or preview), inspect the complete request list first. Stop before body access on an unknown host, `401`, `403`, `429`, repeated `5xx`, CAPTCHA/MFA, logout, account warning, or unexpected write. When new request IDs or statuses appear, wait for baseline plus two unchanged observations; otherwise continue without a redundant stability loop.
11. For each approved completed request, call `get_network_request` once by request ID, import the staged body immediately, and delete staging through the importer. Record `body-unavailable` when Chrome cannot supply the body; never refetch the URL.
12. Record every state attempt with `record-component-state.mjs`. Audit each run, merge once with `merge-captures.mjs`, then audit the delivery and `component-assets.json`.

## HTML boundary

Retain HTML only when the observed resource type is `Document`, MIME is `text/html` or `application/xhtml+xml`, the exact response host is approved, the request is a completed bodyless `GET` with status 200–399, and the visible context is `top-level` or `widget-iframe`.

Never retain HTML from XHR, fetch, GraphQL, or an API. JavaScript/CSS bodies that contain HTML remain invalid. Pass `--request-method`, `--request-has-body`, and `--document-context` to the importer; missing metadata fails closed.

## Hard boundaries

Never use `evaluate_script`. Never set `requestFilePath`; `get_network_request` may receive only a response output path under the resolved `os.tmpdir()` staging root. Never clear/disable cache, bypass Service Workers, intercept requests, replay URLs, guess/probe additional chunks, probe sourcemaps, expose hidden routes, change permissions, publish, execute actions/workflows, export data, or inspect request payloads. Module variable handling is allowed only through visible UI when `allowModuleVariables: true`. The baseline inventory may record Type IDs, Renderer names, Chunk IDs, and module IDs literally present in already retained JS, but must never retrieve those referenced chunks.

Use only visible, authorized controls. `click`, `drag`, `fill`, `press_key`, `wait_for`, `take_snapshot`, authorized element-level `take_screenshot`, and exact-page reload are allowed only after the consolidated Scope is approved.

## Output and claims

Each run contains content-addressed assets, redacted manifest entries, `widget-inventory.json`, state attempts, optional state screenshots, risk/invalid events, and summary counters. The merged delivery contains `metadata/widget-inventory.json`, the aggregate `metadata/component-assets.json`, `metadata/baseline-assets.json`, one reverse-engineering view per Widget under `metadata/components/`, optional screenshots under `evidence/`, and globally deduplicated assets at their redacted delivery paths. The merged Widget inventory resolves registry-declared Chunk/module IDs against retained JavaScript and records matching delivery files plus unretained IDs; it never fetches a missing dependency.

`component-assets.json` distinguishes `baseline/shared` (including `baseline:catalog`), per-widget `firstObservedAssets`, `bodyUnavailable`, failures, `assetCoverageStatus`, and `behaviorCoverageStatus`. Asset retention and behavior coverage are separate: a missing test fixture never downgrades retained implementation bodies. First observation is evidence of timing, not proof that a bundle belongs exclusively to that Widget.

Each per-Widget view renames this evidence to `newlyObservedAssets`, resolves every asset to its merged delivery `file`, and links to the separate baseline view. Approved Document HTML is a network document, not a serialized runtime Widget DOM.

Keep the inventory layers distinct: baseline registry entries mean `registry-known`; visible Add Widget enumeration means `catalog-visible`; state events mean `interaction-confirmed`; retained bodies mean `implementation-body-retained`. Absence from a later layer must not rewrite an earlier layer as missing.
