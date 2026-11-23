# Tasks: 版本预览模式与历史记录面板按飞书 1:1 实现

**Input**: [spec.md](./spec.md) · [plan.md](./plan.md)
**取证**: `/tmp/` 飞书真身截图 8 张（见 plan.md 取证表）

## Phase 1 · 面板收口 ✅ 已交付

- [x] **T1** 删 `src/ui/versionPanel.js` 右栏头部的 `trashToggle`（「回收站」按钮）与 `rightIcon`（chevronDown）
  - 飞书 `fs_hist_full.png`：头部只有 `历史记录` + ⓘ
  - 回收站入口保留在已存版本子菜单（`documentMenuView.js:180` 已实现）
  - 同步：`state.trash` / `renderTrash()` 里对 `trashToggle` 的写值一并清理，回收站弹层本身保留
  - 右侧改为 `rightHeading`（`rightTitle` + `rightInfo`，`aria-label='历史记录会自动保存，可随时还原任意一条'`，图标用 `menu-help` 圆圈问号 16px）
- [x] **T2** 还原确认框改飞书真身：标题 `还原此记录？`、按钮 `取消` / `还原`
  - 现文案 `还原此历史版本？`（`versionPanel.js:190`）无正文
  - 正文 `将当前文档还原至 <时间> 的状态` 由 `versioningPresentation.js:213` `versionRestoreConfirmText()` 提供，落点 `panelPresentation.js`
- [x] **T3** 「显示更改」开关几何校准 36×22 / 圆角 11 / 滑块 18
- [x] **T1'** 翻页器（`上一页` / `下一页` + `cursorLabel`）**保留** —— 真身取证结论：面板内翻页器存在，只删 `trashToggle` 与 `chevronDown`

## Phase 2 · 已存版本预览态

- [x] **T4** 预览态顶栏 —— **落点修正：`src/ui/topBar.js` + `nativeEditorHost.refreshTopBar()`，不在 `versionPanel.js` 内**
  - 依据：飞书已存版本预览态换的是**整页顶栏**（`✦ 飞书云文档` 保留，牌子后紧接 `当前版本：X ⌄`），而 `versionPanel.js` 的 `leftHeader`/`rightHeader` 只是**面板内**顶栏
  - 状态注入链：`nativeEditorHost.mountTopBar()` → `createTopBar({...})` → `refreshTopBar()` 推 `{ ...buildTopBarState.call(this), docToast, docToasts, ... }` → `topBar.update(state)`
  - `state.mode = 'history' | 'saved'`；`history` 顶栏保持现状（回归 `headerVisible !== false` 分支）
  - `saved` 顶栏实测文案（逐字）：
    - 左：`✦ 飞书云文档` ｜ `当前版本：` + `<版本名>` + `⌄`
    - 中右：`回到源文档`（前置 ⧉ 图标，白底灰边胶囊）、`复制版本链接`（前置 🔗 图标，**蓝字蓝边胶囊**）、`···`
    - 最右：竖分隔线、`🔍`、`+`、圆形蓝底头像
  - 几何（native 2880×1800 / DPR 2 → CSS 减半）：版本胶囊 x 392–515.5、**宽 ≈124**、top ≈20、高 ≈32，浅灰底 `rgb(229,230,230)`、文字 `#1F2329`
- [x] **T5** 版本指示下拉（自绘 `topBar.js` 内 `versionMenu`，未复用 `src/ui/select.js`，因需行内 ✓ 与非整行触发器）
  - 行文案：`` `${文档名} 第 N 版${版本名}` ``（N 按列表倒序，最新 = 第<总数>版）
  - 左对齐触发器（左缘与**胶囊**左缘对齐，不拿整枚按钮算，因 `当前版本：` 前缀在胶囊外）；**无分隔线 / 无底部按钮**，当前行行内蓝色 ✓（`iconNode('check', 16)`）
  - ⚠️ **旧结论已推翻**：先前记的「首行灰字元信息 `<作者> 保存于 <时间>`」**不存在**。取证 `_pv4_dd.png` + `_pv4_zoom.png` 确认那是**独立深色 tooltip**（`--ld-bg-tooltip` #24282c、白字、带上指小三角、左缘比面板更靠左、悬浮在胶囊正下方），内容 `<作者> 保存于 <今天 HH:MM>`。macOS 下指针停在胶囊上即出现，与列表无关。
- [x] **T6** `复制版本链接`：写剪贴板 `?edition_id=` → toast `复制成功` + 按钮下方深色 tooltip `有文档阅读权限的用户可通过链接阅读此版本`
  - **toast 直接复用 `showDocumentToast('复制成功')`（`topbarMoreMixin.js:388`），没有新造一套** ✅
  - 依据：实测 toast native x 1322–1557 / y 82–185 → **CSS w 118 / h 52 / top 41 / 中心 x 719.75**（视口中心 720 / 视口高 900），底 `rgb(228,250,225)`、1px 绿边、radius 6、无按钮
  - 现有 `.lark-doc-doc-toast`（`min-height 54 / padding 15px 19px / radius 6`）+ `.lark-doc-toast-stack`（`top: 32px` + `padding-top: 8px` = 40 ≈ 实测 41）**完全吻合**
  - tooltip：深底 `#1F2329`、白字、居中对齐在按钮正下方、带上指小三角（复用 `.lark-doc-version-tip`）
- [x] **T7** `回到源文档`：退出预览态、移除 `?edition_id=`（注：接入前 `grep -rn "edition_id" src scripts test` 为 **0 命中**，URL 契约已从零接入 `versionPreviewLink()`）
- [x] **T8** 「立即查看」（`panelPresentation.js:625` `onNoticeLink`）由「开面板 + 选中」升级为进完整 `mode:'saved'` 预览态
  - 现状：`openVersionPanel({ kind:'saved' })` + `selectVersion(id)`
  - 已实现：`enterVersionPreview(id)` → 关面板（互斥）→ `selectVersion(id)` 取正文 → `mountVersionPreviewPage()` 挂只读正文 + root 加 `.is-version-preview` 换装 → `refreshTopBar()`
  - 兜底：拿不到版本 id、或拉取期间版本被删/文档被换掉 → 退回 `openVersionPanel({ kind:'saved' })`

## Phase 3 · 视觉与断言

- [x] **T9** 面板条目 1:1 —— **取证件从像素扫描升级为 Playwright 读真身 computed style**，以下全部为实测值，无一处换算
  - 分组标题是**月**（`10月`），不是天：293×32、`margin: -1px 0`、`padding-left: 14`、上下各 1px `rgb(222,224,227)`、12px/500/`rgb(100,106,115)`、`line-height: 32`
  - 条目固定**三行节点**（时间 / 事件描述 / 作者）：293×66（desc 空）/ 293×88（desc 有内容）、`padding: 12px 13px 12px 40px`
  - 左蓝竖条是 `.history-timeline-item::before` **常驻 3px `rgb(51,109,244)` + `opacity: 0`**，选中才 `opacity: 1`（不是按需插节点）
  - 条目分隔线是 `::after` 1px `rgb(222,224,227)` 绝对定位铺满 293 宽，**不占高度**
  - hover 底 `rgb(239,240,241)`；选中底 `rgb(224,233,255)` + 整条 `color: rgb(51,109,244)`
  - 第一行 14px/500/`rgb(51,109,244)`/20 + `margin-bottom: 4`；第二行 12px/18 + `margin: 4px 0`（**颜色继承条目**，空时高度 0 且外边距折叠成 4px）；第三行 12px/500/18 `rgb(100,106,115)`，前置 6×6 圆点 `rgb(141,85,237)` @ `top: 6`
  - ⚠️ **旧结论已推翻**：「最近更新」是 desc 行的**文案**，不是绿底徽标 —— `.lark-doc-version-item-badge` 整段删除；作者行选中时**不变蓝**
  - 页脚 42 高 / `padding: 0 16px` / `rgb(31,35,41)` 12px
  - 落点：`src/styles/versioning.css`、`src/ui/versionPanel.js`（desc 改无条件渲染、清 `collapsedDays`/`expandedDays` 死变量）、`versioningPresentation.js`（`groupVersionsByMonth` / `versionItemDesc`）
- [x] **T10** 同步断言
  - `test/unit/build-contract.test.js`：7 处标识符 `groupVersionsByDay`→`groupVersionsByMonth`、`versionDayGroups`→`versionGroups`、去掉 `versionItemBadge`
  - 🔴 修复真 bug：**`rollup.config.mjs:248` 惰性降级值表仍写死 `versionDayGroups`**，改名后 `versionGroups` 冷缓存落到兜底 `return ''`（面板包未加载时应为 `[]`）。这是 `build-contract.test.js:395`「expected '' to deeply equal []」的唯一根因，改名为 `versionGroups` 后 73/73 通过
  - `test/unit/versioning-ui.test.js`：「按天分组」整段重写为「按月分组」（跨月另起组、跨年同月不并组、`createdAt<=0` → `未知时间` 且 key 留空）；条目三行断言重写；「更多历史」断言换成「整月全量铺开 + label 是 DIV」
  - `test/unit/versioning-document.test.js`：手机端用例改为整月全量 4 条 + `more-history` 为 null
  - ⚠️ `scripts/verify-browser-panels.js` / `verify-browser-versions.js` / `verify-browser-mobile.js` 三支 E2E 断言**仍是按天分组 + 徽标的旧口径**，需在 T11 之后单独同步（不在本轮单测范围内）
- [x] **T11** 门禁全绿（2026-11-23）
  - `npx vitest run` → 174 files / 5265 passed, 1 skipped, 0 failed
  - `npm run test:affected` → 99 files / 3617 passed, 1 skipped
  - `npm run check:theme-tokens` → 511 文件，0 新增违例
  - `npm run check:quick` → architecture + contract + eslint 全通过
  - `ROLLUP_TARGET=elementEsm node scripts/build-rollup.mjs` → 构建完成（注：脚本是 `scripts/build-rollup.mjs`，`scripts/rollup.mjs` 不存在）

## 待取证

- [x] **C1** 版本指示下拉几何 —— 已量：左缘与胶囊左缘对齐（≈784 native / 392 CSS）、白底圆角卡、3 项、无分隔线、无底部按钮；项高/阴影待落码后浏览器实测
- [ ] **C2** 已存版本预览态「···」菜单项名单与顺序 —— 截图未展开，需补证（阻塞 T4 的 `···` 面板）
- [ ] **C3** ⓘ 图标的 hover 文案 —— 截图未展开（Phase 1 已先按 `aria-label` 兜住）
- [ ] **C4** 时间线**父子折叠结构** —— 真身确认存在，但数据来源未确认，**未落码**
  - 结构：`history-timeline-majorHistory-item-container`（`overflow: hidden` + `::after` 底部 1px）里放父条目，父条目左上角 `.history-timeline-open-icon` 20×20（`absolute left:16 top:12 z-index:1 radius:4`，内含 12×12 SVG `fill: rgb(100,106,115)`，`transform: matrix(0,1,-1,0,0,0)` = ▶，可旋转成 ▼）
  - 子条目带 `.has-padding`：`padding-left: 56px`（父级文字起点 1187 → 子级 1203，缩进 16）
  - ❓ 未确认：哪些连续快照该折叠成一个 `majorHistory` 组（触发条件 / 分组口径 / 展开状态记忆）—— 当前数据模型是扁平 `versionList`，没有语义来源。**取证到之前不臆造**
- [x] **C5** 条目视觉全量 —— 已被 T9 用 computed style 取证覆盖（见 T9 明细）

## 附：跨分支合并遗留（阻塞「尽可能合并」）

- [ ] **M1** `src/ui/permissionView.js` 两侧两套平行实现，待用户裁定 A/B/C
  - dev 版（502 行，B20/B22 逐像素对齐飞书）：纯权限项列表 = 复选框 + 下划线式下拉 + 灰色说明复选，`selectNode` 命中 0
  - 本分支版（423 行）：保留「邀请协作者」行、搜索框、「链接范围/链接权限」detail 行、服务提示反馈行、原生 select（`selectNode` 命中 8）
  - 连带：`setPermissionValue` 语义（dev 写本地 mock 零请求 / mine 弹 warning toast，`overlays-native.test.js` 两侧断言互斥）、`applyEmbed` 字段（仅 dev 有）、`caretRight` 尺寸（14 vs 16）、`collaboratorView` 是否升级为 dev 的 `avatarLabel`/`roleLabel`/标签/部门结构
