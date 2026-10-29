# 浮层矩阵（27 项冻结清单）

> 验收基线来自 `requirements/04-浮层与弹窗.md` §1–§6 与 `requirements/17-全量功能模块契约.md` §17.6.2。
> 本页是**施工图与对账单**：每一项都能落到「一个 DOM 根类名 + 一个尺寸 + 一个 z-index + 三个关闭入口」，
> 状态只有四种：`✅ 已实现` / `◐ 半成品待补` / `⬜ 缺失` / `🚫 范围外`。
>
> **口径（必须先看）**
>
> 1. 「27」= `04` §1–§6 里**可交付**的浮层数量，不是 `04` 全文条目数（全文含 §7–§10 横切规格）。
> 2. `04 §5.2` 画板 / 白板（`whiteboard-view-container`）**不计入 27**：`15 §2.3` 记「白板完全无规格」，
>    `04 §7` 已把它从待补移出、转 V1 `skip`。它的槽位由 `04 §4.6.3` 顶栏「新建」菜单顶替（同一处已实测、有全量像素）。
> 3. `04 §4.6` 的「搜索」**不是浮层**：`15 §2.3` 与 `04 §0.3` 都写明它是**文档流内嵌**（z11），归 `04 §3.2` 查找替换面板，已计入第 14 项。
> 4. `04 §4.9` 通用二次确认框是**横切件**（不属于任何单一入口），列为第 28 项，与 27 项分开验收。
> 5. 所有浮层都必须是 `position: fixed` 的**兄弟节点**，统一注册在 `LarkDocOverlays.vue`（包裹层 `.lark-doc-p6b-layer`
>    **禁止** `transform` / `filter` / `overflow` / 非 `static` 定位）。唯一例外是 `CoverSlot`（文档流内元素，在 `LarkDocEditor.vue`）。
> 6. 关闭入口恒为三条，全部落在 `overlayDismissMixin.js`：`onDocumentPointerDown`（点外部）/ `onWindowKeydown`（Esc）/
>    `closeOverlay()`（互斥 `else if` 链，一次只收一层）。**新增浮层三处都要插分支**，漏一处就是「Esc 关不掉」。

## z-index 基线（`04 §0.3` 实测）

| 层 | z | 备注 |
| --- | --- | --- |
| 图片大图预览外壳 | 1049 | 全站最高；壳内再分四层：遮罩 **1000** / 内容 **1001** / 工具条 **1001** / 关闭钮 **1002** |
| 顶栏「更多」/「新建」popover | 1030 | 内层滚动渐变遮罩 1001、预览器 1000 |
| 日期提醒日历 | 1000 | |
| 通用二次确认框 wrap / 遮罩 | 1000 | 靠 DOM 顺序压暗，不加 z 到内层 |
| 命令条内层子菜单 | 999 | `.overlay-container`(86/87/600) **套** `.docx-menu-wrapper`(999)，双层结构必须保留 |
| 顶栏「通知」popover | 999 | |
| 分享 popover / 内嵌网页粘贴浮层 | 99 | 同级 |
| 选区气泡条 | 87 | 盖住块工具条 |
| 块工具条（含图片悬浮工具条） | 86 | 164×42 / 图片 310×42；图片这条是**双层**：外层 86 只管定位 + 内层面板 999 |
| 封面 popover | 80 | |
| gutter 块手柄 | 79 | |
| 高亮块取色面板 / 二级子菜单 | 600 | |

## 27 项清单

| # | 04 章节 | moduleId（17 §17.6.2） | DOM 根类名 | 尺寸 | z | 状态 | 实现文件 / 缺口 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | §1.1 | — | `.lark-doc-block-handle-menu` | 164×42 | 86 | ✅ | `BlockHandleMenu.vue` + `blockMenuMixin.js` |
| 2 | §1.2 | — | `.lark-doc-callout-color` | 230×262 | 600 | ✅ | `CalloutTools.vue` + `calloutColorMixin.js` |
| 3 | §1.3 | `overlay.file-view` | `.lark-doc-image-toolbar` | 310×42 | 86 + 内层 999 | ✅ | `core/nodeviews/image.js` + `lark-doc.css` 工具条分区：8 项 24×24 SVG（`data-name` 顺序 `Crop / caption / align left / align center / align right / copyAnchorLink / shareTextLink / comment`）、1 条 1×20 分隔线插在对齐三连之后、当前对齐同时挂 `.menu-item-actived`（视觉）与 `aria-pressed`（读屏）。坐标由 `positionToolbar()` 按图片矩形算（块上方 8px、水平居中、贴视口顶翻到块下方；scroll/resize/load 三处重算）。自校验：`8×24 + (17+17+8+8+24+1+8+17) = 192 + 100 = 292 = 310 − 2×9` |
| 4 | §1.4 | — | `.lark-doc-cover-slot` / `.lark-doc-cover-panel` | 162×126，图库 542×522 | 80 | ✅ | `CoverSlot.vue`（文档流内）+ `CoverPanel.vue`（fixed 兄弟）+ `coverMixin.js` |
| 5 | §1.5 / §5.1 | `overlay.image-preview` | `.lark-doc-image-viewer-shell` | 视口全屏，main 高 = 视口−95 | 1049（遮罩 1000 / 内容 1001 / 工具条 1001 / 关闭钮 1002） | ✅ | `image.js:openPreview()` + `lark-doc.css` 预览分区（11 个类）：z1000 遮罩 `rgba(0,0,0,.8)`、六段工具条（prev · page · next · divider · more+子菜单 · scale）、`syncScale()` 按原图像素写死尺寸、auto-hide 2.5s 走 `opacity`（`.is-hidden` 在预览层被 `:not()` 从 `display:none !important` 里摘出）、Esc / ← → / 右上 × / 点遮罩 / 点图空白五种关闭。自校验：`100vw − 64 = 页面横向 padding 32×2`，`innerHeight − 95 = 42 工具条 + 24 底距 + 29 呼吸` |
| 6 | §1.6 | — | `.lark-doc-link-hover-card` | 卡 320×?，内壳 230×144 | 99 | ✅ | `LinkHoverCard.vue` + `linkHoverMixin.js`：`LINK_HOVER_DELAY = 2700`（§1.6.1 复测值，`test/unit/link-hover-ui.test.js` 直接断言常量），移出即 `clearTimeout`，**展开后移进卡内不重置**计时 |
| 7 | §1.6 | — | `.lark-doc-link-view-menu` | 外壳 232×146 / 内壳 230×144 / 项 214×32 | 600 + 内层 999 | ✅ | 同上（`linkViewModes` 四档）：勾 16×16 `--ld-brand-content`、当前项 `.menu-item-actived`（与图片工具条共用同一条基类规则）。自校验：`146 = 2×1 + 2×8 + 4×32`、`232 = 2×1 + 2×8 + 214`（padding 写 4 会把项撑到 222、总高掉到 138 —— 旧值就是这个错） |
| 8 | §2.1 | — | `.lark-doc-callout-emoji-picker` | 456×392 | 600 | ✅ | `CalloutTools.vue` + `CalloutTools` CSS + `core/emoji/catalog`（搜索 / 随机 / 分组 / 24×24） |
| 9 | §2.2 | — | `.lark-doc-code-lang` | 280×534，列表高 317 | 999 | ✅ | `CodeLangPicker.vue` + `codeLangMixin.js` + `codeLanguages.js` |
| 10 | §2.3 | — | `.lark-doc-math-dialog` | 04 §2.3 规格 | 600 | ✅ | `dialogs/MathDialog.vue` |
| 11 | §2.4 | `overlay.mention` | `.lark-doc-mention-panel` | 280×? | 87 | ✅ | `MentionPanel.vue` + `mentionMixin.js` |
| 12 | §2.5 | — | `.lark-doc-reminder-popover` | 280×534 | 1000 | ✅ | `ReminderPopover.vue` + `reminderMixin.js` |
| 13 | §3.1 | `overlay.comment` | `.lark-doc-comment-panel` | 右侧 314 全高 | 90 | ✅ | `CommentPanel.vue` + `commentsMixin.js` |
| 14 | §3.2 | `overlay.find-replace` | `.lark-doc-find-replace` | 查找 186 / 替换 286 高 | 87 | ✅ | `SearchPanel.vue` |
| 15 | §3.3 | — | `.lark-doc-outline` | 侧栏 300 全高 | 90 | ✅ | `OutlinePanel.vue` |
| 16 | §3.4 | `overlay.history` | `.lark-doc-version-panel` | 全屏模态 | 1000 | ✅ | `VersionPanel.vue` + `versioningMixin.js` |
| 17 | §3.5 | — | `.lark-doc-drawer-right` | 314 全高 | 1000 | ✅ | `dialogs/HelpDialog.vue` + `shortcutGroups.js`（⌘/ 与工具栏入口） |
| 18 | §4.1 | `overlay.share` | `.lark-doc-share-popover` | 480×331 | 99 | ✅ | `SharePopover.vue` + `shareMixin.js` |
| 19 | §4.1.1 | `overlay.permission` | `.lark-doc-permission-dialog` | 04 §4.1.1 | 1000 | ✅ | `PermissionDialog.vue` |
| 20 | §4.2 / §4.6.1 | — | `.lark-doc-topbar-more` | 180×820 | 1030 | ✅ | `TopbarMoreMenu.vue` + `topbarMoreMixin.js`（23 项 + 5 子面板，子面板 999） |
| 21 | §4.3 | — | `.lark-doc-embed-dialog` | 540×164 | 99 | ✅ | `dialogs/EmbedLinkDialog.vue`（**Esc 故意不关**，只认点外部与 × ） |
| 22 | §4.4 | `overlay.button` | `.lark-doc-isv-button-panel` | 270×{386\|308}，底边锚 `cursorY+21` | 600 | ✅ | `IsvButtonPanel.vue` + `isvMixin.js`（16 色 2×8、3 项 action、无 backdrop） |
| 23 | §4.5 | `overlay.relation-bitable` | `.lark-doc-relation-layer` / `.lark-doc-relation-content` | 1080×676（header 72 / body 525 / footer 80） | 1000（内容 1001） | ✅ | `RelationBitableDialog.vue` + `relationBitableMixin.js` + CSS，入口 `/bitableRefer`：遮罩 `rgba(0,0,0,.55)`、居中靠 flex（不写 `(1512−1080)/2` 那类绝对偏移）、header **无关闭 X**（出口＝取消 / Esc / 点遮罩）、项＝「名称 + 所有者」+ `.is-active` 双信号。自校验：`1080 − 2×24 = 1032` = header/footer 内容宽；`1032 − 12 = 2×510` = 两列 |
| 24 | §4.6.4 | `overlay.notification` | `.lark-doc-notify-popover` | 402×555 | 999 | ✅ | `NotifyPopover.vue` + `notifyMixin.js` + TopBar 铃铛：标题 14/700、铃铛 14×14、0 条未读时「全部已读」转 `--ld-text-disabled`、空态 120 插图 + 16/24 主文案 + 250×66/14/22 副文案、双层 loading 壳（外层透传 + 内层 `position: relative`）。自校验：`402 − 2×12 = 378` 四件套（标题/铃铛/关闭通知/全部已读）刚好铺满 |
| 25 | §4.7 | `overlay.calendar` | `.lark-doc-calendar-search` | 280×? | 87 | ✅ | `CalendarSearchPanel.vue` + `calendarMixin.js`（**Esc 实测无效**，故意不进 Esc 链） |
| 26 | §4.8 | `overlay.template` | `.lark-doc-template-library` | 模态 | 1000 | ✅ | `TemplateLibrary.vue` |
| 27 | §4.6.3 | — | `.lark-doc-create-menu` | 182×509（容器 180×503） | 1030 | ✅ | `CreateMenu.vue` + `createMenuMixin.js` + TopBar 加号：11 项 × 项高 **40**、图标外框 19×21、分隔线 180×1、分组标题 20 高 12/500 `--ld-text-tertiary`、右箭头 13×13 `--ld-brand-content`。自校验：`182 − 2×1(border) = 180` = 分隔线宽 |
| ＋ | §4.9 | — | `.lark-doc-confirm` | 420×180 | 1000 | ✅ | `ConfirmDialog.vue` + `confirmMixin.js` + CSS（横切件，不计入 27）：mask `rgba(0,0,0,.55)`、卡 r8 **无阴影**、header `padding: 24px 24px 0`、body 左缩进 64 = 24 + 24(icon) + 16(gap)、footer `padding: 24`、主/次钮 80×32 gap 12、可选「不再提示」勾 16×16 |

## 三入口对账（`overlayDismissMixin.js`，收尾时逐条复核）

点外部有两种写法，都对，区别只是选择器放在哪：

- **`xxxContains(node)` 型**（新浮层一律用这种：命中判定与组件 DOM 同源，改组件不会忘了改这里）：
  `topbarMoreContains` / `linkHoverContains` / `coverContains` / `codeLangContains` /
  `createMenuContains` / `notifyContains` / `relationContains`，对应
  `closeTopbarMore` / `closeLinkHover` / `closeCoverPanel` / `closeCodeLangPicker` /
  `closeCreateMenu` / `closeNotify` / `closeRelationBitable`。
- **内联 `target.closest?.('…')` 型**（早期那批，选择器直接写在 `onDocumentPointerDown` 里）。
  这个写法**不要再新增**；下次动到哪一项，顺手换成 `xxxContains()`。

Esc 与 `closeOverlay()` 的差异只来自「实测 Esc 无效」两处 + 模态两处，别「统一」掉：

| 浮层 | 点外部 | Esc | `closeOverlay()` |
| --- | --- | --- | --- |
| 日程搜索面板（25） | ✅ `closest('.lark-doc-calendar-search')` | 🚫 刻意不进（`02 §26`⑦ 实测 Esc ×1/×2 无效） | 🚫 同左 |
| 内嵌网页浮层（21） | ✅ `closest('.lark-doc-embed-dialog')` | 🚫 刻意不进（`04 §4.3`⑤ 实测关不掉） | 🚫 同左 |
| 确认框（＋） | 🚫 不兜（组件自己绑遮罩 `@mousedown.prevent`；document 再关一次会抢在 `resolve` 之前） | ✅ 链首（模态优先） | ✅ 首位 |
| 关联多维表格（23） | ✅ `relationContains` | ✅ 紧随确认框 | ✅ 第二位 |
| 其余各项 | ✅ | ✅ | ✅ 互斥链一次只收一层，末尾统一 `focus()` |

## 范围外（不计入验收）

> **收尾状态**：27 项全部 ✅（第 3/5/6/7 项本轮由 ◐ 转 ✅，第 23/24/27/＋ 项本轮补齐并转 ✅）。
> 下表两项继续不计入验收，理由见判据列。

| 项 | 04 章节 | 判据 |
| --- | --- | --- |
| 画板 / 白板全屏编辑器 `whiteboard-view-container` | §5.2 | `15 §2.3`「白板完全无规格」；`04 §7` 2026-10-25 移出待补转 V1 `skip`。做它需要三方画板库选型 + 独立协议，工作量大于本表其余全部之和 |
| 顶栏「搜索」（`ud__popover` 之外的文档流内嵌层） | §4.6 | `04 §0.3` 记 z11、`15 §2.3` 记「不是 popover」；能力已由第 14 项查找替换面板覆盖 |

## 施工纪律（改这里前先读）

1. **注册**：新浮层一律加进 `LarkDocOverlays.vue` 的子节点列表，**不在里面写 `v-if`**（`v-if` 归组件自己，便于 toast 顺序与过渡）。
2. **状态机**：一律走 mixin，挂进 `p6bMixin.js` 的 `mixins` 聚合；`LarkDocEditor.vue` 有 <700 行门禁，**不新增门面 import 行**。
3. **点外部判定**：用 `xxxContains(node)`（内部 `node.closest?.()`），选择器必须与组件 DOM 类名同源；不要在 `overlayDismissMixin` 里再抄一份类名。
4. **Esc**：确定进 `onWindowKeydown` 与 `closeOverlay` 两处；实测 Esc 无效的（日程、内嵌网页）**故意不进**并写注释说明。
5. **定位**：样式由 mixin 的纯函数算（`xxxStyle(anchor, size, viewport)`），组件只吃 `:style`；纯函数放独立 `*.js` 便于单测。
