# Workshop and Lazy-Component Runbook

## Goal

Inventory deployed static assets naturally loaded by an authorized test account. Optimize for low intrusion and auditable coverage, not stealth or theoretical completeness.

The operator controls the visible browser. Codex manages the collector, status, markers, stop decisions, audits, and offline merge. The collector must not drive the page, inspect the DOM, or execute page code.

## Prepare

Use one dedicated test module with synthetic data. Component addition may autosave, so written scope must explicitly allow module/page creation, editing, and autosave. Do not publish, execute actions/workflows, export, change permissions, delete data, or write to production unless those actions are separately authorized.

Prepare an empty baseline page. Create batch pages only after the baseline classification gate says the application is actually lazy loading component bundles.

## Run

1. Log in before discovery. On Chrome 144+, prefer the default Chrome session through MCP `--autoConnect`; otherwise use an already approved loopback CDP session. Keep exactly one page on `pageHosts`. Because autoConnect can see all windows in the selected profile, close unrelated sensitive pages when practical.
2. Attach/select the approved page before the operator refreshes. Run discovery once with the page-only Scope and representative visible UI navigation. Discovery lists requests but reads no response bodies.
3. Review `observed-network-hosts.json`, `observed-hosts.json`, and `scope-candidates.json`. Obtain one batch approval for exact hosts and create the strict Scope.
4. Start strict capture with the shared Ledger. Mark `P0:baseline`, visibly refresh or open the empty page, and let it settle. In MCP mode, inspect and import the request list at the checkpoint before navigating away.
5. Run the baseline classification gate offline:
   - `preloaded`: many widget/component/plugin bundles already appear. Stop bulk additions, build the inventory offline, and validate only 1-3 representative components if useful.
   - `lazy`: mainly shell assets appear. Continue with lazy-load batches.
6. For lazy-load batches, place roughly 5-10 related components on a page, including edit/configuration and preview/runtime states. In loopback mode keep one collector running; in MCP mode keep one selected page and ingest the batch before its next navigation.
7. Use one marker per batch by default, such as `P1:table-filter`. Component-level markers are optional for important ambiguous mappings.
8. Audit every run. Inspect `risk-events.ndjson`, `invalid-assets.ndjson`, and ledger usage before continuing.
9. Reuse the ledger for approved continuation runs. Merge once at the end with `merge-captures.mjs`, then audit the merged output.

If an unknown host appears, stop. Review and approve the exact host, then retry only the affected batch or component. Do not repeat completed batches.

## Cache Choice

The lowest-intrusion default reuses the approved attached Chrome session and its in-place login state, accepting body-unavailable gaps after discovery. Never clear cache or refetch missing bodies.

If complete response bodies are required, a fresh capture profile requires owner approval. A second login may receive additional account review, so it is an explicit exception. Never transfer cookies, tokens, passwords, or profile files.

## Suggested Chat Checkpoints

```text
已登录并打开空白 Workshop
发现刷新完成
批准全部候选
严格基线完成
P1 完成
P2 完成
全部完成
```

Codex should report the baseline decision before asking for `P1` work. A preloaded result normally ends bulk component addition.

## Coverage

Use three simple classes:

- `visible-and-covered`: visible to the test account and exercised normally
- `visible-not-covered`: visible but outside the approved window
- `registered-not-visible`: known only from separately approved sanitized metadata; do not expose it through hidden routes or permission changes

Shared bundles make exact component-to-chunk mapping unreliable. Use marker-based first appearance only as evidence, not proof of ownership. Create a single-component validation page only for an important ambiguous component.

Do not save raw HTML. If manifest review is separately approved, retain only Build ID, relative CAS paths, and visible plugin name/type fields.

## Stop Conditions

Stop without retry on `401`, `403`, `429`, CAPTCHA/MFA, logout, account warning, unapproved host, unexpected write, repeated `5xx`, owner traffic ceiling, or owner/SOC instruction.

The final delivery contains observed deployed JS, CSS, WASM, fonts, and optional approved images. It does not contain original source, backend code, unmounted states, unauthorized roles, or unrequested sourcemaps.
