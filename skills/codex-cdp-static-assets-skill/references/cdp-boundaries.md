# CDP Automation Boundaries

## Allowed operations

Only after the single consolidated authorization, use these Chrome DevTools MCP operations on the unique approved page:

| Purpose | MCP operation |
|---|---|
| Enumerate/select the exact target | `list_pages`, `select_page` |
| Read visible UI state | `take_snapshot` |
| Retain authorized visible-state evidence | `take_screenshot` with a unique Widget/panel `uid` and PNG `filePath` under the capture run |
| Reload only the exact approved page | `navigate_page` with reload |
| Use visible controls | `click`, `drag`, `fill`, `press_key`, `wait_for` |
| Inspect already observed requests | `list_network_requests` |
| Read one completed response | `get_network_request` with `reqid` and `responseFilePath` |

Visible actions are restricted to the approved Workshop Module: Add Widget, deterministic capture-page creation, authorized Module-variable handling, canvas/catalog scrolling, widget configuration, autosave, authorized publish, development preview, and explicitly authorized element-level state screenshots.

## Prohibited operations

Never use `evaluate_script`. Never set `requestFilePath`.

- Never fetch, replay, or guess a resource URL; never refetch a missing body.
- Never inspect hidden DOM state, execute page-context JavaScript, expose hidden routes, scan directories, guess/fetch Chunk URLs, or probe sourcemaps. Local post-processing may record IDs literally present in an already retained baseline registry body.
- Never clear/disable cache, bypass a Service Worker, intercept traffic, or alter headers, signatures, origin, referer, fingerprint, requests, or responses.
- Never extract or transfer cookies, Authorization values, passwords, request bodies, browser profiles, or unrelated tab metadata.
- Never use full-page screenshots or retain accessibility/DOM snapshots. If the Widget or panel cannot be uniquely targeted, omit the screenshot instead of widening the evidence scope.
- Never run actions/workflows, export, change permissions, write business data, or inspect request payloads. Module variables may be handled only when `allowModuleVariables: true` is in the approved Scope; publish is allowed only when `allowPublish: true` is in the approved Scope.

## Response-body rule

`list_network_requests` and `get_network_request` inspect Chrome's current local Network record and must not cause a new HTTP request. Ignore `chrome-extension://` local browser requests without body access; inspect exact HTTP/HTTPS hosts and stop statuses before body access. Stage a response only below the runtime value of `os.tmpdir()`, import immediately, and request importer cleanup.

If Chrome returns no body, append `body-unavailable`. A local staging-path failure may retry the same request ID after correcting the local path; a true browser body gap is final for that observation.

## HTML rule

HTML is eligible only for an approved `Document` response with exact `text/html` or `application/xhtml+xml` MIME essence, a completed bodyless `GET`, status 200–399, an exact approved host, and `top-level` or `widget-iframe` context. XHR/fetch/API HTML is excluded.

## UI and identity rule

All mutation must be observable through snapshots and visible controls. Never infer success from a click alone. Verify the visible widget instance before continuing. If the Add Widget result or resume target is ambiguous, stop rather than adding again.

Canonical widget identity requires a visible label; visible category and version/type refine it when available. If a key is still indistinguishable, skip only that key and retain the ambiguity record. Accessibility snapshots stay in memory; state files retain only canonical keys, ambiguity keys, counters, and request ID/status fingerprints.

## Stop conditions

Ignore `chrome-extension://` local browser noise without body reads. Stop before further body reads or UI mutation on an unknown HTTP/HTTPS host, page/Module drift, `401`, `403`, `429`, repeated `5xx`, CAPTCHA/MFA, logout, account warning, unexpected write, unapproved variable handling, traffic/time ceiling, or owner/SOC instruction. A Widget with no permitted compatible variable path is a component-level partial result and does not stop catalog traversal.

## Data handling

Redact every query value and URL fragment. Preserve SHA-256, size, type, status, marker, source run, and structured failure evidence. First-observed attribution excludes baseline assets and is globally assigned only to the earliest non-baseline widget marker.
