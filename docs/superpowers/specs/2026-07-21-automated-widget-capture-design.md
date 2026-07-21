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
- 允许自动执行的 UI 操作；
- 要覆盖的 Widget 状态：`editor`、`config` 和/或 `preview`；
- 禁止动作和停止条件。

发现阶段可以选择唯一获批页面、在内存中检查无障碍快照并列出 Network 元数据，但不能留存响应正文。系统应一次性展示全部精确主机候选和自动化动作集合。用户批准后，不再设置逐 Widget 检查点。

不得静默批准未知主机。授权后若出现新主机，立即停止；只有取得新的授权后才能继续。

Widget 状态选择属于整次运行配置。未指定时默认只覆盖 `editor`。对每个选定状态，仅在可见 Widget UI 确实支持时执行；否则记录为 `not-applicable`，不得推测或暴露隐藏配置、预览路由。

## 自动化 UI 边界

仅允许执行采集所需的可见、同页面操作：

- 刷新或重新访问精确获批页面；
- 在内存中获取无障碍快照；
- 点击、搜索、滚动和键盘导航；
- 打开 Add Widget 并选择可见目录项；
- 添加 Widget 必须使用拖放时执行拖放；
- Scope 明确包含时，打开 Widget 配置或预览；
- 等待可见状态和 Network 稳定。

不得持久化无障碍快照或无关标签页元数据。

禁止执行：

- `evaluate_script`、页面上下文 JavaScript、隐藏路由发现、DOM/源码提取或内部注册表枚举；
- 发布、执行 Action 或 Workflow、导出、修改权限、生产回写或删除业务数据；
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
5. 对每个可见 Widget：
   - 分配稳定 Marker，例如 `widget:object-table:a1b2c3d4`；
   - 只执行一次可见添加动作；
   - 任何重试前先检查页面状态；结果不明确时停止；
   - 在运行超时时间内，等待 Network 请求身份和状态连续两次轮询保持不变；
   - 读取正文前检查所有已观察主机和状态；
   - 立即导入新观察到的获批响应，并删除暂存正文；
   - 审计本轮结果，追加 Widget 记录；
   - 自动继续下一个 Widget。
6. 发生硬停止事件时立即停止；否则只合并一次，生成组件映射并审计合并结果。

只有 Scope 明确允许创建页面和自动保存时，自动化流程才能创建新的采集页面。不得自动删除这些页面。恢复运行时按规范 Widget Key 对比，而不是按目录顺序判断，因此目录重新排序不会跳过或重复已完成 Widget。

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
      "marker": "widget:object-table:a1b2c3d4",
      "status": "captured",
      "states": { "editor": "captured", "config": "not-requested", "preview": "not-requested" },
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

始终输出 baseline 记录。每个尝试过的规范 Widget Key 都必须输出一条组件记录，包括失败尝试。合并时按 `widgetKey` 汇总组件记录；按 `(sha256, 脱敏 URL)` 去重资源；保留最早的首次观察 Marker；合并全部 `bodyUnavailable` 条目；保留所有不同失败；按 `(at, sourceRun)` 追加每次尝试。

汇总状态必须确定性计算：只要任一次尝试完成采集，组件状态即为 `captured`；否则使用最后一次终态尝试的状态。每个已请求状态只要任一次成功采集即为 `captured`；否则，任一次失败则为 `failed`；其余情况为 `not-applicable`。只有没有任何运行请求该状态时才保留 `not-requested`。即使后续尝试成功，历史失败仍保留在 `failures` 和 `attempts` 中。组件按 `widgetKey` 排序，资源按 `(kind, URL, sha256)` 排序，以确保输出稳定。

证据分类如下：

- `baseline/shared`：添加任何 Widget 前已经观察到；
- `first-observed`：首次在该 Widget Marker 下出现；
- `body-unavailable`：观察到请求，但 Chrome 已无法提供响应正文；
- `failed`：UI 或采集失败，并记录原因。

对于因缓存而没有产生可观察证据的资源，不得虚构 `reused-by` 关系。

## 失败处理

遇到以下情况停止且不自动重试：

- 未知主机、页面离开获批主机/Module，或出现未授权写操作；
- `401`、`403`、`429`、重复 `5xx`、CAPTCHA、MFA、掉线或账号警告；
- 添加结果不明确，可能造成 Widget 重复；
- 达到授权方规定的流量或时间上限；
- 授权方或 SOC 要求停止。

记录当前 Widget Key、最后成功 Marker、观察状态、风险事件，以及暂存正文是否已删除。在同一份仍有效的授权下恢复时，复用 Ledger，并跳过已经成功记录的 Widget Key。只有之前的记录能够证明 Widget 未添加时，才能重试失败 Widget；添加结果不明确属于硬停止，不能自动重试。

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
2. 添加失败的单元测试，覆盖 HTML 分类、校验、扩展名、合并、恢复以及组件映射。
3. 只实现使测试通过的最小修改。
4. 运行全部 `*.test.mjs`、Skill 校验器、源码与两个安装副本的差异检查，并对 Skill 指令进行一次独立前向验证。
5. 只有更新后的 Skill 已安装、具体运行 Scope 已获批准，才执行真实 Workshop 采集。

## 完成标准

- 一次授权即可启动无人值守的可见 Widget 遍历；
- 正常流程不再逐 Widget 请求确认；
- 每个成功 Widget 都有 Marker 和组件映射记录；
- 获批 document HTML 能够采集，XHR/fetch HTML 继续排除；
- 共享资源和首次观察证据不会被夸大为组件独占归属；
- 硬停止条件会在继续读取正文或修改 UI 前终止流程；
- 源码测试、Skill 校验、安装副本一致性检查和前向验证全部通过。
