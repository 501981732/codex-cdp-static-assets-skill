# MCP Passive-Capture Boundaries

## Allowed operations

Use only the selected page's existing Network record:

| Purpose | MCP tool |
|---|---|
| Enumerate open pages | `list_pages` |
| Select the approved page | `select_page` |
| Inspect observed requests | `list_network_requests` |
| Read one completed response | `get_network_request` with `reqid` and `responseFilePath` |

`get_network_request` reads Chrome's buffered response. It must not issue another HTTP request. Import the staged body with `import-mcp-response.mjs`, calculate a local SHA-256, and persist only selected response metadata. Never set `requestFilePath` or retain Cookie, Authorization, Set-Cookie, POST bodies, or raw signed query values.

## Prohibited operations

- Browser navigation, reload, automated clicks, or page-context script execution
- URL fetching, replay, guessing, chunk-ID enumeration, directory scanning, or sourcemap probing
- Cache clearing, cache disabling, Service Worker bypass, or request interception
- Header, referer, origin, signature, fingerprint, or response alteration
- Cookie, token, password, request-body, or profile extraction and transfer
- DOM, Cache Storage, debugger source, or CSS-domain extraction for this inventory

## Cache semantics

- Select the approved page before the operator refreshes it.
- Preserve normal cache and Service Worker behavior.
- A cached response may expose a body; save it only when Chrome already has it.
- If the body is unavailable, record the error. Never compensate with an active request or another browser session.
- Ingest each batch before navigating away because the MCP Network record is not an indefinite event archive.

## Default Chrome privacy

- Chrome 144+ and explicit permission at `chrome://inspect/#remote-debugging` are required.
- MCP can enumerate all windows in the selected default profile. Close unrelated sensitive pages when practical.
- Select only the unique top-level page matching `pageHosts`; never persist unrelated page URLs, titles, or metadata.
- If the MCP tools are unavailable or blocked by enterprise policy, pause and report the prerequisite.

## Data handling

Redact all query values and URL fragments in manifests. Store resource content under `assets/<kind>/<sha256>.<ext>` and keep component/scenario markers separately. Restrict output permissions because deployed bundles can still contain internal endpoints, identifiers, and implementation details.
