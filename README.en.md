# Capture Static Assets with CDP

[简体中文](README.md)

An authorization-first Codex skill and Node.js collector for recording static assets that Chrome naturally loads. It captures JavaScript, CSS, WebAssembly, and fonts through Chrome DevTools Protocol (CDP) without replaying URLs, disabling cache, probing source maps, or extracting browser credentials.

## What It Does

- Runs a **discovery** pass that records metadata for every naturally observed network host, classifies static and network-only hosts, and never reads response bodies.
- Requires an explicit reviewed scope before **capture** reads any response body.
- Generates an unapproved `scope-candidates.json` for one batch review instead of serial host prompts.
- Records count and byte usage across continuation runs with an append-only ledger; hard cumulative limits are optional while the per-resource guard remains.
- Merges run directories offline by SHA-256 for a deduplicated delivery.
- Detects Workshop Build IDs in already saved JavaScript and rejects known cross-build merges.
- Reads only completed browser requests with `Network.getResponseBody`.
- Attaches to pages, iframes, workers, shared workers, and service workers.
- Stores accepted assets by locally calculated SHA-256.
- Rejects empty bodies, all-zero placeholders, HTML returned as JS/CSS, invalid WASM/font signatures, and configured budget overruns.
- Audits a completed output directory offline.

This tool is designed for environments where you have written authorization and need auditable, low-impact evidence collection. It is not an evasion, scraping, credential replay, source-map discovery, or chunk-enumeration tool.

## Requirements

- Node.js 22 or later
- Google Chrome or Chromium with a loopback-only remote-debugging endpoint
- A dedicated browser profile and an authorized test account

## Install as a Codex Skill

```bash
npx skills add https://github.com/501981732/codex-cdp-static-assets-skill \
  --skill codex-cdp-static-assets-skill \
  --agent codex \
  --global \
  --yes
```

The installer discovers the complete skill under `skills/codex-cdp-static-assets-skill/`, including `SKILL.md`, scripts, and references. Start a new Codex conversation and invoke it with `$codex-cdp-static-assets-skill`.

## Default Operator Model

- The operator uses only the visible Chrome UI to create the test module, add widgets, and open configuration or preview states.
- Codex starts and monitors the collector, enters markers, stops, audits, and merges runs.
- The operator reports short checkpoints in chat and does not need to type terminal commands.
- The collector does not click, inspect the DOM, execute page scripts, save raw HTML, or retain API bodies.

## Workflow

1. Start visible Chrome with an isolated profile, log in, close unrelated tabs, and leave one `about:blank` tab.
2. Start discovery with a page-only scope for the empty Workshop shell and baseline navigation, then open the target in that same visible tab.
3. Review the baseline network inventory and approve one exact-host scope batch.
4. Put static hosts in `assetHosts` and approved API, identity, telemetry, and image hosts in `approvedNetworkHosts`.
5. The operator exercises visible widgets in small batches while Codex sets request-time markers. Review and retry only the current widget if a new host appears.
6. Reuse one `--ledger` for every strict continuation run. Set `maxAssets` and `maxTotalMiB` to `0` for record-only tracking.
7. Audit each run, merge runs offline, and audit the deduplicated delivery.

Start Chrome:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.cdp-authorized-test-profile"
```

Example discovery scope, `discovery-scope.json`:

```json
{
  "caseId": "SEC-2026-001",
  "pageHosts": ["workshop.example.com"],
  "types": ["js", "css", "wasm", "font"],
  "limits": { "maxAssets": 0, "maxTotalMiB": 0, "maxAssetMiB": 50 },
  "stopOnStatuses": [401, 403, 429]
}
```

Discover every natural network host without reading bodies:

```bash
node skills/codex-cdp-static-assets-skill/scripts/capture-static-assets.mjs \
  --mode discover \
  --scope ./discovery-scope.json \
  --endpoint http://127.0.0.1:9222 \
  --output ./host-discovery
```

After batch review, use a capture scope containing exact `assetHosts` and `approvedNetworkHosts`:

```bash
node skills/codex-cdp-static-assets-skill/scripts/capture-static-assets.mjs \
  --mode capture \
  --scope ./capture-scope.json \
  --endpoint http://127.0.0.1:9222 \
  --ledger ./task-ledger.ndjson \
  --output ./authorized-assets-run-1

node skills/codex-cdp-static-assets-skill/scripts/audit-capture.mjs ./authorized-assets-run-1

node skills/codex-cdp-static-assets-skill/scripts/merge-captures.mjs \
  --output ./authorized-assets-merged \
  ./authorized-assets-run-1 ./authorized-assets-run-2

node skills/codex-cdp-static-assets-skill/scripts/audit-capture.mjs ./authorized-assets-merged
```

See [scope configuration](skills/codex-cdp-static-assets-skill/references/scope-config.md), [Workshop runbook](skills/codex-cdp-static-assets-skill/references/workshop-runbook.md), and [CDP boundaries](skills/codex-cdp-static-assets-skill/references/cdp-boundaries.md) for the full operating model.

## Output

- `observed-hosts.json`: discovery-only host evidence
- `observed-network-hosts.json`: complete network-host evidence including API, identity, telemetry, and image requests
- `scope-candidates.json`: exact unapproved candidates for batch review
- `task-ledger.ndjson`: cumulative retained-resource count and byte evidence
- `manifest.ndjson`: accepted assets and local content hashes
- `invalid-assets.ndjson`: rejected content or budget events
- `risk-events.ndjson`: scope and status-stop events
- `asset-audit.json`: offline integrity report
- `summary.json`: run-level outcome, counters, and Workshop Build IDs detected in saved JavaScript
- `merge-summary.json`: deduplicated multi-run summary; known Build mismatches are rejected

## Validation

```bash
node --test \
  skills/codex-cdp-static-assets-skill/scripts/capture-static-assets.test.mjs \
  skills/codex-cdp-static-assets-skill/scripts/audit-capture.test.mjs \
  skills/codex-cdp-static-assets-skill/scripts/merge-captures.test.mjs
```

## License

[MIT](LICENSE)
