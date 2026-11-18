# Tasks：视频上传按飞书重做（第四轮）

分支 `feat/ui-polish-6`，基线 前三轮已验收状态。依据 [spec.md](spec.md)。每项完成立即跑闸门，不攒批。

## T13 · 读飞书源码定契约

- [x] 确认本机 Chrome CDP 9222=404、`workbuddy-browser-use` 未安装 → 网页实时上传抓不到。
- [x] 定位本地飞书源码 `~/codex/larkdoc-official-reference/`（web-scripts 337 chunk + apk-assets 手机端）。
- [x] rea `analyze_javascript_application` 分析 `298-web-upload-progress-viewer` + `327-docx-drive-upload-sdk`：192 findings / 15 modules；状态机 `UploadStatus(Pending/Inflight/Success/Paused/Error)`、字段 `progress/size/uploadSpeed`、支持暂停/继续/重试/终止。
- [x] 判定：分片上传属网络协议（服务端 SDK），本地无后端 → 不启用；库 `upload.js` 已内置 chunked 供生产用。
- **闸门**：rea 证据 `ev_fe5f48b211ca78075f409e5a1da2e40b1487843e51698f4d62b929b0e0856699`，源码 `UploadStatus` 片段已在对话核对。

## T14 · 分片读取 + 异步编码，修卡顿与进度条不走

- [ ] `preview/src/App.vue` 的 `uploadFile`：`readAsDataURL(整文件)` → 按片 `readAsDataURL(file.slice(...))`，每片完成按累计字节 `onProgress({loaded,total})`，片间让出主线程。
- [ ] 完成后拼接 base64 → 完整 `data:video/...;base64`，满足 `MEDIA_DATA_RE`，视频可播放、可下载。
- [ ] 保留 AbortSignal 取消、错误路径。
- **闸门**：`verify-upload-round3.cjs` 大文件进度序列连续推进（非 `0→…→95→gone` 卡住），无长任务卡顿；页内 `performance` 无 >200ms 长任务。

## T15 · 飞书上传卡 UI + 消除空白

- [ ] 上传卡：浅灰圆角大卡，居中「上传中 X%」+ 进度条；颜色 0%灰 / 进行中蓝 / 100%绿。
- [ ] 完成后短暂蓝色转圈（解析中）再切播放器。
- [ ] 消除上传卡上下空白：上传态块高改内容自适应 + 垂直居中。
- [ ] 不动非视频上传卡、不动 453 完成态契约。
- **闸门**：本机 Chrome 量几何 + 截图，上传卡无大片空白、进度条居中、配色随进度变化；完成态视频播放器 + footer 正常。

## T15b · 完成态视频播放器按飞书重做（第五轮，用户补图明确）

用户补两张飞书图 + 「飞书视频显示是没有留白的，这是上传之后的状态」：图1 静态态、图2 悬浮+播放态。
用 rea 分析 `285-3235` / `197-docx_toolbox` / `063-…` 播放器脚本（4846 findings / 1285 modules，证据 `ev_a6a5940a1b80517126c5d26682d1b4f43bb7e601c3e5100a466ca99ae68ae421`）；
`object-fit` 命中多为头像/评分组件，视频块铺满由「容器按视频比例自适应」实现，与截图一致。

- [x] 消除留白：`file-block.js` 的 `buildVideo` 返回 `.lark-doc-video-player` 壳；`loadedmetadata` 读 `videoWidth/Height` 写 `aspect-ratio`，`preview` 释放固定 409、`object-fit: cover` 铺满。
- [x] 静态态：中央圆播放键 + 右下角时长徽标（真实 `duration`，mm:ss）；悬浮/播放后徽标让位控制条。
- [x] 悬浮态：左上角文件名 + 底部自绘控制条（播放/暂停、进度 slider 可点可键盘、时间、倍速循环 1→1.25→1.5→2→0.75、清晰度占位、画中画、音量、下载、全屏）；原生 controls 留属性作无障碍回退、CSS 隐藏。
- [x] 边界：`is-video-ready` 只在视频解码成功后加；PDF/卡片/fallback 仍走 409+42=453 契约；块选中浮条（问问豆包等）不动；新增 `mediaSrc` 记录换源、避免把 shell 当 video 读 src 误重建。
- **闸门**：`verify-player-feishu.cjs` 本机 Chrome 实测——`blankTop/bottom = 0`、shell=video=532×299、`aspectInline="320 / 180"`、footer `none`、静态中央键/时长在、悬浮 `name/controls opacity=1` 且 `duration opacity=0`、播放推进 `aria-valuenow=40`、倍速 `1.25`；静态/悬浮截图对齐飞书图1/图2。

## T16 · 增量测试与重新打包

- [x] 增量：`file-block` 42 例、`file-block`+`dom-renderer-contract` 518 例全绿；主题令牌 lint 354 文件 / 存量 0 / 新增 0。
- [x] 全量 vitest：109 文件 / 3102 通过 + 1 跳过。
- [x] `npm run build:vue2` + webpack + copy；预览 `http://127.0.0.1:4175/` 可用。
- **闸门**：全绿，预览 HTTP 200，给出链接。

## T17 · 进度条比例与文字不同步（用户截图反馈「94% 文字 / 条只到 42%」）

根因：`lark-doc.css` 给 `.lark-doc-file-uploading-fill` 加了 `transition: width .18s ease-out`。
分片上传每几毫秒更新一次宽度，过渡动画被反复重启、渲染宽度永远追不上同步更新的 `textContent`。
本机 Chrome 高频采样坐实：`text=94 / inline='94%' / rendered=46.3`，61 帧中 56 帧不匹配、最大差 52.7%。

- [x] 去掉 fill 的 `width` transition：条与文字严格同帧；保留灰→蓝→绿三段配色与 42px 轨高契约。
- [x] 回归闸门：`dom-renderer-contract.test.js` 新增 1 例，断言 fill 的 CSS 规则不含 `transition`（防加回）。
- **闸门**：`diag-progress-sync.cjs`（100MB 文件、2ms 轮询）实测 87 帧 `MISMATCH>5%=0 / MAX_GAP=0`，文字=inline=rendered 逐帧一致；
  `dom-renderer-contract` 478 例全绿；全量 109 文件 / 3103 通过 + 1 跳过；主题 lint 354 文件 / 0 新增。

## T18 · 进度跳到 90%+ 卡住 + plus 菜单补 H4/H5（第六轮，用户截图反馈）

进度卡顿根因：`App.vue` 把 100MB 视频分 34 片 `readAsDataURL` 后 `parts.join('')` 拼成 142MB base64 data URL，
再把巨型字符串塞进 schema。实测进度 571ms 线性走完到 99%，随后主线程**冻结 5233ms**（用户看到「93% 卡住」）。
rea 佐证飞书 `298-web-upload-progress-viewer` 用 `progress` 字节进度 + `UploadStatus` 状态机，完成即 100%，
进度来自网络已上传字节、无本地拼串收尾；CDN URL 可持久化。

- [x] 进度模型复用飞书：按「已处理字节/总字节」线性上报；分片 `readAsArrayBuffer` 读真实字节驱动（不编码、不拼接），片间让出主线程，收尾即 100%。
- [x] 完成地址改用 `URL.createObjectURL(file)`（O(1)、流式解码，飞书 CDN URL 的本地等价物），消灭 142MB 拼接阻塞。
- [x] `safeUrl` 宽松档放行合法 `blob:`（格式 `blob:<origin|null>/<uuid>`，严格档仍拒绝）；`network.js` 本就把 blob 当本地资源放行。
- [x] plus 插入菜单基础段补 H4/H5：`commands/index.js` 的 `basic` 数组加 heading4/5、`filterCommands` 放行规则从 `heading[4-9]` 收窄到 `heading[6-9]`；`BASIC_ICONS` 加 h4/h5 映射（图标早已存在）。
- [x] 闸门回归：`link-cell-interaction` 基础段按钮 11→13、svg 11→13；`embed-menu-commands` 新增 H1~H5 顺序断言；`dom-renderer-contract` 新增 blob 放行断言。
- **闸门**：`diag-progress-sync.cjs` 132 帧 `MISMATCH=0/MAX_GAP=0`；`diag-stage.cjs` 最大停顿 `5233ms → 29ms`、总时长 5.8s→0.6s；
  `verify-h45-and-blob.cjs` 视频 `hasVideo=true/srcProtocol=blob`；`verify-h45-browser.cjs` plus 菜单文案含「四级标题/五级标题」；
  增量 540 例全绿；全量 109 文件 / 3105 通过 + 1 跳过；主题 lint 354 文件 / 0 新增。
