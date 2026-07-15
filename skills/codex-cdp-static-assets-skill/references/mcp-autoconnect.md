# Default Chrome autoConnect

Use this backend when login works only in the user's normal Chrome profile.

## Requirements

- Google Chrome 144 or later
- Node.js LTS
- Chrome DevTools MCP network tools available to Codex
- Explicit operator approval in Chrome

Install or replace the MCP server:

```bash
codex mcp remove chrome-devtools
codex mcp add chrome-devtools -- \
  npx -y chrome-devtools-mcp@latest \
  --autoConnect \
  --no-usage-statistics \
  --no-performance-crux
```

Restart Codex after changing MCP configuration. Do not run this command when the required MCP tools are already available.

In the already signed-in default Chrome:

1. Open `chrome://inspect/#remote-debugging`.
2. Enable remote debugging.
3. Keep the approved target page open.
4. Approve the Chrome connection dialog only when Codex initiates the MCP connection.

Chrome DevTools MCP can access every open window in the selected default profile. Close unrelated sensitive pages when practical. Codex must select only the unique page whose hostname matches `pageHosts`, must not inspect other page contents, and must not persist their URLs.

## Discovery

1. Use `list_pages`, then `select_page` for the unique approved target. Selection is not navigation.
2. Ask the operator to refresh and perform the approved representative UI actions.
3. Call `list_network_requests` for the selected page. Use `includePreservedRequests: true` only when the approved flow crossed a navigation; it preserves at most the recent navigation history exposed by the tool.
4. Review all observed request hosts and statuses before reading any response body.
5. Record exact static hosts as candidate `assetHosts` and API/telemetry dependencies as candidate `approvedNetworkHosts`. Discovery does not call `get_network_request`.

Never infer approval from a CDN name. Obtain one batch approval for exact candidates.

## Strict capture

Attach before the operator refreshes or adds components. At each checkpoint:

First resolve the only permitted staging root from the runtime rather than assuming `/tmp` or a workspace directory:

```bash
node -p 'require("node:os").tmpdir()'
```

1. Call `list_network_requests` for all resource types to check hosts and stop statuses.
2. Stop before body reads if the page left `pageHosts`, an unknown host appeared, or a stop condition is present.
3. Filter the same observed list to completed `script`, `stylesheet`, `font`, and approved WASM/image candidates.
4. Before the bulk pass, use one small approved 200 JS/CSS response as a canary. Call `get_network_request` with only `reqid` and an absolute `responseFilePath` under the resolved `os.tmpdir()` staging directory. Continue only when the returned object has `isError !== true`, the saved file is non-empty, and the importer successfully hashes and deletes it.
5. Use the same staging directory for each remaining approved request ID. Never set `requestFilePath`.
6. Inspect the returned MCP object, not just thrown exceptions. If `isError === true` describes a local path/save/tool failure, fix staging and retry the same request ID; this is local inspection and creates no network request. If Chrome reports the response body itself is unavailable, record `body-unavailable`; do not reload or replay the URL.
7. Import a saved response immediately, then delete the staging body:

```bash
node scripts/import-mcp-response.mjs \
  --scope ./capture-scope.json \
  --output ./capture-run-1 \
  --ledger ./task-ledger.ndjson \
  --staging-root '/actual/value/from/node-os-tmpdir' \
  --body '/actual/value/from/node-os-tmpdir/cdp-static-assets/REQ.network-response' \
  --url 'https://approved.example/chunk.js?build=123' \
  --status 200 \
  --resource-type script \
  --mime-type application/javascript \
  --request-id REQ \
  --marker P1:charts \
  --delete-body
```

Pass the observed URL only to the local importer. Its stored manifest redacts every query value and removes fragments. Shell-quote the URL. Do not save request headers or request bodies.

To record an unavailable body, omit `--body` and `--delete-body` while keeping the other metadata.

The importer refuses to delete a body outside `--staging-root`, and a requested cleanup failure is fatal. Inspect only the target MCP configuration section when diagnosing connection setup; never print whole configuration or environment files that may contain unrelated secrets.

## Behavioral limits

- `list_network_requests` is a snapshot of the selected page's local Network record, not a continuous event callback.
- Ingest a batch before navigating away; do not rely on old entries remaining indefinitely.
- Reading a completed response body through MCP is local browser inspection and should not issue another server request.
- Body reads can still fail because of cache eviction, renderer lifecycle, opaque responses, or tool limits. Record the gap.
- Default-profile access lets the MCP enumerate all windows in that profile. Minimize open sensitive pages and keep target selection exact.

After each run:

```bash
node scripts/audit-capture.mjs ./capture-run-1
```

Merge only after all approved batches are complete.

The merged delivery is organized as `assets/<exact-host>/<original-url-path>`. SHA-256 remains in `metadata/manifest.ndjson`; it is not used to create a second set of hash-named files.
