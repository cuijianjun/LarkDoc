# 007 · 视频块生命周期对齐飞书（下载 / 选中块外部工具条 / 上传删除全链路）

## 来源与证据（用 rea + 本地飞书源码核对）

本机没有独立的 `docx_video` chunk，视频块逻辑内嵌在通用 chunk；以下结论来自**真实 DOM 捕获 + 源码**，不是臆测：

- 外部工具条真实捕获：`~/codex/feishu-recon/obs/b10-04-file-click.json` 索引 1314–1367。
  `.overlay-container.block-toolbar__overlay`，块在 y=474、工具条在 y=424 高 42 → **浮在块上方、块外**。
  顺序（`data-name`）：`fullscreen | download | divider | inline view | card view(menu-item-actived 默认激活) | preview view | divider | copyAnchorLink | shareTextLink | divider | comment`。
- 工具条源码：`~/codex/larkdoc-official-reference/web-scripts/197-docx_toolbox_es6.c5ba885e.chunk.js`
  `hn`(fullscreen)/`xt`(download)/`Qt`(三态视图)，`common.download_file = 下载`。
- 下载：同文件 module `222990` → `010-docx_app_spa` module `998866` → `$(e,t,n)`：
  Web 走隐藏 iframe `docs-open-link-iframe`，`src = /api/box/stream/download/all/{token}/`（服务端 Content-Disposition attachment）；
  opendoc 走 `downloadBlobFile`。**全链路无 `window.open` / `target=_blank`**。
- 上传状态机：`325/327/328-docx-drive-upload-sdk` `Pending=1,Inflight=2,Success=3,Error=4,Paused=5`；
  `298-web-upload-progress-viewer` 文案：`box.uploader.button.cancel = 取消上传`、`上传中`、`重试`、`继续上传`。
- 块菜单删除：`obs/b11-03-img-menu.json` `data-name:"delete"`（delete-item）、文案「删除」；撤销 `common.undo`。
- 三态视图官方原文：`飞书官方文档功能原文汇编.md:1449`「文本视图、卡片视图、预览视图」。

## 需求（用户本轮）

1. 飞书下载视频**没有打开新页面** —— 当前 `file-block.js` 顶部功能栏下载用 `window.open(url,'_blank')`，必须改掉。
2. 需要**选中块时浮在视频外面的那条功能栏** —— 即上面 b10-04 的外部工具条（区别于上一轮做的播放器内嵌 topbar，那条保留不动）。
3. 用 rea 读源码，把视频**从上传到删除**所有动作、交互都弄完善，本地实现。

## 范围与边界

- 播放器内嵌 topbar / 控制条（007 之前已实现）**保持不动**，只改下载动作与新增外部工具条。
- `fileBlock` schema 契约不动；三态视图复用已有 `viewType` 属性（只加合法值 `Inline`）。
- 所有外部工具条交互元素走 `markUi(data-lark-doc-file-ui)`，事件不进 ProseMirror；tips 走 `bindHoverTips`。

## 任务

- [x] **T24 下载不开新页**：`topDownload` 去掉 `window.open(...,'_blank')`，改为隐藏 iframe（`src=url`）触发浏览器下载；`data-href` 契约保留。新增 `lark-doc-file-download` 单测闸门：源码不得含 `window.open`。
- [x] **T25 外部块工具条**：`buildVideo()` 外、块壳 `dom` 上新增 `.lark-doc-file-block-toolbar`，选中/悬浮显示，浮在块上方（`bottom: calc(100% + 4px)`）。按 b10-04 顺序：`全屏 | 下载 — 文本视图/卡片视图(激活)/预览视图 — 复制链接/分享 — 评论`；纯图标出 tips，`aria-label` 中文；`data-name` 对齐飞书。
- [x] **T26 三态视图切换**：`FILE_VIEW_TYPES` 增加 `Inline`；工具条三态按钮 `aria-pressed` 反映 `attrs().viewType`，点击用 `editor` 事务 `setNodeMarkup` 改 `viewType`；`syncPreview` 支持 `Inline`（文本视图 = 文件名 + 大小 + 下载链接的紧凑行）。
- [x] **T27 生命周期接线**：
  - 上传：覆盖层加「取消上传」按钮（`data-lark-doc-file-ui`），点了 abort 当前 task 并删占位；保留进度三段配色/无 width transition。
  - 播放：已有控制条不动。
  - 下载：两个入口（顶部功能栏 + 外部工具条 + footer）统一走隐藏 iframe，不开新页。
  - 删除：外部工具条末尾加「删除」（`data-name:"delete"`），点了删块；`Undo` 复用编辑器 history（Ctrl+Z）。
  - 复制链接：写剪贴板（块锚点链接），失败静默；分享/评论：有宿主 onAction 就转发，否则保留入口不误点。
- [x] **T28 闸门**：增量（file-block + dom-renderer-contract + hover-tips + upload）全绿；全量 vitest；主题令牌 lint 0 新增；build + webpack + 预览；浏览器实测下载不开页、外部工具条几何浮于块上方、三态切换、删除/撤销。
