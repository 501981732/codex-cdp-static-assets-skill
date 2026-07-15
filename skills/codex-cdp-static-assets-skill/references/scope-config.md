# Scope Configuration

Use a JSON Scope file for every live session. It is both the execution boundary and the audit record.

## Written authorization

Record the case ID, test account, page host, time window, owner/SOC contact, allowed UI scenarios, permitted asset types, traffic ceiling, and stop conditions.

Component addition may autosave. Written scope must explicitly allow creating or editing the dedicated test module and that autosave. Unless separately approved, forbid publish, action, workflow, export, delete, permission-change, and production-writeback behavior.

## Discovery Scope

Start with only the page host. Discovery records naturally observed HTTP(S) and WebSocket host metadata; it never reads response bodies.

```json
{
  "caseId": "SEC-2026-001",
  "pageHosts": ["workshop.example.com"],
  "types": ["js", "css", "wasm", "font"],
  "limits": {
    "maxAssets": 0,
    "maxTotalMiB": 0,
    "maxAssetMiB": 50
  },
  "stopOnStatuses": [401, 403, 429]
}
```

After one representative discovery pass, review `observed-network-hosts.json`, `observed-hosts.json`, and `scope-candidates.json`. Candidates are evidence for one batch approval, never automatic trust.

## Capture Scope

Add exact approved static hosts to `assetHosts`. Page hosts may serve same-origin assets. Put separately approved normal page dependencies whose bodies must not be saved in `approvedNetworkHosts`.

```json
{
  "caseId": "SEC-2026-001",
  "pageHosts": ["workshop.example.com"],
  "assetHosts": ["cdn.workshop.example.com"],
  "approvedNetworkHosts": ["api.workshop.example.com"],
  "types": ["js", "css", "wasm", "font"],
  "limits": {
    "maxAssets": 0,
    "maxTotalMiB": 0,
    "maxAssetMiB": 50
  },
  "stopOnStatuses": [401, 403, 429]
}
```

Do not use broad CDN/vendor wildcards or allow-any. Stop on a new host and approve its exact hostname before a new run.

Reuse one append-only ledger for every strict run:

```bash
node scripts/capture-static-assets.mjs --mode capture \
  --scope ./capture-scope.json \
  --ledger ./task-ledger.ndjson \
  --output ./capture-run-1
```

Hard cumulative limits are optional. `0` disables a retained asset-count or total-byte stop, but the ledger still records decoded bodies and rejects a mismatched `caseId`. Keep a nonzero per-resource guard. Retention limits do not replace an owner-defined request, traffic, or time ceiling.

## Cache Decision

- Default Chrome: on Chrome 144+, prefer Chrome DevTools MCP `--autoConnect` with explicit approval at `chrome://inspect/#remote-debugging`. Select only the unique page matching `pageHosts`. The MCP can see all windows in the selected profile, so close unrelated sensitive pages when practical and never persist their metadata.
- Loopback fallback: use `capture-static-assets.mjs` only when an approved loopback endpoint already exists. Do not launch another profile automatically because port 9222 is absent.
- Both backends: accept body-unavailable gaps created by discovery or normal browser caching; record the gap and do not refetch.
- Exception: a fresh capture profile requires owner approval when body completeness is necessary. Do not transfer cookies, tokens, passwords, or profile files, and do not run both profiles together.
- Always: never clear cache, disable cache, bypass the Service Worker, or replay a resource URL.

## Outputs

- `observed-network-hosts.json`: all discovered network hosts
- `observed-hosts.json`: discovered static-resource hosts
- `scope-candidates.json`: exact unapproved asset and network-only candidates
- `task-ledger.ndjson`: cumulative retained-body usage
- `manifest.ndjson`: accepted assets and hashes
- `invalid-assets.ndjson`: rejected bodies and budget events
- `risk-events.ndjson`: status, target, and scope failures
- `asset-audit.json`: offline integrity results
- `merge-summary.json`: deduplicated delivery summary from `merge-captures.mjs`
- `summary.json`: run counters and detected Workshop Build IDs
