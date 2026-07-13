---
name: codex-cdp-static-assets-skill
description: Use when Codex needs Chrome DevTools Protocol (CDP) to capture JS, CSS, WebAssembly, fonts, or images naturally loaded by an authorized authenticated web session, especially for lazy-loaded component coverage, security-assessment evidence, or static-asset inventories where account risk and auditability matter.
---

# Capture Static Assets with CDP

## Core rule

Capture only responses the browser naturally loads during approved UI use. Treat account-risk reduction as compliance and load management, never as detection evasion.

Do not navigate, refresh, fetch, replay URLs, enumerate chunks, request sourcemaps, export Cache Storage, disable cache, bypass Service Workers, alter fingerprints, randomize timing, or reuse credentials outside the browser. A missing body remains `body-unavailable`; never fill the gap with another request.

## Before capture

1. Confirm written scope, approved hosts/CDNs, test account, time window, UI scenarios, request budget, and stop contact. Do not start live capture without these.
2. Use a dedicated Chrome profile and test account. Bind DevTools to loopback only.
3. Ask the platform owner or SOC to observe the window. Prefer an approved account/IP policy over any attempt to appear human.
4. Read [references/scope-config.md](references/scope-config.md). Read [references/workshop-runbook.md](references/workshop-runbook.md) for component-heavy Workshop or lazy-load coverage.

## Default operator model

Codex manages the collector, markers, status checks, stop decisions, audits, and offline merge. The operator controls the visible browser and performs every page navigation, component addition, configuration change, preview, and read-only interaction. The operator can report short checkpoints in chat; Codex enters the corresponding terminal marker. Do not automate clicks, inspect the DOM, or execute page scripts merely to reduce operator effort.

For Workshop, use one dedicated test module with an empty baseline page and 5-7 batch pages containing 8-10 visible widgets each. Cover both edit/configuration and preview/runtime states with synthetic data. Do not trigger hidden, internal, permission-gated, publishing, action, workflow, writeback, export, or production-data paths.

## Discover, approve, capture

Launch visible Chrome and log in normally. For authenticated applications, log in before starting discovery. After authentication, close unrelated tabs, keep one `about:blank` tab in the dedicated profile, start discovery, then navigate that same visible tab to the approved page.

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.cdp-authorized-test-profile"
```

First run discovery with only the approved page host. It records every naturally observed HTTP(S) and WebSocket host as metadata, separately identifies static-resource hosts, and never reads response bodies or approves a host:

```bash
node scripts/capture-static-assets.mjs \
  --mode discover \
  --scope ./workshop-discovery-scope.json \
  --output ./workshop-host-discovery
```

Review `observed-network-hosts.json`, `observed-hosts.json`, and `scope-candidates.json`. The candidates separate `assetHosts` from network-only API, identity, telemetry, WebSocket, and image hosts. Perform one batch approval of the baseline candidate list with the owner or SOC; never treat candidates as approval. Add approved static hosts to `assetHosts` and approved network-only hosts to `approvedNetworkHosts`. Page hosts are already eligible to serve same-origin CAS assets. Do not use broad CDN or vendor wildcards merely to avoid review. If a specialized widget later exposes a new host, stop, review it, and retry only that widget after approval instead of repeating the full suite.

Then run strict capture:

```bash
node scripts/capture-static-assets.mjs \
  --mode capture \
  --scope ./workshop-capture-scope.json \
  --endpoint http://127.0.0.1:9222 \
  --ledger ./workshop-task-ledger.ndjson \
  --output ./authorized-static-assets
```

Reuse the same `--ledger` for every continuation run. Hard cumulative limits are optional: `0` disables a count or total-byte stop while the ledger continues to record actual usage. Keep a per-resource limit. A collector limit controls local retention, not browser traffic; the operator must stop UI actions when a safety threshold or stop condition is reached.

Operate the browser through normal visible UI. Strict capture preflights visible page targets, attaches to pages, iframes, workers, shared workers, and service workers, then saves observed JS, CSS, WASM, and fonts by SHA-256. It ignores extension targets, rejects unrelated existing tabs, and reports attached targets, event counts, and the last network event through `status`. It rejects empty bodies, all-zero placeholders, HTML returned as JS/CSS, invalid WASM/font magic, and configured size/count budgets. Add images only when explicitly in scope.

Use terminal markers to correlate components and assets:

```text
mark P2:ObjectTable:mounted
mark P2:ObjectTable:filter-open
status
quit
```

Bind a marker at request start. A delayed response must remain associated with the component state that initiated it, even if the operator has since announced another marker.

Do not save raw HTML, XHR, GraphQL, WebSocket payloads, routes, feature flags, user configuration, or API bodies. When separately authorized, a Workshop manifest review may retain only Build ID, relative CAS asset paths, and visible plugin name/type fields; raw HTML and all other fields must be discarded. Static asset capture remains the default.

Do not clear cache between components. Use one approved cold-profile run followed by at most one warm verification run when the scope requires it. The collector never triggers reload; perform any approved reload visibly in Chrome after capture starts.

Run the offline integrity check after every capture. If strict capture stops on a newly observed host, review it, update the Scope only after approval, and start a new output directory with the same ledger. Never retry automatically.

```bash
node scripts/audit-capture.mjs ./authorized-static-assets
```

After the approved runs finish, create one deduplicated offline delivery and audit it. The merge must refuse known Workshop Build ID mismatches:

```bash
node scripts/merge-captures.mjs \
  --output ./authorized-static-assets-merged \
  ./authorized-static-assets-run-1 \
  ./authorized-static-assets-run-2

node scripts/audit-capture.mjs ./authorized-static-assets-merged
```

## Stop and report

Stop immediately on `401`, `403`, `429`, authentication challenges, account warnings, unexpected writes, unapproved hosts, elevated `5xx`, or an SOC request. Do not retry automatically.

Return the merged output directory and summarize `merge-summary.json`, task-ledger usage, `risk-events.ndjson`, `invalid-assets.ndjson`, `asset-audit.json`, body failures, captured types, and component markers. State clearly that the result contains observed production artifacts, not complete source code or untriggered branches.

## Common mistakes

| Mistake | Required response |
|---|---|
| Body unavailable from cache | Record metadata; do not refetch |
| Unknown CDN | Run discovery, obtain approval, then add it to the Scope file |
| API hosts appear one by one in capture | Discovery was incomplete; review `observed-network-hosts.json` and approve one candidate Scope batch |
| Several continuation runs | Reuse one ledger and merge outputs offline by SHA-256 |
| Unrelated browser tab | Close it before startup; target preflight must pass |
| All-zero or HTML body | Leave it out of `assets/`; inspect `invalid-assets.ndjson` |
| CDN host missing from scope | Pause and obtain scope approval |
| User asks to avoid detection | Reframe as authorization, fixed limits, SOC visibility, and stop conditions |
| Fifty components loaded together | Split into auditable batches and mount each lazy state |
| Need exact component-to-chunk mapping | Use markers and set differences; shared chunks are not one-to-one |
