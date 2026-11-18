# Tasks：第二轮 UI 修复（3 项）

分支 `feat/ui-polish-6`，基线 `master` = `05f2083`（tag `v0.14.9`）。
判定口径来自 `spec.md`，根因与做法来自 `plan.md`。每一项完成后立即跑本项闸门，不攒批。

---

## T1 · 共用 tips 绑定器

- [x] 新建 `src/ui/hoverTips.js`，导出 `bindHoverTips(root, options)`。
- [x] 判定 `tipTarget(node)`，四条依次短路：
      - [x] 命中 `button, [role="button"], [role="combobox"], input[type="color"]` 且在 `root` 内；
      - [x] 有下一级弹窗 → 跳过：`aria-haspopup` 存在且不为 `"false"`、`[class*="caret"]` 子节点、`role="combobox"`；
      - [x] 有可见中文名称 → 跳过：容器内存在文本节点，且该文本**按布局可见**（`getComputedStyle().clipPath === 'none'` 且元素/文本盒宽 > 0）；
      - [x] 其余出提示（`disabled` 也出，文案标注不可用原因）。
- [x] 取自 `toolbar.js` 的既有约定：`title` 迁移到 `data-tooltip-title` 后移除 `title`，避免原生 tip 与自绘 tip 双出。
- [x] 事件走**容器委托**（`mouseover` / `mouseout` / `focusin` / `focusout`），`root` 重建后不需重绑。
- [x] `tooltip.js` 那条 `inPopup(anchor) → hide()` 对命令菜单（`role="menu"`）会拦截，绑定器改用 `createTooltip({ host }).bind()` 这条不判 `inPopup` 的路径。
- [x] 单测 `test/unit/hover-tips.test.js`：判定表 6 例（纯图标出 / 有中文名不出 / `clip-path` 隐藏的 label 视同纯图标 → 出 / caret 不出 / `aria-haspopup` 不出 / `disabled` 出）。
- **闸门**：`npx vitest run test/unit/hover-tips.test.js` 全绿。

## T2 · 气泡条接入

- [x] `bubbleBar.js`：`build()` 末尾按 `bubbleBar` 根节点调一次 `bindHoverTips`（`el.textContent = ''` 重建后容器不变，绑定不丢）。
- [x] 覆盖到位：`highlightButton`、`copyButton`、`commentButton`、`markRows` 全部（`paletteButton` 带 caret，按判定自动跳过）。
- [x] 保留现有 `aria-label`，不删（无障碍不能退化）。
- **闸门**：本机 Chrome hover 断言 —— 纯图标全部出 tips，`paletteButton` 不出。

## T3 · 命令菜单接入

- [x] `commandMenu.js`：容器级一次绑定（菜单 `update()` 复用节点，逐条 `bind` 会累积监听）。
- [x] ➕ 菜单「基础」分类（label 被 `clip-path` 隐藏）出 tips；`is-slash` 带中文名的行不出；`isSkip` 项文案仍为「需要企业版接入」。
- [x] 校验 59 项菜单未被破坏：项数、`data-tooltip-title` 值、键盘上下键选中。
- **闸门**：走查断言 —— 「基础」格出、斜杠菜单行不出、项数仍 59。

## T4 · 表格功能条 / 块手柄 / 单元格➕

- [x] `tableTools.js`：功能条根节点绑定（`AI` 项 `text: true` 有中文名 → 自动不出，符合规则）。
- [x] `blockHandle.js`：`aiButton` 等纯图标按钮出 tips；拖拽把手若 `aria-haspopup` 则不出。
- [x] `cellPlusTools.js`：单元格 ➕ 接入。
- [x] `tableOverlays.js`：**跳过** —— 行列选择条是贴在表格边上的隐形感应条（无图标、`aria-label` 只是「选择第 N 列」），
      悬停出提示会盖在表格上误导用户；自绘滚动条同理。与「功能栏图标」的口径无关。
- [x] 顺带修掉一个连带回归：`createTooltip` 原本在**构造时**就给 `window` 挂 `scroll`/`resize`/`keydown`，
      导致没有悬停过的 UI 实例也各占一份全局监听，`dom-renderer-contract` 里「resize 监听必须成对移除」的用例被打红。
      改为首次 `show()` 时惰性挂载、`destroy()` 卸掉。
- **闸门**：`hover-tips` + `link-cell-interaction` → **143 passed**；`dom-renderer-contract` → **477 passed**。

## T5 · AI 面板结构统一

- [x] `workspacePanels.js`：`aiActionBar` 直接 append 进 `aiPanel`，挂载顺序：标题 → 说明 → 操作栏 → 引用条 → 要求 → 消息 → 按钮 → 状态 → 结果 → 复核列表 → 提案 → 错误 → 结果按钮 → 决策按钮。
- [x] 显隐统一走 `syncChildren(aiPanel, …)`，`imageAi.el` 的独立分支整体消失。
- [x] 迁移对话面板独有能力：引用条（`[图片]` / 选区标签 + 移除 ×，`aria-label` 分「移除内容引用」/「移除图片引用」）、`Esc` 关闭、`focusImageAI()` 聚焦 `aiPrompt`。
- [x] 底部按钮拆为主次两组：`--primary`（生成 / 停止）与 `--decision`（复制 / 插入 / 替换 / 重新生成 / 接受 / 拒绝）。
- [x] `domRenderer.js` 的 `ai-request` 三分流：`action === 'image'` → `openImageAI`、`'chat'` → `openSelectionAI`、其余 → `startAI`，全部落同一张 `aiPanel`（这就是「表格问问AI按钮也用它」的落点）。
- [x] **`imageAiChat.js` 整文件删除**（不是保留不用）。原计划「保留文件不 append DOM」在实施中作废：两套表单并存必然衍生第二份 CSS 与第二套状态机，
      而 `imageAiChat` 的唯一价值（图片引用 + 对话轮次）已并入 `aiPanel` 的 `state.aiImageChat` 字段。全仓 `grep imageAiChat` 仅剩一条注释与 controller 里的状态字段。
- [x] 顺手补掉两个隐患：
      - 引用条常驻 DOM 只切 `hidden`（`{ node: aiReference, on: true }`），否则首次 `hidden` 读取即 null 抛错；
      - 输入框**每会话换新 textarea 节点**（`makePrompt(epoch)` + `aiPromptEpoch/aiPromptOpen/aiPromptSelection` 三元组，`input` 里校验 `node === aiPrompt && epoch === aiPromptEpoch`），
        否则上一会话的 IME 合成事件会串到新会话里，把「关闭重开问答后旧输入与 IME 事件不串」这条契约打红。
- [x] 改 `test/unit/dom-renderer-contract.test.js`：两处 `.lark-doc-image-ai-reference` → `.lark-doc-ai-reference`；IME 用例选择器改 `#lark-doc-ai-prompt`；图片引用用例改 `vi.waitFor`（侧面板是懒加载 `import('./workspacePanels')`，固定一次 `setTimeout(0)` 会 flaky）。
- **闸门**：`npx vitest run test/unit/dom-renderer-contract.test.js` → **477 passed**。

## T6 · AI 面板样式对齐参考图

- [x] `.lark-doc-ai-panel` 卡片化：`display: flex; flex-direction: column; gap: 12px`，删掉旧对话式外壳 `.lark-doc-image-ai*` 共 34 行。
- [x] 标题行：`AI 助手` / `AI 问答` / `图片问答` 三态动态 `aria-label`（`selectionChat ? 'AI 问答' : (aiImageChat || aiImage ? '图片问答' : 'AI 助手')`），关闭按钮同步为 `关闭${aiLabel}`，发送按钮在 `aiRunning` 时变「停止生成」。
- [x] `label` 12px `--ld-text-secondary`；**「上下文范围」「操作」「目标语言」统一成同款字段卡**（`field(control, labelNode)` 包一层 `.lark-doc-ai-field`，与 `.lark-doc-ai-context` 共用一条 CSS 规则：`border: 1px solid var(--ld-border-chrome); border-radius: 8px; background: var(--ld-bg-ai-context)`），否则参考图里三个等宽字段卡只有第一个有框。
- [x] 结果区 `--ld-bg-soft` + 圆角 6；空态文案按形态三态（问答有/无引用、图片、纯文本）分别给出可操作指引。
- [x] 底部按钮：决策行选择器加权（`.lark-doc .lark-doc-ai-panel > .lark-doc-panel-buttons--decision { justify-content: flex-end }` + `> button { flex: 0 0 auto; min-width: 72px }`），压过通用按钮均分规则，避免参考图里「丢弃/替换」被拉成两个半宽按钮。
- [x] 动作行改**固定两列网格**而不是 `flex-wrap`：面板宽 399 时 flex 会把 4 个动作按钮排成「3 + 1」，最后一个被 `flex: 1 1 auto` 撑满整行，看起来像排版错位。
      `grid-template-columns: repeat(2, minmax(0, 1fr))` 让换行点可预期（4 个 → 2×2，2 个 → 一行），按钮再加 `min-width: 0; overflow: hidden; text-overflow: ellipsis` 兜住长文案。
- **闸门**：`node shot-ai.cjs` 实测 `panel 399×761 / actionbar 369×170 / reference 369×32 / textarea 369×56 / selects [347, 347] / overflowing []`，
  按钮宽度 `生成预览 181 / 发送对话 181 / 复制 181 / 插入到光标 181 / 替换范围 181 / 重新生成 181`（2×2 等宽、无截断），`接受结果 74 / 拒绝 72`（贴右且不撑满）；
  默认绿档 / `data-theme-preset="feishu"` 灰档 / `setTheme('dark')` 深色档三种预设截图目视通过（深色档按钮文字对比度足够）；`plain` 模式（空选区）引用条正确隐藏。
- **补充闸门**：`node shot-table-ai.cjs` 走表格入口，`barVisible: true`、`aiCount: 1`、`ariaLabel: "AI 问答"`、`isImageAiShell: false`、`hasActionbar: true`、`fields: ["上下文范围","操作"]`、`refText: "[表格选区]"`，
  确认需求②（表格「问问AI」也换过来了）成立。

## T7 · 视频上传紧凑卡

- [x] `file-upload-tasks.js`：`fileKindOf(file.type) === FILE_KIND.VIDEO` 判 kind；`attachOverlay` 给宿主加 `data-upload-kind="video"`，`releaseOverlay` 一并摘掉 `is-uploading` 与 `data-upload-kind`。
- [x] CSS：`.lark-doc-file[data-upload-kind="video"].is-uploading { height: 300px }`、预览区 `flex: 1 1 auto` 让位；覆盖层 `.is-video` 深底（`--ld-bg-tooltip`）、`justify-content: center`、`gap: 12px`、`padding: 24px`；轨道 160×3、`rgba(255,255,255,.24)`；填充与文件名用 `--ld-text-on-brand`；元信息 `rgba(255,255,255,.72)`。
- [x] 不动 `453` 这条预览态契约常量，只在上传态 CSS 里覆盖块高。
- [x] 文件（非视频）上传观感不变（见闸门对照）。
- **闸门**：`node shot-upload.cjs video` → `uploadKind: "video"`、`shell 534×300`、`overlay 532×298`、`track 160×3`、`overlayClass "lark-doc-file-uploading is-video"`、**`barCenterOffset: 1`**（与块中心偏差 1px，门槛 < 20px）；
  `node shot-upload.cjs file` → `uploadKind: null`、`shell 534×453`、`overlay 532×451`、`track 240×4`、`overlayClass "lark-doc-file-uploading"`、`barCenterOffset: -160`（靠上排布，与改造前一致）。
- **补充闸门**：`node scripts/check-theme-tokens.js` → 通过，354 个文件，存量 0 / 新增 0（本轮新增的 `rgba(255,255,255,…)` 不在 hex/`white` 关键字规则命中范围）。

## T8 · 收口

- [x] `npm run build:vue2` + webpack 重建 `dist/`，`cp index.html dist/index.html`（最后一次在按钮网格修正之后重跑，`webpack compiled successfully`）。
- [x] 全量单测：`Test Files 109 passed`、`Tests 3098 passed / 1 skipped`，**无 `Errors` 行**。
- [x] 走查脚本同步旧选择器（`scripts/verify-browser-image.js` / `verify-browser-ai-api.js`）：
      `.lark-doc-image-ai-reference` → `.lark-doc-ai-reference`、`.lark-doc-image-ai-answer` → `.lark-doc-ai-result`（且 `.first()`，结果区与富文本区同 class）、
      `图片问答消息`/`AI 问答消息` → `#lark-doc-ai-prompt`、引用行高断言 36 → 32、`替换选区` → `替换范围`、`插入正文` → `插入到光标`、
      `[aria-label="AI 模拟预览"]` → `[aria-label="AI 助手"]`、「请先配置 AI 服务」→「尚未配置 AI 服务」。
- [x] 本机 Chrome 走查（基线复查 + 本轮三条，dev server 未启动，全部打在最终 `dist/` 上）：
      - `shot-ai.cjs`：默认绿档 / `data-theme-preset="feishu"` 灰档 / `setTheme('dark')` 深色档 × `selection`/`plain`；
      - `shot-table-ai.cjs`：表格「问问AI」入口；
      - `shot-upload.cjs video|file`：两条上传路径；
      - `baseline.cjs`：工具栏纯图标「撤销」出提示「撤销」、移开即消失；气泡条（真实拖选）出条，`复制选中文字` / `行内代码` 出提示；`缩进和对齐` 带 `aria-haspopup="menu"` → 按规则不出；`+` 菜单 20 项正常展开；
        块手柄提示为「块操作与拖动」且悬停照旧打开块菜单；评论 UI 可见节点 0 个；主题切换实测背景 `rgb(246,248,247) → rgb(23,24,26) → rgb(246,248,247)`；无残留 `tooltip`。
      - 说明：工具栏 `B/I/U` 也出提示，那是第一轮 toolbar 自己的提示通道，不属本轮判据（本轮 `bindHoverTips` 只管四处弹层）。
- [x] 预览 `http://127.0.0.1:4175/` 返回 200，已用最终 `dist/` 刷新。
- [x] 汇报改动清单 + 预览链接，询问是否提交（当前 19 M + 1 D + `specs/` 等未跟踪）。

---

## 第三轮（用户最新 3 条反馈）

### T9 · 视频上传块上方空白

- [x] 根因：T7 的上传态块高 300px，而覆盖层内容（文件名 20 / 轨道 3 / 进度 18）合计约 65px，
      上下各留约 110px 空白（`probe-video.cjs` 实测 `shell 534×300` / `overlay 532×298`）。
- [x] `lark-doc.css`：上传态视频块高 300 → 120px；footer 在上传态隐藏；预览区 `flex: 1 1 auto`；
      覆盖层 `padding: 16px 24px`、`gap: 10px`、轨道 160×3；非上传态 453 契约不动。
- **闸门**：`verify-upload-round3.cjs` 实测视频 `shell 534×120` / `footer none` / `track 160×3` / `barCenterOffset 1`；
      文件（非视频）仍 `534×453` / `footer flex` / `track 240×4`。

### T10 · 视频上传进度改真实进度

- [x] 根因：预览宿主 `App.vue` 的 `uploadFile` mock 用 `setInterval` 分 20 片推进，实测序列
      `0→5→…→95→gone`，最后一片永远等真实上传完成才跳走 → 体感「卡在 95%」。
- [x] 改用 `FileReader.onprogress` 按**真实读入字节**上报 `onProgress({ loaded, total })`，读满 `resolve`；
      lark-doc provider `upload.js` 成功收尾已有 `progress(total)` 补 100%，库侧无需改。
- [x] `signal` 取消链路保留：abort 时 `reader.abort()` 并以 `AbortError` reject。
- **闸门**：`verify-upload-round3.cjs`（40MB fixture + 8ms 高频采样）实测序列
      视频 `["gone","0","gone"]`、文件 `["gone","0","44","gone"]`，不再出现 `95` 后长时间停留。
      旧 `shot-upload.cjs` 因固定 `waitForTimeout(350)` 后上传态已消失而超时，属走查脚本时序问题，非产品回归。

### T11 · ➕ 去 tips + 图片功能栏加 tips

- [x] 用户口径：「➕号按钮，不需要 tips；图片选中出来功能栏，也要按上边规则加 tips」。
- [x] `blockHandle.js`：空段落 ➕ 加 `aria-haspopup="menu"`，使 `hasNextLevelPopup()` 自动跳过；
      并**移除原生 `title="插入内容"`**（被跳过的按钮不进 `tooltip.show()`，不会自动转存 title，
      不移除会弹浏览器原生 tooltip）。点击打开插入菜单行为不变。
- [x] `cellPlusTools.js`：单元格 ➕ 同样加 `aria-haspopup="menu"`，本就无 `title`；保留 `bindHoverTips(el)` 但判据跳过。
- [x] `src/core/nodeviews/image.js`：图片工具条接入 `bindHoverTips(toolbar)` —— 纯图标出 tips、
      「问问AI」有可见中文名自动不出；`unmountToolbar()` 里 `toolbarTips.destroy()`，
      NodeView `destroy()` 改调 `unmountToolbar()`，避免提示层残留在已卸载节点上。
- [x] `test/unit/hover-tips.test.js`：新增「接入 · ➕ 按钮」「接入 · 图片功能栏」两组共 5 例。
- **闸门**：`hover-tips.test.js` **22 passed**；`image-nodeview.test.js` + `dom-renderer-contract.test.js` **517 passed**；
      本机 Chrome `verify-tips-interact.cjs` 实测图片工具条纯图标「裁剪」→ `tooltips: ["裁剪"]`、
      有中文名「问问AI」→ `tooltips: []`（不出）。
- **走查限制**：预览文档 4 个单元格初始都有内容，`buildCellPlusState()` 要求光标落在表格内空段落；
      脚本用键盘与 ProseMirror tr 清空后 `refreshTableTools()` 未随脚本 dispatch 重算，
      故单元格 ➕ 未能在浏览器里稳定生成。该按钮显隐逻辑一行未改（仅加 `aria-haspopup` / 去 `title`），
      且单测已断言 `aria-haspopup="menu"`、无 `title`、`resolveTarget() === null`，以单测为准。

### T12 · 增量测试与重新打包

- [x] 增量：hover-tips 22 / image+dom 517；全量 `npx vitest run` → **109 files passed，3101 passed + 1 skipped**，无 Errors。
- [x] 主题令牌 lint：`check-theme-tokens.js` → 354 文件，存量 0 / 新增 0。
- [x] `npm run build:vue2` + webpack `compiled successfully` + `cp index.html dist/index.html`。
- [x] 预览 `http://127.0.0.1:4175/` → HTTP 200。

---

## 遗留风险

- 飞书视频上传实页抓取受阻（本机 Chrome CDP 端口 9222 返回 404，无法复用登录会话）。T7 按「紧凑媒体卡」通用形态实现，验收时请用户确认；如与飞书实际样式有差异，据截图微调即可。
- tips 的「可见中文名称」判定依赖布局，jsdom 下量不出盒子 → 单测里用 `clip-path` / 字面 class 制造可判分支，不依赖真实排版。
