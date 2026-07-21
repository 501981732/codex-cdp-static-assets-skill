# Widget 静态资源自动采集设计

## 目标

扩展 `codex-cdp-static-assets-skill`，使一次明确的运行授权即可启动无人值守的 Workshop 采集。Codex 使用 Chrome DevTools MCP 遍历可见的 Add Widget 目录，逐个添加 Widget，采集每个 Widget 首次触发的静态资源响应，并自动继续，无需逐组件确认。

采集结果表示“操作该 Widget 时实际观察到的资源”，不能据此断言共享 Bundle 仅归属于该 Widget。

## 唯一事实源

在本仓库的 `feat/automated-widget-capture` 分支实现。验证通过后，将同一份 Skill 目录同步到两个本地安装位置：

- `~/.codex/skills/codex-cdp-static-assets-skill`
- `~/.agents/skills/codex-cdp-static-assets-skill`

不得把本地安装副本作为源码直接修改。

## 运行授权

任何 UI 写操作或响应正文留存之前，都必须取得一次汇总授权。授权记录包括：

- Case ID、测试账号、精确页面主机、时间窗口、测试 Module 和停止联系人；
- 发现到的精确资源主机与已批准网络主机；
- 允许的资源类型以及字节数、资源数上限；
- 编辑专用测试 Module 及允许自动保存的权限；
- 全目录模式下创建新采集页面的权限，以及单页 Widget 上限；
- 允许自动执行的 UI 操作；
- 要覆盖的 Widget 状态矩阵；
- 允许使用的现有合成测试数据源，以及 Widget 到数据源 Profile 的精确映射；
- 禁止动作和停止条件。

发现阶段可以选择唯一获批页面、在内存中检查无障碍快照并列出 Network 元数据，但不能留存响应正文。系统应一次性展示全部精确主机候选和自动化动作集合。用户批准后，不再设置逐 Widget 检查点。

不得静默批准未知主机。授权后若出现新主机，立即停止；只有取得新的授权后才能继续。

自动化 Workshop 采集按实际执行顺序默认覆盖 `editor-mounted`、`viewport-visible`、`config-opened`、`data-bound` 和 `preview-visible`。对每个状态，仅在可见 Widget UI 确实支持时执行；否则记录为 `not-applicable`，不得推测或暴露隐藏配置、数据源或预览路由。

Scope 使用显式数据源配置，不得根据候选顺序猜测：

```json
{
  "fixtureProfiles": {
    "object-set-default": {
      "kind": "object-set",
      "visibleOption": "CDP Synthetic Objects"
    }
  },
  "widgetFixtureMap": {
    "tables/object-table/v1": "object-set-default"
  }
}
```

`widgetFixtureMap` 只能引用 `fixtureProfiles` 中已获批准的现有合成测试数据源。自动化流程可以选择并保存这些配置，但不得创建、修改或删除数据源本身，不得选择任意第一个候选项，也不得把真实业务数据源作为回退项。

## 自动化 UI 边界

仅允许执行采集所需的可见、同页面操作：

- 刷新或重新访问精确获批页面；
- 在内存中获取无障碍快照；
- 点击、搜索、滚动和键盘导航；
- 打开 Add Widget 并选择可见目录项；
- 添加 Widget 必须使用拖放时执行拖放；
- 打开 Widget 配置、选择 Scope 映射的合成测试数据源并允许自动保存；
- 打开预览，并滚动 Widget 进入可视区；
- 等待可见状态和 Network 稳定。

不得持久化无障碍快照或无关标签页元数据。

禁止执行：

- `evaluate_script`、页面上下文 JavaScript、隐藏路由发现、DOM/源码提取或内部注册表枚举；
- 发布、执行 Action 或 Workflow、导出、修改权限、生产回写或删除业务数据；
- 创建、修改或删除数据源，或选择 Scope 未明确映射的数据源；
- 添加结果不明确时盲目重试；
- 清理或禁用缓存、绕过 Service Worker、拦截请求、重放 URL、猜测 Chunk 或探测 sourcemap；
- 提取 Cookie、Token、密码、请求正文或浏览器 Profile。

## 资源范围

支持 `js`、`css`、`wasm`、`font`、`image` 和 `html`。

HTML 只有同时满足以下条件时才允许保留：

- 资源类型为 `document`；
- MIME 类型为 `text/html` 或 `application/xhtml+xml`；
- 响应由获批顶层页面或 Widget iframe 自然加载；
- 响应的精确主机已获批准；
- 请求为已完成且不带请求正文的 `GET`。

不得保留 `xhr`、`fetch` 或 API 返回的 HTML。JavaScript、CSS 响应中误返回的 HTML 仍必须拒绝。获批 HTML 使用与其他资源相同的查询参数脱敏、SHA-256、Ledger、大小限制和审计规则。

## 采集算法

1. 连接唯一匹配 `pageHosts` 的页面，并验证 Chrome/MCP 前置条件。
2. 执行仅含元数据的发现流程，取得一次汇总授权。
3. 添加 Widget 前，采集并审计 `baseline`。在自动化模式下，`preloaded` 基线不能阻止目录遍历，只用于把已观察资源归类为 `baseline/shared`；现有的预加载停止门禁仅保留给被动/人工模式。
4. 打开可见 Add Widget 目录，通过无障碍快照构建内存队列，不使用隐藏注册表：
   - 按页面展示顺序遍历可见分类；
   - 在每个分类内，通过可见的键盘或滚动操作滚动目录面板并收集目录项；
   - 只有执行 `End`/到底操作后，连续两次快照都没有出现新的规范 Widget Key，才视为枚举完成；
   - 使用规范化的可见名称、可见分类路径，以及存在时的可见版本/类型文本生成规范 Widget Key；
   - 如果这些可见字段仍然冲突，记录目录身份歧义并在修改任一目录项前停止；不得使用出现顺序作为身份；
   - 按规范 Widget Key 去重，Marker 由其 slug 和短哈希生成，不能使用目录位置。
5. 每个采集页面只放置 Scope 指定上限内的 Widget，默认 5–10 个。全目录模式必须设置 `allowCreateCapturePages: true`，并使用确定性名称自动创建 `CDP Capture 001`、`CDP Capture 002` 等页面继续下一批，避免页面过长导致未进入可视区、画布虚拟化或浏览器性能下降。未授权创建页面时只能运行单页模式；达到 `maxWidgetsPerPage` 后记录 `blocked-page-capacity` 并停止，结果只能是部分覆盖。
6. 对每个可见 Widget 按状态依次采集：
   - 分配稳定 Marker，例如 `widget:object-table:a1b2c3d4`；
   - 只执行一次可见添加动作；
   - 任何重试前先检查页面状态；结果不明确时停止；
   - `editor-mounted`：添加完成后等待编辑器结构稳定并采集；
   - `viewport-visible`：滚动并使 Widget 完整进入画布可视区，等待可见渲染后采集；
   - `config-opened`：打开可见配置面板，等待配置相关资源加载后采集；
   - `data-bound`：若可见配置表明需要数据源，则按 `widgetFixtureMap` 选择已批准 Profile、保存配置、重新滚动到可视区，等待数据渲染后采集；若不支持数据源则记录 `not-applicable`，若需要但没有映射则记录 `blocked-missing-fixture`；
   - `preview-visible`：进入可见预览或 Runtime 状态，将 Widget 滚动到可视区，等待渲染后采集；不支持预览时记录 `not-applicable`；
   - 每个状态都使用独立 Marker，例如 `widget:object-table:a1b2c3d4:data-bound`；
   - 每个状态在运行超时时间内，等待 Network 请求身份和状态连续两次轮询保持不变；
   - 每个状态读取正文前都检查所有已观察主机和状态；
   - 每个状态都立即导入新观察到的获批响应、删除暂存正文并执行审计；
   - 追加状态结果和 Widget 汇总记录；
   - 自动继续下一个 Widget。
7. 发生硬停止事件时立即停止；否则只合并一次，生成组件映射并审计合并结果。

只有 Scope 明确允许创建页面和自动保存时，自动化流程才能创建新的采集页面。不得自动删除这些页面。每次成功添加后，在组件记录中保存 `capturePage`、规范 `widgetKey` 和可见实例标签，不保存临时 DOM UID。恢复运行时按采集页和规范 Widget Key 对比，而不是按目录顺序判断，因此目录重新排序不会跳过或重复已完成 Widget。

## 归属与输出

保留现有内容寻址资源存储和 Manifest，新增带版本的 `component-assets.json`：

```json
{
  "schemaVersion": 1,
  "caseId": "SEC-2026-001",
  "generatedAt": "2026-07-21T00:00:00.000Z",
  "baseline": {
    "marker": "baseline",
    "status": "captured",
    "assets": [],
    "bodyUnavailable": [],
    "failures": []
  },
  "components": [
    {
      "widgetKey": "tables/object-table/v1",
      "label": "Object Table",
      "category": "Tables",
      "capturePage": "CDP Capture 001",
      "visibleInstanceLabel": "Object Table",
      "marker": "widget:object-table:a1b2c3d4",
      "coverageStatus": "complete",
      "requiredStates": ["editor-mounted", "config-opened", "data-bound", "viewport-visible", "preview-visible"],
      "coveredStates": ["editor-mounted", "config-opened", "data-bound", "viewport-visible", "preview-visible"],
      "blockedStates": [],
      "states": {
        "editor-mounted": "captured",
        "config-opened": "captured",
        "data-bound": "captured",
        "viewport-visible": "captured",
        "preview-visible": "captured"
      },
      "attempts": [
        { "sourceRun": "capture-run-1", "at": "2026-07-21T00:00:00.000Z", "status": "captured" }
      ],
      "firstObservedAssets": [
        {
          "kind": "js",
          "sha256": "...",
          "url": "https://approved.example/assets/widget.js?build=%5BREDACTED%5D",
          "size": 12345
        }
      ],
      "bodyUnavailable": [],
      "failures": []
    }
  ]
}
```

始终输出 baseline 记录。每个尝试过的规范 Widget Key 都必须输出一条组件记录，包括失败尝试。合并时按 `(capturePage, widgetKey)` 汇总组件记录；按 `(sha256, 脱敏 URL)` 去重资源；保留最早的首次观察 Marker；合并全部 `bodyUnavailable` 条目；保留所有不同失败；按 `(at, sourceRun)` 追加每次尝试。

汇总状态必须确定性计算：每个要求状态只要任一次成功采集即为 `captured`；否则，缺少已批准数据源映射时为 `blocked-missing-fixture`，任一次执行失败则为 `failed`，可见 UI 明确不支持时为 `not-applicable`。只有没有任何运行请求该状态时才保留 `not-requested`。`coveredStates` 只包含 `captured`，`blockedStates` 包含所有 `blocked-*` 和 `failed` 状态。全部适用的要求状态均为 `captured` 且不存在阻塞时，`coverageStatus` 才能是 `complete`；否则为 `partial`。即使后续尝试成功，历史失败仍保留在 `failures` 和 `attempts` 中。组件按 `widgetKey` 排序，资源按 `(kind, URL, sha256)` 排序，以确保输出稳定。

证据分类如下：

- `baseline/shared`：添加任何 Widget 前已经观察到；
- `first-observed`：首次在该 Widget Marker 下出现；
- `body-unavailable`：观察到请求，但 Chrome 已无法提供响应正文；
- `failed`：UI 或采集失败，并记录原因。
- `blocked-missing-fixture`：Widget 明确需要数据源，但 Scope 没有提供获批 Profile 映射。
- `blocked-page-capacity`：单页模式达到上限且未授权创建下一采集页。
- `blocked-existing-instance-ambiguous`：恢复时无法通过已记录可见信息唯一定位现有 Widget 实例。

对于因缓存而没有产生可观察证据的资源，不得虚构 `reused-by` 关系。

## 失败处理

遇到以下情况停止且不自动重试：

- 未知主机、页面离开获批主机/Module，或出现未授权写操作；
- `401`、`403`、`429`、重复 `5xx`、CAPTCHA、MFA、掉线或账号警告；
- 添加结果不明确，可能造成 Widget 重复；
- Widget 数据源映射指向不存在、不可见或非合成测试数据源；
- 达到授权方规定的流量或时间上限；
- 授权方或 SOC 要求停止。

记录当前 Widget Key、采集页、最后成功状态 Marker、观察状态、风险事件，以及暂存正文是否已删除。在同一份仍有效的授权下恢复时，复用 Ledger，并按状态恢复：

- 打开记录的 `capturePage`，通过规范 Widget Key 和可见实例标签定位已添加 Widget；
- 实例唯一可定位时，不再添加 Widget，只补采 `blocked`、`failed` 或尚未执行的状态；
- 补充数据源 Profile 后，从 `data-bound` 继续，并重新执行依赖数据渲染的 `viewport-visible`、`preview-visible`；
- 实例无法唯一定位时记录 `blocked-existing-instance-ambiguous` 并停止，不得重新添加；
- 只有之前的记录能够证明 Widget 从未添加时，才能重新执行添加动作；添加结果不明确属于硬停止，不能自动重试。

## 仓库修改范围

更新：

- `SKILL.md`：自动化模式和一次授权流程；
- `references/scope-config.md`：自动化权限和 HTML Scope；
- `references/workshop-runbook.md`：无人值守 Widget 遍历；
- `references/mcp-autoconnect.md`、`references/cdp-boundaries.md`：允许使用的 MCP UI 工具；
- `agents/openai.yaml`：新的默认提示词；
- `README.md`、`README.en.md`：配置和调用方式；
- 契约测试和 importer 测试；
- 按 HTML 和 `component-assets.json` 需求修改 importer、merge、audit 脚本。

## 验证

遵循测试驱动开发：

1. 先添加失败的契约测试，要求支持自动化 UI 工具、一次授权、HTML document 采集和组件映射，同时继续禁止 `evaluate_script` 与 `xhr/fetch` HTML。
2. 添加失败的单元测试，覆盖 HTML 分类、校验、扩展名、合并、恢复、状态覆盖矩阵、数据源阻塞以及组件映射。
3. 只实现使测试通过的最小修改。
4. 运行全部 `*.test.mjs`、Skill 校验器、源码与两个安装副本的差异检查，并对 Skill 指令进行一次独立前向验证。
5. 只有更新后的 Skill 已安装、具体运行 Scope 已获批准，才执行真实 Workshop 采集。

## 完成标准

- 一次授权即可启动无人值守的可见 Widget 遍历；
- 正常流程不再逐 Widget 请求确认；
- 每个成功 Widget 都有 Marker 和组件映射记录；
- 每个 Widget 都完成适用的编辑器、配置、数据绑定、可视区和预览状态，或明确记录阻塞原因；
- 需要数据源的 Widget 只使用 Scope 映射的现有合成测试数据源；
- 获批 document HTML 能够采集，XHR/fetch HTML 继续排除；
- 共享资源和首次观察证据不会被夸大为组件独占归属；
- 硬停止条件会在继续读取正文或修改 UI 前终止流程；
- 源码测试、Skill 校验、安装副本一致性检查和前向验证全部通过。
