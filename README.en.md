# Codex CDP Static Asset Capture Skill

[中文](README.md)

An authorization-first, passive Codex Skill that saves JS, CSS, WebAssembly, fonts, and optional images already loaded by a visible Chrome page. It produces redacted manifests, hashes, a cumulative ledger, and audit reports.

The operator handles login, refresh, component addition, and preview. Codex only inspects the selected page's local Network record and completed response bodies. It does not automate clicks, enumerate chunks, probe sourcemaps, replay URLs, change cache or Service Workers, or transfer credentials.

## Install the Skill

```bash
npx skills add https://github.com/501981732/codex-cdp-static-assets-skill \
  --skill codex-cdp-static-assets-skill \
  --agent codex \
  --global \
  --yes
```

Start a new Codex task after installation or update.

## Reuse the Default Chrome Login

The target account keeps its authenticated state in the user's normal Chrome and connects through the official Chrome 144+ `autoConnect` path.

One-time MCP setup:

```bash
codex mcp remove chrome-devtools
codex mcp add chrome-devtools -- \
  npx -y chrome-devtools-mcp@latest \
  --autoConnect \
  --no-usage-statistics \
  --no-performance-crux
```

Restart Codex. In the already signed-in default Chrome:

1. Open `chrome://inspect/#remote-debugging`.
2. Enable remote debugging.
3. Open the authorized target page.
4. Approve Chrome's connection dialog when Codex connects.

`autoConnect` can access every window in the selected default profile. Close unrelated sensitive pages when practical. The Skill selects only the unique page matching the authorized hostname and does not persist other tabs.

If Chrome is below 144, the MCP tools are unavailable, or enterprise policy blocks the connection, the Skill pauses and reports the missing prerequisite. It does not launch or request another browser session, and never copies profiles, cookies, tokens, or passwords to bypass login controls.

## Quick Start

```text
Use $codex-cdp-static-assets-skill for a passive, low-intrusion capture of naturally loaded static assets.

Page: https://workshop.example.com/...
Case ID: SEC-2026-001
Reuse my current default Chrome login through autoConnect. I will control the visible page.
I do not know the CDN, so discover exact hosts first and do not approve them automatically.
Authorization permits editing and autosave in a dedicated test module, but not publishing, actions, workflows, exports, permission changes, or production writeback.
Wait for my confirmation at each stage.
```

## Workflow

1. Codex selects the unique approved page. The operator refreshes and performs representative actions. Codex calls `list_network_requests` for discovery without reading bodies.
2. Exact static and network dependency hosts receive one owner/SOC approval. No broad CDN wildcard is inferred.
3. For the strict baseline, Codex checks the full request list first. Unknown hosts, `401`, `403`, `429`, repeated `5xx`, or account warnings stop the run before body access.
4. For approved completed static requests, `get_network_request` writes only the response body to staging. A local importer validates Scope, type, size, and SHA-256. No URL is refetched. Missing bodies remain `body-unavailable`.
5. If the baseline is preloaded, stop bulk component addition. If it is lazy, capture related components in batches of about 5-10 and ingest each batch before navigating away.
6. Audit each run, reuse one ledger, merge once by SHA-256, and audit the merged output.

Suggested checkpoints:

```text
Logged in and empty Workshop open
Discovery refresh complete
Approve all candidates
Strict baseline complete
P1 complete
P2 complete
All complete
```

## Stop Conditions

Stop without automatic retry on `401`, `403`, `429`, repeated `5xx`, CAPTCHA/MFA, logout, account warnings, an unknown host, an unexpected write, owner traffic/time exhaustion, or owner/SOC instruction.

## Output

- Content-addressed JS, CSS, WASM, fonts, and optional images
- `manifest.ndjson` with redacted URLs, hashes, sizes, types, and markers
- One cumulative `task-ledger.ndjson`
- `risk-events.ndjson`, `invalid-assets.ndjson`, and `asset-audit.json`
- `merge-summary.json` for the final deduplicated result

The result contains observed deployed artifacts, not original source, backend code, unauthorized roles, or untriggered branches.

## Validation

```bash
node --test skills/codex-cdp-static-assets-skill/scripts/*.test.mjs
python3 /path/to/skill-creator/scripts/quick_validate.py \
  skills/codex-cdp-static-assets-skill
```

## License

[MIT](LICENSE)
