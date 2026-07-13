---
name: capture-static-assets-cdp
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

## Discover, approve, capture

Launch visible Chrome and log in normally:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.cdp-authorized-test-profile"
```

First run discovery with only the approved page host. It records static-resource hosts naturally encountered during visible UI use; it never reads response bodies or approves a host:

```bash
node scripts/capture-static-assets.mjs \
  --mode discover \
  --scope ./workshop-discovery-scope.json \
  --output ./workshop-host-discovery
```

Review `observed-hosts.json`. Add only approved CDNs to `assetHosts`; add other approved network endpoints, if needed for normal page use, to `approvedNetworkHosts`. Do not use broad CDN or vendor wildcards merely to avoid another review.

Then run strict capture:

```bash
node scripts/capture-static-assets.mjs \
  --mode capture \
  --scope ./workshop-capture-scope.json \
  --endpoint http://127.0.0.1:9222 \
  --output ./authorized-static-assets
```

Operate the browser through normal visible UI. Strict capture attaches to pages, iframes, workers, shared workers, and service workers, then saves observed JS, CSS, WASM, and fonts by SHA-256. It rejects empty bodies, all-zero placeholders, HTML returned as JS/CSS, invalid WASM/font magic, and configured size/count budgets. Add images only when explicitly in scope.

Use terminal markers to correlate components and assets:

```text
mark P2:ObjectTable:mounted
mark P2:ObjectTable:filter-open
status
quit
```

Do not clear cache between components. Use one approved cold-profile run followed by at most one warm verification run when the scope requires it. The collector never triggers reload; perform any approved reload visibly in Chrome after capture starts.

Run the offline integrity check after every capture:

```bash
node scripts/audit-capture.mjs ./authorized-static-assets
```

## Stop and report

Stop immediately on `401`, `403`, `429`, authentication challenges, account warnings, unexpected writes, unapproved hosts, elevated `5xx`, or an SOC request. Do not retry automatically.

Return the output directory and summarize `summary.json`, `risk-events.ndjson`, `invalid-assets.ndjson`, `asset-audit.json`, body failures, captured types, and component markers. State clearly that the result contains observed production artifacts, not complete source code or untriggered branches.

## Common mistakes

| Mistake | Required response |
|---|---|
| Body unavailable from cache | Record metadata; do not refetch |
| Unknown CDN | Run discovery, obtain approval, then add it to the Scope file |
| All-zero or HTML body | Leave it out of `assets/`; inspect `invalid-assets.ndjson` |
| CDN host missing from scope | Pause and obtain scope approval |
| User asks to avoid detection | Reframe as authorization, fixed limits, SOC visibility, and stop conditions |
| Fifty components loaded together | Split into auditable batches and mount each lazy state |
| Need exact component-to-chunk mapping | Use markers and set differences; shared chunks are not one-to-one |
