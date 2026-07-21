# Scope Configuration

The JSON Scope is both the one-time authorization boundary and an audit input. Metadata discovery never promotes a host automatically.

## Required authorization

Record the case ID, exact page host/Module, test account, time and traffic ceilings, stop contact, asset types, autosave permission, capture-page permission, and exact existing synthetic fixtures. The authorization permits only visible Workshop edits needed for capture.

```json
{
  "caseId": "SEC-2026-001",
  "pageHosts": ["workshop.example.com"],
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
- Omitted automation is passive mode. An automation object must use an explicit boolean `enabled`.

`maxWidgetsPerPage` must be at least 1; use 5–10 by default. All state names must be from the fixed state matrix.

## Synthetic fixtures

`fixtureProfiles` names existing visible synthetic test options. `widgetFixtureMap` may reference only those names. Never choose the first available option, add a real-data fallback, or create/modify/delete any data source.

For `data-bound`:

- no data-source capability: `not-applicable`, `required: false`;
- optional and no mapping: `not-requested`, `required: false`;
- required and no mapping: `blocked-missing-fixture`, partial coverage;
- mapping present: select the exact `visibleOption`, save through approved autosave, return to viewport, and capture the rendered state.

Provenance retains only policy fields, Profile names, and mapped widget keys—not visible option text or data.

## Exact hosts

Start discovery with `pageHosts`. List all current request metadata, then present exact asset/network candidates in the single consolidated authorization. Do not use allow-any or broad wildcard approval. Any later unknown host stops the run and requires a new authorization boundary.

Document HTML additionally requires its response hostname to appear as an exact non-wildcard approved host.

## Limits and Ledger

Reuse one append-only Ledger across all runs. `0` disables retained asset-count or total-byte limits but does not disable owner traffic/time ceilings. Keep a nonzero `maxAssetMiB` guard. A Ledger `caseId` mismatch is fatal.

## Outputs

- Per run: `manifest.ndjson`, `component-events.ndjson`, `markers.ndjson`, `risk-events.ndjson`, `invalid-assets.ndjson`, `summary.json`, `provenance.json`.
- Resume state: `catalog-state.json` contains only canonical keys/counters; `network-state.json` contains only request ID/status fingerprints/counters.
- Delivery: `metadata/manifest.ndjson`, `metadata/source-manifest.ndjson`, `metadata/component-events.ndjson`, `metadata/merge-summary.json`, `component-assets.json`, and `assets/`.
