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
  - ~~⚠️ 三支 E2E 断言仍是旧口径~~ → 已在 C9 同步（`panels` 改折叠组口径 90/90 通过；`versions` / `mobile` 走真实内存 provider，无 `groupId` ⇒ 口径本就一致），`versions` 剩下的两处过期断言见 C12
- [x] **T11** 门禁全绿（2026-11-23）
  - `npx vitest run` → 174 files / 5265 passed, 1 skipped, 0 failed
  - `npm run test:affected` → 99 files / 3617 passed, 1 skipped
  - `npm run check:theme-tokens` → 511 文件，0 新增违例
  - `npm run check:quick` → architecture + contract + eslint 全通过
  - `ROLLUP_TARGET=elementEsm node scripts/build-rollup.mjs` → 构建完成（注：脚本是 `scripts/build-rollup.mjs`，`scripts/rollup.mjs` 不存在）

## 待取证

- [x] **C1** 版本指示下拉几何 —— 已量：左缘与胶囊左缘对齐（≈784 native / 392 CSS）、白底圆角卡、3 项、无分隔线、无底部按钮；项高/阴影待落码后浏览器实测
- [x] **C2** 已存版本预览态「···」菜单项名单与顺序 ✅ 已取证 + 已落码（2026-11-23 Playwright 直连真身）
  - **9 项独立名单，不是编辑态 23 项的子集**。逐行走 DOM + computed style（产物 `/tmp/c2_menu_full.json`）
  - 名单与顺序：`页宽设置 ›` / `演示模式` / `查找` / `在段落前显示作者`[开关] — 分隔线 — `下载为 ›` / `翻译为英语 ›` / `打印` / `重命名` — 分隔线 — `删除`
  - 外框：198×326 @(1101,53)、白底、`radius: 6px`、`padding: 2px 0`；每行 190×32
  - 分隔线只有两条：y195（`在段落前显示作者`之后）、y338（`重命名`之后），1px 贯穿 196 宽
  - 与编辑态的差异必须写死在表里，不靠过滤推导：
    - **多** 1 项 `重命名` —— 改的是**版本名**（`重命名版本` 对话框），不是文档名
    - **少** 16 项：关注文档更新 / 添加快捷方式到 / 移动到 / 置顶 / 收藏 / 转换为模板 / 创建副本 / 另存为版本 / 查看已存版本 / 文档权限 / 文档小组件 / 文档信息 / 提及的人 / 历史记录 / 历史评论 / 更多
    - `查找和替换` 在这里只叫 `查找`（同命令不同文案）
  - 图标：`重命名` 用新增 `menu-rename`（path 逐字取自真身）；`在段落前显示作者` **无图标**（`iconCls` 空数组，只有右侧 28×16 开关）；其余 7 项 `svg path[d]` 与 `TOPBAR_MORE_ITEMS` 同名项**逐字节相同**（`/tmp/c2_icons.json`）
  - 只读下这 9 项**全部不置灰**（含 `删除`），所以预览态不走 readonly 置灰逻辑
  - 「立即查看」落点的**重命名对话框**实测（`/tmp/c2_rename.json`）：
    - `cls: "ud__dialog__content ud__modal save-version-dialog ud__dialog__content-sm"`、`role: dialog`、420×242 @(510,329)、`radius 8px`、白底
    - header 420×72；body 420×90，文本 `版本名称` + 计数 `8/1000`
    - 输入框 `ud__native-input` 271×22 @(546,436)、placeholder `请输入名称`、预填当前版本名
    - 按钮 `取消` 80×32 @(734,515)（outlined）/ `确定` 80×32 @(826,515)（filled）
    - 遮罩 `ud__dialog__mask` 1440×900 `rgba(0,0,0,0.55)`
    - 🔑 **与「另存为版本」是同一套壳**（真身类名同为 `ud__modal save-version-dialog`、同 420×242），因此复用 `createSaveVersionDialog`，只把标题与关闭钮读屏文案开成入参
  - 落码：
    - `topbarMoreMixin.js` 新增 `TOPBAR_MORE_PREVIEW_ITEMS`（9 项冻结表，含 `action` 列）+ `TOPBAR_MORE_PREVIEW_DIVIDER_AFTER = ['show-author','rename']`
    - `topbarMoreItems` 加 `if (this.versionPreviewPageId) return TOPBAR_MORE_PREVIEW_ITEMS.map(...)`（**分支在 readonly 逻辑之前**，否则会被置灰）
    - `topbarMoreRows` 按态切分隔线；`onTopbarMoreItem` 加一级 switch 分支（`id` 保持 `show-author` 让渲染器找到开关状态，`action` 走 `more.show-author` 复用宿主事件，菜单不关）
    - `runTopbarMoreAction` 加 `case 'rename'` → `openRenameVersion(this.versionPreviewPageId, trigger)`
    - `versioningMixin.js` 新增 `openRenameVersion` / `closeRenameVersion`；`provider.js` 新增 `rename(versionId, label)`（只换 `label`，`id/createdAt/seq` 不动，校验口径同 `createSnapshot` → `E_SNAPSHOT_LABEL`）；`icons.js` 新增 `menu-rename`；`dialogs.js` `createSaveVersionDialog` 开 `dismissLabel` 入参
    - 重命名后**不调 `loadVersions()`** —— 那会把 `versionSelectedId` 重置回第一条，等于把用户踢出预览态；改为原地替换 `versionList` 那一条的 `label`，时间线 / 顶栏「当前版本：<名>」/ 预览下拉三处同源刷新
  - 单测：`test/unit/topbar-more-ui.test.js` 新增 8 组 → **56 passed**；`test/unit/versioning-core.test.js` 新增 `rename` 用例；三支版本单测 **196 passed**
- [x] **C3** ⓘ 图标的 hover 文案 ✅ 已取证（落码见下方遗留）
  - 文案是 **`帮助中心`** —— 真身 `.docx-history-right-header-help-icon` 的 `ud__tooltip-content` 实测逐字
  - ⚠️ **旧结论已推翻**：本仓原先写的「历史记录会自动保存，可随时还原任意一条」是**臆造**，已删除
  - 气泡几何（`/tmp/c3_tooltip.json`）：72×36、底 `rgb(31,35,41)`、白字、`12px/20px 400`、`radius 8px`、`padding 8px 12px`、三层阴影、位于图标正下方（tooltip y53 vs 图标 bottom 43.5）
  - 落码：`versionPanel.js` 的 `aria-label` 改 `帮助中心`，**不再写 `title`**（那会弹浏览器原生灰气泡），改走共享 `createTooltip({ host })` + `bind(rightInfo)`，`destroy()` 里补 `helpTip?.destroy()`
  - 气泡样式对齐真身（`src/styles/deferred-ui.css` 的 `.lark-doc-tooltip`）：`padding 8px 12px` / `radius 8px` / `12px-20px 400` / 三层阴影 `0 8px 24px 8px rgba(31,35,41,.04), 0 6px 12px rgba(31,35,41,.04), 0 4px 8px -8px rgba(31,35,41,.06)` / 箭头 `border: 8px` → 16×8（真身 `.ud__tooltip__arrow` 即 16×8）
  - 🔴 同时校正 token：`--ld-bg-tooltip` `#24282c` → **`#1F2329`**（真身 `rgb(31,35,41)`；原值是早先目测取的，偏亮）。这是「改值」不是「新增字面 hex」，`check:theme-tokens` 基线计数不变
  - ✅ 本地渲染实测复核（`/tmp/tip-check.html` + Playwright 量盒模型）：72×36 / `rgb(31, 35, 41)` / 白字 / `12px/20px 400` / `radius 8px` / `padding 8px 12px` / 三层阴影 / 箭头 16×8 —— **与真身逐项相同**
- [x] **C4** 时间线**父子折叠结构** ✅ 已取证（2026-11-23 Playwright 直连真身，产物 `/tmp/c4_net3.json` / `/tmp/fs_c4i.mjs` / `/tmp/fs_c4svg.mjs`）—— **数据源已锁定，阈值假设已证伪**，落码见 C6

  **① 数据源（接口逐字）**
  - `GET /space/api/docx/history/page/list/?page_id=<docToken>&count=10[&cursor=<n>]`
  - 响应 `data` 键：`major_history` / `next_cursor` / `user` / `has_more`
  - `major_history[i]` 键：`type` / `editor_ids` / `page_info` / `minor_history` / `version` / `name` / `description` / `edit_time`
  - `minor_history[j]` 同键 + `external_block_info`
  - 🔑 **分组完全由服务端给出**：`major_history` = 一个父组，`minor_history[]` = 该组下的子条目数组，且 `minor_history[0].edit_time === major_history[i].edit_time`。客户端**不做任何时间聚类**

  **② `type` 枚举实测**
  - `1` = 创建（`title_changes` 为 `{origin:'',now:''}`、`from_ver/to_ver = 1`、`external_block_info {}`、`minor_history` 恰 1 条）
  - `2` = 编辑保存（绝大多数）
  - `3` = 还原（`minor_history[0].page_info.revert_info = { time, revert_task_id }`）
  - 🔑 `type 1 / 3` 的 `minor_history` **恒为 1 条**，与 DOM 上「这两类条目没有箭头」严格对应
  - ⚠️ 本仓 `SNAPSHOT_KINDS = ['auto','manual','restore']`（`src/core/versioning/types.js:21`）与飞书 `1/2/3` **不是同一枚举**，落码必须显式映射，不得混用

  **③ 翻页**
  - 第一页 `has_more=true` / `next_cursor=11264`；第二页 `has_more=false`
  - 两页各 10 组，合计 20 组，与面板滚动加载出的 20 个 container 一一对齐

  **④ DOM ↔ 接口的严格对应**
  - `DOM 条目数 = 1 个父行（head） + minor_history.length 个子行`
  - 父行时间 = `minor_history[0]` 时间（秒被隐藏，所以父行与首个子行看起来同刻）
  - 实测 group0：minors 3 条（12:08:29 / 12:08:14 / 12:02:25）→ DOM 4 条（12:08 / 12:08 / 12:08 / 12:02）
  - 实测 group1：minors 2 条（01:31:08 / 01:29:40）→ 展开后 DOM 3 条

  **⑤ 阈值假设已证伪（关键结论）**
  - 统计 20 组：**组内最大间隔 30.1 分钟**（group18，39 条）；**组间最小间隔 2.1 分钟**（group18→19，type2→type1）
  - 十二个最小组间间隔：2.1 / 4.8 / 5.7 / 41.4 / 42.9 / 60.7 / 62.1 / 64.0 / 65.0 / 68.3 / 89.6 / 90.7 分钟
  - 🔴 组内 30.1 > 组间 2.1，**区间反向重叠 → 不存在任何时间阈值**
  - ⇒ **「按间隔聚类」是实现方向错误**，必须改为「按服务端组标识（`version` / `edit_time` 作为 groupId）透传」

  **⑥ 容器 / 父行 / 子行几何（computed style 实测）**
  - container `.history-timeline-majorHistory-item-container`：293×281 @(1147,94)、`overflow: hidden`、`position: relative`、`margin: -1px 0`、`::after` = `absolute left0 right0 bottom0 1px rgb(222,224,227)`
  - 父行 `.history-timeline-item`：293×**88**、`padding: 12px 13px 12px **40px**`、`margin: -1px 0`；选中态 `background rgb(224,233,255)`
  - 子行 `.has-padding.history-timeline-item`：293×**66**、`padding: 12px 13px 12px **56px**`、`margin: -1px 0`
  - 文字左起点：父 1187 / 子 1203（**差 16px**）

  **⑦ 箭头（逐字）**
  - 容器 `.history-timeline-open-icon`：20×20 @(1163,106)、`absolute`、`left: 16`、`top: 12`、`border-radius: 4px`
  - 内含 `svg 12×12 viewBox="0 0 12 12" fill="none"`
  - path（逐字）：`M9.166 6.243l-4.69 3.41A.3.3 0 014 9.412V2.589a.3.3 0 01.476-.242l4.69 3.41a.3.3 0 010 .486z`，`fill="#646A73"`
  - 两态**同一份 SVG（向右实心三角）靠 class + transform 旋转**：
    - 展开：`class="pulldown-icon open"` + `transform: matrix(0, 1, -1, 0, 0, 0)`
    - 折叠：`class="pulldown-icon"` + `transform: matrix(1, 0, 0, 1, 0, 0)`
  - ⚠️ **旧记录两处错值已更正**：`fill` 是 `#646A73`（不是 `rgb(100,106,115)` 之外的写法，两者同色但落码写 `#646A73`）；`matrix(0,1,-1,0,0,0)` 是**展开态**（▼），`matrix(1,0,0,1,0,0)` 才是折叠态（▶）—— 旧条目的方向记反了
  - 箭头**只在 `minor_history.length > 1` 时存在**（type 1/3 恒单条 ⇒ 无箭头）
  - 面板内 `[title]` / `[aria-label]` 探测为空 ⇒ 箭头**没有 tooltip 文案，不加气泡**

  **⑧ 分片代码检索结论（避免重复劳动）**
  - 下载 4 个 revision 相关 chunk（37KB / 3.5KB / 12KB / 102KB）+ `bear-docx-loadable-revision.6d6a114f.css`，`grep major_history|majorHistory|history-timeline` **0 命中**
  - 页内 `fetch` 扫全部 525 个已加载 JS，`majorHistory` **0 命中** ⇒ 该段渲染代码不在首屏 chunk 里（或用了压缩别名）。此路不再追，结论以接口 + DOM 实测为准
- [x] **C5** 条目视觉全量 —— 已被 T9 用 computed style 取证覆盖（见 T9 明细）

## Phase 4 · 时间线父子折叠结构（C4 落码）

- [x] **C6** 数据层：把「服务端分组」贯通到 `versionGroups` ✅
  - `snapshot.js`：`normalizeSnapshot` 新增第十个字段 `groupId`（非字符串 → 缺省空串），纯透传、不做任何归组推断
  - `versioningPresentation.js:groupVersionsByMonth` 语义扩成两层：先按月，月内按 `groupId` 再分组 → `{ key, label, groups: [{ id, head, children }] }`
    （任务原文写的 `items` 字段名在落码时改叫 `groups`：`items` 是旧的扁平口径，改名避免与新结构「组内含行」混淆）
  - 关键语义三条：`groupId` 非空时 `children[0] === head`（父行即 `minor_history[0]`）；`children.length < 2` 抹平成 `[]`（渲染层不必再判长度）；`groupId` 空则自成一组
  - 未改 `SNAPSHOT_KINDS`；飞书 `type 1/2/3` 与本仓 `kind` 的映射落在 provider 侧 ✅（见 C11）
- [x] **C11** provider 侧词表适配：`purpose` → `kind`、`groupId` 透传 ✅
  - `core/versioning/types.js` 新增 `snapshotKindFromPurpose(purpose)`：`auto→auto`、`pre_restore/post_restore→restore`、`approval` 与未知值 `→manual`（与 `normalizeSnapshot` 同口径，误判成 auto 会永久删历史）
  - `providers/versioning.js` 的 `metadata()` 用它落 `kind`，并把 `raw.groupId`（非字符串 → 空串）显式带进元信息；`purpose` **原样保留**（恢复/重试校验都比它，不能翻）
  - `session/sessionVersionMethods.js` 删本地同名私有 `localSnapshotKind`，改用共享函数（写路径与读路径一张表）
  - `versioningPresentation.js` 的「另存为版本」过滤由 `['manual','approval']` 收回 `kind === MANUAL` —— 那处 `'approval'` 正是 provider 漏翻词表的补丁
  - 单测：`versioning-core` 补 1 条纯映射用例；`versioning-ui` 新增 2 条走真实 `createHttpVersioningProvider` 的用例（4 种 purpose 的 kind 投影、`groupId` 透传与降级）
- [x] **C7** 渲染层：`versionPanel.js` 三层节点 ✅
  - `buildDay(day)` → `buildGroup(node)`：容器 `.lark-doc-version-group` + 父行 `button` + 展开态子行（`has-padding`）
  - 箭头节点：20×20 `span` + 内嵌 12×12 SVG（`icons.js` 新增 `version-group-arrow`，逐字取真身 path；**不用 `wrap()`**，它的 16 视图 + stroke 会把实心三角画变形）
  - 展开态是闭包 `expandedGroups = new Set()`，**不进 `daysSignature`**；展开只 `replaceWith` 被点的那一组，其它组一个节点都不动（否则丢焦点/丢滚动）
  - 默认**全部折叠**（与真身首屏一致）；`update()` 复位时 `expandedGroups.clear()`
  - 🔴 **对任务原文的一处更正**：原文写「点击父行 = 切换展开（不是选中）」，落码改成**三角管折叠、行管选中**。理由是真身把三角做成一颗独立元素（`.history-timeline-open-icon` 20×20 `absolute left:16 top:12`，类名 `pulldown-icon`），文字区从 40px 起排、是另一颗元素；而父行本身就是 `minor_history[0]` 这条版本 —— 整行只做折叠会让「组头」用鼠标永远选不到，而打开面板时自动选中的恰好就是它
- [x] **C8** 样式层：`src/styles/versioning.css` 补 ✅
  - `.lark-doc-version-group`：`position: relative`、`overflow: hidden`、`margin: -1px 0`
  - `.lark-doc-version-item.has-padding`：`padding-left: 56px`（父行 40 + 三角占位 16）
  - `.lark-doc-version-item-toggle`：20×20 / `absolute` / `left: 16px` / `top: 12px` / `radius: 4px` / `color: rgb(100, 106, 115)`；`svg` 12×12；`is-open` → `transform: rotate(90deg)`
  - 真身 container 另有 `::after` 1px `rgb(222,224,227)`，本仓**故意不补**：条目的 `::after` 已铺满每行，再叠一条会画出 2px
  - 新样式全部 `rgb()`；同时修掉 `icons.js` / `versionPanel.js` 注释里的两处字面 hex（`check:theme-tokens` 连注释一起算基线）
- [x] **C9** 断言 ✅
  - 单测：`versioning-ui.test.js` 迁移 4 条旧分组断言（`headIds()` 辅助）+ 新增 4 条分组纯函数用例 + 迁移 2 条 DOM 用例 + 新增 4 条折叠 DOM 用例（默认折叠 / 无子无三角 / 点三角展开 / 点行选中）；`versioning-core.test.js` 字段数九→十 + `groupId` 透传
  - `build-contract.test.js`：`versioningPresentationShape().methods` 名单补 `versionTimelineItem`
  - E2E `verify-browser-panels.js`：`measureVersions` 的 `days[].items` 改 `days[].groups[{ foldable, open, expanded, head, children }]`；注入 provider 给前两条同 `groupId` 造出真折叠组；新增「点三角展开 2 条子行且不改变选中」一条
  - `verify-browser-versions.js` / `verify-browser-mobile.js` **无需改**：它们走真实内存 provider，记录不带 `groupId` ⇒ 每条自成一组、无三角，`nth()` 顺序与扁平口径一致（已核对 `provider.js` 不写 `groupId`）
- [x] **C10** 门禁五连后提交（结果见本轮提交说明）
- [x] **C12** E2E 过期断言按真身收回（`scripts/verify-browser-versions.js`）✅
  - 还原确认框：旧断言要求按钮 `height >= 40`，是按本地早期实心按钮写的；飞书真身是右下角两颗 **32px 文字按钮**（实测 取消 80×32 / 还原 80×32、面板 420×178、圆角 12px、焦点落「取消」、`aria-modal=true`）。断言改为 `height === 32` 且文本为 `取消/还原`
  - 只读文档菜单：旧断言要求「另存为版本」`count === 0`；真身是**保留但灰掉**（`topbarMoreMixin` 实测结论），断言改为「存在且不可用」，同时保留「历史记录」仍可用
  - 复跑：`BASE_URL=http://127.0.0.1:8877/lark-doc node scripts/verify.mjs panels versions` → panels 90/90、versions 全过
- [x] **C13** 修全量门禁红：冷层与首屏层重复了同一条 `:has` 规则 ✅
  - `src/styles/deferred-ui.css` 与 `src/components/lark-doc/lark-doc.css` 各有一份 `.lark-doc .lark-doc-external-panel:has(.lark-doc-dialog-backdrop, .lark-doc-version-layer, .lark-doc-drawer-mask) { z-index: 100 }`
  - 之前能过是因为首屏那份多带了 `.lark-doc-save-version-mask`（死类名），两份文本不同 ⇒ `element-ui.test.js` 的规则指纹当成两条；`7613583` 把死类名删掉后两份变成完全一致，指纹撞车 → `fullRules.get(key) === count` 期望 1 实得 2
  - 收口：删掉冷层那份（首屏那份与同族的 `:has(.lark-doc-ai-panel:only-child)` 规则待在一起，且冷层覆盖的遮罩只在冷层加载后才出现，首屏那份已足够）
  - 全量 `npx vitest run` → 174 files / 5288 passed / 1 skipped ✅

## 附：跨分支合并遗留（阻塞「尽可能合并」）

- [ ] **M1** `src/ui/permissionView.js` 两侧两套平行实现，待用户裁定 A/B/C
  - dev 版（502 行，B20/B22 逐像素对齐飞书）：纯权限项列表 = 复选框 + 下划线式下拉 + 灰色说明复选，`selectNode` 命中 0
  - 本分支版（423 行）：保留「邀请协作者」行、搜索框、「链接范围/链接权限」detail 行、服务提示反馈行、原生 select（`selectNode` 命中 8）
  - 连带：`setPermissionValue` 语义（dev 写本地 mock 零请求 / mine 弹 warning toast，`overlays-native.test.js` 两侧断言互斥）、`applyEmbed` 字段（仅 dev 有）、`caretRight` 尺寸（14 vs 16）、`collaboratorView` 是否升级为 dev 的 `avatarLabel`/`roleLabel`/标签/部门结构
