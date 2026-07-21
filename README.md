# Workshop Widget 资源采集 Skill

[English](README.en.md)

这个 Skill 用 Chrome 的真实操作，把一个 Workshop Module 里能看到的 Widget 逐个加到测试页、按需配置、进入预览，并把浏览器**自然加载**到的前端资源整理出来。

适合做 Widget 逆向、资源盘点和按需加载分析。它不会猜测资源地址或重新下载资源，而是只保存你在页面操作时 Chrome 已经拿到的内容。

## 它会帮你做什么

- 找出当前账号可见的 Widget；
- 自动创建用于采集的测试页，把 Widget 分批放进去（每页数量由 Scope 控制，例如 8 个）；
- 覆盖三个有意义的时机：刚添加到编辑器、成功绑定已有数据（如果组件支持）、进入预览；
- 保存 JS、CSS、WASM、图片，以及符合条件的页面 HTML；默认不收集字体；
- 把公共资源和每个组件第一次触发的资源分开记录，方便后续分析。

不适合用来抓接口数据、绕过登录、导出生产数据，或判断某个 Chunk “一定属于”某个 Widget。

## 安装

```bash
npx skills add https://github.com/501981732/codex-cdp-static-assets-skill \
  --skill codex-cdp-static-assets-skill \
  --agent codex \
  --global \
  --yes
```

安装或更新后，重新开一个 Codex 任务，输入 `$codex-cdp-static-assets-skill` 即可调用。

## 使用前准备

1. 使用已经登录的日常 Chrome（Chrome 144 或更高版本）。
2. 配置 Chrome 连接：

   ```bash
   codex mcp remove chrome-devtools
   codex mcp add chrome-devtools -- \
     npx -y chrome-devtools-mcp@latest \
     --autoConnect \
     --no-usage-statistics \
     --no-performance-crux
   ```

3. 重启 Codex；在 Chrome 打开 `chrome://inspect/#remote-debugging`，启用 Remote debugging，再打开要采集的 Workshop 页面。
4. 最好使用专门的测试 Module。采集会新增页面、添加组件、改组件配置并自动保存。

如果有 Object Table 这类必须选变量的组件，Skill 会在一次授权后自行创建、选择、修改和清理 Module 变量。它不需要理解变量背后的请求或业务数据，只关注组件因此自然加载的前端资源。

## 直接这样提需求

把下面内容中的链接和 Case ID 换掉后发给 Codex：

```text
使用 $codex-cdp-static-assets-skill 采集这个 Workshop Module 中全部可见 Widget 的资源：
https://workshop.example.com/module/edit/...

Case ID：SEC-2026-001
这是专用测试 Module。允许新建 CDP Capture 页面、添加和配置 Widget，并自动保存。
允许在这个 Module 中自动处理变量（新建、选择、修改、删除和清理）。
请先只做主机和组件入口的发现，把要操作的内容和每页 Widget 上限汇总给我；我一次授权后全自动执行。
采集 js、css、wasm、image，以及自然加载的页面或 Widget iframe HTML；默认不采集字体。
```

## 采集时会发生什么

1. 先记录打开页面时已经加载的公共资源（`baseline`）。
2. 打开“添加 Widget”，滚到底，确认目录里的组件都找到了。
3. 分批添加 Widget；每个组件会进入编辑器，必要时绑定你已有的测试变量，再进入预览。
4. 每次操作后只读取 Chrome Network 中新出现且已完成的响应，不会重放 URL。
5. 中断后可以继续：它会找回已有的组件，只补还没采到的状态。

目录里的图标和预览图会标记为 `baseline:catalog` 公共资源，不会误记成某个组件单独加载的资源。

## 你会拿到什么

- `assets/`：按内容去重后的资源文件；
- `metadata/component-assets.json`：每个 Widget 的状态、资源留存情况和首次观察到的资源；
- `metadata/components/`：Input、Table 等每个实际交互组件各自的逆向视图；
- `metadata/widget-inventory.json`：从基础 JS 中整理出的 Widget、Renderer、Chunk 和模块 ID；
- `metadata/baseline-assets.json`：页面启动和组件目录共用的资源；
- `metadata/manifest.ndjson`：资源 URL、类型、哈希和观察位置等索引。

`firstObservedAssets` 的意思是“第一次在这个组件操作后看到”，不是“这个文件只属于这个组件”。某些资源来自缓存，或 Chrome 没有保留正文时，报告会明确标记为未留存，而不会偷偷再请求一次。

目录只显示组件名称时也可以继续采集；只有同名组件在界面上仍无法区分时才跳过那一项。浏览器扩展的 `chrome-extension://` 本地请求会直接忽略，不会要求你额外授权。

## 需要知道的边界

- 只操作你一次性授权的精确 Workshop 主机和 Module；遇到登录失效、验证码、未知主机或异常写操作会停止。
- HTML 只保留页面或 Widget iframe 自然加载的 Document，不收集 XHR、fetch、GraphQL 或 API 响应。
- 不执行页面脚本、不读取 Cookie/Token、不探测隐藏路由、sourcemap 或 Chunk，也不清缓存或绕过 Service Worker。

如果要调整覆盖状态、每页数量、截图或变量映射，查看 [Scope 配置说明](skills/codex-cdp-static-assets-skill/references/scope-config.md)；完整执行和安全规则见 [Skill 说明](skills/codex-cdp-static-assets-skill/SKILL.md)。
