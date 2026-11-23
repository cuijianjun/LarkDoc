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

- [ ] **T4** 预览态顶栏 —— **落点修正：`src/ui/topBar.js` + `nativeEditorHost.refreshTopBar()`，不在 `versionPanel.js` 内**
  - 依据：飞书已存版本预览态换的是**整页顶栏**（`✦ 飞书云文档` 保留，牌子后紧接 `当前版本：X ⌄`），而 `versionPanel.js` 的 `leftHeader`/`rightHeader` 只是**面板内**顶栏
  - 状态注入链：`nativeEditorHost.mountTopBar()` → `createTopBar({...})` → `refreshTopBar()` 推 `{ ...buildTopBarState.call(this), docToast, docToasts, ... }` → `topBar.update(state)`
  - `state.mode = 'history' | 'saved'`；`history` 顶栏保持现状（回归 `headerVisible !== false` 分支）
  - `saved` 顶栏实测文案（逐字）：
    - 左：`✦ 飞书云文档` ｜ `当前版本：` + `<版本名>` + `⌄`
    - 中右：`回到源文档`（前置 ⧉ 图标，白底灰边胶囊）、`复制版本链接`（前置 🔗 图标，**蓝字蓝边胶囊**）、`···`
    - 最右：竖分隔线、`🔍`、`+`、圆形蓝底头像
  - 几何（native 2880×1800 / DPR 2 → CSS 减半）：版本胶囊 x 392–515.5、**宽 ≈124**、top ≈20、高 ≈32，浅灰底 `rgb(229,230,230)`、文字 `#1F2329`
- [ ] **T5** 版本指示下拉（复用 `src/ui/select.js`）：首行灰字元信息 `<作者> 保存于 <时间>`，下接版本列表；左对齐触发器（左缘与胶囊左缘对齐）；**无分隔线 / 无底部按钮**，选中行行内 ✓
- [ ] **T6** `复制版本链接`：写剪贴板 `?edition_id=` → toast `复制成功` + 按钮下方深色 tooltip `有文档阅读权限的用户可通过链接阅读此版本`
  - **toast 直接复用 `showDocumentToast('复制成功')`（`topbarMoreMixin.js:388`），不要新造一套**
  - 依据：实测 toast native x 1322–1557 / y 82–185 → **CSS w 118 / h 52 / top 41 / 中心 x 719.75**（视口中心 720 / 视口高 900），底 `rgb(228,250,225)`、1px 绿边、radius 6、无按钮
  - 现有 `.lark-doc-doc-toast`（`min-height 54 / padding 15px 19px / radius 6`）+ `.lark-doc-toast-stack`（`top: 32px` + `padding-top: 8px` = 40 ≈ 实测 41）**完全吻合**
  - tooltip：深底 `#1F2329`、白字、居中对齐在按钮正下方、带上指小三角
- [ ] **T7** `回到源文档`：退出预览态、移除 `?edition_id=`（注：`grep -rn "edition_id" src scripts test` 当前 **0 命中**，URL 契约需从零接入）
- [ ] **T8** 「立即查看」（`panelPresentation.js:625` `onNoticeLink`）由「开面板 + 选中」升级为进完整 `mode:'saved'` 预览态
  - 现状：`openVersionPanel({ kind:'saved' })` + `selectVersion(id)`
  - 目标：进完整预览态（顶部换 T4 顶栏 + T5 下拉 + T6/T7 按钮可用）

## Phase 3 · 视觉与断言

- [ ] **T9** 面板条目：hover / 选中底色 + 左蓝竖条 + 分组 caret + 副标题行（`最近更新` / `还原自 X 的版本` / `文档命名为X`）
- [ ] **T10** 同步断言：`test/unit/versioning-ui.test.js:1072~1081`、`scripts/verify-browser-panels.js:756~820`、`scripts/verify-browser-versions.js:64~118`、`scripts/verify-browser-mobile.js:153~178`
- [ ] **T11** 门禁：`npx vitest run` → `npm run test:affected` → `npm run check:theme-tokens` → `npm run check:quick` → `ROLLUP_TARGET=elementEsm node scripts/build-rollup.mjs`

## 待取证

- [x] **C1** 版本指示下拉几何 —— 已量：左缘与胶囊左缘对齐（≈784 native / 392 CSS）、白底圆角卡、3 项、无分隔线、无底部按钮；项高/阴影待落码后浏览器实测
- [ ] **C2** 已存版本预览态「···」菜单项名单与顺序 —— 截图未展开，需补证（阻塞 T4 的 `···` 面板）
- [ ] **C3** ⓘ 图标的 hover 文案 —— 截图未展开（Phase 1 已先按 `aria-label` 兜住）

## 附：跨分支合并遗留（阻塞「尽可能合并」）

- [ ] **M1** `src/ui/permissionView.js` 两侧两套平行实现，待用户裁定 A/B/C
  - dev 版（502 行，B20/B22 逐像素对齐飞书）：纯权限项列表 = 复选框 + 下划线式下拉 + 灰色说明复选，`selectNode` 命中 0
  - 本分支版（423 行）：保留「邀请协作者」行、搜索框、「链接范围/链接权限」detail 行、服务提示反馈行、原生 select（`selectNode` 命中 8）
  - 连带：`setPermissionValue` 语义（dev 写本地 mock 零请求 / mine 弹 warning toast，`overlays-native.test.js` 两侧断言互斥）、`applyEmbed` 字段（仅 dev 有）、`caretRight` 尺寸（14 vs 16）、`collaboratorView` 是否升级为 dev 的 `avatarLabel`/`roleLabel`/标签/部门结构
