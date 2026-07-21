# Workshop Full-Catalog Runbook

## Goal

Automatically exercise every visible Widget and its naturally triggered loading states after one Scope approval. Preserve deployable response evidence without claiming source ownership or hidden coverage.

## Phase 1: metadata discovery and one authorization

1. Connect to the signed-in default Chrome with MCP `--autoConnect` and select the unique exact `pageHosts` page.
2. Keep snapshots and page-list results in memory. Use `take_snapshot` to verify the approved Module and visible Add Widget entry point.
3. Use `list_network_requests` without body reads to list exact current hosts and statuses.
4. Present the exact host candidates, automation mode, autosave/page-creation actions, five states, asset limits, and synthetic fixture Profiles as a **single consolidated authorization**.
5. Write and validate `capture-scope.json`. Do not mutate before approval.

## Phase 2: baseline

1. Reload only the exact approved page when authorized.
2. Mark `baseline`, inspect all observed hosts/statuses, and stop before body reads on any boundary violation.
3. Wait for Network stability: the first observation is baseline; two additional identical `(requestId,status)` observations are required.
4. Import eligible bodies immediately. HTML uses strict Document metadata. Record body gaps as `body-unavailable`.
5. Classify baseline as `preloaded` or `lazy`. Automated full-catalog mode continues either way; baseline assets remain `baseline/shared` and can never become a widget's `firstObservedAssets`.

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

Catalog enumeration is complete only after reaching bottom and receiving two consecutive observations with no new key. Do not persist the accessibility snapshot or DOM.

## Phase 4: deterministic pages and resume

Use no more than `maxWidgetsPerPage`. Full-catalog mode creates `CDP Capture 001`, `CDP Capture 002`, etc. Single-page mode records `blocked-page-capacity` instead of creating a page.

Before adding, inspect the target page for the recorded visible instance label. Use:

```bash
node scripts/automation-policy.mjs resume \
  --component-json '{"completedStates":["editor-mounted"],"added":true,"fixtureAvailable":true}' \
  --visible-matches 1
```

One match resumes missing states. More than one records `blocked-existing-instance-ambiguous` and stops. An already-added widget with no required fixture mapping must not be added again.

## Phase 5: per-widget state matrix

Generate a state marker:

```bash
node scripts/automation-policy.mjs marker \
  --widget-key tables/object-table/v1 \
  --state viewport-visible
```

Then run states in this order:

1. `editor-mounted`: use `click` or visible `drag` to add; verify the unique visible instance.
2. `viewport-visible`: scroll the canvas until the instance is visible. This step is mandatory even if editor-mounted loaded assets, because viewport virtualization may defer rendering.
3. `config-opened`: open the visible configuration UI and wait for it to settle.
4. `data-bound`: inspect visible capability/requiredness. Apply the exact Scope semantics for `not-applicable`, `not-requested`, mapped synthetic fixture, or `blocked-missing-fixture`. Use `fill` only for authorized visible configuration fields and `click` only the mapped option. Autosave is the only allowed persistence.
5. `preview-visible`: enter preview, scroll the instance into view, and wait for visible rendering.

After configuration, scroll back to the widget before capture so configuration-driven lazy rendering is not missed.

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
  --marker widget:object-table:a1b2c3d4:viewport-visible \
  --state viewport-visible \
  --status captured \
  --required \
  --attempt-id capture-run-1:viewport-visible:2
```

Attempt IDs are unique within the run and use `<run>:<state>:<monotonic-number>`. Failures require `--failure-code` and `--failure-message`. Use `--not-required` for `not-applicable`/`not-requested`.

## Phase 6: request ingestion at every state

1. Call `list_network_requests` for all types and check hosts/statuses first.
2. Feed only `(requestId,status)` to `network-update`; three identical observations are stable.
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

The final `component-assets.json` groups by `(capturePage, widgetKey)`, keeps every attempt/failure, treats captured as the winning current state, excludes `not-applicable`/`not-requested` from required states, and gives each non-baseline `(sha256,url)` only to its earliest observable widget marker.

## Stop without automatic retry

Stop on unknown hosts, page/Module drift, authentication challenges, status stops, account warnings, unexpected writes, ambiguous widget identity/add/resume, missing required fixture mapping, capacity without authority, traffic/time limits, or owner/SOC instruction. Local staging-path errors may be corrected without new network traffic; browser body eviction is not retried.
