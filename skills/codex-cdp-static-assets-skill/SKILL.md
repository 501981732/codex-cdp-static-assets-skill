---
name: codex-cdp-static-assets-skill
description: Use when Codex needs Chrome DevTools Protocol (CDP) to passively capture JS, CSS, WebAssembly, fonts, or images naturally loaded by an authorized authenticated browser session, especially for Workshop components, lazy-loaded UI coverage, security evidence, or static-asset inventories.
---

# Capture Static Assets with CDP

## Non-negotiable boundary

Capture only completed responses that the approved visible browser naturally loads. Account safety comes from written authorization, limited UI scope, owner-visible traffic controls, and immediate stop conditions. Never frame the workflow as detection evasion.

Do not navigate or refresh the page, automate clicks, inspect the DOM, execute page scripts, refetch resources, enumerate chunks, probe sourcemaps, clear or disable cache, bypass Service Workers, replay URLs, alter fingerprints, or extract, copy, transfer, or replay browser credentials. Reuse only the authenticated state already present inside the approved attached Chrome session. A missing response body stays `body-unavailable`.

Do not save raw HTML, XHR, GraphQL, WebSocket payloads, routes, feature flags, user configuration, API bodies, or production data.

## Before live work

1. Confirm written scope: test account, page host, time window, test module, allowed UI actions, owner traffic ceiling, stop contact, and permitted asset types.
2. Component addition may autosave. Written scope must explicitly allow creating or editing the dedicated test module and its autosave behavior. It must still forbid publishing, actions, workflows, exports, permission changes, deletes, and production writeback unless separately authorized.
3. Prefer an already-running, visible, operator-approved Chrome session with loopback CDP and exactly one page matching `pageHosts`. Reuse that browser's in-place authenticated state; a separate profile is not required solely for capture. Unrelated top-level tabs may remain open because the collector attaches only to the approved page target and its related workers/frames.
4. Read [references/scope-config.md](references/scope-config.md). For Workshop or component-heavy pages, also read [references/workshop-runbook.md](references/workshop-runbook.md).

## Operator model

Codex manages the collector, status checks, markers, stop decisions, audits, and offline merge. The operator controls the visible browser and performs login, navigation, refresh, component addition, configuration, preview, and normal read-only interaction.

For authenticated applications, log in before starting discovery. The collector remains passive throughout.

## Chrome session choice

Probe the loopback endpoint first. If it exposes exactly one page matching `pageHosts`, attach to that page even when unrelated tabs are open. Never attach to unrelated top-level tabs or persist their metadata.

The bundled collector cannot add CDP to an ordinary Chrome process after it has started. Chrome 136 and later also ignore command-line remote debugging for the default Chrome data directory. If no approved loopback endpoint exists, pause instead of launching another profile automatically. Let the operator choose a previously signed-in persistent capture profile or another owner-approved CDP connection. Never copy cookies, passwords, tokens, or profile files to make attachment work.

## Default workflow

### 1. Discover hosts once

Run `--mode discover` with only the approved page host. Discovery records host metadata and writes `observed-network-hosts.json`, `observed-hosts.json`, and `scope-candidates.json`; it does not read response bodies or approve hosts.

Review exact host candidates with the owner or SOC and obtain one batch approval. Put approved static hosts in `assetHosts` and approved network-only dependencies in `approvedNetworkHosts`. Do not use broad vendor/CDN wildcards as a shortcut.

### 2. Capture a strict baseline

Start `--mode capture` with the approved Scope and one shared `--ledger`. Start before the operator visibly refreshes or opens the empty Workshop page. Use one marker such as `P0:baseline`, then wait for the page to settle.

Run a baseline classification gate before adding many components:

- `preloaded`: baseline assets already contain many component, widget, or plugin bundles. Stop bulk component addition, inventory those assets offline, and validate only 1-3 representative components when needed.
- `lazy`: baseline contains mainly the shell. Continue with lazy-load batches.

### 3. Capture lazy-load batches only when needed

Group roughly 5-10 related components per page. Keep one collector running for the whole batch. Start it before opening the batch, exercise edit/configuration and preview/runtime states through the visible UI, then stop after the batch settles.

Use one marker per batch by default. Component-level markers are optional and should be reserved for important ambiguous mappings. Do not stop and restart the collector between components.

If an unknown host appears, stop, review the exact host, obtain approval, and retry only the affected batch or component. Never auto-approve or auto-retry.

### 4. Audit and deliver

Audit every run with `audit-capture.mjs`. Reuse the same ledger across approved continuation runs. Merge once at the end with `merge-captures.mjs`, then audit the merged directory.

Hard cumulative limits are optional: `0` disables a retained count or total-byte stop while the ledger still records usage. Keep a per-resource guard. These limits govern local retention, not browser traffic; always follow the owner's request, traffic, and time ceiling.

## Cache choice

The default, lowest-intrusion path reuses the already attached browser session and its in-place login state, accepting body-unavailable gaps after discovery. Never clear cache or refetch a missing body.

When response-body completeness is materially required, a fresh capture profile requires owner approval. Use it only for the approved strict baseline. A second login/profile may trigger extra account review, so this is an exception. Never clear cache, run profiles concurrently, or transfer credentials.

## Commands

```bash
node scripts/capture-static-assets.mjs --mode discover \
  --scope ./discovery-scope.json --output ./host-discovery

node scripts/capture-static-assets.mjs --mode capture \
  --scope ./capture-scope.json \
  --endpoint http://127.0.0.1:9222 \
  --ledger ./task-ledger.ndjson \
  --output ./capture-run-1

node scripts/audit-capture.mjs ./capture-run-1

node scripts/merge-captures.mjs \
  --output ./capture-merged ./capture-run-1 ./capture-run-2

node scripts/audit-capture.mjs ./capture-merged
```

## Stop and report

Stop immediately on `401`, `403`, `429`, CAPTCHA/MFA, authentication challenges, account warnings, unexpected writes, unapproved hosts, repeated `5xx`, traffic ceiling exhaustion, or an owner/SOC request. Do not retry automatically.

Return the merged output and summarize `merge-summary.json`, ledger usage, `risk-events.ndjson`, `invalid-assets.ndjson`, `asset-audit.json`, body failures, captured types, and markers. State that the result contains observed deployed static artifacts, not source code or untriggered branches.

Use these coverage labels when reporting Workshop results: `visible-and-covered`, `visible-not-covered`, and `registered-not-visible`.
