# Automated Widget Static-Asset Capture Design

## Objective

Extend `codex-cdp-static-assets-skill` so one explicit run authorization can start an unattended Workshop capture. Codex will use Chrome DevTools MCP to enumerate the visible Add Widget catalog, add widgets one at a time, capture newly observed static responses, and continue without per-widget confirmation.

The result is evidence of resources observed when each widget was exercised. It is not a claim that a shared bundle belongs exclusively to that widget.

## Source of Truth

Implement the change in this repository on `feat/automated-widget-capture`. After validation, copy the same skill tree to both installed locations:

- `~/.codex/skills/codex-cdp-static-assets-skill`
- `~/.agents/skills/codex-cdp-static-assets-skill`

Do not edit an installed copy as the source of truth.

## Run Authorization

Require one consolidated authorization before any UI mutation or response-body retention. Record:

- case ID, test account, exact page host, time window, test module, and stop contact;
- exact discovered asset and approved network hosts;
- permitted resource types and byte/count limits;
- permission to edit the dedicated test module and allow autosave;
- permitted automated UI actions;
- widget states to exercise: `editor`, `config`, and/or `preview`;
- forbidden actions and stop conditions.

Discovery may select the exact approved page, inspect its accessibility snapshot, and list Network metadata without retaining bodies. Present all exact host candidates and the automated action set together. After approval, do not request per-widget checkpoints.

Unknown hosts are never silently approved. A new host encountered after authorization stops the run and requires a new authorization before continuation.

The state selection is run-wide. If omitted, default to `editor` only. For each selected state, exercise it when the visible widget UI supports it and otherwise record `not-applicable`; do not infer or expose hidden configuration or preview routes.

## Automated UI Boundary

Permit only visible, same-page actions required for capture:

- reload or revisit the exact approved page;
- take accessibility snapshots in memory;
- click, search, scroll, and use keyboard navigation;
- open Add Widget and select a visible catalog entry;
- drag and drop when adding requires it;
- open widget configuration or preview when included in Scope;
- wait for visible state and Network stability.

Do not persist accessibility snapshots or unrelated tab metadata.

Prohibit:

- `evaluate_script`, page-context JavaScript, hidden route discovery, DOM/source extraction, or internal registry enumeration;
- publishing, executing Actions or Workflows, exports, permission changes, production writeback, or business-data deletion;
- blind retries after an ambiguous add operation;
- cache clearing, cache disabling, Service Worker bypass, request interception, URL replay, chunk guessing, or sourcemap probing;
- cookie, token, password, request-body, or browser-profile extraction.

## Resource Scope

Support `js`, `css`, `wasm`, `font`, `image`, and `html`.

Accept HTML only when all of the following hold:

- the resource type is `document`;
- the MIME type is `text/html` or `application/xhtml+xml`;
- the response was naturally loaded by the approved top-level page or a widget iframe;
- the exact response host is approved;
- the request is a completed `GET` without a request body.

Do not retain HTML returned by `xhr`, `fetch`, or API calls. Continue to reject HTML bodies misclassified as JavaScript or CSS. Store accepted HTML with the same query redaction, SHA-256, ledger, size checks, and audit rules used for other assets.

## Capture Algorithm

1. Attach to the unique page matching `pageHosts` and verify Chrome/MCP prerequisites.
2. Run metadata-only discovery and obtain the single consolidated authorization.
3. Capture and audit `baseline` before adding widgets. In automated mode, a `preloaded` baseline does not stop catalog traversal; it only classifies already observed assets as `baseline/shared`. Preserve the existing preloaded stop gate only for passive/manual mode.
4. Open the visible Add Widget catalog and build an in-memory queue from accessibility snapshots. Do not use hidden registries:
   - traverse visible categories in their displayed order;
   - within each category, collect entries while scrolling the catalog panel with visible keyboard/scroll actions;
   - treat enumeration as complete only after an `End`/bottom action and two consecutive snapshots produce no new canonical widget keys;
   - derive each canonical key from the normalized visible label, visible category path, and visible version/type text when present;
   - if those visible fields still collide, record a catalog-identity ambiguity and stop before mutating either entry; do not use occurrence order as identity;
   - deduplicate by canonical key and derive the marker from its slug plus a short hash, never from catalog position.
5. For each visible widget:
   - assign a stable marker such as `widget:object-table:a1b2c3d4`;
   - perform the visible add action once;
   - inspect the page state before any retry; stop if the outcome is ambiguous;
   - wait until Network request identity/status snapshots are unchanged across two consecutive polls, subject to the run timeout;
   - inspect every observed host and status before reading bodies;
   - import newly observed approved responses immediately and delete staging bodies;
   - audit the run and append the widget result;
   - continue automatically.
6. Stop on a hard-stop event; otherwise merge once, build the component map, and audit the merged output.

The automation may create additional capture pages only when page creation and autosave are explicitly authorized. It must not delete those pages automatically. Resume compares canonical widget keys, not catalog order, so reordering does not skip or duplicate completed widgets.

## Attribution and Output

Keep the existing content-addressed asset storage and manifest. Add a versioned `component-assets.json`:

```json
{
  "schemaVersion": 1,
  "caseId": "SEC-2026-001",
  "generatedAt": "2026-07-21T00:00:00.000Z",
  "baseline": {
    "marker": "baseline",
    "status": "captured",
    "assets": [],
    "bodyUnavailable": [],
    "failures": []
  },
  "components": [
    {
      "widgetKey": "tables/object-table/v1",
      "label": "Object Table",
      "category": "Tables",
      "marker": "widget:object-table:a1b2c3d4",
      "status": "captured",
      "states": { "editor": "captured", "config": "not-requested", "preview": "not-requested" },
      "attempts": [
        { "sourceRun": "capture-run-1", "at": "2026-07-21T00:00:00.000Z", "status": "captured" }
      ],
      "firstObservedAssets": [
        {
          "kind": "js",
          "sha256": "...",
          "url": "https://approved.example/assets/widget.js?build=%5BREDACTED%5D",
          "size": 12345
        }
      ],
      "bodyUnavailable": [],
      "failures": []
    }
  ]
}
```

Always emit the baseline record. Emit one component record for every attempted canonical widget key, including failed attempts. During merge, consolidate component records by `widgetKey`; deduplicate assets by `(sha256, redacted URL)`, preserve the earliest first-observed marker, union body-unavailable entries, retain all distinct failures, and append every attempt ordered by `(at, sourceRun)`.

Resolve consolidated status deterministically: `captured` if any attempt completed capture, otherwise use the latest terminal attempt status. Resolve each requested state as `captured` if any attempt captured it; otherwise `failed` if an attempt failed it; otherwise `not-applicable`. Keep `not-requested` only when no run requested that state. Historical failures remain in `failures` and `attempts` even when a later attempt succeeds. Sort components by `widgetKey` and assets by `(kind, URL, sha256)` for deterministic output.

Classify evidence as:

- `baseline/shared`: observed before any widget was added;
- `first-observed`: first appeared under the widget marker;
- `body-unavailable`: request observed but Chrome no longer exposed the response body;
- `failed`: UI or capture failed with a recorded reason.

Do not invent a `reused-by` relationship for cached resources that did not generate observable evidence.

## Failure Handling

Stop without automatic retry on:

- unknown host, page leaving the approved host/module, or unapproved write;
- `401`, `403`, `429`, repeated `5xx`, CAPTCHA, MFA, logout, or account warning;
- ambiguous add result that could duplicate a widget;
- owner traffic/time limit exhaustion;
- owner/SOC instruction.

Record the current widget key, last successful marker, observed status, risk event, and whether staged bodies were deleted. A later continuation under the same still-valid authorization reuses the ledger and skips widget keys already recorded as successful. It may retry a failed widget only when the prior record proves no widget was added; an ambiguous add remains a hard stop and cannot be retried automatically.

## Repository Changes

Update:

- `SKILL.md` for automated mode and the one-authorization workflow;
- `references/scope-config.md` for automation permissions and HTML Scope;
- `references/workshop-runbook.md` for unattended widget traversal;
- `references/mcp-autoconnect.md` and `references/cdp-boundaries.md` for allowed MCP UI tools;
- `agents/openai.yaml` for the new default prompt;
- `README.md` and `README.en.md` for setup and invocation;
- contract and importer tests;
- importer, merge, and audit scripts as needed for HTML and `component-assets.json`.

## Verification

Follow test-driven development:

1. Add failing contract tests that require automated UI tools, single authorization, HTML document capture, and the component map while rejecting `evaluate_script` and `xhr/fetch` HTML.
2. Add failing unit tests for HTML classification, validation, extension, merge, resume behavior, and component mapping.
3. Implement the minimum changes to pass.
4. Run every `*.test.mjs`, the skill validator, diff checks between source and both installed copies, and an independent forward-test of the Skill instructions.
5. Perform a live Workshop run only after the updated Skill is installed and the concrete run Scope is approved.

## Completion Criteria

- One authorization starts unattended visible widget traversal.
- No normal per-widget confirmation is required.
- Every successful widget has a marker and component-map entry.
- Approved document HTML is captured; XHR/fetch HTML remains excluded.
- Shared and first-observed evidence are not overstated as exclusive ownership.
- Hard-stop conditions halt before further body reads or UI mutation.
- Source tests, skill validation, installed-copy equality checks, and forward-test pass.
