# Default Chrome autoConnect

## Requirements

- Google Chrome 144 or later
- Node.js LTS
- Chrome DevTools MCP with browser snapshot, visible input, and Network tools
- Explicit Chrome connection approval

Configure only when the MCP is missing:

```bash
codex mcp remove chrome-devtools
codex mcp add chrome-devtools -- \
  npx -y chrome-devtools-mcp@latest \
  --autoConnect \
  --no-usage-statistics \
  --no-performance-crux
```

Restart Codex after configuration. In the already signed-in default Chrome, open `chrome://inspect/#remote-debugging`, enable remote debugging, keep the approved Workshop page open, and approve Chrome's connection dialog when Codex connects.

MCP may enumerate every window in that profile. Close unrelated sensitive pages where practical. Codex selects only the unique page whose hostname matches `pageHosts`, does not inspect other page contents, and never persists their metadata.

If Chrome is too old, required tools are missing, or enterprise policy blocks access, pause. Do not launch a replacement profile, copy credentials, or work around login controls.

## Metadata discovery

Before the single consolidated authorization:

1. `list_pages` and `select_page` the exact target.
2. `take_snapshot` only to verify the approved Module and visible automation entry points.
3. `list_network_requests` to collect exact host/status/resource metadata without response bodies.
4. Present all exact host candidates and intended visible actions for approval.

Do not infer trust from a CDN suffix. Discovery candidates remain unapproved until the user accepts the Scope.

## Visible automation after approval

Use snapshots before and after each visible action. `click`, `drag`, `fill`, `press_key`, and `wait_for` may operate only the authorized Module and state matrix. When the Scope enables `captureStateScreenshots`, use `take_screenshot` only with the unique visible Widget/panel `uid` and a PNG path under the current capture run. Exact-page reload may use `navigate_page` reload; do not navigate to a newly constructed resource URL.

Never use page-script evaluation. Accessibility snapshots are transient inputs, not output artifacts. Store only canonical widget keys and minimal progress counters.

## Network stabilization

`list_network_requests` is a snapshot, not a callback. At every widget state:

1. Inspect the complete list for unknown hosts and stop statuses before any body read.
2. Compare only request IDs and statuses.
3. Treat the first observation as baseline and require two more identical observations.
4. Any new request or status change resets the unchanged counter.

Example:

```bash
node scripts/automation-policy.mjs network-update \
  --state ./capture-run-1/network-state.json \
  --requests-json '[{"requestId":"1","status":200}]'
```

## Response staging

Resolve the staging root instead of assuming `/tmp`:

```bash
node -p 'require("node:os").tmpdir()'
```

Use one small approved 200 JS/CSS response as a canary. Call `get_network_request` with only `reqid` and an absolute `responseFilePath` under that staging root. Continue only when the MCP result is not an error, the file is non-empty, and local import/hash/delete succeeds.

Import a static response:

```bash
node scripts/import-mcp-response.mjs \
  --scope ./capture-scope.json \
  --output ./capture-run-1 \
  --ledger ./task-ledger.ndjson \
  --staging-root '/actual/os/tmpdir/cdp-static-assets' \
  --body '/actual/os/tmpdir/cdp-static-assets/REQ.network-response' \
  --url 'https://approved.example/chunk.js?build=123' \
  --status 200 \
  --resource-type script \
  --mime-type application/javascript \
  --request-id REQ \
  --marker widget:object-table:a1b2c3d4:editor-mounted \
  --delete-body
```

For approved document HTML, also pass:

```text
--request-method GET --request-has-body false --document-context top-level
```

Use `widget-iframe` only when the visible response belongs to an approved widget iframe. Missing HTML metadata is ignored. XHR/fetch HTML is never imported.

If Chrome cannot provide a body, omit `--body` and `--delete-body` to record `body-unavailable`. Do not reload, replay, or retrieve the URL elsewhere. A local file-path failure may retry the same request ID only after fixing the staging path because that does not create network traffic.

## Privacy and cache semantics

Preserve normal cache and Service Worker behavior. Never clear cache, disable cache, bypass Service Workers, save request headers/bodies, or transfer the browser profile. Redact query values/fragments through the importer. Ingest each state before navigation because older Network records may disappear.
