# Codex CDP 静态资源采集 Skill

[English](README.en.md)

这是一个授权优先、仅监听的 Codex Skill。它保存可见 Chrome 在正常页面操作中已经自然加载完成的 JS、CSS、WASM、字体和可选图片，并生成脱敏清单、哈希、Ledger 和审计报告。

你负责登录、刷新、添加组件和预览；Codex 只检查当前页面的 Network 记录和已完成响应正文。它不会自动点击、枚举 Chunk、扫描 sourcemap、重放 URL、清缓存、绕 Service Worker，也不会复制 Cookie 或登录凭证。

## 安装 Skill

```bash
npx skills add https://github.com/501981732/codex-cdp-static-assets-skill \
  --skill codex-cdp-static-assets-skill \
  --agent codex \
  --global \
  --yes
```

安装或更新后，新建一个 Codex 任务再调用 `$codex-cdp-static-assets-skill`。

## 默认 Chrome 登录态

目标账号使用日常默认 Chrome 的登录态，通过 Chrome 144+ 官方 `autoConnect` 连接。

一次性配置：

```bash
codex mcp remove chrome-devtools
codex mcp add chrome-devtools -- \
  npx -y chrome-devtools-mcp@latest \
  --autoConnect \
  --no-usage-statistics \
  --no-performance-crux
```

重启 Codex。然后在已经登录的默认 Chrome 中：

1. 打开 `chrome://inspect/#remote-debugging`。
2. 开启 Remote debugging。
3. 打开授权目标页面。
4. Codex 发起连接时，在 Chrome 弹窗中点击允许。

`autoConnect` 可以看到该默认 Profile 的全部窗口。建议暂时关闭无关敏感页面；Skill 只选择唯一匹配授权域名的页面，不保存其他标签页的信息。

Chrome 低于 144、MCP 工具不可用或企业策略禁止连接时，Skill 会直接暂停并报告缺少的条件。它不会启动或要求另一个浏览器会话，也不会复制 Profile、Cookie、Token 或密码来绕过登录限制。

## 30 秒开始

在新 Codex 任务中发送：

```text
使用 $codex-cdp-static-assets-skill 对下面的授权页面做一次仅监听、低侵入的静态资源采集。

页面：https://workshop.example.com/...
Case ID：SEC-2026-001
使用当前默认 Chrome 的登录态和 autoConnect，由我操作可见页面。
我不知道 CDN，请先发现精确主机，不要自动批准。
授权允许编辑专用测试 Module 及自动保存，但不允许发布、Action、Workflow、导出、改权限或生产回写。
每一步等我确认。
```

## 最简单流程

你通常只需要依次回复：

```text
已登录并打开空白 Workshop
发现刷新完成
批准全部候选
严格基线完成
P1 完成
P2 完成
全部完成
```

### 1. 发现主机

Codex 先通过 `list_pages` 选择唯一授权页面，再让你手动刷新和做一次代表性操作。完成后，Codex 只用 `list_network_requests` 查看当前页面自然产生的请求，不读取正文。

你和授权方一次确认精确的静态资源主机和网络依赖主机。候选不会自动进入白名单，也不会使用宽泛 CDN 通配符。

### 2. 严格基线

批准 Scope 后，你手动刷新空白 Workshop。Codex 先检查完整请求列表；如果出现未知主机、`401`、`403`、`429`、连续 `5xx` 或账号异常，就在读取正文前停止。

对已批准且加载完成的静态资源，Codex 使用 `get_network_request` 将响应正文写入临时文件，再由本地脚本校验类型、大小、白名单和 SHA-256。它不会再次请求资源 URL。正文不可用时只记 `body-unavailable`，不补请求。

### 3. 判断是否按需加载

- **已预加载**：基线已有大量 widget/component/plugin 包，停止批量添加，直接离线整理。
- **按需加载**：基线主要是页面外壳，再按 P1、P2 分批添加组件。

每批约 5-10 个相关组件。一个批次尽量保持在同一次页面导航中，并在跳转前回复“P1 完成”，让 Codex及时入库该批 Network 记录。默认每批一个 Marker。

### 4. 审计和合并

Codex 每轮审计无效正文、风险事件和 Ledger。全部完成后按 SHA-256 合并去重，再审计最终目录。

## 立即停止

遇到以下任一情况都停止且不自动重试：

- `401`、`403`、`429` 或连续 `5xx`；
- CAPTCHA、MFA、掉线、账号警告；
- 未批准主机或意外写操作；
- 达到授权方的请求量、流量或时间上限；
- 授权方或 SOC 要求停止。

## 输出

- `assets/`：按 SHA-256 保存的 JS、CSS、WASM、字体和可选图片；
- `manifest.ndjson`：脱敏 URL、哈希、大小、类型和 Marker；
- `task-ledger.ndjson`：跨批次累计记录；
- `risk-events.ndjson`、`invalid-assets.ndjson`、`asset-audit.json`；
- `merge-summary.json`：最终去重结果。

结果是浏览器实际观察到的部署产物，不是原始源码，也不包含未触发分支、后端代码或未经授权的角色资源。

## 验证

```bash
node --test skills/codex-cdp-static-assets-skill/scripts/*.test.mjs
python3 /path/to/skill-creator/scripts/quick_validate.py \
  skills/codex-cdp-static-assets-skill
```

## 许可证

[MIT](LICENSE)
