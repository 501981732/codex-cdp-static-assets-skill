# Codex CDP Workshop Widget 自动资源采集 Skill

[English](README.en.md)

这个 Skill 用一次汇总授权，自动遍历授权 Workshop 中当前账号可见的 Widget，通过真实可见 UI 添加组件、按需打开配置、使用当前 Module 已有的兼容变量并进入预览，再从 Chrome 已完成的 Network 记录中保存自然加载的 JS、CSS、WASM、图片和严格限定的 Document HTML。

它不重新请求资源 URL，不执行页面脚本，不复制登录凭证，也不把“首次观察到”误报为组件源码所有权。

## 安装

```bash
npx skills add https://github.com/501981732/codex-cdp-static-assets-skill \
  --skill codex-cdp-static-assets-skill \
  --agent codex \
  --global \
  --yes
```

安装或更新后，新建 Codex 任务并调用 `$codex-cdp-static-assets-skill`。

## Chrome 前置条件

使用已登录的日常默认 Chrome，要求 Chrome 144+：

```bash
codex mcp remove chrome-devtools
codex mcp add chrome-devtools -- \
  npx -y chrome-devtools-mcp@latest \
  --autoConnect \
  --no-usage-statistics \
  --no-performance-crux
```

重启 Codex，在 Chrome 打开 `chrome://inspect/#remote-debugging` 并启用 Remote debugging，再打开授权 Workshop 页面。Codex 连接时只需批准一次 Chrome 弹窗。

`autoConnect` 能枚举默认 Profile 的窗口。建议关闭无关敏感页面；Skill 只选择唯一匹配精确授权主机的页面，不留存其他标签页信息。Chrome 版本、MCP 工具或企业策略不满足时，流程暂停，不复制 Profile/Cookie/Token，也不另开登录会话。

## 开始方式

在新任务中发送：

```text
使用 $codex-cdp-static-assets-skill 自动采集这个 Workshop Module 的全部可见 Widget 资源：
https://workshop.example.com/module/edit/...

Case ID：SEC-2026-001
允许在专用测试 Module 中新增 CDP Capture 页面、添加 Widget、修改 Widget 配置并自动保存。
允许使用当前 Module 已有、Widget 可见类型选择器明确兼容的变量；禁止创建、修改或删除变量或数据源。
先做只含元数据的主机和 Widget 入口发现，把精确主机、动作、上限和数据源策略一次性列给我授权；授权后全自动执行。
采集 js、css、wasm、image，以及自然加载的顶层/Widget iframe Document HTML；默认不采集字体。
```

## 自动化流程

授权前只做 `list_pages`、精确页 `select_page`、`take_snapshot` 和 `list_network_requests` 元数据发现。Codex 随后给出 **single consolidated authorization**：精确主机、页面/自动保存权限、组件页上限、三状态矩阵、流量限制和现有 Module 变量使用策略。

授权一次后，Codex 自动执行：

1. 采集 `baseline`；预加载资源归为 `baseline/shared`，不会阻止全目录遍历。
2. 打开 Add Widget，滚动到底；连续两次无新规范 Key 后确认目录完成。
3. 每页按 Scope 的上限放组件；默认测试可设为 8 个，确定性创建 `CDP Capture 001`、`CDP Capture 002` 等页面。
4. Catalog 预览图和图标先归为 `baseline:catalog` 共享发现资源，再对每个 Widget 覆盖 `editor-mounted`、适用时的 `data-bound`、`preview-visible`。
5. 仅在基线、Catalog、添加组件、成功绑定数据或进入预览后检查网络；有新增请求/状态时才等待三次相同的请求 ID/状态观察，随后按 request ID 读取已完成响应并立即入库。
6. 每次状态写入可恢复事件；中断后定位唯一现有实例，只补缺失状态，不重复添加。
7. 从已保存的 baseline JS 导出 Widget 注册清单，再逐 run 审计并按 SHA-256/URL 合并，生成独立基线和每组件逆向视图。

可视区是执行前提，不再单列状态：Workshop 画布虚拟化或 `IntersectionObserver` 可能直到组件进入视口才渲染/加载。配置数据后还会再次滚回组件并等待渲染；预览仍单列，因为可能加载独立 runtime。

## 使用已有变量

- 组件没有数据源能力：`data-bound = not-applicable`，不影响完整度。
- Scope 设置 `allowExistingModuleVariables: true` 后，优先用人工预置并映射到精确可见选项的测试变量；否则保留当前兼容选择或选择 Widget 可见类型选择器提供的第一个启用兼容变量。
- Scope 有精确 Fixture 映射时，该映射优先于自动选择。
- 没有兼容变量：可选数据源记为 `not-requested`；必填数据源记为 `blocked-missing-fixture`，但继续采集其余状态和后续组件。

Skill 不检查隐藏候选，不创建、修改或删除变量或数据源，也不保存变量名和渲染数据。

## HTML 范围

HTML 只在以下条件全部成立时保留：资源类型是 `Document`，MIME 是 `text/html` 或 `application/xhtml+xml`，精确响应主机已授权，请求是无正文的 `GET`，状态为 200–399，且上下文是获批顶层页或 Widget iframe。

XHR、fetch、GraphQL/API HTML 一律排除；JS/CSS 返回 HTML 仍记为无效正文。正文缺失记录 `body-unavailable`，绝不补请求。

## 安全边界

允许的可见自动化工具包括 `take_snapshot`、`click`、`drag`、`fill`、`press_key` 和等待；只作用于获批 Module。Never use `evaluate_script`. Never set `requestFilePath`; 只允许把响应正文暂存到运行时 `os.tmpdir()` 下的 `responseFilePath`。

出现 unknown host、`401`、`403`、`429`、连续 `5xx`、CAPTCHA/MFA、掉线、账号警告、页面/Module 漂移、未授权写操作、组件添加/恢复歧义、流量/时间上限或负责人停止指令时，立即停止。

禁止发布、Action/Workflow、导出、权限变更、生产回写、隐藏路由、Chunk 枚举、sourcemap 探测、清缓存、绕 Service Worker、请求拦截和凭证提取。

## 结果

每个 run 保存内容寻址资源、脱敏 Manifest、`component-events.ndjson`、风险/无效事件和摘要。合并结果包含：

- `assets/`：按交付 URL 路径保存的去重资源；
- `metadata/manifest.ndjson`：SHA-256、URL、类型、Marker 和来源 run；
- `metadata/source-manifest.ndjson`：带 `sourceRun` 的原始观察事件；
- `metadata/component-events.ndjson`：全部状态尝试；
- `metadata/component-assets.json`：Case、baseline、每个 Widget 的 `assetCoverageStatus`、`behaviorCoverageStatus`、首次观察资源、正文缺失和历史失败；
- `metadata/widget-inventory.json`：baseline Bundle 已声明的 Type ID、Renderer、Chunk/模块 ID 和来源哈希；合并后通过 `retainedEvidence` 标出已落盘的 Chunk/模块文件、未留存 ID 和实现正文状态；
- `metadata/baseline-assets.json`：页面启动和共享资源，资源正文不重复存储；
- `metadata/components/*.json`：Input、Table 等组件各自的状态、首次观察资源引用、正文缺失、失败和已授权截图；
- `evidence/`：仅在 Scope 设置 `captureStateScreenshots: true` 时保存的元素级状态截图；
- `metadata/asset-audit.json`、`metadata/merge-summary.json`：完整性和覆盖摘要。

`firstObservedAssets` 会排除 `baseline` 和 `baseline:catalog`，并把同一 `(sha256, URL)` 只分配给最早的非共享 Widget Marker。它表示观察时序，不代表独占归属；数据 Fixture 缺失不会降低资源正文留存结论。
