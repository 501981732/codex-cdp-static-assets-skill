# 通过 CDP 合规采集静态资源

[English](README.en.md)

这是一个面向 Codex 的授权优先 Skill 和 Node.js 采集器。它只记录 Chrome 在正常页面操作中自然加载的 JS、CSS、WASM 和字体资源，不重放 URL、不禁用缓存、不扫描 sourcemap，也不导出浏览器凭据。

## 能力边界

- 先运行 **发现模式**：记录所有自然出现的网络主机元数据，并区分静态资源与网络通信主机，不读取响应正文。
- 只有人工审核并写入 Scope 后，**严格采集模式** 才读取已完成请求的正文。
- 自动生成未批准的 `scope-candidates.json`，支持整份 Scope 一次性审核，而不是逐个域名反复确认。
- 使用 append-only ledger 跨轮累计资源数和字节预算。
- 多轮输出可离线按 SHA-256 去重合并。
- 只使用 `Network.getResponseBody(requestId)` 读取浏览器已经收到的响应。
- 覆盖页面、iframe、Worker、Shared Worker 和 Service Worker。
- 以本地计算的 SHA-256 保存有效资源。
- 自动拒绝空文件、全零占位、HTML 伪装的 JS/CSS、无效 WASM/字体文件头和超预算资产。
- 采集结束后可离线审计输出目录。

本工具仅适用于已获得书面授权、需要低影响和可审计证据采集的场景。它不用于规避检测、枚举 chunk、重放凭据、扫描 sourcemap 或绕过访问控制。

## 环境要求

- Node.js 22 及以上
- 启用本机 CDP 调试端口的 Chrome/Chromium
- 独立浏览器 Profile 与授权测试账号

## 作为 Codex Skill 安装

```bash
npx skills add https://github.com/501981732/codex-cdp-static-assets-skill \
  --skill capture-static-assets-cdp \
  --agent codex \
  --global \
  --yes
```

安装器会从 `skills/capture-static-assets-cdp/` 发现完整技能目录，包括 `SKILL.md`、脚本和参考文档。之后在 Codex 新对话中调用 `$capture-static-assets-cdp`。

## 标准流程

1. 启动独立、可见的 Chrome，正常登录后关闭无关标签，只保留一个 `about:blank` 标签页。
2. 使用仅含页面主域名的 Scope 启动发现模式，再在同一标签页打开目标页面。
3. 审阅 `observed-network-hosts.json`、`observed-hosts.json` 和 `scope-candidates.json`，一次性批准整份精确主机清单。
4. 将获批静态主机写入 `assetHosts`，API、身份、遥测和图片主机写入 `approvedNetworkHosts`。
5. 严格采集的每个续跑目录都复用同一个 `--ledger`，Scope 中始终保留原始总预算。
6. 每轮运行离线审计，最后使用 `merge-captures.mjs` 合并为去重交付目录。

启动 Chrome：

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.cdp-authorized-test-profile"
```

发现模式 Scope 示例 `discovery-scope.json`：

```json
{
  "caseId": "SEC-2026-001",
  "pageHosts": ["workshop.example.com"],
  "types": ["js", "css", "wasm", "font"],
  "limits": { "maxAssets": 0, "maxTotalMiB": 0, "maxAssetMiB": 50 },
  "stopOnStatuses": [401, 403, 429]
}
```

发现全部自然网络主机并生成未批准候选，不读取正文：

```bash
node skills/capture-static-assets-cdp/scripts/capture-static-assets.mjs \
  --mode discover \
  --scope ./discovery-scope.json \
  --endpoint http://127.0.0.1:9222 \
  --output ./host-discovery
```

批量审核并补充 `capture-scope.json` 中的精确 `assetHosts` 与 `approvedNetworkHosts` 后：

```bash
node skills/capture-static-assets-cdp/scripts/capture-static-assets.mjs \
  --mode capture \
  --scope ./capture-scope.json \
  --endpoint http://127.0.0.1:9222 \
  --ledger ./task-ledger.ndjson \
  --output ./authorized-assets-run-1

node skills/capture-static-assets-cdp/scripts/audit-capture.mjs ./authorized-assets-run-1

node skills/capture-static-assets-cdp/scripts/merge-captures.mjs \
  --output ./authorized-assets-merged \
  ./authorized-assets-run-1 ./authorized-assets-run-2

node skills/capture-static-assets-cdp/scripts/audit-capture.mjs ./authorized-assets-merged
```

完整规则见 [Scope 配置](skills/capture-static-assets-cdp/references/scope-config.md)、[Workshop 操作手册](skills/capture-static-assets-cdp/references/workshop-runbook.md) 与 [CDP 边界](skills/capture-static-assets-cdp/references/cdp-boundaries.md)。

## 输出文件

- `observed-hosts.json`：发现模式的域名证据
- `observed-network-hosts.json`：包括 API、身份、遥测和图片请求在内的完整网络主机证据
- `scope-candidates.json`：等待批量审核的精确主机候选，不代表自动批准
- `task-ledger.ndjson`：跨轮累计预算账本
- `manifest.ndjson`：有效资源与本地内容哈希
- `invalid-assets.ndjson`：被质量或预算规则拒绝的资源
- `risk-events.ndjson`：域名范围、状态码等风险事件
- `asset-audit.json`：离线完整性审计结果
- `summary.json`：本轮采集汇总
- `merge-summary.json`：多轮去重合并汇总

## 验证

```bash
node --test \
  skills/capture-static-assets-cdp/scripts/capture-static-assets.test.mjs \
  skills/capture-static-assets-cdp/scripts/audit-capture.test.mjs \
  skills/capture-static-assets-cdp/scripts/merge-captures.test.mjs
```

## 许可证

[MIT](LICENSE)
