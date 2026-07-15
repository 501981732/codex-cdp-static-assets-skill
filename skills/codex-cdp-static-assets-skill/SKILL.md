---
name: codex-cdp-static-assets-skill
description: Use when Codex needs Chrome DevTools Protocol (CDP) to passively capture JS, CSS, WebAssembly, fonts, or images naturally loaded by an authorized authenticated browser session, especially for Workshop components, lazy-loaded UI coverage, security evidence, or static-asset inventories.
---

# Capture Static Assets with CDP

## Boundary

Capture only completed static-resource responses naturally loaded by the approved visible page. Written authorization, limited UI scope, owner traffic controls, and stop conditions are mandatory. Never describe this as detection evasion.

Codex must not navigate, refresh, click, inspect the DOM, execute page scripts, refetch URLs, enumerate chunks, probe sourcemaps, alter cache or Service Workers, change fingerprints, or copy/replay credentials. The operator performs all visible UI actions. Do not save HTML, XHR, GraphQL, WebSocket payloads, feature flags, user configuration, API bodies, or production data.

## Before capture

1. Confirm case ID, test account, page host, time window, test module, allowed UI actions, asset types, owner traffic ceiling, stop contact, and autosave authorization.
2. Read [references/scope-config.md](references/scope-config.md). For component-heavy pages, read [references/workshop-runbook.md](references/workshop-runbook.md).
3. Choose the connection backend below. Never transfer cookies, tokens, passwords, or profile files.

For authenticated applications, log in before discovery. Reuse authenticated state in place; never export it from Chrome.

## Connection choice

### A. Default Chrome via autoConnect (preferred)

Use this when the account is already signed in to the user's normal Chrome. It requires Chrome 144+ and Chrome DevTools MCP configured with `--autoConnect`. Read [references/mcp-autoconnect.md](references/mcp-autoconnect.md) before operating.

Do not probe `127.0.0.1:9222` first when `list_pages`, `select_page`, `list_network_requests`, and `get_network_request` are available. Ask the operator to enable the remote debugging server at `chrome://inspect/#remote-debugging` and approve Chrome's connection dialog.

The MCP can see all windows in the selected default profile. Recommend closing unrelated sensitive pages. Use `list_pages` only in memory, select the unique page matching `pageHosts`, and never persist unrelated page metadata.

### B. Loopback collector (fallback)

Use `capture-static-assets.mjs` only when the operator already has an approved loopback CDP endpoint. Attach to the unique page matching `pageHosts`; ignore unrelated targets. Do not launch a new profile automatically when attachment fails.

Chrome below 144 cannot use `autoConnect`. Chrome 136+ also ignores a remote-debugging port for the default data directory. In that case pause for an owner-approved connection choice; do not work around login controls.

## autoConnect workflow

1. Attach and select the approved page before the operator refreshes it.
2. Discovery: after one operator-driven refresh and representative navigation, call `list_network_requests` without reading bodies. Review exact hosts and build the Scope; candidates are never auto-approved.
3. Baseline: after approval, ask the operator to refresh the empty Workshop. At the checkpoint, inspect the complete request list first. Stop on unknown hosts, `401`, `403`, `429`, repeated `5xx`, auth challenges, or account warnings before reading any body.
4. For approved completed JS/CSS/WASM/font requests only, call `get_network_request` by request ID with `responseFilePath`. Never set `requestFilePath`. Import each staged body with `import-mcp-response.mjs --delete-body`; the importer enforces Scope, validation, hashing, Ledger, and redacted manifests. A missing file becomes `body-unavailable`; never refetch it.
5. Classify the baseline as `preloaded` or `lazy`. Only for `lazy`, capture batches of roughly 5-10 related components. Keep each batch within one page navigation, use one marker, and ingest its request list before navigating away.
6. Audit every run, merge once, then audit the merged directory.

`list_network_requests` and `get_network_request` inspect Chrome's local Network record; they must not create a new HTTP request. Do not use `navigate_page`, `evaluate_script`, `click`, or URL-fetching tools in this workflow.

## Loopback workflow

Run discovery once, strict baseline once, then component batches only when baseline proves lazy loading. Keep one collector running per batch and let the operator drive the page. See [references/cdp-boundaries.md](references/cdp-boundaries.md) for commands and limitations.

## Stop and report

Stop without automatic retry on `401`, `403`, `429`, repeated `5xx`, CAPTCHA/MFA, logout, account warnings, unexpected writes, unknown hosts, owner limits, or owner/SOC instruction.

Audit with `audit-capture.mjs`, reuse one Ledger, merge with `merge-captures.mjs`, and report risks, invalid bodies, body failures, hashes, markers, and coverage. The result contains observed deployed artifacts, not source code or untriggered branches. Use `visible-and-covered`, `visible-not-covered`, and `registered-not-visible` for Workshop coverage.
