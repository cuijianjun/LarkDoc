# Tasks：视频播放器控制栏/功能栏 + 上传卡按飞书 1:1（第七轮）

分支 `feat/ui-polish-6`，基线第六轮全绿。依据 [spec.md](spec.md)。每项完成立即跑闸门，不攒批。

## T19 · 读飞书源码/截图定契约
- [x] 放大用户图1顶部功能栏：确认「问问豆包(66角标) | ↗展开 ↓下载 —收起 字幕 布局(蓝高亮) | 链接 列表 评论」的分组与顺序。
- [x] 放大用户图1底部控制栏：确认「暂停 00:06/01:56 … 1x 480p 画中画 音量 全屏」顺序；进度条在控制栏上沿通栏细线。
- [x] 放大用户图2上传卡：浅灰大卡 + 居中「上传中 100%」+ 进度条（蓝填充与百分比需一致）。
- [x] rea/本地源码：播放器 chunk `doc_common_videojs` 未下载；确证 video.js + 5 速/4 清晰度。本轮以截图为视觉契约。
- [x] 当前预览几何实测：shell=video=532×299、blank=0、controls=8 个，顶部无功能栏 → 本轮补齐。
- **闸门**：视觉契约已写入 spec；改动前基线 `verify-player-feishu.cjs` 通过。

## T20 · 顶部功能栏（buildVideo 新增 topbar）
- [x] `file-block.js` 的 `buildVideo()` 在播放器壳内新增 `.lark-doc-video-topbar`（悬浮可见），按 spec 2.2 顺序构建：
  - AI「问问豆包」按钮（sparkle 图标 + 中文名，不出 tips；派发 `lark-doc:ai-request` 冒泡事件，`domRenderer` 接住走同一条 `ai-request` 链 → 统一 AI 弹窗）；
  - 分隔线；展开/下载/收起/字幕/布局（纯图标，中文 aria-label + tips，布局默认蓝色高亮=激活）；
  - 分隔线；链接/列表/评论（纯图标 + tips，未接入能力占位不误点）。
- [x] CSS：白色胶囊、圆角、描边、阴影、分组分隔线、悬浮出现；纯图标 tips 用既有 hoverTips 机制；
  `bindHoverTips(topbar)` 句柄随 `teardownMedia()` 清理。
- [x] 下载入口：从底部控制栏移到顶部功能栏（`data-href` + 新开，避免重复）；保留 aria-disabled 契约。
- **闸门**：`file-block.test.js` 断言顶部 9 按钮序列/分组/下载位置/布局激活；543 例增量全绿；浏览器 `verify-round7.cjs` 实测 9 标签齐全、dividers=2、opacity=1；`verify-ai-topbar.cjs` 点「问问豆包」弹出统一「AI 问答」面板。

## T21 · 底部控制栏按飞书重排
- [x] `buildVideo()` 的 controls 重排为：播放/暂停、时间（`mm:ss/mm:ss` 无空格）、spacer、1x、480p、画中画、音量、全屏（移除底部下载）。
- [x] 进度条 `.lark-doc-video-seek` 改为绝对定位到控制栏**顶部上沿通栏细线**（3px、浅底+蓝填充），作为 controls 第一子节点；时间文字不再与进度条同行占位。
- [x] CSS 调整控制栏布局（进度条上沿、按钮顺序、时间格式无空格、倍速 `1x`、清晰度 `480p` 描边小按钮）。
- **闸门**：单测断言进度条为第一子节点 + `role=slider` + 时间格式正则 + 无底部下载；浏览器实测 `seek.position=absolute/top=0px/h=3/w=532`、时间 `00:00/00:02`、按钮顺序与飞书一致。

## T22 · 上传卡高度 1:1 对齐
- [x] 上传卡预览区由 `flex:1 + height:auto`（塌陷到 106px）改为 `aspect-ratio:16/9` + 固定宽，撑到 301px，与完成态播放器（532×299）等高；内容由 `.is-video` 垂直居中。
- [x] 保留进度条三段配色（灰/蓝/绿）与「无 width transition」同步闸门。
- [x] 不动非视频上传卡、PDF/卡片/fallback 453 契约。
- **闸门**：新增 `dom-renderer-contract` 用例断言上传卡预览区与播放器都声明 16:9；浏览器实测上传态 `shell 534×301 / previewAspect 16/9 / 进度条居中偏移 19px`。

## T23 · 增量测试 + 打包 + 预览
- [x] 增量：file-block + hover-tips + dom-renderer-contract 543 例全绿；主题令牌 lint 354 文件 / 0 新增。
- [x] 全量 vitest：109 文件 / 3106 通过 + 1 跳过。
- [x] `npm run build:vue2` + webpack + copy；预览 HTTP 200。
- [x] 浏览器走查：顶部 9 项、底部 8 项、进度条上沿、时间格式、上传卡 301px 等高；截图 `/tmp/round7-*.png`。
- **闸门**：全绿 + 预览链接 `http://127.0.0.1:4175/`。
