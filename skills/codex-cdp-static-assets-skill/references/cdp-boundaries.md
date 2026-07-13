# CDP Passive-Capture Boundaries

## Allowed operations

Use only observation and response-body access tied to an existing request:

| Purpose | CDP method or event |
|---|---|
| Attach targets | `Target.getTargets`, `Target.attachToTarget`, `Target.setAutoAttach` |
| Observe requests | `Network.requestWillBeSent` |
| Observe responses | `Network.responseReceived`, `Network.loadingFinished`, `Network.loadingFailed` |
| Read an observed body | `Network.getResponseBody` with that event's `requestId` |

`Network.getResponseBody` reads the browser's buffered response. It does not issue another HTTP request. Decode `base64Encoded` bodies and calculate a local SHA-256. Persist only selected response metadata; never persist Cookie, Authorization, Set-Cookie, POST bodies, or raw signed query values.

## Prohibited operations

Do not add any operation that creates, changes, or replays traffic:

- `Network.loadNetworkResource`
- `Network.setCacheDisabled`
- `Network.setBypassServiceWorker`
- `Page.navigate` or `Page.reload`
- page-context `fetch`, XHR, dynamic script/link injection, or `Runtime.evaluate` for retrieval
- Cache Storage enumeration or cached-response export
- URL guessing, chunk-ID enumeration, directory scanning, or sourcemap probing
- cookie/token extraction or replay outside the attached browser
- request interception used to alter headers, referer, origin, signatures, or responses

Do not use `Debugger.getScriptSource` or CSS-domain extraction by default. They can collect runtime-generated material that is broader than a static network-resource inventory. Add them only when the written scope explicitly covers runtime source and the collection plan records that distinction.

## Cache semantics

- Attach before the approved page load; CDP has no historical Network event stream.
- Preserve normal cache and Service Worker behavior.
- A disk-cache or Service-Worker response may still expose a body through `Network.getResponseBody`; save it when available.
- If the body is unavailable, keep URL metadata and the error. Never compensate with an active request.
- Use a fresh dedicated profile once when a cold run is approved. Do not clear cache repeatedly.

## Data handling

Redact all query values and URL fragments in manifests. Store resource content under `assets/<kind>/<sha256>.<ext>` and keep component/scenario markers in a separate event stream. Restrict output permissions because production bundles can still contain internal endpoints, identifiers, and implementation details.
