# Workshop Full-Catalog Runbook

## Goal

Automatically exercise every visible Widget and its naturally triggered loading states after one Scope approval. Preserve deployable response evidence without claiming source ownership or hidden coverage.

## Phase 1: metadata discovery and one authorization

1. Connect to the signed-in default Chrome with MCP `--autoConnect` and select the unique exact `pageHosts` page.
2. Keep snapshots and page-list results in memory. Use `take_snapshot` to verify the approved Module and visible Add Widget entry point.
3. Use `list_network_requests` without body reads to list exact current hosts and statuses.
4. Present the exact host candidates, automation mode, autosave/page-creation actions, all authorized variable mutations, the three-state matrix, optional element-level screenshots, asset limits, and optional fixture overrides as a **single consolidated authorization**.
5. Write and validate `capture-scope.json`. Do not mutate before approval.

## Phase 2: baseline

1. Reload only the exact approved page when authorized.
2. Mark `baseline`, inspect all observed hosts/statuses, and stop before body reads on any boundary violation.
3. Wait for Network stability: the first observation is baseline; two additional identical `(requestId,status)` observations are required.
4. Import eligible bodies immediately. HTML uses strict Document metadata. Record body gaps as `body-unavailable`.
5. Extract the Widget registry already present in retained baseline JavaScript:

```bash
node scripts/widget-inventory.mjs \
  --capture ./capture-run-1 \
  --output ./capture-run-1/widget-inventory.json
```

6. Classify baseline as `preloaded` or `lazy`. Automated full-catalog mode continues either way; baseline assets remain `baseline/shared` and can never become a widget's `firstObservedAssets`.

`widget-inventory.json` is the expected registry layer. It records Type IDs, Renderer names, referenced Chunk IDs, module IDs, and the exact retained source hash. It does not fetch a referenced Chunk and does not prove the Widget was visible, added, rendered, or that its implementation body was retained.

## Phase 3: catalog enumeration

Open Add Widget through visible `click`. Repeatedly inspect the visible catalog with `take_snapshot` and scroll with `press_key`/visible scroll controls.

For each observation, pass visible entries to:

```bash
node scripts/automation-policy.mjs catalog-update \
  --state ./capture-run-1/catalog-state.json \
  --entries-json '[{"label":"Object Table","category":"Tables","versionOrType":"v1"}]' \
  --at-bottom true
```

Canonical identity is visible category/label/version-or-type. The same key in later snapshots is one Widget. Two indistinguishable entries with the same key in one snapshot stop as `catalog-identity-ambiguity`.

Keep the visible catalog queue separate from the baseline registry. Use the registry to detect coverage gaps and support later reverse engineering; use only the visible catalog to decide what can be added through the authorized UI.

Catalog enumeration is complete only after reaching bottom and receiving two consecutive observations with no new key. Do not persist the accessibility snapshot or DOM. Import natural Catalog preview/icon responses with marker `baseline:catalog` before adding the first Widget; this shared discovery batch must never become a Widget's `firstObservedAssets`.

## Phase 4: deterministic pages and resume

Use no more than `maxWidgetsPerPage`. Full-catalog mode creates `CDP Capture 001`, `CDP Capture 002`, etc. Single-page mode records `blocked-page-capacity` instead of creating a page.

Before adding, inspect the target page for the recorded visible instance label. Use:

```bash
node scripts/automation-policy.mjs resume \
  --component-json '{"completedStates":["editor-mounted"],"added":true,"fixtureAvailable":true}' \
  --visible-matches 1
```

One match resumes missing states. More than one records `blocked-existing-instance-ambiguous` and stops. An already-added Widget with no compatible variable must not be added again; record the data state and continue its remaining missing states.

## Phase 5: per-widget state matrix

Generate a state marker:

```bash
node scripts/automation-policy.mjs marker \
  --widget-key tables/object-table/v1 \
  --state editor-mounted
```

Then run states in this order:

1. `editor-mounted`: use `click` or visible `drag` to add; verify the unique visible instance. If needed, scroll it into the viewport before recording this state; viewport visibility is an execution guard, not another coverage state.
2. `data-bound`: only for a Widget with a visible data-input capability. Open configuration and inspect visible requiredness. Create mapped `CDP Capture` variables only with `allowCreateTestVariables`; modify compatible variables only with `allowModifyModuleVariables`; select existing variables only with `allowExistingModuleVariables`; and delete cleanup variables only with `allowDeleteModuleVariables`. If no permitted compatible path exists, record `not-requested` for an optional source or `blocked-missing-fixture` for a required source and continue. Never create, modify, or delete a data source. Use `fill` only for authorized visible configuration fields. Autosave is the only allowed persistence.
3. `preview-visible`: enter preview, scroll the instance into view, and wait for visible rendering. Keep this separate because preview can load a runtime bundle that editor mounting does not.

After successful data configuration, scroll back to the Widget before capture so configuration-driven lazy rendering is not missed.

If `captureStateScreenshots` is true and the successful state has a unique Widget or panel `uid`, save a PNG with `take_screenshot` to:

```text
<capture-run>/evidence/components/<marker-base-with-colons-replaced-by-double-hyphens>/<state>--<attempt-number>.png
```

Do not take full-page screenshots. A missing unique target omits only the screenshot; it does not convert an otherwise successful resource state into a failure.

For each attempt, append an event:

```bash
node scripts/record-component-state.mjs \
  --scope ./capture-scope.json \
  --output ./capture-run-1 \
  --widget-key tables/object-table/v1 \
  --label 'Object Table' \
  --category Tables \
  --capture-page 'CDP Capture 001' \
  --visible-instance-label 'Object Table' \
  --marker widget:object-table:a1b2c3d4:editor-mounted \
  --state editor-mounted \
  --status captured \
  --required \
  --attempt-id capture-run-1:editor-mounted:2
```

Attempt IDs are unique within the run and use `<run>:<state>:<monotonic-number>`. Failures require `--failure-code` and `--failure-message`. Use `--not-required` for `not-applicable`/`not-requested`.

## Phase 6: request ingestion at resource-triggering boundaries

1. Call `list_network_requests` for all types and check hosts/statuses first after baseline, Catalog opening, Widget addition, successful data binding, and preview entry.
2. If the action produced new request IDs or statuses, feed only `(requestId,status)` to `network-update`; three identical observations are stable. If no static request changed, do not add a redundant stabilization loop.
3. For each approved completed asset, call `get_network_request` with `reqid` and `responseFilePath` under `os.tmpdir()`.
4. Import immediately with the current widget/state marker. Never set `requestFilePath` and never refetch a URL.
5. If the body is unavailable, call the importer without `--body` so the manifest records `body-unavailable`.

Do not navigate away before ingestion; the Network panel is not an indefinite event archive.

## Phase 7: audit and merge

Audit each run:

```bash
node scripts/audit-capture.mjs ./capture-run-1
```

Merge all runs once, then audit the delivery:

```bash
node scripts/merge-captures.mjs --output ./delivery ./capture-run-1 ./capture-run-2
node scripts/audit-capture.mjs ./delivery
```

The final `metadata/component-assets.json` remains the machine-readable interaction aggregate. It reports `assetCoverageStatus` separately from `behaviorCoverageStatus`: fixture availability can make behavior partial without downgrading retained Widget bodies. Merge also writes `metadata/widget-inventory.json`, `metadata/baseline-assets.json`, and one human-oriented file per interacted Widget under `metadata/components/`. The merged Widget inventory keeps the registry-declared IDs and adds `retainedEvidence`: matching Chunk/module delivery files, unretained IDs, and an implementation-body retention status. This is local evidence resolution only and never retrieves a missing dependency. Each Widget view uses `newlyObservedAssets`, resolves assets to the merged delivery path, lists copied screenshots, and links to the separate baseline and registry files. Resource bodies remain globally deduplicated.

Document HTML means an observed top-level or Widget iframe network document. It is not a serialized post-render Widget DOM.

## Stop without automatic retry

Stop on unknown hosts, page/Module drift, authentication challenges, status stops, account warnings, unexpected writes, ambiguous widget identity/add/resume, capacity without authority, traffic/time limits, or owner/SOC instruction. Missing compatible variables remain component-level partial coverage and do not stop traversal. Local staging-path errors may be corrected without new network traffic; browser body eviction is not retried.
