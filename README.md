# 通过 CDP 合规采集静态资源

[English](README.en.md)

这是一个面向 Codex 的授权优先 Skill 和 Node.js 采集器。它只记录 Chrome 在正常页面操作中自然加载的 JS、CSS、WASM 和字体资源，不重放 URL、不禁用缓存、不扫描 sourcemap，也不导出浏览器凭据。

## 能力边界

- 先运行 **发现模式**：只记录自然出现的静态资源域名，不读取响应正文。
- 只有人工审核并写入 Scope 后，**严格采集模式** 才读取已完成请求的正文。
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
git clone https://github.com/501981732/codex-cdp-static-assets-skill.git \
  "$HOME/.codex/skills/capture-static-assets-cdp"
```

之后在 Codex 对话中调用 `$capture-static-assets-cdp`。

## 标准流程

1. 启动独立、可见的 Chrome，CDP 只监听 `127.0.0.1`。
2. 使用仅含页面主域名的 Scope 运行发现模式。
3. 审阅 `observed-hosts.json`，逐个确认自然出现的 CDN。
4. 将获批 CDN 精确写入严格采集 Scope。
5. 在正常可见 UI 操作前启动采集器。
6. 结束后运行离线审计。

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

发现自然加载的资源域名，不读取正文：

```bash
node scripts/capture-static-assets.mjs \
  --mode discover \
  --scope ./discovery-scope.json \
  --endpoint http://127.0.0.1:9222 \
  --output ./host-discovery
```

审核并补充 `capture-scope.json` 中的精确 `assetHosts` 后：

```bash
node scripts/capture-static-assets.mjs \
  --mode capture \
  --scope ./capture-scope.json \
  --endpoint http://127.0.0.1:9222 \
  --output ./authorized-assets

node scripts/audit-capture.mjs ./authorized-assets
```

完整规则见 [Scope 配置](references/scope-config.md)、[Workshop 操作手册](references/workshop-runbook.md) 与 [CDP 边界](references/cdp-boundaries.md)。

## 输出文件

- `observed-hosts.json`：发现模式的域名证据
- `manifest.ndjson`：有效资源与本地内容哈希
- `invalid-assets.ndjson`：被质量或预算规则拒绝的资源
- `risk-events.ndjson`：域名范围、状态码等风险事件
- `asset-audit.json`：离线完整性审计结果
- `summary.json`：本轮采集汇总

## 验证

```bash
node --test scripts/capture-static-assets.test.mjs scripts/audit-capture.test.mjs
```

## 许可证

[MIT](LICENSE)
