# 007 · 视频块生命周期对齐飞书 —— 任务清单

来源：`specs/007-video-lifecycle-feishu/spec.md`（rea + 本地飞书源码证据）。

## T24 · 下载不开新页
- [x] `file-block.js`：去掉 `topDownload` 的 `window.open(url,'_blank')`；新增共享 `downloadByIframe(url)`（隐藏 iframe src=url，触发服务端 attachment 下载，无新页/无 ProseMirror 事务）。`data-href` 保留。
- [x] 单测闸门：`file-block.test.js` 断言 `file-block.js` 源码不含 `window.open`；点击下载按钮不抛错。

## T25 · 选中块外部工具条（块外）
- [x] `buildVideo()` 之外、块壳 `dom` 上新增 `.lark-doc-file-block-toolbar`（role=toolbar，aria-label=文件工具），`position:absolute; bottom:calc(100% + 4px); left:50%; transform:translateX(-50%)`，浮在块正上方（对齐 b10-04 y=424 vs 块 y=474）。
- [x] 显示：`dom:hover` / `dom.is-selected` / `:focus-within` 可见；`data-lark-doc-file-ui` 全量 markUi；`bindHoverTips` 绑纯图标。
- [x] 顺序（data-name）：`fullscreen | download — text view | card view | preview view — copy link | share — comment`（9 项 + 2 分隔线）。card view 默认 `aria-pressed=true`（对应 viewType=Card）。

## T26 · 三态视图
- [x] `FILE_VIEW_TYPES` 增加 `Inline`（`Preview/Card/Inline`，schema 只序列化 default，快照不受影响）。
- [x] 工具条三态按钮 `aria-pressed` 反映当前 `attrs().viewType`（Inline/Card/Preview 一一对应 text/card/preview view）；点击用 `editor.view.dispatch(tr.setNodeMarkup(pos,...))` 改属性。
- [x] `syncPreview` 支持 `Inline`：渲染紧凑文本视图（图标 + 文件名 + 大小 + 下载）。

## T27 · 生命周期动作
- [x] 上传：`file-upload-tasks.js` 覆盖层加「取消上传」按钮，点击 abort task 并删占位（走已有 fail 路径）；进度三段配色与无 transition 不动。
- [x] 下载：顶部功能栏 / 外部工具条 / footer 三个入口统一隐藏 iframe，不开新页。
- [x] 删除：外部工具条末尾 `data-name:"delete"`（trash 图标），点击 `editor` 删除当前块；撤销走 Ctrl+Z（history）。
- [x] 复制链接：块锚点链接写剪贴板（`#blockId`），失败静默；分享/评论：派发 `lark-doc:file-action` 冒泡事件，宿主可接；无宿主不误点。

## T28 · 闸门（实测结果）
- [x] 增量：file-block(45) + dom-renderer-contract(481) + hover-tips 全绿；最终 548 例通过。
- [x] 全量 vitest：109 文件 / 3110 通过 +1 跳过；主题令牌 lint 354 文件 0 新增。
- [x] build:vue2 + webpack + copy 成功；预览 HTTP 200。
- [x] 浏览器 `verify-round8.cjs`：取消上传按钮可见；外部工具条 9 项 + 4 分隔线、浮于块上（barBottom=596 / blockTop=599）、hover opacity=1、overflow=visible、三态 preview 激活；下载 pagesBefore=1/pagesAfter=1（无新页）；文本视图落 inline 行、预览视图切回；删除 2→1、undo 1→2；截图 /tmp/round8-final.png。

## 实现注记（踩坑）
- `blockIconButton` 收 SVG **字符串**（VIDEO_ICON.*），不能传 `iconNode()` 返回的 DOM（innerHTML 会变 `[object HTMLSpanElement]`）。
- 块壳必须 `position:relative`，否则工具条 `bottom:calc(100%+4px)` 以 `.ProseMirror` 为参照飞到页顶；`has-block-toolbar` 放开 overflow 让工具条浮出块外。
- 工具条 `mousedown.preventDefault()` 避免抢焦点；删块后 `editor.view.focus()` 把焦点交回编辑器，Ctrl+Z / undo API 才能进 history。
- headless macOS 的 `Control+z` 键位映射不稳，浏览器走撤销改走公开 `undo()` API（与工具栏撤销按钮同一条链）。

## T31 · 分享 / 评论暂时隐藏 UI（功能保留）
- [x] `file-block.js` 新增模块级开关 `SHOW_SHARE_COMMENT = false`；`buildBlockToolbar()` 里 `shareTextLink` / `comment` 按钮照旧构建、照旧绑 `fireFileAction('share'|'comment')`，只是不 append 进 DOM。
- [x] 隐藏后工具条为 `fullscreen | download — text view | card view | preview view — copyAnchorLink | delete`（7 项 + 3 分隔线），不残留悬空分隔线。
- [x] 单测闸门：`file-block.test.js` 断言按钮清单不含 share/comment、divider=3，且源码仍保留 `fireFileAction('share'|'comment')` 与开关常量（功能没被删）。
- [x] 浏览器实测：`names=[fullscreen,download,text view,card view,preview view,copyAnchorLink,delete]`、`dividers=3`、`hasShare=false`、`hasComment=false`、宽 235px、hover opacity=1；截图 /tmp/round9-toolbar.png。
- 说明：播放器**内嵌** topbar 的「评论」占位保持不动（对齐上一轮飞书截图）；若要一并隐藏，改 `buildVideo()` 里 `[shareLink, playlist, comment]` 的那行即可。

## T32 · 所有评论按钮统一隐藏（功能保留）
- [x] 拆开关：`file-block.js` `SHOW_SHARE`（块工具条分享）/ `SHOW_COMMENT`（评论，覆盖播放器顶栏 + 块工具条）；`image.js` 加 `SHOW_COMMENT`，图片工具条不挂「添加评论」。
- [x] 三处按钮**照旧构建并保留事件出口**（`fireFileAction('comment')` / `onAction('comment')`），只不 append。
- [x] 其余评论入口本就是「没 provider 就不出现」：气泡条（`config.comment = commentEntryVisible`）、块菜单、链接工具条、表格工具条（`commentVisible`/`canComment`）、图片查看器（`typeof onComment === 'function'`）→ 本 Demo 无 provider，实测不出现。
- [x] 单测闸门：`file-block`（顶栏 8 项无评论、块条 7 项无 share/comment、divider=3）、`image-nodeview`（工具条 7 项、无 comment、复制/分享仍禁用门控）、`hover-tips`（评论按钮不存在）；增量 588 例全绿。
- [x] 浏览器实测：文档初始 + 视频悬浮态扫描「aria-label/title/文案含评论」的**可见**按钮 = 0；顶栏 `[问问豆包,展开视频,下载视频,收起,字幕,布局,复制链接,播放列表]`，块条 7 项。截图 /tmp/round9-all-comment-hidden.png。

## T33 · 去掉视频框内功能栏（飞书文档没有）
- [x] 结论：飞书文档的视频块**只有块外那一条**浮动工具条；框内顶栏（问问豆包 / 展开 / 下载 / 收起 / 字幕 / 布局 / 链接 / 列表）是上一轮按另一张截图加的，属多余 → 整块删除。
- [x] `file-block.js`：删掉 `buildVideo()` 里 topbar 的构建/append/`topbarTips` 与 teardown 清理；顺便删掉只服务它的 5 个图标（expand/minus/subtitle/layout/list）。
- [x] `domRenderer.js`：删掉只为「问问豆包」服务的 `lark-doc:ai-request` 监听与 cleanup（无生产者了）；`lark-doc:file-action` 保留。
- [x] CSS：删掉 `.lark-doc-video-topbar*` / `.lark-doc-video-top-btn` / `.lark-doc-video-ai*` 共 11 条规则。
- [x] 单测：`file-block` 改为断言 `shell.querySelector(".lark-doc-video-topbar") === null` 且框内 `[role=toolbar]` 数量 0；下载测试改点块外工具条的 `[data-name=download]`。
- [x] 浏览器实测：框内 `[role=toolbar]=0`、`topbar=false`，播放器内按钮仅 `播放视频/播放/播放速度/清晰度/画中画/静音/全屏`；块外工具条 7 项、浮在块上方 gap=4px、hover opacity=1；增量 548 例全绿；截图 /tmp/round10-hover.png。

## T34 · 块外工具条「点不住」修复 + 图标/尺寸对齐飞书
- [x] 根因：条浮在块外 `calc(100% + 8px)`，鼠标从画面移到条上要穿过这段既不属于块、也不属于条的空隙；纯 CSS `:hover` 在这几帧断掉 → `opacity:0` + `pointer-events:none`，按钮点不到。
- [x] 修法：块/条各自 `pointerenter` 立刻加 `is-toolbar-open`，`pointerleave` 延时 180ms 再摘（进条即取消关闭）；CSS 增加 `.is-toolbar-open > .lark-doc-file-block-toolbar { opacity:1; pointer-events:auto }`。destroy 里 `disposeBlockToolbar()` 清定时器。
- [x] 图标按飞书 `universe-icon` 重画：24 viewBox 实心路径（fullscreen 对角双箭头 / download 入托盘 / inline 短横+长横 / card 卡片+内条 / preview 显示器+底座线 / copy 双叠方块 / share 三线+右箭头 / comment 气泡+内线），新增 `BLOCK_ICON` 表；删除只服务旧顶栏的图标。
- [x] 尺寸按 obs 实测：容器高 42、内边距 8、项间距 8、按钮 24×24（压回全局 `button{min-height:30px;padding:4px 8px}`）、图标 18、组内分隔线 1×20、三态后那条 `is-full` 1×40、块与条间隙 8。
- [x] 激活态改飞书 `menu-item-actived`：`--ld-bg-accent` 底 + `--ld-brand-content` 图标。
- [x] 单测：新增「点不住回归」用例（pointerenter 开、leave 179ms 仍开、181ms 关、进条取消关闭）；几何闸门断言 bottom/gap/height/24×24/18px/is-full/全 24 viewBox。增量 **549 例全绿**，主题 lint 354 文件 0 新增。
- [x] 浏览器真实鼠标轨迹（不加 force）：穿空隙后 `open=true / opacity=1 / pointer-events=auto`；点击 text→inline、card、preview 三态切换成功；delete 1→0、undo 0→1；download 走 1 个隐藏 iframe（blob src）、`window.open` 调用 0 次、页面数仍 1；按钮 tips「文本视图」正常。截图 /tmp/round11-final.png。

## T35 · 工具条「下载」真的落盘（iframe 只作兜底）
- [x] 现象：`downloadByIframe(src)` 在本地只会把 mp4 塞进隐藏 iframe 播起来，**不落盘**（飞书那套靠服务端附件地址 + `Content-Disposition: attachment`，本地没有这个端点）。
- [x] 修法：`file-block.js` 新增 `downloadFile(url)` —— `fetch(url, {credentials:'same-origin'})` 取字节 → `URL.createObjectURL(blob)` → 造 `a[download=文件名]` 点击 → 摘节点 + 延时 `revokeObjectURL`；**仍然不开新页、不 window.open**。
- [x] 文件名：`downloadName(url)` 优先 `attrs.name`，其次 URL 尾段；缺扩展名按 `mimeType` 补（mp4/webm/pdf/图片）。footer 的 `<a download>` 同步写这个值，右键/中键另存不会是 `download`。
- [x] 兜底顺序：取不到字节（跨域无 CORS）→ 同源/blob/data 用 `a[download]` 直链；其余退回 `downloadByIframe`（不导航当前页）。
- [x] 三个入口统一走它：块外工具条 `download`、footer 下载、文本视图文件名链接。
- [x] 单测：`file-block.test.js` 改「fetch→blob→a[download]」用例（stub fetch/createObjectURL/click，断言 download=「a.mp4」、节点已摘、无 iframe）+ 「fetch 失败退 iframe」+ 「缺扩展名按 mime 补」；增量 4 文件 / **555 例全绿**，主题令牌 lint 354 文件 0 新增。
- [x] 浏览器实测（`acceptDownloads`）：工具条下载 `recon-valid.mp4` / 2995B、文本视图链接同样 2995B、`window.open`=0、页面数 1→1；截图 /tmp/verify-final.png。

## T36 · 文件 / 视频块六点句柄对齐飞书（图标 + 功能）
- [x] 契约（`obs/b10-03-file-hover.json` 实测）：`.menu-trigger.file-menu-trigger.has-drag-icon` **42×26**；左槽 `.hover-block-type-icon-container` 24×24（内 svg 14×14，`data-icon="AttachmentOutlined"` 回形针，色 `color-w-500`）；右侧 `.drag-handle` 14×14（`DragOutlined`）；条与块顶齐平、贴块左 **6px**。
- [x] 图标：`handleIconFor` 补 `fileBlock → 'block-attachment'`（此前落到 `block-text`，视频块句柄显示成正文的 T）；`icons.js` 新增 `block-attachment`（飞书 AttachmentOutlined 原路径，24 viewBox 实心）；`blockHandle.js` 加 `HANDLE_ICON_SIZE`，回形针按飞书给 **14px**（与六点等重），其余类型仍 18。
- [x] 几何：`FRAME_BLOCK_SELECTOR` / `blockShellElement` 纳入 `figure[data-type="file"]`；`blockHandleGeometry` 文件块分支 = 块顶对齐 + 左贴 6px（此前按首行文字居中，整体低 12px）。
- [x] 功能（浏览器实测）：hover 出现句柄；点击开块菜单（问问AI/缩进和对齐/颜色/剪切/复制/翻译/删除/分享/保存为模板/复制链接/在下方添加）；HTML5 拖拽 `dragstart→dragover→drop`，视频块 index 0→3，拖拽指示线 `.lark-doc-drop-line` 出现。
- [x] 单测：`dom-renderer-contract` 新增「回形针类型图标 + 块顶齐平 + 左贴 6px」（块顶 300/纸面 20 → top=280；120−42−6−50 → left=22）。
- [x] 已知口径：图标色沿用本仓库控件蓝 `--ld-accent-control`（飞书 file 用更浅的 wathet），形状/尺寸/位置与飞书一致；主题令牌 lint 不允许新增字面色，需 1:1 配色时先加 token 再改。

## T37 · 六点句柄不出悬停提示（用户口径）
- [x] 现象：悬停句柄会先闪一个灰底小框（原生 `title="块操作与拖动"`），150ms 后自定义提示再补一条「块操作与拖动」；飞书句柄悬停是**直接展开块菜单**，没有提示。
- [x] 修法：`blockHandle.js` 删掉主按钮原生 `title`，改挂 `data-tooltip-none`（保留 `aria-label="块操作"` 给读屏）；`hoverTips.js` 的 `resolveTarget` 开头认这个标记直接返回 `null`——一个显式 opt-out，不牵连别的按钮。
- [x] 覆盖范围：句柄主按钮 + 表格 secondary（`cloneNode(true)` 继承标记）+ 空段落「＋」（本就靠 `aria-haspopup` 跳过）。块菜单内条目不受影响（类型网格纯图标仍出提示）。
- [x] 单测：`hover-tips.test.js` 新增「data-tooltip-none 带名字也不出」；把原来「句柄本体都出提示」改成「都不出提示」，并断言无原生 title。增量 6 文件 / **616 例全绿**；令牌 lint 354 文件 0 新增；`check-lark-doc-core` 全 PASS。
- [x] 浏览器实测（`verify-handle-notip.cjs`）：悬停句柄 700ms → `title=null` / `optOut=true` / 可见 tooltip **0** / 菜单已展开；截图 /tmp/handle-notip.png。
