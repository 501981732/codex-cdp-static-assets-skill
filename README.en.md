# Codex CDP Static Asset Capture Skill

[中文](README.md)

An authorization-first, passive Codex Skill that saves JS, CSS, WebAssembly, fonts, and optionally approved images naturally loaded by a visible Chrome session.

The operator controls the visible browser. Codex discovers hosts, manages the collector, checks risks, audits runs, and merges the final output. It does not automate clicks, inspect the DOM, execute page scripts, enumerate chunks, probe sourcemaps, replay URLs, or save HTML/API bodies.

## Quick Start

```text
Use $codex-cdp-static-assets-skill for a passive, low-intrusion capture of naturally loaded static assets.

Page: https://workshop.example.com/...
Case ID: SEC-2026-001
I will control visible Chrome. Start with host discovery because I do not know the CDN.
Authorization permits editing and autosave in a dedicated test module, but not publishing, actions, workflows, exports, permission changes, or production writeback.
Record cumulative totals without a hard cap; keep a 50 MiB per-file limit.
Wait for my confirmation at each stage.
```

You do not need to know the CDN in advance. Discovery records naturally observed host metadata without reading response bodies. Exact candidates enter strict Scope only after approval.

## Install

```bash
npx skills add https://github.com/501981732/codex-cdp-static-assets-skill \
  --skill codex-cdp-static-assets-skill \
  --agent codex \
  --global \
  --yes
```

Start a new Codex task after installation, then invoke `$codex-cdp-static-assets-skill`.

Requires Node.js 22 or later and Chrome/Chromium with a loopback CDP endpoint.

## Authorization

Record the case ID, test account, page, time window, asset types, owner traffic ceiling, and stop contact. Use a dedicated Workshop module and synthetic data.

Component addition may autosave. Written authorization must explicitly cover module/page creation, edits, and autosave. Publishing, actions, workflows, exports, deletes, permission changes, and production writeback remain forbidden unless separately approved.

## Simple Workflow

### 1. Discover once

First log in normally and open the empty Workshop in the dedicated Chrome profile. After Codex starts Discovery, manually refresh the visible page and perform representative base navigation. Codex then reviews:

- `observed-network-hosts.json`
- `observed-hosts.json`
- `scope-candidates.json`

Candidates are not approval. Review exact hosts once with the owner or SOC, then build the strict Scope. Pause only when a later component naturally exposes a new host.

### 2. Capture the strict baseline

Codex starts strict capture with `P0:baseline` and the shared ledger. Refresh or reopen the empty page through visible Chrome, then let it settle.

Run the baseline classification gate before creating many component pages:

- **Preloaded:** many widget/component/plugin bundles already appear. Stop bulk additions, inventory offline, and optionally validate 1-3 representatives.
- **Lazy:** mainly shell assets appear. Continue with lazy-load batches.

### 3. Capture batches only when lazy

Group about 5-10 related components per page. Keep one collector running for the whole batch, including edit/configuration and preview/runtime states. Do not restart it between components.

Use one marker per batch by default. Component-level markers are optional for important ambiguous mappings.

### 4. Audit and merge

Audit every run, reuse one ledger, and inspect risk events before continuing. Merge once at the end by SHA-256, then audit the merged directory.

Suggested operator checkpoints:

```text
Logged in and empty Workshop open
Discovery refresh complete
Approve all candidates
Strict baseline complete
P1 complete
P2 complete
All complete
```

## Cache Choice

The lowest-intrusion default is same-profile capture accepts body-unavailable gaps after discovery. Record cached-body or empty-`304` gaps; never refetch them.

When body completeness is required, a fresh capture profile requires owner approval. Retire the discovery profile, log in normally with one new dedicated profile, and run only the approved strict baseline. A second login may receive additional account review, so this is an exception.

Never clear cache, disable cache, bypass Service Workers, transfer cookies, or replay resource URLs.

## Stop Conditions

Stop without automatic retry on `401`, `403`, `429`, repeated `5xx`, CAPTCHA/MFA, logout, account warning, an unapproved host, an unexpected write, owner traffic/time exhaustion, or an owner/SOC instruction.

If a new exact host appears, approve it and retry only the affected batch or component. Do not repeat completed work or add broad CDN wildcards.

## Output

- Deduplicated JS, CSS, WASM, fonts, and optional approved images
- `manifest.ndjson` with redacted URLs, hashes, sizes, targets, and markers
- One cumulative `task-ledger.ndjson`
- `risk-events.ndjson`, `invalid-assets.ndjson`, and `asset-audit.json`
- `merge-summary.json` and a coverage report

The result contains observed deployed artifacts, not original source, backend code, unauthorized roles, or untriggered branches.

## Commands

```bash
node skills/codex-cdp-static-assets-skill/scripts/capture-static-assets.mjs \
  --mode discover --scope ./discovery-scope.json --output ./host-discovery

node skills/codex-cdp-static-assets-skill/scripts/capture-static-assets.mjs \
  --mode capture --scope ./capture-scope.json \
  --endpoint http://127.0.0.1:9222 \
  --ledger ./task-ledger.ndjson --output ./capture-run-1

node skills/codex-cdp-static-assets-skill/scripts/audit-capture.mjs ./capture-run-1

node skills/codex-cdp-static-assets-skill/scripts/merge-captures.mjs \
  --output ./capture-merged ./capture-run-1 ./capture-run-2
```

`maxAssets: 0` and `maxTotalMiB: 0` disable retained-body hard stops, not browser traffic controls. Keep a nonzero per-resource guard and follow the owner's request, traffic, and time ceiling.

## Validation

```bash
node --test skills/codex-cdp-static-assets-skill/scripts/*.test.mjs
python3 /path/to/skill-creator/scripts/quick_validate.py \
  skills/codex-cdp-static-assets-skill
```

## License

[MIT](LICENSE)
