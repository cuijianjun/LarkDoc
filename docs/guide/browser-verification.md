# 浏览器验证（`scripts/verify.mjs`）

单测跑的是 jsdom 下的语义，**像素、层级、主题、异步 chunk 这些必须在真浏览器里看**。
本仓有 12 个浏览器验证目标，统一入口是 `scripts/verify.mjs`。

## 1. 一条命令

```bash
node scripts/verify.mjs --all        # 全跑（12 个目标）
node scripts/verify.mjs mermaid splitting   # 只跑指定的几个，按顺序
node scripts/verify.mjs --list       # 列出所有可用目标
node scripts/verify.mjs --all --verbose     # 成功的也打印原始输出
```

## 2. 三个前置（缺一个就会假红）

| 前置 | 端口 | 谁需要 | 怎么起 |
| --- | --- | --- | --- |
| dev server | **8080** | 除 `element` 外的 11 个目标（都打 `http://localhost:8080/lark-doc`） | 脚本**只探活、不负责拉起**。不通时它会警告，但不会替你启动 |
| 静态服务 | **8765** | 只有 `element`（`examples/element-demo.html` 依赖 `../dist` 相对路径） | 在**包根目录**起：`python3 -m http.server 8765` |
| Node / playwright | — | 全部 | Node ≥ 18（脚本硬校验）；`playwright-core` 走 `NODE_PATH`，未设置时回落到 `~/.workbuddy/binaries/node/workspace/node_modules`；chromium 从 `~/Library/Caches/ms-playwright` 找 |

> `8080` 起不来最常见的表现是**每个目标都 FAIL 但断言一条都不对不上**——先探活，不要去改断言。

## 3. 输出规则

- 成功：一行 `PASS <target> <耗时> <摘要>`。
- 失败：一行 `FAIL` + 最多 12 行命中 `fail/error` 的关键行 + 末尾几行。**细节去读日志**：
  `_codex/verify-logs/<target>.log`（目录已被 gitignore）。
- 每次跑完会写 `_codex/verify-logs/latest.json`（机器可读：目标 / exit code / 耗时），给下个会话或 CI 用。
- 单个目标默认 240s 超时，超时按 `TIME` 计。

## 4. 写新断言的四条口径（都是踩过的坑）

1. **断言从 CSS 自定义属性取值，不要写死 hex。** `#1F2329` 这种字面量一旦写进脚本，token 改一次就假红一次，而且会把「token 改了」误报成「功能回退」。
2. **计数按归属，不按全局次数。** 例如量 `coordsAtPos` 调用次数，只算「发生在本轮 `runSelectionLayout` 内」的那些；全局计数会把 ProseMirror `focus() → scrollIntoView → updateStateInner` 的自测量算进来，断言从头到尾量错了对象。
3. **异步 chunk 必须先等结果再取证。** `mermaid` 这类懒加载 chunk 实测比首屏晚 1.2~1.4s 到达；在 `waitForSelector('.lark-doc-toolbar')` 之后立刻取证，永远只能拿到中间态。正确做法是 `await page.waitForSelector('.lark-doc-diagram svg', { timeout: 20000 })` 之后再读 DOM / 脚本清单。
4. **体积断言分两档，别混。** `gzip` 是传输口径、也是真预算，读 `package.json` 的 `size-limit`（运行时读，不要在脚本里复制一份数字）；`raw` 只当回归护栏（例如「不许退回拆包前的单文件」），不再新增手写上限。历史脚本里 `主文件 ≤ 1 MiB` 这种 raw 阈值，对 gzip 477 KB 的产物没有任何约束力，留着只会逼后来人抬数字。

## 5. 外部 demo 宿主的坑：chunk id 混搭

用 `LARK_DOC_SOURCE` 把 Vue2 demo 宿主指向某个 worktree 时，**alias 必须覆盖全**，少一条就会出最难查的一类 bug：

```js
config.resolve.alias.set('lark-doc',            path.join(src, 'src/index.js'))
config.resolve.alias.set('lark-doc/style.css',  path.join(src, 'dist/lark-doc.css'))
config.resolve.alias.set('lark-doc/katex.css',  path.join(src, 'dist/katex.min.css'))
config.resolve.alias.set('lark-doc/mermaid-vendor', path.join(src, 'src/assets/vendor/mermaid/mermaid.min.js'))
config.resolve.alias.set('lark-doc/element',    path.join(src, 'dist/lark-doc-element.umd.min.js'))  // ← 最容易漏
```

漏掉 `lark-doc/element` 的后果：element 主包来自 worktree A，而它 `publicPath:'auto'` 推导出的运行时 chunk 却跑到另一份检出 B 去取，**chunk id 对不上 → 图表静默渲染失败**，且 `console` / `pageerror` **一条输出都没有**。
排查手法：`curl http://localhost:8080/js/<主包 chunk 名>.js | grep -c "只在最新产物里才有的字符串"` 为 0，就说明页面加载的不是你刚构建的那份。

配套两点：

- **webpack 不监听 `node_modules` 软链内部的变动**：预构建 dist 已被编译进 chunk 时，改完必须**重启 dev server**，热更新不会生效。
- Node 14 宿主在带文件代理的环境下会抛 `TypeError: Object.hasOwn is not a function`，用 `env -u NODE_OPTIONS node scripts/verify.mjs --all` 绕过。

## 6. 失败时先看什么

| 现象 | 先查 |
| --- | --- |
| 全目标 FAIL、断言数字离谱 | 8080 / 8765 探活 |
| 只有 `element` FAIL | 8765 是否从**包根目录**起；`npm run build:element` 是否跑过 |
| `mermaid` / `splitting` FAIL 但页面看着正常 | 取证时机（见 §4.3）；或宿主 alias 是否齐全（见 §5） |
| `perf-scheduling` 计数偏大 | 是否用了全局计数而不是按归属计数（见 §4.2） |
| 体积类断言 FAIL | 先确认是 gzip 还是 raw 口径；预算以 `package.json` 的 `size-limit` 为准 |
