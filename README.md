# Codex CDP 静态资源采集使用手册

[English](README.en.md)

这是一个授权优先的 Codex Skill，用于保存 Chrome 在正常页面操作中自然加载的 JS、CSS、WASM 和字体资源。

你只操作可见 Chrome。Codex 负责启动和监控采集器、设置 Marker、执行停止条件、审计结果以及合并多轮输出。采集器不会自动点击页面、枚举 Chunk、重放 URL、扫描 sourcemap、读取 DOM、执行页面脚本，也不会保存原始 HTML 或 API 正文。

## 30 秒开始

安装完成后，新建一个 Codex 任务，然后发送：

```text
使用 $codex-cdp-static-assets-skill 帮我采集授权页面自然加载的静态资源。

目标页面：https://workshop.example.com/workspace/module/...
Case ID：SEC-2026-001
我只操作可见 Chrome，你负责采集器、Marker、状态检查、停止、审计和合并。
我目前只知道页面域名，不知道 CDN。
累计数量和总字节只记录，不设硬上限；单文件上限保留 50 MiB。
不要自动点击、读取 DOM、执行页面脚本或保存 HTML/API 正文。
先从基础 Discovery 开始，每一步等我确认。
```

不需要预先知道 CDN。Codex 会先运行不读取正文的 Discovery，生成精确主机候选；候选经过审核后才会进入严格采集 Scope。

## 安装 Skill

可以直接让 Codex 执行：

```text
请安装这个 Skill：
npx skills add https://github.com/501981732/codex-cdp-static-assets-skill \
  --skill codex-cdp-static-assets-skill \
  --agent codex \
  --global \
  --yes
```

对应命令是：

```bash
npx skills add https://github.com/501981732/codex-cdp-static-assets-skill \
  --skill codex-cdp-static-assets-skill \
  --agent codex \
  --global \
  --yes
```

安装后建议新建 Codex 任务，再使用 `$codex-cdp-static-assets-skill`，确保新安装的 Skill 已被加载。

## 使用前准备

至少准备这些信息：

| 信息 | 示例 | 说明 |
|---|---|---|
| 页面地址 | `https://workshop.example.com/...` | 允许只知道页面域名 |
| Case ID | `SEC-2026-001` | 用于 Scope、Ledger 和输出关联 |
| 测试账号 | 专用测试账号 | 不复用日常主账号 |
| 测试空间 | 专用 Workshop Module | 允许创建页面和自动保存 |
| 测试数据 | 合成对象、坐标、时间序列 | 不使用真实业务数据 |
| 停止条件 | `401/403/429`、登录挑战等 | Codex 发现后立即停止 |
| 时间窗口 | 经批准的测试时段 | 固定账号、角色、语言和浏览器 |

书面授权应覆盖静态产物留存、测试 Module 的创建和编辑、允许的页面及主机、保存期限和接收人员。

## 双方分工

**你负责：**

- 在可见 Chrome 中正常登录；
- 创建测试 Module 和页面；
- 添加 Widget；
- 打开配置、预览和只读交互状态；
- 在对话中告诉 Codex 当前要做什么；
- 审核候选主机和是否继续。

**Codex 负责：**

- 启动专用 Chrome 和 CDP 采集器；
- 生成 Discovery Scope 与严格 Capture Scope；
- 根据你的聊天检查点写入 Marker；
- 检查网络安静时间、风险事件和 Build ID；
- 停止并排空已经完成的响应正文；
- 每轮审计，最终离线去重合并；
- 返回覆盖范围、缺口和风险报告。

## 完整流程

### 1. 登录与基础 Discovery

先对 Codex 说：

```text
启动专用 Chrome 和基础 Discovery。我登录完成后告诉你。
```

在 Chrome 中正常登录，关闭无关标签页，只保留授权页面需要的一个标签页。完成后回复：

```text
已登录，可以开始基础 Discovery。
```

Codex 应该返回：

- Discovery 是否已连接 CDP；
- 当前页面 Target 数量；
- Discovery 输出目录；
- 明确说明此阶段不读取响应正文；
- 提示你何时可以打开 Workshop 空白页。

正常打开空白 Workshop 和基础导航，稳定后回复：

```text
基础页面加载完成。
```

### 2. 审核主机候选

Codex 会读取：

- `observed-network-hosts.json`；
- `observed-hosts.json`；
- `scope-candidates.json`。

它应把主机分成静态资源主机和 network-only 主机，并解释每个主机的观察依据。候选不代表自动批准。

批准时可以回复：

```text
批准这批基础候选主机进入本次 Case 的严格 Scope。
```

同源 CAS 路径会直接使用页面主机，例如：

```text
/assets/content-addressable-storage/frontend/<hash>.js
```

不要根据旧环境猜测或添加宽泛 CDN 通配符。

### 3. 开始严格采集

对 Codex 说：

```text
开始严格采集 P0 空白基线，使用同一个 Ledger，累计硬上限关闭。
```

Codex 应该返回：

- Capture 输出目录；
- Ledger 路径；
- 获批页面、静态资源和 network-only 主机；
- 单文件上限；
- 当前 Workshop Build ID，若尚未识别则标记为未知；
- `P0:baseline` Marker 已就绪。

只有看到“Marker 已就绪”后，再操作页面。

### 4. 创建测试 Module

推荐只创建一个测试 Module，在里面按类别建立页面：

| 页面 | Widget 类型 |
|---|---|
| P0 | 空白基线 |
| P1 | 布局、文本、按钮、输入 |
| P2 | 表格、列表、筛选、对象视图 |
| P3 | 图表、地图、时间线、媒体 |
| P4 | 弹窗、抽屉、菜单、交互组件 |
| P5 | 编辑器、嵌入、复杂配置 |
| P6 | 授权范围内的特殊 Widget |

每页约 8-10 个 Widget。不要把全部组件放在一个页面，也不要进入隐藏、内部或权限受限的插件。

### 5. 采集一个 Widget

Marker 必须在操作之前设置。以 ObjectTable 为例，先发送：

```text
开始 P2:ObjectTable:edit-mounted
```

Codex 写入 Marker 后应回复：

```text
Marker 已就绪：P2:ObjectTable:edit-mounted。现在可以添加 ObjectTable。
```

这时再在可见页面中添加组件。组件稳定后回复：

```text
ObjectTable 编辑态加载完成，请检查状态。
```

准备打开配置面板时，再发送：

```text
开始 P2:ObjectTable:config-open
```

等 Codex 回复 Marker 已就绪，再打开配置。预览和只读交互同理：

```text
开始 P2:ObjectTable:preview-mounted
开始 P2:ObjectTable:filter-open
开始 P2:ObjectTable:column-settings
```

Codex 不会替你点击页面。它会在每个检查点查看采集数量、最后网络事件时间、风险事件和 Build ID。

### 6. 编辑态与运行态

一个 Widget 至少考虑两类状态：

- 编辑态：组件挂载、配置面板、数据绑定、样式页签；
- 运行态：预览挂载、筛选、弹窗、抽屉、虚拟滚动和只读交互。

不执行 Action、Workflow、Writeback、发布、导出、审批、权限修改或真实业务写入。无法安全触发的状态记录为未覆盖。

### 7. 遇到未知主机

严格采集发现未知请求或 WebSocket 主机时会停止，不保存该主机正文，也不会自动重试。

Codex 应该返回：

- 精确主机名；
- 首次出现的 Marker；
- 资源类型或 network-only 判断；
- 风险事件路径；
- 当前 Ledger 使用量；
- 是否只需重试当前 Widget。

审核通过后回复：

```text
批准该精确主机，更新 Scope，使用原 Ledger 新开一个 Capture 目录，并重试当前 Widget。
```

只重试当前 Widget，不重新遍历全部页面。

### 8. 结束一个批次

完成 8-10 个组件后发送：

```text
结束当前批次，停止并排空已完成响应，然后审计本轮。
```

Codex 应该返回：

- 保存事件数与唯一文件数；
- JS、CSS、WASM、字体数量；
- 正文不可用、无效资源和全零占位数量；
- 风险事件及停止原因；
- Workshop Build ID；
- Ledger 记录量；
- 本批次覆盖的 Marker。

### 9. 继续下一轮

发送：

```text
开始下一批，复用当前 Scope 和 Ledger，新建 Capture 输出目录。
```

每轮必须使用新的输出目录，但复用同一个 Ledger。不要手动扣减 Scope 中的限制。

### 10. 合并与完成验收

所有批准批次完成后发送：

```text
合并全部 Capture 目录，按 SHA-256 去重，检查 Build 一致性并审计最终目录。
```

Codex 应该返回以下完成验收信息：

- 合并目录绝对路径；
- 来源运行列表；
- 保存事件数、唯一文件数和重复事件数；
- 唯一总字节量；
- Build ID 及一致性结果；
- 风险、无效资源和正文不可用统计；
- `visible-and-covered`、`visible-not-covered`、`registered-not-visible` 覆盖分类；
- 明确声明结果只包含批准场景中实际加载的生产静态产物。

## 预算怎么设置

推荐默认值：

```json
{
  "maxAssets": 0,
  "maxTotalMiB": 0,
  "maxAssetMiB": 50
}
```

`0` 表示不因累计数量或总字节自动停止，但 Ledger 仍持续记录。单文件上限用于保护本机内存和磁盘。

累计保存量不等于服务器流量。真正控制访问负载的是小批次、一次一个组件状态、固定测试窗口、正常缓存和操作者及时停止页面动作。

## 立即停止的情况

出现以下任一情况，不自动重试：

- `401`、`403`、`429`；
- CAPTCHA、MFA、重新登录或账号警告；
- 未批准主机；
- Workshop Build 发生变化；
- 意外写入、发布、导出或权限变化；
- 重复 `5xx`；
- SOC 或系统所有者要求停止。

## 你最终能拿到什么

- 实际加载的混淆或最小化生产 JS；
- CSS、WASM、字体，以及明确批准的图片；
- 每个资源的本地 SHA-256、大小、缓存来源和 Marker；
- 多轮去重后的交付目录；
- Build 一致性、风险事件和质量审计；
- 可见 Widget 编辑态和运行态的覆盖记录。

不会得到：

- 未触发的 Lazy Chunk；
- 隐藏或无权限插件；
- 原始源码和未经批准的 sourcemap；
- 后端代码；
- API、GraphQL、WebSocket 正文；
- 原始 HTML、功能开关、用户配置或凭据。

## 常见问题

### 我不知道 CDN 怎么办？

只提供页面域名即可。先做基础 Discovery；同源 CAS 资源自动归入页面主机，其他精确主机经过审核后再加入 Scope。

### 页面操作了，但没有新文件

可能是组件没有真正挂载、资源已由共享 Bundle 提供，或者正文来自缓存但不可读取。让 Codex 检查 `status`、Marker、最后网络事件和 `body-unavailable`，不要清缓存或重放 URL。

### 出现全零或 HTML 伪装的 JS

采集器会拒绝保存，并记录在 `invalid-assets.ndjson`。旧式手动下载常见这种失败文件，不能通过改扩展名恢复。

### 为什么不能把所有组件一次性放进页面？

这会产生集中请求、降低组件与 Chunk 的关联质量，并且仍可能漏掉折叠状态、弹窗和配置页签的 Lazy Chunk。

### 为什么合并失败？

如果不同运行识别出不同 Workshop Build ID，合并器会拒绝混合。应按 Build 分开交付，不要绕过检查。

### 可以让 Codex 自动添加 Widget 吗？

本 Skill 默认禁止。安全优先模式下，页面操作由用户完成，Codex 只管理本地采集会话和离线结果。

## 高级：手动命令

大多数 Codex 用户不需要直接运行这些命令。

启动可见 Chrome：

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.cdp-authorized-test-profile"
```

Discovery：

```bash
node skills/codex-cdp-static-assets-skill/scripts/capture-static-assets.mjs \
  --mode discover \
  --scope ./discovery-scope.json \
  --endpoint http://127.0.0.1:9222 \
  --output ./host-discovery
```

严格采集：

```bash
node skills/codex-cdp-static-assets-skill/scripts/capture-static-assets.mjs \
  --mode capture \
  --scope ./capture-scope.json \
  --endpoint http://127.0.0.1:9222 \
  --ledger ./task-ledger.ndjson \
  --output ./capture-run-1
```

审计与合并：

```bash
node skills/codex-cdp-static-assets-skill/scripts/audit-capture.mjs ./capture-run-1

node skills/codex-cdp-static-assets-skill/scripts/merge-captures.mjs \
  --output ./capture-merged \
  ./capture-run-1 ./capture-run-2

node skills/codex-cdp-static-assets-skill/scripts/audit-capture.mjs ./capture-merged
```

完整规则见 [Scope 配置](skills/codex-cdp-static-assets-skill/references/scope-config.md)、[Workshop 操作手册](skills/codex-cdp-static-assets-skill/references/workshop-runbook.md) 和 [CDP 边界](skills/codex-cdp-static-assets-skill/references/cdp-boundaries.md)。

## 验证

```bash
node --test skills/codex-cdp-static-assets-skill/scripts/*.test.mjs
```

## 许可证

[MIT](LICENSE)
