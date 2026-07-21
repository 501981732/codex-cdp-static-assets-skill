# Widget 静态资源自动采集实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有纯被动 CDP 静态资源 Skill 改为一次授权后可自动遍历 Workshop Widget，并完整覆盖 HTML、数据配置、可视区懒加载和预览状态的可审计采集流程。

**Architecture:** 保留 Chrome DevTools MCP `--autoConnect` 和“只读取浏览器已完成响应、绝不重抓 URL”的资源采集内核。HTML 支持落在 importer 的严格类型/方法校验中；Widget 自动化仍由 Skill 调用可见 MCP UI 工具完成，状态结果通过独立事件记录器写入 NDJSON，并由 merge 阶段生成确定性的 `component-assets.json`。

**Tech Stack:** Node.js ESM、`node:test`、Chrome DevTools MCP、Markdown Skill/Runbook、NDJSON、SHA-256。

---

## 文件职责

- `skills/codex-cdp-static-assets-skill/scripts/capture-core.mjs`：Scope 类型、正文校验和通用采集规则。
- `skills/codex-cdp-static-assets-skill/scripts/import-mcp-response.mjs`：把已观察的 MCP 响应导入内容寻址存储；新增严格 document HTML 支持。
- `skills/codex-cdp-static-assets-skill/scripts/automation-policy.mjs`：新增；校验自动化 Scope，并提供目录身份、Marker、分页、Network 稳定和恢复决策纯函数。
- `skills/codex-cdp-static-assets-skill/scripts/record-component-state.mjs`：新增；校验并追加 Widget 状态事件，不操作浏览器。
- `skills/codex-cdp-static-assets-skill/scripts/component-coverage.mjs`：新增；把状态事件与 Manifest 合成为稳定组件覆盖模型。
- `skills/codex-cdp-static-assets-skill/scripts/merge-captures.mjs`：聚合多个 run，输出 `component-assets.json`。
- `skills/codex-cdp-static-assets-skill/SKILL.md`：一次授权自动化工作流与硬边界。
- `skills/codex-cdp-static-assets-skill/references/*.md`：Scope、MCP 工具、Workshop 状态矩阵和恢复流程。
- `README.md`、`README.en.md`、`agents/openai.yaml`：安装、调用和 UI 文案。

### Task 1: 固化旧 Skill 的失败行为与新契约

**Files:**
- Modify: `skills/codex-cdp-static-assets-skill/scripts/skill-contract.test.mjs`
- Reference: `docs/superpowers/specs/2026-07-21-automated-widget-capture-design.md`

- [ ] **Step 1: 记录 RED 基线**

保留已完成的独立基线结果：当前 Skill 明确拒绝自行点击、滚动、添加 Widget、绑定数据源、预览和保存 HTML，并仍要求人工 `P1/P2` 检查点。这证明新契约在修改前不成立。

- [ ] **Step 2: 把契约测试改成新要求**

新增断言，要求 Skill/README/reference 包含：

```js
for (const required of [
  'take_snapshot', 'click', 'drag', 'fill', 'press_key',
  'single consolidated authorization',
  'editor-mounted', 'viewport-visible', 'config-opened',
  'data-bound', 'preview-visible',
  'component-assets.json', 'text/html',
]) assert.equal(combined.includes(required), true);

for (const requiredBoundary of [
  'Never use `evaluate_script`',
  'Never set `requestFilePath`',
  'never refetch',
  'unknown host',
]) assert.equal(combined.includes(requiredBoundary), true);

assert.equal(allowedToolsSection.includes('evaluate_script'), false);
assert.equal(allowedToolsSection.includes('requestFilePath'), false);
```

用更精确的否定断言替代旧的“operator checkpoints”测试：文档不得再要求正常流程逐 Widget 回复 `P1 完成`，但必须继续禁止页面脚本、主动 refetch、隐藏路由和未授权数据源。

- [ ] **Step 3: 运行契约测试，确认 RED**

Run: `node --test skills/codex-cdp-static-assets-skill/scripts/skill-contract.test.mjs`

Expected: FAIL，缺少自动化 UI、状态矩阵、HTML 或组件映射契约。

- [ ] **Step 4: 提交 RED 测试**

```bash
git add skills/codex-cdp-static-assets-skill/scripts/skill-contract.test.mjs
git commit -m "test: define automated widget capture contract"
```

### Task 2: 支持严格的 document HTML 导入

**Files:**
- Modify: `skills/codex-cdp-static-assets-skill/scripts/capture-core.mjs`
- Modify: `skills/codex-cdp-static-assets-skill/scripts/capture-core.test.mjs`
- Modify: `skills/codex-cdp-static-assets-skill/scripts/import-mcp-response.mjs`
- Modify: `skills/codex-cdp-static-assets-skill/scripts/import-mcp-response.test.mjs`

- [ ] **Step 1: 添加 HTML Scope 与正文校验失败测试**

覆盖：

```js
assert.deepEqual([...normalizeScope({ pageHosts: ['app.test'], types: ['html'] }).types], ['html']);
assert.equal(validateBody('html', Buffer.from('<!doctype html><title>x</title>')).accepted, true);
assert.equal(validateBody('html', Buffer.from('{"data":1}')).reason, 'invalid-html-body');
```

- [ ] **Step 2: 添加 importer 分类失败测试**

覆盖：

```js
assert.equal(classifyMcpResource({ resourceType: 'document', mimeType: 'text/html', url: 'https://app.test/' }), 'html');
assert.equal(classifyMcpResource({ resourceType: 'fetch', mimeType: 'text/html', url: 'https://app.test/api' }), null);
```

集成测试要求：只有 `requestMethod: 'GET'`、`requestHasBody: false`、`documentContext: 'top-level' | 'widget-iframe'`、完成状态为 2xx/3xx、精确主机获批的 document HTML 才保存到 `assets/html/<sha>.html`。POST、请求正文状态未知/存在、上下文未知、未完成/4xx、fetch/xhr HTML 都被忽略或拒绝；JS/CSS 返回 HTML 仍为 invalid。

- [ ] **Step 3: 运行测试，确认 RED**

Run: `node --test skills/codex-cdp-static-assets-skill/scripts/capture-core.test.mjs skills/codex-cdp-static-assets-skill/scripts/import-mcp-response.test.mjs`

Expected: FAIL，`html` 尚非有效类型且 importer 不分类 document。

- [ ] **Step 4: 实现最小 HTML 支持**

在 `capture-core.mjs`：

```js
const validTypes = new Set(['js', 'css', 'wasm', 'font', 'image', 'html']);
if (kind === 'html' && !/^\s*(?:<!doctype\s+html|<html\b)/i.test(body.subarray(0, 2048).toString('utf8'))) {
  return { accepted: false, reason: 'invalid-html-body' };
}
```

在 importer：先把 MCP resource type 大小写归一化。仅当归一化类型为 `Document`、MIME 为 HTML/XHTML、`requestMethod === 'GET'`、`requestHasBody === false`、`documentContext` 为 `top-level` 或 `widget-iframe`、HTTP 状态为 200–399 时接受 `html`。新增 `--request-method`、`--request-has-body`、`--document-context`；缺少任一 HTML 专用元数据时 fail closed。HTML 扩展名为 `.html` 或 `.xhtml`。fetch/xhr MIME 不触发 HTML 分类。

- [ ] **Step 5: 运行相关测试，确认 GREEN**

Run: `node --test skills/codex-cdp-static-assets-skill/scripts/capture-core.test.mjs skills/codex-cdp-static-assets-skill/scripts/import-mcp-response.test.mjs`

Expected: PASS。

- [ ] **Step 6: 提交 HTML 支持**

```bash
git add skills/codex-cdp-static-assets-skill/scripts/capture-core.mjs skills/codex-cdp-static-assets-skill/scripts/capture-core.test.mjs skills/codex-cdp-static-assets-skill/scripts/import-mcp-response.mjs skills/codex-cdp-static-assets-skill/scripts/import-mcp-response.test.mjs
git commit -m "feat: capture approved document HTML"
```

### Task 3: 校验自动化 Scope 与核心决策

**Files:**
- Create: `skills/codex-cdp-static-assets-skill/scripts/automation-policy.mjs`
- Create: `skills/codex-cdp-static-assets-skill/scripts/automation-policy.test.mjs`
- Modify: `skills/codex-cdp-static-assets-skill/scripts/capture-core.mjs`
- Modify: `skills/codex-cdp-static-assets-skill/scripts/capture-core.test.mjs`

- [ ] **Step 1: 编写自动化 Scope 失败测试**

测试 `normalizeScope`/`normalizeAutomationPolicy` 的明确字段：`mode: 'full-catalog' | 'single-page'`、`allowAutosave`、`allowCreateCapturePages`、`maxWidgetsPerPage`、`states`。拒绝：`enabled` 但未授权自动保存、全目录模式未授权建页、single-page 却授权自动建页、`maxWidgetsPerPage < 1`、未知 mode/state、Fixture 缺少 `kind/visibleOption`、`widgetFixtureMap` 引用不存在的 Profile、真实数据源回退字段。合法 Scope 返回冻结的自动化策略对象。

- [ ] **Step 2: 编写核心决策失败测试**

覆盖纯函数：

```js
canonicalWidgetKey({ label: 'Object Table', category: 'Tables', versionOrType: 'v1' });
assert.equal(buildCatalogQueue([
  { snapshotId: 's1', entries: [sameVisibleEntry] },
  { snapshotId: 's2', entries: [sameVisibleEntry] },
]).length, 1);
assert.throws(() => buildCatalogQueue([
  { snapshotId: 's1', entries: [sameVisibleEntry, indistinguishableSecondEntry] },
]), /catalog-identity-ambiguity/);
assert.match(markerForWidget('tables/object-table/v1', 'data-bound'), /^widget:object-table:[a-f0-9]{8}:data-bound$/);
assert.equal(classifyBaselineGate({ automationEnabled: true, classification: 'preloaded' }), 'continue');
assert.equal(classifyBaselineGate({ automationEnabled: false, classification: 'preloaded' }), 'stop');
assert.equal(planCapturePage({ count: 8, maxWidgetsPerPage: 8, allowCreateCapturePages: false }).reason, 'blocked-page-capacity');
```

`buildCatalogQueue` 对跨快照重复观察到的同一规范 Key 去重；只有同一 `snapshotId` 内出现两个无法区分的同 Key 可见项时才报 `catalog-identity-ambiguity`。为目录完成追踪器依次传入可见规范 Widget Key 和 `atBottom`：只有已经执行到底操作，并且随后连续两次更新都没有新增 Key 时才返回 complete；出现新 Key 或离开底部会重置稳定计数。追踪器只保存规范 Key 集合和计数，不保存无障碍快照。

为 Network 稳定追踪器提供三次相同的 `(requestId,status)` 快照；第一次建立基线，第二次为连续一次相同，第三次才返回稳定。任何新增请求或状态变化都重置计数。

为恢复决策测试：已有实例唯一时只补缺失状态；实例歧义返回 `blocked-existing-instance-ambiguous`；已添加但缺 Fixture 时不得重新添加；preloaded 自动模式继续、人工模式停止。

- [ ] **Step 3: 运行测试，确认 RED**

Run: `node --test skills/codex-cdp-static-assets-skill/scripts/automation-policy.test.mjs skills/codex-cdp-static-assets-skill/scripts/capture-core.test.mjs`

Expected: FAIL，自动化策略模块不存在，Scope 尚未校验 automation/fixture 字段。

- [ ] **Step 4: 实现最小策略模块与 Scope 校验**

实现并导出：`normalizeAutomationPolicy`、`canonicalWidgetKey`、`buildCatalogQueue`、`markerForWidget`、`classifyBaselineGate`、`planCapturePage`、`createCatalogCompletionTracker`、`createNetworkStabilityTracker`、`planResume`。所有函数只处理传入的可见元数据，不访问 DOM、网络或浏览器。

同一文件提供可执行 CLI 子命令，使 Skill 无需编写页面脚本即可调用这些决策：

```bash
node scripts/automation-policy.mjs validate-scope --scope capture-scope.json
node scripts/automation-policy.mjs catalog-update --state capture-run-1/catalog-state.json --entries-json '[{"label":"Object Table","category":"Tables","versionOrType":"v1"}]' --at-bottom true
node scripts/automation-policy.mjs network-update --state capture-run-1/network-state.json --requests-json '[{"requestId":"1","status":200}]'
node scripts/automation-policy.mjs marker --widget-key tables/object-table/v1 --state data-bound
node scripts/automation-policy.mjs resume --component-json '{...}' --visible-matches 1
```

`catalog-state.json` 只保存规范 Key、到底标记和稳定计数；`network-state.json` 只保存 requestId/status 指纹和稳定计数。不得写入无障碍快照、DOM、Cookie 或请求头。

`normalizeScope` 保留原字段，并调用策略校验器处理 `automation`、`fixtureProfiles`、`widgetFixtureMap`；provenance 只记录 Profile 名和非敏感策略，不写真实业务数据。`full-catalog` 必须同时满足 `allowAutosave: true` 与 `allowCreateCapturePages: true`；`single-page` 必须为 `allowCreateCapturePages: false`。

- [ ] **Step 5: 运行测试，确认 GREEN**

Run: `node --test skills/codex-cdp-static-assets-skill/scripts/automation-policy.test.mjs skills/codex-cdp-static-assets-skill/scripts/capture-core.test.mjs`

Expected: PASS。

- [ ] **Step 6: 提交自动化策略**

```bash
git add skills/codex-cdp-static-assets-skill/scripts/automation-policy.mjs skills/codex-cdp-static-assets-skill/scripts/automation-policy.test.mjs skills/codex-cdp-static-assets-skill/scripts/capture-core.mjs skills/codex-cdp-static-assets-skill/scripts/capture-core.test.mjs
git commit -m "feat: validate widget automation policy"
```

### Task 4: 记录 Widget 状态事件

**Files:**
- Create: `skills/codex-cdp-static-assets-skill/scripts/record-component-state.mjs`
- Create: `skills/codex-cdp-static-assets-skill/scripts/record-component-state.test.mjs`

- [ ] **Step 1: 编写记录器失败测试**

测试 CLI/API 将以下事件追加到 `<run>/component-events.ndjson`：

```json
{
  "caseId": "SEC-1",
  "widgetKey": "tables/object-table/v1",
  "label": "Object Table",
  "category": "Tables",
  "capturePage": "CDP Capture 001",
  "visibleInstanceLabel": "Object Table",
  "marker": "widget:object-table:a1b2c3d4:data-bound",
  "state": "data-bound",
  "status": "captured",
  "required": true,
  "attemptId": "capture-run-1:data-bound:1",
  "at": "2026-07-21T00:00:00.000Z",
  "failure": null
}
```

同时测试拒绝未知状态、未知 status、缺少 `widgetKey/capturePage/marker/attemptId`、`caseId` 与 Scope 不一致、`required: true + not-applicable/not-requested`，以及 blocked/failed 事件缺少结构化 `failure: { code, message }`。

- [ ] **Step 2: 运行测试，确认 RED**

Run: `node --test skills/codex-cdp-static-assets-skill/scripts/record-component-state.test.mjs`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现最小记录器**

允许状态：`editor-mounted`、`viewport-visible`、`config-opened`、`data-bound`、`preview-visible`。允许结果：`captured`、`not-applicable`、`not-requested`、`failed`、`blocked-missing-fixture`、`blocked-page-capacity`、`blocked-existing-instance-ambiguous`。记录器生成或验证 ISO 时间，要求稳定 `attemptId`，并让 blocked/failed 事件保存结构化失败原因。not-applicable/not-requested 状态必须写成 `required: false`，因此不会进入 `requiredStates`。

CLI 示例：

```bash
node scripts/record-component-state.mjs --scope capture-scope.json --output capture-run-1 \
  --widget-key tables/object-table/v1 --label 'Object Table' --category Tables \
  --capture-page 'CDP Capture 001' --visible-instance-label 'Object Table' \
  --marker widget:object-table:a1b2c3d4:data-bound --state data-bound \
  --status captured --required --attempt-id capture-run-1:data-bound:1
```

`--attempt-id` 由自动化流程按 `<run>:<state>:<monotonic-attempt-number>` 显式传入并在同一 run 内唯一；记录器生成 `at`，测试可用 `--at` 注入固定 ISO 时间。blocked/failed 命令必须同时提供 `--failure-code` 与 `--failure-message`。

- [ ] **Step 4: 运行测试，确认 GREEN**

Run: `node --test skills/codex-cdp-static-assets-skill/scripts/record-component-state.test.mjs`

Expected: PASS。

- [ ] **Step 5: 提交状态记录器**

```bash
git add skills/codex-cdp-static-assets-skill/scripts/record-component-state.mjs skills/codex-cdp-static-assets-skill/scripts/record-component-state.test.mjs
git commit -m "feat: record widget capture states"
```

### Task 5: 生成组件覆盖映射并支持状态级恢复

**Files:**
- Create: `skills/codex-cdp-static-assets-skill/scripts/component-coverage.mjs`
- Create: `skills/codex-cdp-static-assets-skill/scripts/component-coverage.test.mjs`
- Modify: `skills/codex-cdp-static-assets-skill/scripts/merge-captures.mjs`
- Modify: `skills/codex-cdp-static-assets-skill/scripts/merge-captures.test.mjs`

- [ ] **Step 1: 添加覆盖合并失败测试**

构造两个 run：第一次 `data-bound=blocked-missing-fixture`，第二次同一 `(capturePage, widgetKey)` 为 `captured`；要求：

- 顶层包含 `schemaVersion: 1`、`caseId`、合法 `generatedAt`、`baseline` 和按 key 排序的 `components`；
- 最终 `coverageStatus=complete`；
- `failures/attempts` 保留历史阻塞；
- attempts 按 `(at, sourceRun, attemptId)` 稳定排序，重复 attemptId 去重；
- `states.data-bound=captured`；
- baseline 已出现的资源不进入任何组件的 `firstObservedAssets`；
- 对每个 `(sha256, redacted URL)`，只归给按 `(at, sourceRun)` 排序后最早的非 baseline Widget 状态 Marker，后续 Widget 不重复认领；
- body-unavailable 按 Marker 汇总；
- `requiredStates/coveredStates/blockedStates` 都稳定排序并符合状态汇总；
- 可选数据源且未映射的 `data-bound=not-requested, required=false` 不阻塞完整度；
- `blocked-page-capacity`、`blocked-existing-instance-ambiguous` 产生 `partial`。

- [ ] **Step 2: 运行测试，确认 RED**

Run: `node --test skills/codex-cdp-static-assets-skill/scripts/component-coverage.test.mjs skills/codex-cdp-static-assets-skill/scripts/merge-captures.test.mjs`

Expected: FAIL，覆盖模块与 `component-assets.json` 尚不存在。

- [ ] **Step 3: 实现纯函数覆盖模型**

`component-coverage.mjs` 导出 `buildComponentCoverage({ caseId, events, manifest })`：

- 按 `(capturePage, widgetKey)` 分组；
- 每个状态只要存在 captured 即为 captured；否则在按 `(at, sourceRun, attemptId)` 排序后取最新 terminal failed/blocked；再退到 not-applicable、not-requested；同时保留带 `attemptId/at/sourceRun/failure` 的 attempts；
- required 状态必须全部为 `captured` 且没有阻塞时为 `complete`；not-applicable/not-requested 事件在记录阶段已经强制 `required: false`；
- 先建立 baseline 资源集合；非 baseline 资源按 `(at, sourceRun)` 选择全局最早 Marker，再按 `(sha256, url)` 去重并只归给对应组件；
- 组件、状态、资源稳定排序；
- baseline 单独输出。

- [ ] **Step 4: 在 merge 中生成映射**

读取每个 run 的 `component-events.ndjson` 和完整 Manifest（含 body-unavailable）；读取时为每个事件和 Manifest 条目补充该目录 basename 作为 `sourceRun`，再调用覆盖模块并写入：

`<delivery>/metadata/component-assets.json`

在 `merge-summary.json` 添加 `componentCount`、`completeComponents`、`partialComponents`。

- [ ] **Step 5: 运行测试，确认 GREEN**

Run: `node --test skills/codex-cdp-static-assets-skill/scripts/component-coverage.test.mjs skills/codex-cdp-static-assets-skill/scripts/merge-captures.test.mjs`

Expected: PASS。

- [ ] **Step 6: 提交覆盖映射**

```bash
git add skills/codex-cdp-static-assets-skill/scripts/component-coverage.mjs skills/codex-cdp-static-assets-skill/scripts/component-coverage.test.mjs skills/codex-cdp-static-assets-skill/scripts/merge-captures.mjs skills/codex-cdp-static-assets-skill/scripts/merge-captures.test.mjs
git commit -m "feat: build widget component coverage map"
```

### Task 6: 审计组件映射与合并产物

**Files:**
- Modify: `skills/codex-cdp-static-assets-skill/scripts/audit-capture.mjs`
- Modify: `skills/codex-cdp-static-assets-skill/scripts/audit-capture.test.mjs`

- [ ] **Step 1: 添加合并审计失败测试**

构造带 `metadata/manifest.ndjson`、HTML 文件和 `metadata/component-assets.json` 的 delivery，断言 audit：

- 验证所有 Manifest 文件存在且 SHA-256 一致，包括 `.html/.xhtml`；
- 验证 component map 的 `schemaVersion/caseId/baseline/components`；
- 验证每个 `firstObservedAssets` 的 `(sha256,url)` 能在 Manifest 中找到；
- 验证 required/covered/blocked 与 states、coverageStatus 自洽；
- 对缺失文件、悬空组件资源、错误 complete 状态输出明确 invalid reason。

- [ ] **Step 2: 运行测试，确认 RED**

Run: `node --test skills/codex-cdp-static-assets-skill/scripts/audit-capture.test.mjs`

Expected: FAIL，现有 audit 不读取 `component-assets.json`。

- [ ] **Step 3: 实现最小组件映射审计**

扩展 audit 报告，增加 `componentMap: { present, componentCount, completeComponents, partialComponents }`，并把 schema、引用或覆盖不一致加入现有 `invalid` 数组。保持旧 run 没有 component map 时仍可审计，只有合并 delivery 声明了 component map 才执行严格校验。

- [ ] **Step 4: 运行测试，确认 GREEN**

Run: `node --test skills/codex-cdp-static-assets-skill/scripts/audit-capture.test.mjs`

Expected: PASS。

- [ ] **Step 5: 提交审计支持**

```bash
git add skills/codex-cdp-static-assets-skill/scripts/audit-capture.mjs skills/codex-cdp-static-assets-skill/scripts/audit-capture.test.mjs
git commit -m "feat: audit widget component coverage"
```

### Task 7: 改造 Skill 为一次授权后的可见 UI 自动化

**Files:**
- Modify: `skills/codex-cdp-static-assets-skill/SKILL.md`
- Modify: `skills/codex-cdp-static-assets-skill/references/scope-config.md`
- Modify: `skills/codex-cdp-static-assets-skill/references/workshop-runbook.md`
- Modify: `skills/codex-cdp-static-assets-skill/references/mcp-autoconnect.md`
- Modify: `skills/codex-cdp-static-assets-skill/references/cdp-boundaries.md`
- Modify: `skills/codex-cdp-static-assets-skill/agents/openai.yaml`
- Modify: `README.md`
- Modify: `README.en.md`

- [ ] **Step 1: 重跑契约测试，确认仍为 RED**

Run: `node --test skills/codex-cdp-static-assets-skill/scripts/skill-contract.test.mjs`

Expected: FAIL，文档仍为 operator-only。

- [ ] **Step 2: 修改 SKILL.md 核心流程**

写明：发现后一次汇总授权；允许 `take_snapshot/select_page/navigate_page(reload)/click/drag/fill/press_key/wait_for/list_network_requests/get_network_request`；禁止 `evaluate_script`；调用 Task 3 的目录身份、Marker、preloaded 门禁、分页、两轮 Network 稳定和恢复决策；逐 Widget 状态 Marker；每个状态读取正文前检查精确主机和 stop status；确定性页面名；HTML document 规则；调用状态记录器、merge 和 audit。

- [ ] **Step 3: 修改 Scope 与 Runbook**

Scope 示例新增：

```json
{
  "types": ["js", "css", "wasm", "font", "image", "html"],
  "automation": {
    "enabled": true,
    "mode": "full-catalog",
    "allowAutosave": true,
    "allowCreateCapturePages": true,
    "maxWidgetsPerPage": 8,
    "states": ["editor-mounted", "viewport-visible", "config-opened", "data-bound", "preview-visible"]
  },
  "fixtureProfiles": {},
  "widgetFixtureMap": {}
}
```

明确：无数据源能力为 not-applicable；可选且无映射为 not-requested；必填且无映射才阻塞。滚动到可视区后再判定 Network 稳定。Runbook 必须展示 `automation-policy.mjs` 的 catalog/network/marker/resume 子命令如何嵌入逐状态流程，而不是要求调用者自行重写决策逻辑。

- [ ] **Step 4: 更新 README 与 UI 元数据**

中英文 README 改为“一次授权、全自动、可见 UI”；保留默认 Chrome、精确主机批准、停止条件和不 refetch。`openai.yaml` 默认提示应允许自动添加/配置/滚动/预览，但禁止页面脚本和高风险动作。

- [ ] **Step 5: 运行契约测试，确认 GREEN**

Run: `node --test skills/codex-cdp-static-assets-skill/scripts/skill-contract.test.mjs`

Expected: PASS。

- [ ] **Step 6: 提交 Skill 改造**

```bash
git add README.md README.en.md skills/codex-cdp-static-assets-skill
git commit -m "feat: automate authorized widget capture"
```

### Task 8: 全量验证并同步本地安装副本

**Files:**
- Source: `skills/codex-cdp-static-assets-skill/**`
- Sync: `~/.codex/skills/codex-cdp-static-assets-skill/**`
- Sync: `~/.agents/skills/codex-cdp-static-assets-skill/**`

- [ ] **Step 1: 运行全部测试**

Run: `node --test skills/codex-cdp-static-assets-skill/scripts/*.test.mjs`

Expected: 全部 PASS，无 warning/error。

- [ ] **Step 2: 运行 Skill 校验器**

Run: `python3 /Users/wangmeng5/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/codex-cdp-static-assets-skill`

Expected: `Skill is valid!`

- [ ] **Step 3: 运行仓库卫生检查**

Run: `git diff --check`

Expected: 无输出。

- [ ] **Step 4: 同步两个安装副本**

先用 `diff -qr` 记录差异，再执行以下精确同步；两个目标都是安装副本，`--delete` 只清理其中已经不属于源码 Skill 的陈旧文件，不反向写入仓库：

```bash
rsync -a --delete skills/codex-cdp-static-assets-skill/ /Users/wangmeng5/.codex/skills/codex-cdp-static-assets-skill/
rsync -a --delete skills/codex-cdp-static-assets-skill/ /Users/wangmeng5/.agents/skills/codex-cdp-static-assets-skill/
```

- [ ] **Step 5: 验证安装副本一致**

Run:

```bash
diff -qr skills/codex-cdp-static-assets-skill ~/.codex/skills/codex-cdp-static-assets-skill
diff -qr skills/codex-cdp-static-assets-skill ~/.agents/skills/codex-cdp-static-assets-skill
```

Expected: 两条命令均无输出。

- [ ] **Step 6: 独立前向验证**

让新代理仅获得更新后的 Skill 路径和真实风格请求，验证它会：一次授权后自动添加/滚动/配置/预览；HTML 仅保存 document GET；可选数据源不阻塞；未知主机和高风险动作仍停止。不得连接真实浏览器或修改线上模块。

- [ ] **Step 7: 提交最终验证修正**

如前向验证暴露问题，先增加失败契约测试再修复并提交。否则确认工作区干净。

### Task 9: 准备真实 Workshop 采集

**Files:**
- Create at runtime: `capture-scope.json`
- Create at runtime: `capture-run-*/`

- [ ] **Step 1: 验证 Chrome DevTools MCP 工具面**

确认 `list_pages`、`select_page`、`take_snapshot`、`click`、`drag`、`fill`、`press_key`、`list_network_requests` 和 `get_network_request` 可用。

- [ ] **Step 2: 对目标 Module 做 metadata-only 发现**

只选择 `eos-dev.chehejia.com` 的唯一目标页；发现精确主机，不读取正文、不修改 UI。

- [ ] **Step 3: 生成一次汇总 Scope 等待授权**

包含精确主机、测试 Module、页面创建、自动保存、合成数据源 Profile、状态矩阵、资源类型（含 HTML）、上限和停止条件。

- [ ] **Step 4: 授权后执行全自动采集**

按新版 Skill 实际运行；每个状态及时导入和审计；最后生成 `component-assets.json`。真实运行结果与源码修改分开保存，不提交 Cookie、Token、API 正文或业务数据。
