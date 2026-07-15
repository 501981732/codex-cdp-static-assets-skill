# Codex CDP 静态资源采集 Skill

[English](README.en.md)

这是一个授权优先、仅监听的 Codex Skill。它保存 Chrome 在正常页面操作中自然加载完成的 JS、CSS、WASM 和字体，可选保存已授权图片。

你只操作可见 Chrome。Codex 负责发现主机、运行采集器、检查风险、审计和合并。它不会自动点击、读取 DOM、执行页面脚本、枚举 Chunk、扫描 sourcemap、重放 URL，也不会保存 HTML 或 API 正文。

## 30 秒开始

安装后，在新的 Codex 任务中发送：

```text
使用 $codex-cdp-static-assets-skill 对下面的授权页面做一次仅监听、低侵入的静态资源采集。

页面：https://workshop.example.com/...
Case ID：SEC-2026-001
我只操作可见 Chrome，你负责发现主机、严格基线、风险检查、审计和合并。
我不知道 CDN，请先做一次 Discovery，不要自动批准主机。
组件可能自动保存，授权允许编辑专用测试 Module，但不允许发布、执行 Action/Workflow、导出、改权限或写入生产数据。
累计数量和总字节只记录，单文件上限 50 MiB。
每一步等我确认。
```

不需要预先知道 CDN。Discovery 只记录浏览器自然访问过的主机，不读取响应正文；候选主机经过确认后才进入严格 Scope。

## 安装

```bash
npx skills add https://github.com/501981732/codex-cdp-static-assets-skill \
  --skill codex-cdp-static-assets-skill \
  --agent codex \
  --global \
  --yes
```

安装后新建一个 Codex 任务，再调用 `$codex-cdp-static-assets-skill`。

需要 Node.js 22 或更高版本，以及支持 loopback CDP 的 Chrome/Chromium。

## 开始前

准备这些信息：

| 项目 | 要求 |
|---|---|
| 授权 | Case ID、测试账号、页面、时间窗口、资产类型、流量上限、停止联系人 |
| 测试空间 | 专用 Workshop Module，允许创建、编辑及自动保存 |
| 测试数据 | 使用合成数据，不使用真实客户或生产数据 |
| Chrome | 专用可见 Profile，一个标签页，CDP 只监听 `127.0.0.1` |
| 禁止操作 | 发布、Action、Workflow、导出、删除、改权限、生产回写 |

添加组件可能触发自动保存，因此这项写操作必须明确写进授权。仅写“允许浏览页面”是不够的。

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

具体含义如下。

### 1. 发现一次

你先在专用 Chrome 中正常登录并打开空白 Workshop，然后回复“已登录并打开空白 Workshop”。Codex 启动 Discovery 后，你在可见页面中手动刷新并做一次代表性的基础导航，然后回复：

```text
发现刷新完成
```

Codex 检查：

- `observed-network-hosts.json`：页面自然访问过的全部网络主机；
- `observed-hosts.json`：提供静态资源的主机；
- `scope-candidates.json`：待确认的精确主机候选。

候选不是自动批准。确认它们属于本次页面后回复：

```text
批准全部候选
```

Discovery 只做一次。以后只有出现新的精确主机时才暂停复核。

### 2. 采集严格基线

Codex 启动严格采集器并设置 `P0:baseline`。你在可见 Chrome 中刷新或重新打开空白页面，页面稳定后回复：

```text
严格基线完成
```

### 3. 基线判断

Codex 先离线检查基线资源，再决定是否需要批量添加组件：

- **已预加载**：基线里已经有大量 widget、component 或 plugin 包。停止批量添加，直接离线整理；最多验证 1-3 个代表组件。
- **按需加载**：基线主要只有页面外壳。再创建 P1、P2 等组件批次。

这个基线判断能避免为了“找 Chunk”而无意义地添加几十个组件。

### 4. 按批采集

只有确认是按需加载时才继续。每页放约 5-10 个相关组件，例如：

| 批次 | 示例 |
|---|---|
| P1 | 输入、按钮、布局、Tabs |
| P2 | Table、List、Filter、对象视图 |
| P3 | Chart、Map、Timeline、Media |
| P4 | Dialog、Drawer、Menu、复杂编辑器 |

一个批次只启动一次采集器。采集器启动后，你连续完成该页的添加、编辑态、配置态和预览态；不要每加一个组件就停一次。完成后只回复：

```text
P1 完成
```

默认每批一个 Marker。只有某个重要组件的归属确实模糊时，才额外使用组件级 Marker 或单组件验证页。

### 5. 审计和合并

Codex 每轮运行审计，检查无效正文、未知主机、状态码和 Ledger。全部批次结束后回复：

```text
全部完成
```

Codex 最后只合并一次，按 SHA-256 去重，再审计合并目录并完成验收。

## 缓存怎么处理

默认使用同一个 Profile 完成 Discovery 和严格采集。这是侵入性最低的选择，但已经进入浏览器缓存的资源可能显示为 `body-unavailable` 或空 `304`。记录缺口即可，不主动补请求。

如果授权方确实要求更完整的响应正文，可以单独批准“新 Capture Profile”方案：退出 Discovery Profile，在新的专用 Profile 中正常登录，只执行已批准的严格基线。第二次登录可能引起额外账号审核，因此不是默认方案。

无论哪种方案，都不清缓存、不禁用缓存、不绕 Service Worker、不复用 Cookie、不主动重放资源 URL。

## 遇到新主机

严格采集中出现未知主机时，Codex 立即停止。你和授权方确认这个精确主机后，只重试受影响的批次或组件，不重复已经完成的页面，也不使用宽泛 CDN 通配符。

## 立即停止

遇到以下任一情况都停止且不自动重试：

- `401`、`403`、`429` 或连续 `5xx`；
- CAPTCHA、MFA、掉线、账号警告；
- 未批准主机或意外写操作；
- 达到授权方的请求量、流量或时间上限；
- 授权方或 SOC 要求停止。

## 最终输出

- 去重后的 JS、CSS、WASM、字体和可选图片；
- `manifest.ndjson`：脱敏 URL、哈希、大小、Target、Marker；
- `task-ledger.ndjson`：所有严格运行的累计记录；
- `risk-events.ndjson` 和 `invalid-assets.ndjson`；
- `asset-audit.json` 和 `merge-summary.json`；
- 覆盖说明：已覆盖、可见未覆盖、已注册但不可见。

结果是浏览器实际观察到的部署产物，不是原始源码，也不包含未触发分支、后端代码或未经授权的角色资源。

## 手动命令

通常让 Codex 执行即可。需要排查时可以手动运行：

```bash
node skills/codex-cdp-static-assets-skill/scripts/capture-static-assets.mjs \
  --mode discover \
  --scope ./discovery-scope.json \
  --output ./host-discovery

node skills/codex-cdp-static-assets-skill/scripts/capture-static-assets.mjs \
  --mode capture \
  --scope ./capture-scope.json \
  --endpoint http://127.0.0.1:9222 \
  --ledger ./task-ledger.ndjson \
  --output ./capture-run-1

node skills/codex-cdp-static-assets-skill/scripts/audit-capture.mjs ./capture-run-1

node skills/codex-cdp-static-assets-skill/scripts/merge-captures.mjs \
  --output ./capture-merged ./capture-run-1 ./capture-run-2

node skills/codex-cdp-static-assets-skill/scripts/audit-capture.mjs ./capture-merged
```

`maxAssets: 0` 和 `maxTotalMiB: 0` 只表示不设本地留存硬上限，Ledger 仍会记录。它们不能代替授权方定义的浏览器请求量、流量和时间上限。`maxAssetMiB` 应保留非零值。

## 验证

```bash
node --test skills/codex-cdp-static-assets-skill/scripts/*.test.mjs
python3 /path/to/skill-creator/scripts/quick_validate.py \
  skills/codex-cdp-static-assets-skill
```

## 许可证

[MIT](LICENSE)
