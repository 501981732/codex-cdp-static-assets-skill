# Workshop and Lazy-Component Runbook

## Goal

Collect production static assets naturally loaded while an authorized test account mounts and exercises approved component states. Optimize for auditable coverage, not stealth or theoretical completeness.

## Project layout

Create one dedicated test module with an empty baseline page plus 5-7 test pages, each containing roughly 8-10 related components:

| Batch | Typical content |
|---|---|
| P0 | Empty Workshop shell and navigation baseline |
| P1 | Layout, text, inputs, buttons, tabs |
| P2 | Tables, lists, object views, filters |
| P3 | Charts, maps, timelines, media |
| P4 | Dialogs, drawers, menus, actions |
| P5+ | Embeds, permissions, workflows, specialized components |

Use synthetic data. Avoid real customer or production records. Do not place all components on one page: it creates a burst, obscures attribution, and may still leave collapsed lazy states unmounted.

The operator controls the visible browser. Codex manages the collector, enters markers from the operator's chat checkpoints, checks status and stop conditions, and runs audits. The collector must not add components, click controls, inspect the DOM, or execute page code.

## Capture sequence

1. Log in before starting discovery with the dedicated profile. Close unrelated tabs and leave one `about:blank` tab after authentication.
2. Start `--mode discover` with a page-only Scope, then navigate that same visible tab to the approved empty Workshop page. Discover the baseline shell and representative navigation, not every widget.
3. Review `observed-network-hosts.json`, `observed-hosts.json`, and `scope-candidates.json`; obtain one batch approval for exact baseline static and network-only hosts, then write the strict capture Scope. Same-origin CAS paths need no separate CDN guess. If a later widget exposes a new host, stop and review it, then retry only that widget after approval.
4. Start strict capture with one shared `--ledger` before the approved page load. Mark `P0:baseline`, open the empty page visibly, and wait until no new static-resource requests appear for 3–5 seconds.
5. Open one batch and mark its page mount.
6. Before each component state, Codex enters a marker such as `mark P2:ObjectTable:filter-open` after the operator announces the checkpoint in chat.
7. The operator triggers only normal UI states: activate tabs, expand accordions, open dialogs, expose virtualized/viewport content, and wait for data-backed rendering. Cover edit/configuration and preview/runtime states without executing action, workflow, writeback, publish, or export behavior.
8. Wait for 3–5 seconds of static-resource quiet before the next marker. Use fixed, operator-reviewable pacing; do not add random jitter.
9. End after 8–10 components, inspect `risk-events.ndjson`, `invalid-assets.ndjson`, and ledger remaining budget, then continue only within the approved window.
10. Run `audit-capture.mjs` after every stop. Reuse the same ledger for approved continuation runs, then run `merge-captures.mjs` and audit the merged directory. Run at most one warm-cache verification pass when required.

## Coverage model

Maintain a component checklist with these fields:

```text
project,page,component,state,marker,result,started_at,ended_at,notes
```

Derive associations from ordered first appearance:

```text
component delta = asset hashes after marker - asset hashes before marker
```

Label assets as `baseline`, `shared`, `first-seen`, or `unmapped`. Shared bundles make exact one-component-to-one-chunk mapping impossible. Create a single-component verification page only for important ambiguous cases; do not rerun all components in isolated profiles.

Maintain three coverage classes:

- `visible-and-covered`: visible in the current account's Workshop palette and exercised normally
- `visible-not-covered`: visible but not exercised in the approved window
- `registered-not-visible`: present in separately approved sanitized manifest metadata but not visible; never trigger it through hidden routes or permission changes

Do not save raw HTML. If manifest metadata review is separately approved, retain only Build ID, relative CAS paths, and plugin name/type; discard routes, feature flags, user configuration, and the source document.

## Load controls

- One test account, one visible profile, one tab, one UI action at a time.
- Check `status` before UI work; stop if target counts, event counts, or the last network event do not match the visible tab.
- Use the owner's QPS/request/traffic ceiling. Hard asset count and retained-byte limits may be disabled because they do not stop browser traffic; keep the ledger, per-resource guard, small component batches, and operator stop control. In the absence of an owner ceiling, pause for a defined limit instead of inventing a "safe" anti-detection interval.
- Coordinate the time window and expected navigation path with SOC.
- Never perform writes, publish actions, exports, deletes, or permission changes unless separately authorized.

## Stop conditions

Stop without retry on `401`, `403`, `429`, CAPTCHA/MFA, unexpected logout, account warning, unapproved domain, write side effect, repeated `5xx`, traffic-budget exhaustion, or SOC instruction. Preserve logs and report the point of interruption.

## Deliverables

- Deduplicated JS, CSS, WASM, fonts, and optional images
- `merge-summary.json` and the shared task ledger proving cumulative budget use
- `manifest.ndjson` with redacted URLs, hashes, sizes, cache source, target type, and marker
- `markers.ndjson`, `risk-events.ndjson`, `invalid-assets.ndjson`, `asset-audit.json`, `provenance.json`, and `summary.json`
- Component coverage sheet and component-to-asset matrix
- Explicit limitations: unmounted states, unauthorized roles, backend code, original sources, and unrequested sourcemaps are absent
