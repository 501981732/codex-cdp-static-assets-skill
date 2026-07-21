# Scope Configuration

The JSON Scope is both the one-time authorization boundary and an audit input. Metadata discovery never promotes a host automatically.

## Required authorization

Record the case ID, exact page host/Module, test account, time and traffic ceilings, stop contact, asset types, autosave permission, capture-page permission, and whether current Module variables may be selected. Exact synthetic fixtures may still be approved as per-Widget overrides. The authorization permits only visible Workshop edits needed for capture.

```json
{
  "caseId": "SEC-2026-001",
  "pageHosts": ["workshop.example.com"],
  "approvedPageUrl": "https://workshop.example.com/module/edit/module-rid",
  "moduleId": "module-rid",
  "testAccount": "synthetic-test-account",
  "authorizationWindow": {
    "startsAt": "2026-07-21T00:00:00.000Z",
    "endsAt": "2026-07-21T08:00:00.000Z"
  },
  "stopContact": "workshop-owner",
  "assetHosts": ["cdn.workshop.example.com"],
  "approvedNetworkHosts": ["api.workshop.example.com"],
  "types": ["js", "css", "wasm", "font", "image", "html"],
  "limits": {
    "maxAssets": 0,
    "maxTotalMiB": 0,
    "maxAssetMiB": 50
  },
  "stopOnStatuses": [401, 403, 429],
  "automation": {
    "enabled": true,
    "mode": "full-catalog",
    "allowAutosave": true,
    "allowCreateCapturePages": true,
    "allowExistingModuleVariables": true,
    "captureStateScreenshots": true,
    "maxWidgetsPerPage": 8,
    "states": [
      "editor-mounted",
      "viewport-visible",
      "config-opened",
      "data-bound",
      "preview-visible"
    ]
  },
  "fixtureProfiles": {
    "objects": {
      "kind": "synthetic-object-set",
      "visibleOption": "CDP Synthetic Objects"
    }
  },
  "widgetFixtureMap": {
    "tables/object-table/v1": "objects"
  }
}
```

Validate before mutation:

```bash
node scripts/automation-policy.mjs validate-scope --scope ./capture-scope.json
```

## Modes

- `full-catalog` requires `allowAutosave: true` and `allowCreateCapturePages: true`. Pages are named `CDP Capture 001`, `CDP Capture 002`, and so on.
- `single-page` requires `allowAutosave: true` and `allowCreateCapturePages: false`. At capacity, record `blocked-page-capacity` and stop.
- `captureStateScreenshots: true` authorizes element-level PNG evidence for successful visible states. Omit it or set it to `false` to retain no screenshots.
- Omitted automation is passive mode. An automation object must use an explicit boolean `enabled`.

`maxWidgetsPerPage` must be at least 1; use 5–10 by default. All state names must be from the fixed state matrix. Automated Scope also requires a non-empty Case ID, an exact query-free `approvedPageUrl` whose final path segment equals `moduleId`, plus test account, a currently active increasing authorization window, and stop contact. Expired or not-yet-active Scope is rejected. These fields let the runner stop on same-host Module drift; account/contact values are never copied into provenance.

## Existing Module variables and fixture overrides

`allowExistingModuleVariables: true` authorizes selecting variables already defined in the approved Module. Keep the current selection when the Widget's visible typed selector accepts it; otherwise choose the first enabled compatible option presented by that selector. Never inspect hidden candidates or create, modify, or delete variables or data sources.

`fixtureProfiles` names exact visible test options and `widgetFixtureMap` may reference only those names. A mapped fixture overrides automatic existing-variable selection for that Widget.

For `data-bound`:

- no data-source capability: `not-applicable`, `required: false`;
- mapping present: select the exact `visibleOption`;
- no mapping and existing Module variables are authorized: keep or select a visibly compatible existing variable;
- no compatible variable for an optional source: `not-requested`, `required: false`;
- no compatible variable for a required source: `blocked-missing-fixture`, partial coverage, then continue the remaining states and Widgets.

After a successful selection, save through approved autosave, return to the viewport, and capture the rendered state.

Provenance retains only the existing-variable authorization boolean, Profile names, and mapped widget keys—not variable names, visible option text, or rendered data.

## Exact hosts

Start discovery with `pageHosts`. List all current request metadata, then present exact asset/network candidates in the single consolidated authorization. Do not use allow-any or broad wildcard approval. Any later unknown host stops the run and requires a new authorization boundary.

Document HTML additionally requires its response hostname to appear as an exact non-wildcard approved host.

## Limits and Ledger

Reuse one append-only Ledger across all runs. `0` disables retained asset-count or total-byte limits but does not disable owner traffic/time ceilings. Keep a nonzero `maxAssetMiB` guard. A Ledger `caseId` mismatch is fatal.

## Outputs

- Per run: `manifest.ndjson`, baseline-derived `widget-inventory.json`, `component-events.ndjson`, optional `evidence/components/<marker-base>/<state>--<attempt-number>.png`, `markers.ndjson`, `risk-events.ndjson`, `invalid-assets.ndjson`, `summary.json`, `provenance.json`.
- Resume state: `catalog-state.json` contains only canonical keys/counters; `network-state.json` contains only request ID/status fingerprints/counters.
- Delivery: aggregate metadata including `metadata/widget-inventory.json`, `metadata/baseline-assets.json`, one file per Widget under `metadata/components/`, optional screenshots under `evidence/`, and globally deduplicated `assets/`.
