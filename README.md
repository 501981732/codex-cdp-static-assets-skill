# Capture Static Assets with CDP

[简体中文](README.zh-CN.md)

An authorization-first Codex skill and Node.js collector for recording static assets that Chrome naturally loads. It captures JavaScript, CSS, WebAssembly, and fonts through Chrome DevTools Protocol (CDP) without replaying URLs, disabling cache, probing source maps, or extracting browser credentials.

## What It Does

- Runs a **discovery** pass that records naturally observed static-resource hosts without reading response bodies.
- Requires an explicit reviewed scope before **capture** reads any response body.
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
git clone https://github.com/501981732/capture-static-assets-cdp.git \
  "$HOME/.codex/skills/capture-static-assets-cdp"
```

Then invoke it in Codex with `$capture-static-assets-cdp`.

## Workflow

1. Start visible Chrome with an isolated profile and local CDP endpoint.
2. Run discovery using a page-only scope.
3. Review `observed-hosts.json` and obtain approval for every static CDN.
4. Add approved CDNs to a strict capture scope.
5. Start capture before normal visible UI activity.
6. Run the offline audit after stopping.

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

Discover hosts without reading bodies:

```bash
node scripts/capture-static-assets.mjs \
  --mode discover \
  --scope ./discovery-scope.json \
  --endpoint http://127.0.0.1:9222 \
  --output ./host-discovery
```

After review, use a capture scope containing exact `assetHosts` and run:

```bash
node scripts/capture-static-assets.mjs \
  --mode capture \
  --scope ./capture-scope.json \
  --endpoint http://127.0.0.1:9222 \
  --output ./authorized-assets

node scripts/audit-capture.mjs ./authorized-assets
```

See [scope configuration](references/scope-config.md), [Workshop runbook](references/workshop-runbook.md), and [CDP boundaries](references/cdp-boundaries.md) for the full operating model.

## Output

- `observed-hosts.json`: discovery-only host evidence
- `manifest.ndjson`: accepted assets and local content hashes
- `invalid-assets.ndjson`: rejected content or budget events
- `risk-events.ndjson`: scope and status-stop events
- `asset-audit.json`: offline integrity report
- `summary.json`: run-level outcome and counters

## Validation

```bash
node --test scripts/capture-static-assets.test.mjs scripts/audit-capture.test.mjs
```

## License

[MIT](LICENSE)
