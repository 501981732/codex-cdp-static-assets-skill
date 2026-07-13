# Capture Static Assets with CDP

[简体中文](README.md)

An authorization-first Codex skill and Node.js collector for recording static assets that Chrome naturally loads. It captures JavaScript, CSS, WebAssembly, and fonts through Chrome DevTools Protocol (CDP) without replaying URLs, disabling cache, probing source maps, or extracting browser credentials.

## What It Does

- Runs a **discovery** pass that records metadata for every naturally observed network host, classifies static and network-only hosts, and never reads response bodies.
- Requires an explicit reviewed scope before **capture** reads any response body.
- Generates an unapproved `scope-candidates.json` for one batch review instead of serial host prompts.
- Enforces count and byte limits across continuation runs with an append-only ledger.
- Merges run directories offline by SHA-256 for a deduplicated delivery.
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
  --skill capture-static-assets-cdp \
  --agent codex \
  --global \
  --yes
```

The installer discovers the complete skill under `skills/capture-static-assets-cdp/`, including `SKILL.md`, scripts, and references. Start a new Codex conversation and invoke it with `$capture-static-assets-cdp`.

## Workflow

1. Start visible Chrome with an isolated profile, log in, close unrelated tabs, and leave one `about:blank` tab.
2. Start discovery with a page-only scope, then open the target in that same visible tab.
3. Review the complete network inventory and approve one exact-host scope batch.
4. Put static hosts in `assetHosts` and approved API, identity, telemetry, and image hosts in `approvedNetworkHosts`.
5. Reuse one `--ledger` across strict continuation runs while retaining the original total limits.
6. Audit each run, merge runs offline, and audit the deduplicated delivery.

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
node skills/capture-static-assets-cdp/scripts/capture-static-assets.mjs \
  --mode discover \
  --scope ./discovery-scope.json \
  --endpoint http://127.0.0.1:9222 \
  --output ./host-discovery
```

After batch review, use a capture scope containing exact `assetHosts` and `approvedNetworkHosts`:

```bash
node skills/capture-static-assets-cdp/scripts/capture-static-assets.mjs \
  --mode capture \
  --scope ./capture-scope.json \
  --endpoint http://127.0.0.1:9222 \
  --ledger ./task-ledger.ndjson \
  --output ./authorized-assets-run-1

node skills/capture-static-assets-cdp/scripts/audit-capture.mjs ./authorized-assets-run-1

node skills/capture-static-assets-cdp/scripts/merge-captures.mjs \
  --output ./authorized-assets-merged \
  ./authorized-assets-run-1 ./authorized-assets-run-2

node skills/capture-static-assets-cdp/scripts/audit-capture.mjs ./authorized-assets-merged
```

See [scope configuration](skills/capture-static-assets-cdp/references/scope-config.md), [Workshop runbook](skills/capture-static-assets-cdp/references/workshop-runbook.md), and [CDP boundaries](skills/capture-static-assets-cdp/references/cdp-boundaries.md) for the full operating model.

## Output

- `observed-hosts.json`: discovery-only host evidence
- `observed-network-hosts.json`: complete network-host evidence including API, identity, telemetry, and image requests
- `scope-candidates.json`: exact unapproved candidates for batch review
- `task-ledger.ndjson`: cumulative task budget evidence
- `manifest.ndjson`: accepted assets and local content hashes
- `invalid-assets.ndjson`: rejected content or budget events
- `risk-events.ndjson`: scope and status-stop events
- `asset-audit.json`: offline integrity report
- `summary.json`: run-level outcome and counters
- `merge-summary.json`: deduplicated multi-run summary

## Validation

```bash
node --test \
  skills/capture-static-assets-cdp/scripts/capture-static-assets.test.mjs \
  skills/capture-static-assets-cdp/scripts/audit-capture.test.mjs \
  skills/capture-static-assets-cdp/scripts/merge-captures.test.mjs
```

## License

[MIT](LICENSE)
