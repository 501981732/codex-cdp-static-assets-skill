# Scope Configuration

Use a JSON Scope file for every Workshop capture. It is both the execution boundary and the audit record.

## Discovery scope

Use only the page host. Discovery records static resource host metadata, never response bodies.

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

Run `--mode discover`, operate the approved page normally, then review `observed-hosts.json`. This is evidence gathering, not automatic trust. It must not save bodies, enumerate URLs, or retry a resource.

## Capture scope

Add each approved CDN to `assetHosts`. `pageHosts` are automatically eligible to serve static assets. Use `approvedNetworkHosts` only for separately approved endpoints needed for normal page operation but whose bodies must never be saved.

```json
{
  "caseId": "SEC-2026-001",
  "pageHosts": ["workshop.example.com"],
  "assetHosts": ["cdn.workshop.example.com"],
  "approvedNetworkHosts": ["api.workshop.example.com"],
  "types": ["js", "css", "wasm", "font"],
  "limits": {
    "maxAssets": 500,
    "maxTotalMiB": 500,
    "maxAssetMiB": 50
  },
  "stopOnStatuses": [401, 403, 429]
}
```

Do not use `*.vendor.com`, `*.cloudfront.net`, or an allow-any option as a shortcut. If a new static host appears in capture mode, stop, review the evidence, and update the Scope before the next approved run.

## Outputs

- `observed-hosts.ndjson` and `observed-hosts.json`: discovery-only host evidence
- `manifest.ndjson`: accepted assets with local content hash
- `invalid-assets.ndjson`: rejected body and budget events
- `risk-events.ndjson`: status or scope failures
- `asset-audit.json`: offline revalidation of saved assets
