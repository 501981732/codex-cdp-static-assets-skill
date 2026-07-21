# Codex CDP Workshop Widget 自动资源采集 Skill

[English](README.en.md)

这个 Skill 用一次汇总授权，自动遍历授权 Workshop 中当前账号可见的 Widget，通过真实可见 UI 添加组件、滚动进可视区、打开配置、绑定获批合成数据并进入预览，再从 Chrome 已完成的 Network 记录中保存自然加载的 JS、CSS、WASM、字体、图片和严格限定的 Document HTML。

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
只允许使用我批准的现有合成测试数据源；禁止创建、修改或删除数据源。
先做只含元数据的主机和 Widget 入口发现，把精确主机、动作、上限和 Fixture 映射一次性列给我授权；授权后全自动执行。
采集 js、css、wasm、font、image，以及自然加载的顶层/Widget iframe Document HTML。
```

## 自动化流程

授权前只做 `list_pages`、精确页 `select_page`、`take_snapshot` 和 `list_network_requests` 元数据发现。Codex 随后给出 **single consolidated authorization**：精确主机、页面/自动保存权限、组件页上限、五个状态、流量限制和合成 Fixture 映射。

授权一次后，Codex 自动执行：

1. 采集 `baseline`；预加载资源归为 `baseline/shared`，不会阻止全目录遍历。
2. 打开 Add Widget，滚动到底；连续两次无新规范 Key 后确认目录完成。
3. 每页放 5–10 个组件，确定性创建 `CDP Capture 001`、`CDP Capture 002` 等页面。
4. 对每个 Widget 覆盖 `editor-mounted`、`viewport-visible`、`config-opened`、`data-bound`、`preview-visible`。
5. 每个状态都先检查全部主机/状态码，再等待三次相同的请求 ID/状态观察，随后按 request ID 读取已完成响应并立即入库。
6. 每次状态写入可恢复事件；中断后定位唯一现有实例，只补缺失状态，不重复添加。
7. 逐 run 审计，最终按 SHA-256/URL 合并，同时生成全量组件索引、独立基线和每组件逆向视图。

可视区步骤是必需的：Workshop 画布虚拟化或 `IntersectionObserver` 可能直到组件进入视口才渲染/加载。配置数据后还会再次滚回组件并等待渲染。

## 没有数据源也可以

- 组件没有数据源能力：`data-bound = not-applicable`，不影响完整度。
- 数据源可选、Scope 没映射：`data-bound = not-requested`，保留无数据状态，不影响完整度。
- 数据源必填、Scope 没有获批映射：`blocked-missing-fixture`，结果为部分覆盖。
- Scope 有映射：只选择映射的现有合成数据源，保存配置后再次进入可视区采集。

Skill 不会随便选择第一个数据源，不会回退到真实业务数据，也不会创建、修改或删除数据源。

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
- `metadata/component-assets.json`：Case、baseline、每个 Widget 的状态覆盖、首次观察资源、正文缺失和历史失败；
- `metadata/baseline-assets.json`：页面启动和共享资源，资源正文不重复存储；
- `metadata/components/*.json`：Input、Table 等组件各自的状态、首次观察资源引用、正文缺失、失败和已授权截图；
- `evidence/`：仅在 Scope 设置 `captureStateScreenshots: true` 时保存的元素级状态截图；
- `metadata/asset-audit.json`、`metadata/merge-summary.json`：完整性和覆盖摘要。

`firstObservedAssets` 会排除 baseline，并把同一 `(sha256, URL)` 只分配给最早的非 baseline Widget Marker。它表示观察时序，不代表独占归属。
