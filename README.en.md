# Workshop Widget Asset Capture Skill

[中文](README.md)

This Skill uses real Chrome interactions to add visible Widgets from a Workshop Module to test pages, configure them when needed, enter preview, and organize the frontend resources that the browser **naturally loads**.

It is useful for Widget reverse engineering, asset inventory, and lazy-load analysis. It does not guess URLs or download resources again: it only retains content Chrome already received while performing the approved UI work.

## What it does

- Finds the Widgets visible to the current account.
- Creates capture pages and adds Widgets in batches (the Scope controls the per-page limit, such as eight).
- Covers three useful moments: mounted in the editor, bound to existing data when supported, and visible in preview.
- Retains JS, CSS, WASM, images, and eligible page HTML. Fonts are excluded by default.
- Separates shared resources from resources first observed while operating a Widget, making later analysis easier.

It is not for collecting API data, bypassing login, exporting production data, or proving that a Chunk exclusively belongs to a Widget.

## Install

```bash
npx skills add https://github.com/501981732/codex-cdp-static-assets-skill \
  --skill codex-cdp-static-assets-skill \
  --agent codex \
  --global \
  --yes
```

After installing or updating, start a new Codex task and invoke `$codex-cdp-static-assets-skill`.

## Before you start

1. Use your normal signed-in Chrome (Chrome 144 or newer).
2. Configure the Chrome connection:

   ```bash
   codex mcp remove chrome-devtools
   codex mcp add chrome-devtools -- \
     npx -y chrome-devtools-mcp@latest \
     --autoConnect \
     --no-usage-statistics \
     --no-performance-crux
   ```

3. Restart Codex. Open `chrome://inspect/#remote-debugging` in Chrome, enable Remote debugging, then open the Workshop page to capture.
4. Prefer a dedicated test Module. Capture creates pages, adds Widgets, changes Widget configuration, and autosaves.

For data-required Widgets such as Object Table, the Skill can create a clearly named `CDP Capture` test variable in the dedicated test Module, or use an existing variable that the Widget UI explicitly marks compatible. It never modifies or deletes a variable, and never creates, changes, or deletes a data source.

## Ask Codex like this

Replace the URL and Case ID, then send this in a Codex task:

```text
Use $codex-cdp-static-assets-skill to capture resources for every visible Widget in this Workshop Module:
https://workshop.example.com/module/edit/...

Case ID: SEC-2026-001
This is a dedicated test Module. Allow creation of CDP Capture pages, Widget addition/configuration, and autosave.
Allow creation of dedicated test variables named CDP Capture, and allow existing Module variables only when the Widget UI explicitly marks them compatible. Do not modify or delete variables, and do not create, modify, or delete data sources.
First discover only the host and Widget entry points, then summarize the intended actions, Widget limit per page, and data-source policy for one approval. Run automatically after that approval.
Capture js, css, wasm, image, and naturally loaded page or Widget-iframe HTML. Exclude fonts by default.
```

## What happens during capture

1. It records resources already loaded when the page opens (`baseline`).
2. It opens Add Widget, scrolls to the bottom, and confirms the catalog is complete.
3. It adds Widgets in batches. Each Widget is mounted in the editor, optionally bound to an existing test variable, then opened in preview.
4. After each action, it reads only new, completed responses from Chrome Network; URLs are never replayed.
5. If interrupted, it resumes by locating existing Widgets and filling only missing states.

Catalog icons and preview images are recorded as shared `baseline:catalog` resources, rather than being attributed to an individual Widget.

## What you receive

- `assets/`: deduplicated retained resource files.
- `metadata/component-assets.json`: Widget states, asset-retention results, and first-observed resources.
- `metadata/components/`: a reverse-engineering view for each interacted Widget, such as Input or Table.
- `metadata/widget-inventory.json`: Widget, Renderer, Chunk, and module IDs parsed from baseline JavaScript.
- `metadata/baseline-assets.json`: resources shared by page startup and the Widget catalog.
- `metadata/manifest.ndjson`: an index of resource URL, type, hash, and observation point.

`firstObservedAssets` means “first seen after operating this Widget,” not “owned only by this Widget.” If a resource came from cache or Chrome did not retain its body, the report marks that clearly and never fetches it again.

## Important boundaries

- The Skill operates only on the exact authorized Workshop host and Module. It stops on login expiry, CAPTCHA, an unknown host, or an unexpected write.
- HTML is retained only for naturally loaded Document pages or Widget iframes—not XHR, fetch, GraphQL, or API responses.
- It does not execute page scripts, read cookies/tokens, probe hidden routes, sourcemaps, or Chunks, clear caches, or bypass Service Workers.

For state coverage, page limits, screenshots, and variable mappings, see the [Scope configuration](skills/codex-cdp-static-assets-skill/references/scope-config.md). Full execution and safety rules are in the [Skill guide](skills/codex-cdp-static-assets-skill/SKILL.md).
