# Specification：视频上传按飞书交互/UI 重做 + 真实进度不卡顿（第四轮）

状态：**实施中**。日期：2026-11-18。
基线：分支 `feat/ui-polish-6`，工作树 `~/codex/lark-doc-ui-polish`；预览宿主 `~/codex/lark-doc-vue2-preview`。
约束沿用前三轮：**没点名的功能不要动**。

## 1. 用户原文

> 视频上传你按照飞书的交互和 UI 来设计。另外上传过程还是有些卡顿，进度条不走，你确认一下。目前你这里有空白（配图标注上传卡上下空白）。你用 rea 读取一下飞书源码，看看应该怎么设计和交互，看看需要启动分片上传不，需要按要求改正。

后续补充：「你可以启动谷歌插件来控制谷歌浏览器」「而且之前本地也有已经下载过飞书电脑版本、手机版本的源码」。

## 2. 飞书源码研究结论（用 rea + 本地源码实证）

- 本机 Chrome CDP 9222 = 404，`workbuddy-browser-use` skill 未安装 → 无法复用登录态抓飞书网页实时上传。
- 但本地有真实源码：`~/codex/larkdoc-official-reference/web-scripts/`（337 个飞书网页 JS chunk）+ `apk-assets/`（手机端）。
- 用 rea `analyze_javascript_application` 分析 `298-web-upload-progress-viewer.250e22f7.js` 与 `327-…docx-drive-upload-sdk…chunk.js`：192 findings / 15 modules，证据 `ev_fe5f48b211ca78075f409e5a1da2e40b1487843e51698f4d62b929b0e0856699`。
- 飞书上传状态机 `UploadStatus`：`Pending / Inflight / Success / Paused / Error`；字段含 `progress`（字节）、`size`、`uploadSpeed`、`finishedCount/totalCount`、`uuid`。
- 飞书有暂停/继续/重试/终止：`box.uploader.header.pause / success / fail / uploading`，`bar.speed`、`bar.progress`，`button.retry`。
- 分片上传在 `docx-drive-upload-sdk`（网络传输切片 + 断点），**属于服务端上传协议**，本地预览没有后端，不需要真的分片上传。
- 需求原文（`feishu-recon/飞书官方文档功能原文汇编.md`）：上传中在右下角进度窗口查看，可暂停/继续/重试/终止，已完成任务不可撤销。

## 3. 根因判定

- **卡顿 / 进度条不走的根因不是缺分片**：预览宿主 `App.vue` 的 `uploadFile` 用 `FileReader.readAsDataURL(46MB)`，一次性在主线程把整文件编码成 ~62MB base64 字符串。编码期间 JS 主线程被占满 → `onprogress` 回调排队、进度条冻结、页面卡顿；编码完才一次性 resolve。
- `safeUrl` 只放行 `data:video/mp4;base64,…`（`MEDIA_DATA_RE`），不放行 `blob:`，所以完成态只能内联 data URI —— 这决定了「编码必须发生」，但**可以分片异步编码、片间让出主线程**，让进度真实且 UI 不卡。

## 4. 方案

1. **分片读取 + 异步编码**（T14）：把文件按固定片（如 4MB）用 `FileReader.readAsDataURL(slice)` 逐片读，每片完成按字节上报真实进度；片间 `await 下一帧/微任务` 让出主线程。最后拼接 base64 得完整 data URL。既真实反映字节，又不长时间霸占主线程。
2. **飞书式上传卡 UI**（T15）：
   - 上传中浅灰圆角大卡，居中「上传中 X%」+ 进度条；颜色随进度：0% 灰 → 进行中蓝 → 100% 绿（按用户 6 张截图）。
   - 上传完成后短暂蓝色转圈（解析中），再切视频播放器（截图 4 的 spinner 态）。
   - 完成态（第五轮按飞书补图重做）：容器按视频真实宽高比自适应 + `object-fit: cover` 铺满（零留白），
     静态态中央圆播放键 + 右下角时长，悬浮态左上角文件名 + 底部自绘控制条（播放/进度/时间/倍速/
     清晰度/画中画/音量/下载/全屏）；原生 controls 保留属性作无障碍回退、CSS 隐藏。PDF/卡片/fallback
     仍走 453 契约，只有 video 完成态改变。
   - 消除标注的上下空白：上传卡改为内容自适应高度并垂直居中，不再用 453 空壳撑高。
3. **分片上传**：判定为**不启用**（本地无后端）。库 `upload.js` 已内置 `chunked`/`chunkSize`/断点续传，生产接后端时宿主声明 `uploader.chunked === true` 即可，本轮不动库这一层。

## 5. 边界（不动）

- 不动文档内核、协同、版本、表格、tips、AI 面板、分享等前三轮已验收行为。
- 不动 `safeUrl` / `MEDIA_DATA_RE` 契约、不动 schema attrs（`fileBlockAttrs`）。
- 非视频文件上传卡观感保持原样；只在 `data-upload-kind="video"` 上传态生效。
