# 06 · 视觉规格 Token（飞书实测）

> 全部数值来自飞书文档网页 `getComputedStyle` / `getBoundingClientRect` 真实读取【实测】。
> 采集环境：Chrome 1512×950，飞书 wiki 文档页（`docx-in-wiki`）。

---

## 1. 颜色 Token

### 1.1 文字色

| Token | 用途 | rgb | HEX | 实测出处 |
| --- | --- | --- | --- | --- |
| `--text-primary` | 正文 / 标题 / 菜单项主文字 | `rgb(31, 35, 41)` | **#1F2329** | `.docx-text-block`、`.ud__menu-normal-item` |
| `--text-secondary` | 次要文字、图标按钮、菜单图标 | `rgb(100, 106, 115)` | **#646A73** | `.ud__button--icon`、`universe-icon`、`doc-custom-icon-entry` |
| `--text-tertiary` | 三级 / 占位 / 字数统计 | `rgb(143, 149, 158)` | **#8F959E** | `.rangecode-bomb-container-bottom` |
| `--text-placeholder` | **空块占位 / 禁用图标 / 引用竖线** | `rgb(187, 191, 196)` | **#BBBFC4** | `.zone-container.text-editor::before`（fs 随块：正文 16 / H2 22）、禁用图标 16×16、`.quote-container-block::before` |
| `--text-on-brand` | 品牌色按钮上的文字 | `rgb(255, 255, 255)` | **#FFFFFF** | `.ud__button--filled` |

### 1.2 品牌与功能色

| Token | 用途 | rgb | HEX | 实测出处 |
| --- | --- | --- | --- | --- |
| `--brand` | 飞书蓝（主按钮填充/边框） | `rgb(20, 86, 240)` | **#1456F0** | `.ud__button--filled-default` (分享按钮) |
| `--note-bg` | 单元格批注便签黄 | `rgb(255, 255, 219)` | **#FFFFDB** | `.sheet-cell-note-editor-container` |

### 1.3 边框与分割线

| Token | 用途 | 值 | HEX |
| --- | --- | --- | --- |
| `--border` | 菜单/弹窗/圆形按钮边框 | `1px solid rgb(222, 224, 227)` | **#DEE0E3** |
| `--border-cell` | 表格单元格内阴影线 | `rgb(222, 224, 227) 1px 0 0 0 inset` | **#DEE0E3** |
| `--border-note` | 批注左边框 | `1px solid rgba(31, 35, 41, 0.15)` | 主色 15% |

### 1.4 背景

| Token | 用途 | 值 |
| --- | --- | --- |
| `--bg-surface` | 浮层/菜单/侧栏/按钮底 | `rgb(255, 255, 255)` → **#FFFFFF** |
| `--bg-transparent` | 多数块容器默认透明（继承页面白底） | `rgba(0, 0, 0, 0)` |
| `--bg-hover` | **块 hover / 选中浅灰底** | `rgba(100, 106, 115, 0.05)` 【实测 `.todo-block`】 |
| `--bg-table-cell` | **表格单元格底色** | `rgb(242, 243, 245)` → **#F2F3F5** 【实测 `TD.docx-table_cell-block`】 |
| `--bg-page` | 侧栏 / wiki 树底 | `rgb(245, 246, 247)` → **#F5F6F7** 【实测 `.vmok-sidebar-container` `z90`】 |
| `--bg-code` | 代码块色层 | `#F5F6F7` + border `1px #DEE0E3`，radius 8 【见 6.5】 |
| `--bg-active-weak` | 气泡条激活态热区 | `rgba(31, 35, 41, 0.05)` 【实测 `.panel-submenu-item.hot-area-unique` 44×24】 |
| `--bg-active` | 气泡条激活态图标位 | `rgba(31, 35, 41, 0.15)` 【实测 `.menu-icon` 24×24】 |

### 1.5 语义色板（高亮块取色面板三档·8 色 × 3）【实测】

飞书高亮块面板 `.callout-highlight-panel` 提供 **3 组色板**，每组 **8 色**：
第 1 组「字体颜色」（svg `fill` 读值）／第 2 组「边框颜色」／第 3 组「填充颜色」（**2 行 × 8 = 16 色，上排浅档、下排深档**）。

| # | 语义 | 字体颜色（svg fill） | 边框颜色 | 填充·浅档 | 填充·深档 |
| --- | --- | --- | --- | --- | --- |
| 0 | 默认 / 白 | `rgb(31,35,41)` **#1F2329** | `rgb(255,255,255)` **#FFFFFF** | `rgb(255,255,255)` **#FFFFFF** | `rgba(222,224,227,0.7)` **#DEE0E3·70%** |
| 1 | 灰 | `rgb(143,149,158)` **#8F959E** | `rgb(222,224,227)` **#DEE0E3** | `rgba(239,240,241,0.6)` **#EFF0F1·60%** | `rgba(187,191,196,0.5)` **#BBBFC4·50%** |
| 2 | 红 | `rgb(216,57,49)` **#D83931** | `rgb(249,142,139)` **#F98E8B** | `rgb(253,226,226)` **#FDE2E2** | `rgb(251,191,188)` **#FBBFBC** |
| 3 | 橙 | `rgb(222,120,2)` **#DE7802** | `rgb(255,186,107)` **#FFBA6B** | `rgb(254,234,210)` **#FEEAD2** | `rgb(254,212,164)` **#FED4A4** |
| 4 | 黄 | `rgb(220,155,4)` **#DC9B04** | `rgb(255,246,122)` **#FFF67A** | `rgb(255,255,204)` **#FFFFCC** | `rgb(255,252,163)` **#FFFCA3** |
| 5 | 绿 | `rgb(46,161,33)` **#2EA121** | `rgb(142,224,133)` **#8EE085** | `rgb(217,245,214)` **#D9F5D6** | `rgb(183,237,177)` **#B7EDB1** |
| 6 | 蓝 | `rgb(36,91,219)` **#245BDB** | `rgb(130,167,252)` **#82A7FC** | `rgb(225,234,255)` **#E1EAFF** | `rgb(186,206,253)` **#BACEFD** |
| 7 | 紫 | `rgb(100,37,208)` **#6425D0** | `rgb(173,130,247)` **#AD82F7** | `rgb(236,226,254)` **#ECE2FE** | `rgb(205,178,250)` **#CDB2FA** |

> ⚠️ **色板值 ≠ 实际落值（重要）**：点选「填充颜色」后，`.callout-block` 的 `background-color` 会取**比所点色块再浅一档**的值。
> 实测（蓝色）：点填充·浅档 `#E1EAFF` → 实际 bg `rgb(240,244,255)` **#F0F4FF**；点填充·深档 `#BACEFD` → 实际 bg `rgb(225,234,255)` **#E1EAFF**。
> 默认橙色高亮块实测：`bg rgb(255,245,235)` **#FFF5EB** / `border 1px rgb(254,212,164)` **#FED4A4**。
> 实现建议：**不要直接用色板值**，应维护一份 `swatch → applied` 映射表（浅档 +1 级）。

**面板其余元素【实测】**

| 元素 | 类名 | 尺寸 | 样式 |
| --- | --- | --- | --- |
| 面板容器 | `.callout-highlight-panel` | **230×262**，位于 841,472 | bg `#FFFFFF`，radius **4px**（不是 6），border `1px #DEE0E3`，padding `4px 10px 12px`，shadow `rgba(31,35,41,0.1) 0 6px 24px 0` |
| 分组标题 | `.group-title`（`<p>`） | 206×14 | 「字体颜色」「边框颜色」「填充颜色」，位于 854,y486/546/606 |
| 色块按钮 | `.callout-highlight-btn` | **26×26** | radius **4px**，border **2px**；未选中 `#FFFFFF`、选中 **`rgb(20,86,240)` #1456F0** |
| 色块内芯 | `.highlight-bg` | **22×22** | radius **2px** |
| 字体色块图形 | `.callout-highlight-btn.text > svg > path` | 10×11 | 颜色在 **`fill`** 上（不是 `color`），取 `getComputedStyle(path).fill` |
| 随机 | `.random` | 43×17，位于 1017,484 | color **`rgb(51,109,244)` #336DF4**，fs **12px**，含 15×12 universe-icon |
| 恢复默认 | `.callout-clear-highlight`（`<button>`） | **204×24**，位于 854,697 | bg 透明，radius **4px**，color **#1F2329**，fs **12px** |

---

## 2. 圆角 Token

| Token | 值 | 实测出处 |
| --- | --- | --- |
| `--radius-menu` | **6px** | `.ud__menu-normal`（下拉菜单容器） |
| `--radius-item` | **4px** | `.ud__menu-normal-item`（菜单项） |
| `--radius-btn` | **6px** | `.ud__button--filled` / `.ud__button--icon` |
| `--radius-iconbtn` | **6px** | `.ud__button--icon-size-md`（24×24 图标按钮） |
| `--radius-circle` | **50%** | `.gpf-biz-help-center__trigger-button`（36×36 悬浮圆钮） |
| `--radius-small` | **4px** | `.rangecode-bomb-container-bottom`（字数气泡） |
| `--radius-block` | **0px** | 各类 `docx-*-block` 内容块（块本身无圆角） |
| `--radius-panel` | **8px** | `.callout-block`（高亮块色层）、`.editor-kit-code-block`（代码块色层）【实测】 |
| `--radius-avatar` | **50%** | `.ud__avatar--circle`（26×26 头像）、`.link-sharing-v3__icon`（30×30，bg `#336DF4`） |
| `--radius-pill` | **29px**（= 高 26 / 2 + 余量，非标准档） | `.invited-member-list-entry-right-avatar`（31×26 头像溢出计数块） |
| `--radius-half-right` | **`0 4px 4px 0`** | `.invite-member-organization-entry`（输入框右侧拼接块，左侧贴边不留圆角） |

> **规律**：飞书圆角只有 **0 / 2 / 4 / 6 / 8 / 50%** 六档。内容块外层一律 0，**带背景色的"色层"用 8px**（高亮块、代码块），控件 6，内部子项 4，色块 2，圆形控件 50%。

---

## 3. 阴影 Token（飞书通用阴影体系）

| Token | 值 | 实测出处 |
| --- | --- | --- |
| `--shadow-menu` | `rgba(31,35,41,0.04) 0 8px 24px 8px, rgba(31,35,41,0.04) 0 6px 12px 0` | `.ud__menu-normal` 下拉菜单 |
| `--shadow-fab` | `rgba(31,35,41,0.08) 0 6px 12px 0` | `.gpf-biz-help-center__trigger-button` 悬浮圆钮 |
| `--shadow-popover` | `rgba(31,35,41,0.1) 0 4px 8px 0` | `.cover-panel-popover-content-wrapper` |
| `--shadow-note` | `rgba(31,35,41,0.04) 0 10px 36px 10px, rgba(31,35,41,0.04) 0 ...` | 单元格批注便签 |
| `--shadow-blockbar` | `rgba(31, 35, 41, 0.1) 0px 4px 8px 0px` | `.docx-menu-wrapper`（块工具条 / 气泡条） |
| `--shadow-colorpanel` | `rgba(31, 35, 41, 0.1) 0px 6px 24px 0px` | `.callout-highlight-panel`（高亮块取色面板，230×262） |
| `--shadow-megamenu` | **三层**：`rgba(31,35,41,0.04) 0 8px 24px 8px, rgba(31,35,41,0.04) 0 6px 12px 0, rgba(31,35,41,0.06) 0 4px 8px -8px` | 顶部「更多」菜单根 `ul.ud__menu-normal-root`（175×816）【实测】 |

> **规律**：阴影色恒为**主文字色 #1F2329 的低透明度**，透明度只有 **0.04 / 0.06 / 0.08 / 0.1** 四档；越大越"重"（0.1 是小弹窗，0.04 是大菜单/长阴影）。
> **三层阴影**：只有「超长菜单」（816px 高、需内部滚动）用三层叠加 —— 远层 `0 8px 24px 8px` 定体量、中层 `0 6px 12px` 定边缘、近层 `0 4px 8px -8px` 收紧底部。普通下拉（如帮助中心 120×166）只两层。

---

## 4. 字体与行高

### 4.1 字号阶梯【实测】

| 元素 | font-size | line-height | 行高倍数 | 实测出处 |
| --- | --- | --- | --- | --- |
| 文档大标题（wiki 标题行） | **34px** | 55.25px | 1.625 | `.zone-container.text-editor`（首行） |
| H1 | **26px** | **36.4px** | **1.4** | `.ace-line`（行内实测） |
| H2 | **22px** | 39.6px | 1.8 | `.docx-heading2-block`（容器值） |
| **正文** | **16px** | **28.8px** | **1.8** | `.docx-text-block.focused`（新输入实测） |
| 有序/无序列表 | **16px** | 28.8px | **1.8** | `.docx-ordered-block` |
| 任务块 todo | **16px** | 26px | 1.625 | `.todo-block_content` |
| 表格容器 | 16px | 28.8px | 1.8 | `.docx-table-block` |
| 表格单元格 | **12px** | 21.6px | **1.8** | `.docx-table_cell-block` |
| 分隔线 | 16px | **10px** | — | `.divider-block` |
| 菜单项 | 14px | — | — | `.ud__menu-normal-item` |
| 图标按钮 | 16px | 0 | — | `.ud__button--icon` |
| 主按钮 | 14px | 22px | — | `.ud__button--filled` |

> ✅ **正文确认 = 16px / 28.8px（行高 1.8）**，与 lark-doc 现有实现一致。
> ✅ **H1 行高 = 1.4**（36.4 / 26），与 lark-doc 现有实现一致。
>
> ⚠️ **测量陷阱（重要）**：`.docx-heading1-block` **容器**读到的 `line-height: 46.8px` 是**继承的无效值**，真实渲染行高要看内部 `.ace-line`（36.4px）。采规格时**必须读行内层，不能只读块容器**，否则会得到错误的 1.8。
> ⚠️ 同理 `.docx-text-block` 上曾读到 14px，那是该段被单独设置过小字号；**新输入正文实测 16px**。

### 4.2 字重

- 文档大标题：`font-weight: 500`
- 正文 / 标题 / 单元格：`font-weight: 400`【实测】

> 飞书正文与标题**默认不加粗**，靠字号区分层级。

---

## 5. 间距 Token

### 5.1 块外边距【实测】

| 块类型 | margin | 说明 |
| --- | --- | --- |
| 文本块 `docx-text-block` | `8px -2px 8px -2px` | 上下 8px；**左右 -2px 负边距**（配合 padding 0 2px 抵消） |
| 有序/无序列表 | `8px -2px 8px -2px` | 同上 |
| H1 `docx-heading1-block` | `26px -2px 10px -2px` | 上 26 / 下 10 |
| H2 `docx-heading2-block` | `22px -2px 8px -2px` | 上 22 / 下 8 |
| 表格 `docx-table-block` | `24px 0 24px 0` | 上下 24（**表格间距最大**） |
| ISV 块 `docx-isv-block` | `16px 0 16px 0` | 上下 16 |
| 页面块 `docx-page-block` | `0 0 72px 0` | **底部留白 72px**（文档末尾滚动余量） |
| 高亮块 `docx-callout-block` | `16px 0 16px 0` | 上下 16，无左右负边距 |
| 代码块 `docx-code-block` | `16px 0 16px 0` | 上下 16 |
| 引用 `docx-quote_container-block` | `8px -2px 8px 0` | 上 8 / 下 8 / 左 -2 / 右 0 |
| 任务块 `docx-todo-block` | `8px -2px 8px -2px` | 同文本块 |
| 分隔线 `docx-divider-block` | `8px -2px 8px -2px` | 同文本块，高度仅 25px |

> **规律（负边距技巧）**：文本类块统一 `margin: 8px -2px`，`padding: 0 2px` —— 用**负 margin + 等量 padding** 让文本左右各外扩 2px，视觉上与其他块对齐但选中高亮区更宽。
> **规律（块间距）**：普通文本/列表 **8px**；容器类块（高亮/代码/ISV）**16px**；表格 **24px**（最大）；H1 **上 26 下 10**，H2 **上 22 下 8**。

### 5.2 块内边距【实测】

| 元素 | padding |
| --- | --- |
| 文本块 / 标题 / 列表 | `0 2px 0 2px` |
| 表格单元格 | `8px 8px 8px 8px` |
| 图标按钮（24×24） | `4px 4px 4px 4px` |
| 主按钮 | `4px 11px 4px 11px` |
| 单元格批注 | `10px 3px 10px 3px` |
| 批注外层 | `2px 3px 3px 2px` |

---

## 6. 布局尺寸【实测】

### 6.1 页面骨架

| 区域 | 类名 | x | y | w | h |
| --- | --- | --- | --- | --- | --- |
| 侧边栏（wiki 空间树） | `.vmok-sidebar-container` | 0 | 0 | **300** | 950 |
| 侧边栏内容 | `.workspace-next-sidebar-wrapper` | 0 | 64 | 298 | 886 |
| 主应用区 | `.app-main` | 300 | 0 | **1212** | 950 |
| 顶部导航栏 | `.navigation-bar` | 300 | 0 | 1212 | **64** |
| 文档标题栏 | `.note-title` | 316 | 0 | 1180 | 64 |
| 正文外层容器 | `.bear-web-x-container` | 300 | 64 | 1212 | 886 |
| **正文内容宽度** | `.docx-page-block` | — | — | **820** | — |
| 目录侧栏（打开时） | `.catalogue` | 300 | 64 | **252** | 624 |

> **核心布局常量**：侧边栏 **300px**、顶部栏 **64px**、正文栏宽 **820px**、目录栏 **252px**。

### 6.2 组件尺寸

| 组件 | 类名 | 尺寸 |
| --- | --- | --- |
| 图标按钮 | `.ud__button--icon-size-md` | **24×24** |
| 主按钮（分享） | `.ud__button--filled-size-md` | padding `4px 11px` |
| 悬浮圆钮（帮助中心） | `.gpf-biz-help-center__trigger-button` | **36×36**，radius 50% |
| 帮助中心菜单 | `.ud__menu-normal` | **120×166**（5 项） |
| 菜单项 | `.ud__menu-normal-item` | **112×30** |
| 菜单项图标 | `.ud__menu-normal-icon-wrap` | **16×16** |
| 菜单项文字容器 | `.ud__menu-normal-item-title-content` | 56×22 |
| 字数统计气泡 | `.rangecode-bomb-container-bottom` | **27×25**（选中文本时显示） |
| 目录项 | `.catalogue__list-item` | 237×**30** |
| 目录项标题 | `.catalogue__item-title` | 237×22 |
| 目录折叠三角 | `.catalogue__item-collapse` | 16×30 |
| 目录固定按钮 | `.catalogue__pin-btn-unpin` | 18×18 |
| **顶部「更多」菜单项** | `LI.ud__menu-normal-item.navigation-bar__*` | **167×32**，radius 4，pad `4px 8px`，图标 16×16 `#646A73`，文字 fs14/lh22/fw400 `#1F2329` |
| └ 带子菜单项 | `LI.ud__menu-normal-submenu` | **173×32 或 34**，radius 0，pad 0（宽 +6 留箭头位） |
| └ 内嵌小组件项 | `.j-top-doc-mini-app-menu-item-popover-wrapper` | **173×40** |
| **实心主按钮** | `.ud__button--filled--default` | **80×32**，bg `#1456F0`，radius 6，pad `4px 11px` |
| 文字按钮 | `.ud__button--text` | **84×24**（权限设置）/ 164×26（组织名）/ 66×26（权限下拉），radius 6，pad `0 4px` 或 `2px 4px` |
| 头像 | `.ud__avatar--circle` | **26×26**，radius 50% |
| 头像溢出计数 | `.invited-member-list-entry-right-avatar` | **31×26**，bg `#F5F6F7`，radius 29px，fs 12 |
| 邀请输入框外壳 | `.invite-member-and-settings-v2` | **448×36**，radius 6，**border `1px #1456F0`**（聚焦） |
| 权限标签 | `ud__tag.link-sharing-v2__perm_type` | **58×16**，bg `rgba(20,86,240,0.2)`，color `#1456F0`，radius 4，fs 10（内容 12） |
| 链接分享图标 | `.link-sharing-v3__icon` | **30×30**，bg `#336DF4`，radius 50% |
| 分享 popover | `.share-popover-v2` | **480×331**，z 99 |
| 更多菜单 popover | `.more-menu-popover` | **175×820**，z 1030 |

> **「更多」菜单项间距规律**：普通项 **y 步进 34**（32 高 + 2 间隙）；跨分隔线处步进变 **41**（32 + 2 + 7 分隔区）。
| 头像 | `._pp-header-avatar` | **32×32** |
| AI 按钮（豆包） | `.doc-header-ai-button_container` | 78×26 |
| 通用图标 | `.universe-icon` | **16×16** |
| 表格单元格 | `.docx-table_cell-block` | 100×41 |
| **gutter 块手柄浮层** | `.overlay-container`（z79） | **42×26** |
| └ 手柄白底 | `.hover-drag-icon-wrapper` | **42×26**，bg **#FFFFFF**，radius **6px** |
| └ 块类型图标 | `.hover-block-type-icon-container` / `span.universe-icon.menu_ud_icon.color-o-500` | **24×24** / 图标 **22×22** |
| └ 拖拽手柄 | `span.universe-icon.drag-handle` | **14×14**，svg fill `rgb(143,149,158)` #8F959E |
| **块工具条**（hover 块内部） | `.overlay-container.block-toolbar__overlay`（z86） | **164×42**（4 项） |
| └ 白色容器 | `.docx-menu-wrapper` | 164×42，bg #FFF，radius **6px**，border 1px #DEE0E3，z 999 |
| └ 菜单项 | `.panel-menu-item` | **24×24**，radius 4，hover `rgba(31,35,41,0.1)` |
| **选区气泡条** | `.overlay-container`（z87） | **594×42**（13 项） |
| 高亮块取色面板 | `.callout-highlight-panel` | **230×262** |
| 色块按钮 / 内芯 | `.callout-highlight-btn` / `.highlight-bg` | **26×26** / **22×22** |
| 对齐子菜单 | `.docx-menu-wrapper` | **232×187**（5 项） |
| 目录固定按钮容器 | `.catalogue__pin` | **34×40**，z 1 |
| 目录固定按钮 | `.catalogue__pin-wrapper` | **24×24**，白底，radius 4 |
| 目录主体 | `.catalogue__main` | **248×570** |
| 目录滚动区 | `.catalogue__main-wrapper` / `.scrollbar-container.catalogue__scroller` | **248×530** |
| 目录项折叠三角 | `.catalogue__item-collapse` | **16×29**，padding `6px 3px`，有 `.collapsed` 变体 |
| **顶栏子面板容器**（全站最高） | `.ud__menu-normal-submenu.ud__menu-normal-submenu-popup` | **z 1050**，bg 透明，radius 6，pad 0，shadow none |
| └ 子面板菜单根 | `ul.ud__menu-normal.ud__menu-normal-sub` | bg **#FFFFFF**，radius **6**，border `1px #DEE0E3`，pad `2px 0`，**三层阴影** |
| └ 子面板菜单项 | `LI.ud__menu-normal-item.navigation-bar__moreMenu_v3-item` | **高 32**，radius 4，pad `4px 8px`，fs 14 / lh 22 / color `#1F2329` |
| └ 子面板文案层 | `span.item-badge-label` / `span.navigation-bar__moreMenu_v3-item__text` | lh **25**（pad `0 5px 0 0`）/ lh **20** |
| └ 子面板箭头 | `span.navigation-bar__moreMenu_v3-item__submenu` | **12×12** |
| └ 子面板分隔线 | `LI.ud__menu-normal-item-divider` | **119×1** |
| **「下载为」子面板** | `EXPORT` | **120×108**（Word / PDF / Markdown，项 113×32） |
| **「文档权限」子面板** | `DOC_PERMISSION` | **121×115**（管理协作者 / 权限设置 / 分隔线 119×1 / 转移所有权，项 113×32） |
| **「更多」子面板** | `MORE` | **198×142**（添加文档应用 / 在段落前显示作者 / 设为离线可使用 / 举报，项 190×32） |
| └ 子面板内 Switch | `div.ud__switch__handler` | **12×12**，radius **`999999px`** |
| **翻译模式「更多」菜单** | `.more-menu-popover`（翻译态） | popover **160×344**，菜单根 160×340，项 **152×32**，分隔线 **158×1**（整体比普通态窄 **15px**） |
| **气泡条高亮按钮·热区** | `.panel-submenu-item.hot-area-unique` | **44×24**，激活 bg `rgba(31,35,41,0.05)`，radius 4 |
| └ 图标位 | `.menu-icon` | **24×24**，激活 bg `rgba(31,35,41,0.15)` |
| └ 色块预览 | `.universe-icon.highlight-menu` | **20×20**，bg `rgba(255,246,122,0.8)`，radius **2** |
| **slash 命令菜单** | `.overlay-container.overlay-transition` | **247×383~639**，**z 600**，项 214×32（y 步进 32） |
| **表格块 gutter 手柄** | `div.table-menu-trigger.has-drag-icon` | **44×30** @(563,209)，**z 9**，radius **6px** |
| └ 手柄白底 | `.hover-drag-icon-wrapper`（表格内） | **40×24**，bg **#FFFFFF**，radius **6px**，cursor **grab** |
| └ 拖拽图标 | `span.universe-icon.drag-handle` | **14×14**，cursor **grab** |
| **表格列宽拖拽热区** | `.resizer-line-hotzone.draggable-btn` | **10×81**，cursor **`col-resize`**，位于列边界（x=700/800/900），hover 时加 `.visible` |
| └ 列宽拖拽线 | `.resizer-line` | **2×81**，bg **`rgb(20,86,240)` #1456F0**（品牌蓝），cursor `col-resize` |
| └ 列宽容器链 | `.column-resizer` → `.docx-table-inside-resizer-line-container` → `.column-resizer-item` | 0×0 **z1** absolute → 0×0 **z1** relative → **100×0** |
| **表格行插入手柄** | `.row-insert-wrapper` | **16×40** @x=**583**（表格左缘外 **24px**），每行一个；末行 `.row-insert-wrapper.last` **16×15**（absolute） |
| **表格新增列符号** | `.table-hover-ignore.table-add-line-symbol.vertical` | **30×35** @(592,203)，**z 599** |
| **表格表头栏** | `.table-header-bar.table-header-bar--col` | **300×10**（表格上方），内含 `.table-header-bar__inner` 301×10 → `.table-header-wrapper` 100×10 → `.table-header` → `.table-header-placeholder` |
| **消息条容器** | `.ud__msg-manager.ud__msg-manager--top` | 1512×16 @y=32 **z 9999** / @y=72 **z 1010**（两条并存，fixed） |
| **顶栏** | `.navigation-bar.navigation-bar__suite` | 1212×64 @(300,0)，**z 89**，bg **#FFFFFF** |

> **⚠️ 菜单宽度自适应，不能硬编码**：顶栏「更多」普通模式 **175**（项 167 / 分隔线 173）、翻译模式 **160**（项 152 / 分隔线 158）、子面板 **120 / 121 / 198** 各不相同 → **宽度由最长文案决定**，复刻时用 `fit-content` + `min-width` 而非定值。
>
> **⚠️ 表格 gutter 手柄尺寸与文本块不同**：文本块 `42×26`（内 `42×26`），**表格 `44×30`（内 `40×24`）** —— 别复用同一套常量。
>
> ✅ **「帮助中心菜单 120×166（5 项）」归属已确认**：DOM 链 `ud__menu-normal` → `gpf-biz-help-center__internal-btns.opacity-hide` → `gpf-biz-help-center__button-group` → `help-block.group-btns`（z60）→ `app-main-container` → `app`。5 项 = **上传日志 / 联系客服 / 功能更新 / 帮助中心 / 快捷键**，项 112×30。它**常驻离屏预挂载**（`rect = -8560,-9123`），不是任何子菜单。

### 6.3 层级（z-index）【实测】

| 元素 | z-index | position |
| --- | --- | --- |
| 字数统计气泡 | **60** | fixed |
| 帮助中心悬浮区 | **60** | fixed |
| 封面 popover | **80** | — |
| **gutter 块手柄浮层** | **79** | `.overlay-container`（42×26，hover 块左侧出现） |
| **块工具条（hover 块内部）** | **86** | `.overlay-container.block-toolbar__overlay`（164×42） |
| **选区气泡条** | **87** | `.overlay-container`（594×42） |
| 高亮块取色面板 | **600** | `.overlay-container`（含 `.callout-highlight-panel` 230×262） |
| 菜单内层 wrapper | **999** | `.docx-menu-wrapper`（气泡条/块工具条/子菜单内部的白色容器） |
| 分享 popover | **99** | `.ud__popover.share-popover-v2`（480×331） |
| 内嵌网页 URL 弹窗 | **99** | 540×164 |
| 内嵌网页全屏容器 | **102** | `doc-mini-app--float-card-container` |
| 更多菜单滚动遮罩 | **1001** | `.more-menu-v2-scroll-gradient__mask`（173×814） |
| 图片预览器本体 / 日期提醒日历 | **1000** | `image-viewer-v2` / `docx-reminder-popover-wrapper` |
| **顶部「更多」菜单 popover** | **1030** | `.ud__popover.more-menu-popover`（175×820） |
| 图片大图预览外壳 | **1049** | `docx-image-viewer-shell`（全站最高） |
| 侧边栏 wiki 树 | **90** | `.wiki-sidebar-wrap`（300×full）／`.vmok-sidebar-container`（#F5F6F7） |
| 顶栏 | **89** | `.navigation-bar.navigation-bar__suite`（1212×64） |
| 表格新增列符号 | **599** | `.table-add-line-symbol.vertical`（30×35） |
| 表格 gutter 手柄 | **9** | `div.table-menu-trigger.has-drag-icon`（44×30） |
| 表格列宽 resizer | **1** | `.column-resizer` / `.docx-table-inside-resizer-line-container` |
| **顶栏子面板（全站最高）** | **1050** | `.ud__menu-normal-submenu-popup`（下载为 120×108 / 文档权限 121×115 / 更多 198×142） |
| 消息条（顶部 toast） | **9999 / 1010** | `.ud__msg-manager--top`（两条并存，fixed） |

> **z-index 六档体系（复刻直接照抄）**
> 1. **1 / 9 / 60** —— 表格内部件（列宽线 1、块手柄 9）与常驻微浮层（字数统计、帮助中心 60）
> 2. **79 / 86 / 87** —— 「条类」三档：`gutter 手柄 < 块工具条 < 选区气泡条`
> 3. **89–102** —— 顶栏与页面级弹窗（顶栏 89、侧栏 90、分享/URL 弹窗 99、内嵌全屏 102）
> 4. **599–600 / 999** —— 命令条体系：表格新增列符号 599、外层 `.overlay-container` **600**（slash 菜单 247×383），内层 `.docx-menu-wrapper` **999**（双层是硬要求）
> 5. **1000–1049** —— 全屏级（预览器 1000、更多菜单 1030、预览外壳 1049）
> 6. **1050** —— **顶栏子面板，全站最高**（子菜单必须压过一级菜单 1030）
>
> ⚠️ **注意 599 vs 600**：表格「新增列」符号 599 与 slash 菜单 600 仅差 1，是刻意分层（表格内小控件在命令条之下）。

---

## 6.4 块容器规格总表【实测·插入后采集】

| 块 | 类名 | 宽×高 | margin | padding | 背景 | 圆角 |
| --- | --- | --- | --- | --- | --- | --- |
| 文本块 | `.docx-text-block` | 824×26 | `8px -2px` | `0 2px` | 透明 | 0 |
| 有序列表 | `.docx-ordered-block` | 824×26 | `8px -2px` | `0 2px` | 透明 | 0 |
| H1 | `.docx-heading1-block` | 824×36 | `26px -2px 10px` | `0 2px` | 透明 | 0 |
| H2 | `.docx-heading2-block` | 799×65 | `22px -2px 8px 0` | `0 2px` | 透明 | 0 |
| 任务块 | `.docx-todo-block` | 824×26 | `8px -2px` | `0 2px` | 透明 | 0 |
| └ 任务块内层 | `.todo-block` | 824×26 | `0 -2px` | `0 2px` | **`rgba(100,106,115,0.05)`** | **4px** |
| └ 任务内容 | `.todo-block_content` | 794×26 | 0 | `0 0 0 24px` | 透明 | 0 |
| 高亮块 | `.docx-callout-block` | 820×60 | `16px 0` | 0 | 透明¹ | 0 |
| └ 高亮块色层 | `.callout-block` | 820×60 | 0 | **16px** | **#FFF5EB**（默认橙） | **8px** |
| 代码块 | `.docx-code-block` | 820×97 | `16px 0` | 0 | 透明 | 0 |
| └ 代码块色层 | `.editor-kit-code-block` | 820×97 | 0 | `0 0 2px` | **#F5F6F7** + border 1px #DEE0E3 | **8px** |
| 引用 | `.docx-quote_container-block` | 822×26 | `8px -2px 8px 0` | `0 2px` | 透明 | 0 |
| └ 引用内层 | `.quote-container-block` | 820×26 | `0 -2px 0 0` | `0 2px 0 12px` | 透明 | 0 |
| └ 引用竖线 | `.quote-container-block::before` | **2×26** | — | — | **#BBBFC4** | **1px** |
| 分隔线 | `.docx-divider-block` | 824×**25** | `8px -2px` | `0 2px` | 透明 | 0 |
| 表格（3 列小表） | `.docx-table-block` | 820×**83** | `24px 0` | `0 0 2px` | 透明 | 0 |
| └ 表格实体 | `TABLE.table` | **300×81** | 0 | 0 | 透明 | 0 |
| 表格（多列大表） | `.docx-table-block` | 820×**268** | `24px 0` | `0 0 2px` | 透明 | 0 |
| 表格单元格（大表首列） | `.docx-table_cell-block` | **139**×**41** | 0 | `8px` | **#F2F3F5** | 0 |
| 表格单元格（其余） | `.docx-table_cell-block` | **100**×**40/41** | 0 | `8px` | **#F2F3F5** | 0 |

> **⚠️ 表格宽不等于 820**：`.docx-table-block` 是**块容器**（恒 820，与正文栏同宽），真正的 `TABLE.table` 只占**列宽之和**（3 列 × 100 = 300）。复刻时容器撑满、表格 `width: auto`。
> **⚠️ 单元格底色是 `#F2F3F5`（不是透明）**：`rgb(242,243,245)`，实测两处表格一致。首行高 **41**、后续行 **40**（差 1px）。
> 完整 DOM 链与行列表头手柄见 **§6.8**。
| ISV 块 | `.docx-isv-block` | 820×282 | `16px 0` | 0 | 透明 | 0 |

> ¹ **高亮块默认无背景色**（`rgba(0,0,0,0)`）。飞书的高亮块背景是**用户选色后才写入**，默认态透明。各色号配色【待补】。

---

## 6.5 代码块完整规格【实测·DOM 递归 dump】

结构链：`.docx-code-block` → `.docx-code-block-container` → `.docx-code-block-inner-container` → `.code-block-resize` → `.resizable-wrapper` → `.editor-kit-code-block`

| 层 | 类名 | 尺寸 | 关键样式 |
| --- | --- | --- | --- |
| 外层块 | `.docx-code-block` | 820×97 | margin `16px 0`，padding 0，bg 透明 |
| 内容层 | `.editor-kit-code-block.code-block.code-fold-block` | 820×97 | **bg `#F5F6F7`**，padding `0 0 2px`，fs **14px**，lh 25.2px，color `rgb(43,47,54)` |
| 头部 | `.code-block-header` | 818×**32** | padding `8px 8px 0 0` |
| 语言按钮 | `.code-block-header-btn`（语言） | **90×22** | radius **4**，fs 13.33px，color `#1F2329`，图标 svg `fill="#8F959E"` |
| 自动换行 | `.code-block-header-btn` | **84×22** | radius 4，fs 13.33px，color `#646A73` |
| 复制 | `.code-block-header-btn` | **56×22** | radius 4，fs 13.33px，color `#646A73` |
| 标题/说明 | `.code-block-caption` | 502×30 | — |
| 头部工具栏 | `.code-block-header-toolbar` | 264×22 | 三个按钮左到右排列 |
| 内容区 | `.code-block-content` | 818×**53** | **fontFamily `SourceCodeProMac`**，fs **14px**，lh **22px**，padding `0 20px 0 0` |
| 行号槽 | `.code-block-line` | **55×53** | bg `#F5F6F7` |
| 代码行 | `.ace-line` | 715×**22** | fs 14px，lh 22px |

> **要点**：
> 1. 代码块**等宽字体是 `SourceCodeProMac`**（飞书自托管字体），font-size **14px**（比正文 16px 小），line-height **22px**（≈1.57，非 1.8）。
> 2. 内容区右内边距 20px、左靠行号槽 55px。
> 3. 头部按钮高度统一 **22px**、圆角 **4px**（不是 6），与通用菜单项圆角一致。
> 4. 语言下拉浮层 `.ud__popover.code-block__lang-picker` **219×771**，**带搜索框**（可直接键入「JavaScript」过滤）；语言项无 `data-name`，只能按文本匹配。
> 5. 容器圆角更正：`.editor-kit-code-block` **radius 8px**（不是 0），border `1px rgb(222,224,227)` #DEE0E3；头部 `.code-block-header` radius **`4px 4px 0 0`**。
> 6. 「JavaScript」下语言按钮宽 **96×22**（「Plain Text」下 90×22）。

### 6.5.1 语法高亮配色【实测·JavaScript】

飞书**确实用 `code-hljs-*` 类名**（不是纯 inline style），类名与 highlight.js 同名但色值自定。切到 JavaScript 语言并输入代码后逐个 span 读 `color`：

| 类名 | rgb | HEX | 典型 token |
| --- | --- | --- | --- |
| `code-hljs-keyword` | `rgb(166, 38, 164)` | **#A626A4** | `const` / `function` / `return` / `if` |
| `code-hljs-number` | `rgb(152, 104, 1)` | **#986801** | `1` / `0` / `42` |
| `code-hljs-variable language_` | `rgb(152, 104, 1)` | **#986801** | `console` |
| `code-hljs-comment` | `rgb(160, 161, 167)` | **#A0A1A7** | `// note` |
| `code-hljs-title function_` | `rgb(64, 120, 242)` | **#4078F2** | `foo` / `log`（函数名） |
| `code-hljs-string` | `rgb(80, 161, 79)` | **#50A14F** | `"hi"` |
| `code-hljs-params` | `rgb(43, 47, 54)` | **#2B2F36** | 形参 `x` |
| 默认（无 hljs 类） | `rgb(43, 47, 54)` | **#2B2F36** | 标点、运算符、其它 |

> 这套色值与 **Atom One Light** 主题一致（#A626A4 / #986801 / #50A14F / #4078F2），可直接复用 highlight.js 的 `atom-one-light` 主题。
> ⚠️ **Plain Text 语言下无任何高亮**：所有 span 都是默认色 `rgb(43,47,54)`。

---

## 6.6 高亮块（callout）完整规格【实测·插入后采集】

DOM 结构链（7 层）：

```
.block.docx-callout-block                       820×60  bg 透明  margin 16px 0
└ .block-comment.callout-block-comment          (local-comment-all-third-party)
  └ .docx-callout-block-container.docx-block-align-left
    └ .docx-callout-block-inner-container
      └ .callout-block            ← 真正的"色层"  820×60  bg/border/radius 8px/padding 16px
        ├ .callout-emoji-container.emoji-for-text   24×26  (x+16)
        │ └ .callout-block-emoji                    24×24  (内含 .emoji-mart-emoji，radius 4px)
        └ .callout-block-children                   754×26 (x+49)
          └ .render-unit-wrapper.callout-render-unit
            └ .block.docx-text-block.callout-render-unit  758×26  padding 0 2px
```

| 属性 | 值 |
| --- | --- |
| emoji 容器 | 24×**26**（比 emoji 的 24×24 高 2px，垂直居中用） |
| emoji | **24×24**，radius **4px**（`.emoji-mart-emoji.emoji-mart-emoji-native`） |
| emoji 与正文间距 | emoji 左边缘距块左 **16px**，正文起点距块左 **49px**（= 16 + 24 + 9） |
| 色层 padding | **16px** |
| 色层圆角 | **8px** |
| 默认（橙） | `bg rgb(255,245,235)` **#FFF5EB** / `border 1px rgb(254,212,164)` **#FED4A4** |
| 正文文字色 | `rgb(31,35,41)` #1F2329（**不随高亮块配色变化**，除非显式改字体颜色） |

**入口链路**：hover 高亮块内部 → 自动出现块工具条 → 点 `[data-name="callout-highlight"]` → 弹出 `.callout-highlight-panel`（230×262，见 §1.5）。

---

## 6.7 引用块左侧竖线【实测】

> ⚠️ **关键结论**：竖线**不是 `border-left`**，也不是 `box-shadow`，而是 **`.quote-container-block::before` 伪元素**。用 `getComputedStyle(el)` 读不到，必须 `getComputedStyle(el, '::before')`。

```
.quote-container-block::before {
  content: "";
  position: absolute;
  left: -2px;  top: 0px;
  width: 2px;  height: 26px;      /* 高度 = 引用块内容高度 */
  background: rgb(187, 191, 196); /* #BBBFC4 */
  border-radius: 1px;
  display: block;
}
```

| 属性 | 值 |
| --- | --- |
| `.quote-container-block` 自身 | 820×26，`padding-left: 12px`，`border-left: 0 none`，bg 透明，box-shadow none |
| 竖线颜色 | **`rgb(187,191,196)` #BBBFC4** |
| 竖线尺寸 | **2 × 26**（宽 2px，高 = 块高） |
| 竖线位置 | `left: -2px`（相对 `.quote-container-block`，即块左边缘外 2px） |
| 竖线圆角 | **1px** |
| 引用正文 | `.ace-line` 806 宽、fs **16px**、lh **26px**、color **`rgb(100,106,115)` #646A73** |

> 引用块正文用**次要文字色 #646A73**（不是主色 #1F2329），这是引用与正文的视觉区分点。

---

## 6.8 表格完整规格【实测·batch67/68 · hover 表格后采集】

### 6.8.1 DOM 结构链（8 层）

```
.docx-table-block                                   820×83   margin 24px 0  padding 0 0 2px
└ .docx-block-loading-container                     820×81
  └ .scrollable-item                                304×81
    └ .block-comment.table-block-comment            304×81  (local-comment-all-third-party)
      └ .content-scroller                           304×81
        └ .table-scrollable-content                 304×81
          └ .table-content-padding.flash-block-content  304×81
            └ TABLE.table                           300×81  ← 真正表格，宽 = 列宽之和
              ├ THEAD/TBODY > TR.row--<id>.docx-table-tr(.first-row)  300×41 / 300×40
              │ └ TD.docx-table_cell-block           100×41  bg #F2F3F5  padding 8px
              │   └ .docx-text-block(.isEmpty)       87×23   fs 12px
```

| 层 | 类名 | 尺寸 | 关键样式 |
| --- | --- | --- | --- |
| 块容器 | `.docx-table-block` | 820×83 | margin `24px 0`，padding `0 0 2px`，border **0**，radius **0** |
| 表格实体 | `TABLE.table` | **300×81** | `border-collapse: **separate**`，`border-spacing: **0px`** |
| 行 | `TR.row--100011.docx-table-tr.first-row` | 300×**41** | bg 透明，cursor `text` |
| 行（后续） | `TR.row--100012.docx-table-tr` | 300×**40** | 同上，**比首行矮 1px** |
| 单元格（首列） | `TD.docx-table_cell-block` | **139**×41 | padding **8px**，fs **12px**，lh **21.6px**，color `#1F2329`，valign **top** |
| 单元格（其余） | `TD.docx-table_cell-block` | **100**×40/41 | 同上 |

> **单元格边框**：首单元格四边 `1px solid #DEE0E3`；**后续单元格上边框 `none`**（靠 `border-collapse: separate` + 单边框拼出网格，避免双线）。
> **单元格底色**：`rgb(242,243,245)` **#F2F3F5**。
> **空单元格**内是一个 `.docx-text-block.isEmpty`（87×23，fs **12px**），占位机制同 §7.2。

### 6.8.2 行 / 列 / 块手柄（hover 表格时全部出现）

| 部件 | 类名 | 尺寸 | 位置 | 样式 |
| --- | --- | --- | --- | --- |
| **块手柄（gutter）** | `div.table-menu-trigger.has-drag-icon` | **44×30** | @(563,209)，表格左外 | **z 9**，radius **6px** |
| └ 白底 | `.hover-drag-icon-wrapper` | **40×24** | 同左 | bg **#FFFFFF**，radius **6px**，cursor **grab** |
| └ 拖拽图标 | `span.universe-icon.drag-handle` | **14×14** | 白底内 | cursor **grab** |
| **新增列符号** | `.table-hover-ignore.table-add-line-symbol.vertical` | **30×35** | @(592,203) | **z 599**，absolute |
| **行插入手柄** | `.row-insert-wrapper` | **16×40** | @x=**583**（表格左缘外 **24px**），逐行 y=236/277 | bg 透明，cursor `text` |
| └ 末行手柄 | `.row-insert-wrapper.last` | **16×15** | @y=317 | **absolute** |
| **列宽热区** | `.resizer-line-hotzone.draggable-btn` | **10×81** | x=700 / 800 / 900（列边界，居中） | absolute，cursor **`col-resize`**，hover 加 `.visible` |
| └ 列宽线 | `.resizer-line` | **2×81** | x=705 / 805 / 905 | bg **`rgb(20,86,240)` #1456F0**，cursor `col-resize` |
| └ 容器链 | `.column-resizer` → `.docx-table-inside-resizer-line-container` → `.column-resizer-item` | 0×0 → 0×0 → **100×0** | 表格内 | z **1**（absolute / relative / relative） |
| **表头栏（列）** | `.table-header-bar.table-header-bar--col` | **300×10** | 表格**上方** y=227 | 内含 `__inner` 301×10 → `table-header-wrapper` 100×10 → `table-header` → `table-header-placeholder` |

> **⚠️ 表格 gutter 手柄是 44×30（白底 40×24）**，与**文本块 42×26（白底 42×26）不同** —— 别复用同一常量。
> **⚠️ 列宽热区位 10px 宽、跨整表高 81**，命中区在列边界 ±5px；线本身 **2px 品牌蓝 #1456F0**，hover 才显形（`.visible`）。

---

## 7. 状态样式【实测】

### 7.1 hover（核心结论）

| 场景 | 背景色 | 实测出处 |
| --- | --- | --- |
| **菜单项 / 气泡条按钮 / 子菜单项 hover** | **`rgba(31, 35, 41, 0.1)`** | `.panel-menu-item:hover`、`.panel-submenu-item:hover`、`.docx-menu-container` 内项 |
| 正常态（无 hover） | `rgba(0, 0, 0, 0)`（透明） | 同上 |
| 块 hover | `rgba(100, 106, 115, 0.05)` | `.todo-block`（块级另用 5% 灰） |

> ✅ **结论**：飞书**控件类 hover 恒为主文字色 #1F2329 的 10%**，即 `rgba(31,35,41,0.1)`，与 hover 对象自身的图标色/文字色无关。
> ✅ **块容器类 hover 是另一套**：`rgba(100,106,115,0.05)`（次要文字色 5%）。二者**不可混用**。
>
> ⚠️ **采样陷阱**：hover 有过渡动画，立刻读会拿到中间帧（如 `rgba(31,35,41,0.05)`）。必须 **hover 后等 ~300ms 再读**，稳定值才是 `0.1`。

### 7.2 其他状态

| 状态 | 说明 |
| --- | --- |
| **选中（selected）** | 色板/对齐菜单中的选中项用**边框**标示：`border: 2px rgb(20,86,240)` #1456F0（色板）；菜单项选中用**文字+图标色** `rgb(51,109,244)` **#336DF4**（实测 `text align` 子菜单「左对齐」），未选中项文字 `rgb(43,47,54)` #2B2F36 |
| **hover** | 控件 `rgba(31,35,41,0.1)`（实测 `.panel-submenu-item[data-name="callout-highlight"]` hover 后 bg 由 `rgba(0,0,0,0)` → `rgba(31,35,41,0.1)`） |
| **disabled** | 图标色 `rgb(187,191,196)` **#BBBFC4**（实测 `text align` 子菜单中 4 个禁用图标 16×16 为该色） |
| **focus** | ✅ **块 `.focused` 类无任何视觉差异**。`.docx-text-block.focused` 774×26 与 normal 的 **bg / shadow / border / outline / radius 五项完全一致**（bg `rgba(0,0,0,0)` / shadow `none` / border `0px` / outline `3px none` / radius `0px`）；同期带 `focused` 的元素只有 2 个：块本身 + `.zone-container.text-editor.non-empty.text-editor-focused`（782×26）。**复刻时不要给 focused 加高亮**（与目录 `.active` 同类结论） |
| **`isEmpty`** | ✅ **无占位文案**。10 个空块子树 dump 结论：`.zone-container.text-editor::before` 的 `content` 是 **空串 `""`**（不是文案），空块上**无 `data-placeholder` 属性**，`.ace-line` 内层只有一个空 `<span>`（无文本节点）→ **飞书空块默认不显示任何占位提示**。该伪元素唯一有信息的是 `color: rgb(187,191,196)` **#BBBFC4** 与 `font-size` 随块（正文 16px / H2 22px）—— 即**占位文字色 Token**，供宿主自定义占位时使用 |
| 行内高亮（mark） | 已应用的高亮底色 = `rgba(255, 246, 122, 0.8)`，即 **#FFF67A @80%**（与色板黄色同色号，仅加 80% 不透明度） |

---

## 8. 待验证清单（更新至 2026-10-24）

### 8.1 ✅ 本轮已实测解决

| 项 | 结论 | 依据 |
| --- | --- | --- |
| 正文究竟 14px 还是 16px | ✅ **16px / 28.8px（1.8）** | `.docx-text-block.focused` 新输入实测（此前 14px 是那段被单独设了小字号） |
| H1 line-height | ✅ **1.4**（26px × 1.4 = 36.4px） | 必须读 `.ace-line` 行内层；容器 `46.8px` 是继承的**无效值**，以此前误判 1.8 为准是错的 |
| 高亮块 callout 默认背景 | ✅ **`rgba(0,0,0,0)` 透明** | `.docx-callout-block` 820×60 `padding:0`。飞书默认无背景，配色仅在用户选色后写入 |
| 文本气泡条配色 | ✅ 已采全 | 见 [03-工具栏与菜单.md](./03-工具栏与菜单.md) 3.1：容器 594×42 / radius 6 / shadow `rgba(31,35,41,0.1) 0 4px 8px 0` / hover `rgba(31,35,41,0.1)` / divider `1×20` `#DEE0E3` |
| 代码块配色 | ✅ 已采全（语法高亮除外） | 见 6.5 |
| 菜单 hover 色 | ✅ `rgba(31,35,41,0.1)` | 见 7.1 |
| **代码块语法高亮配色** | ✅ **飞书确实用 `code-hljs-*` 类名**，7 类 token 色值全采（= Atom One Light 主题） | 见 6.5.1；切 JavaScript 语言后逐个 span 读 `color` |
| **高亮块色号（原记"7 色"）** | ✅ 实际是 **3 组 × 8 色**：字体色 8 / 边框色 8 / 填充色 16（2 行深浅档），共 32 色全采 | 见 1.5；入口 = hover 块 → 块工具条 `[data-name="callout-highlight"]` |
| **引用块左侧竖线** | ✅ **是 `::before` 伪元素**，不是 border 也不是 box-shadow | 见 6.7：2×26、`#BBBFC4`、`left:-2px`、radius 1px |
| 引用正文色 | ✅ `rgb(100,106,115)` #646A73（**次要色**，区别于正文主色） | 见 6.7 |
| 高亮块 DOM 结构 | ✅ 7 层全采 + emoji 24×26/24×24 + 色层 padding 16 / radius 8 | 见 6.6 |
| 块工具条 / gutter 手柄 / 气泡条 z-index | ✅ 79 / 86 / 87 | 见 6.3 |
| 目录项配色 | ✅ 已采（标题 `rgb(100,106,115)` 14px/22px；`.catalogue__item-collapse` 16×29 pad `6px 3px`；level≥2 `padding-left:14px`） | 见 6.2 |
| **目录项 `active` 态配色** | ✅ **反直觉：active 无任何视觉差异**。四次采样对比 color/bg/伪元素/border 全同（均 `#646A73` + 透明）；视觉层级只由 `heading-0/1/2` 决定（fs 15 vs 14、fw 500 vs 400、padding-left 0 vs 14）。`.active` class **仅供滚动跟随逻辑** | 见 [04 §3.3 ⑤](../04-浮层与弹窗.md)；复刻时不要凭空加高亮 |
| **分享「弹窗」** | ✅ **实为 popover 非 Dialog**：480×331，**z99**，无遮罩；主按钮 80×32 `#1456F0` radius 6；输入框外壳 448×36 **聚焦描边 `1px #1456F0`**；权限标签 58×16 `rgba(20,86,240,0.2)` / `#1456F0` / fs10；头像 26×26 radius 50% | 见 [04 §4.1 ④-2](../04-浮层与弹窗.md) |
| **顶部「更多」菜单** | ✅ 外壳 175×820 **z1030**；根菜单 175×816 radius 6 border `#DEE0E3` pad `2px 0` **三层阴影**；普通项 **167×32** radius 4 pad `4px 8px` 图标 16×16 `#646A73`；子菜单项 173×32/34；**一级 22 项**（原记 27 含子菜单项） | 见 [04 §4.2 ④-2](../04-浮层与弹窗.md) |
| **分栏（grid）块** | ✅ 已采（slash `slash grid`，键盘选中插入） | 见 [02 §分栏](../02-块类型规格总表.md) |
| **「更多」4 个子菜单面板** | ✅ **3 个有面板**（下载为 120×108 / 文档权限 121×115 / 更多 198×142），**「翻译为英语」无面板**（是命令项，click 直接进入翻译模式）；hover **≥2000ms** 才展开，z **1050** | 见 [04 §4.2 ④-3](../04-浮层与弹窗.md) 与本文件 6.2 |
| **翻译模式改写「更多」菜单** | ✅ 160×344 / 项 152×32 / 分隔线 158×1，**9 项**；整体比普通态窄 **15px** → 菜单宽度**自适应，不可硬编码** | 见 [04 §4.2](../04-浮层与弹窗.md) |
| **气泡条 13 项顺序与绝对坐标** | ✅ 已采全（双击选词法）；**顺序陷阱**：Bold → **Strikethrough** → Italic → Underline（删除线在斜体**前**）；间隙：同组 32、跨分隔线 17、`more` 前 25 | 见 [03 §3.1 ④-2](../03-工具栏与菜单.md) |
| **highlight 按钮三层像素** | ✅ 热区 44×24 `rgba(31,35,41,0.05)` radius 4 / 图标位 24×24 `rgba(31,35,41,0.15)` / 色块 20×20 `rgba(255,246,122,0.8)` radius **2**；**面板四种触发均打不开**（hover 800/1500/2500ms、mousedown、click）→ 色板面板尺寸仍【待补】 | 见 [03 §3.2.4 ④-2](../03-工具栏与菜单.md) |
| **块 `focused` 态视觉差异** | ✅ **无任何视觉差异**（bg/shadow/border/outline/radius 全同），同目录 `.active` 结论 | 见 7.2 |
| **空块占位文案** | ✅ **不存在占位文案**（伪元素 content 为空串、无 `data-placeholder`）；只采到**占位色 Token `#BBBFC4`** | 见 7.2 |
| **表格完整规格** | ✅ 容器 820×83 / 实体 `TABLE.table` 300×81 / `border-collapse: separate` / 首列 139 其余 100 / 高 41·40 / 单元格底 **`#F2F3F5`** / pad 8px / fs 12px / lh 21.6px / valign top | 见 **6.8** |
| **表格行 / 列 / 块手柄** | ✅ 全采：块手柄 44×30（白底 40×24）z9 / 行插入 16×40 @左外 24px / 列宽热区 10×81 + 线 2×81 **#1456F0** / 新增列符号 30×35 **z599** / 表头栏 300×10 | 见 **6.8.2** |
| **离屏 120×166 菜单（5 项）归属** | ✅ **就是帮助中心菜单**：`help-block.group-btns`（z60）→ `gpf-biz-help-center__*`，5 项 = 上传日志 / 联系客服 / 功能更新 / 帮助中心 / 快捷键，项 112×30，常驻离屏预挂载 | 见 6.2 末尾注 |
| **顶栏子面板 z-index** | ✅ **1050**，全站最高（压过一级菜单 1030） | 见 6.3 |

### 8.2 ⏳ 仍未采到（后续专项）

| 项 | 现状 | 采集建议 |
| --- | --- | --- |
| **顶部工具栏 `bear-web-toolbar` 按钮清单** | wiki 页（`docx-in-wiki`）**二次确认不渲染**。页面根类实测 `bear-web-x-container catalogue-opened docx-in-wiki width-transition keyboard-mode`，全文档 0 个 `.bear-web-toolbar` | **换普通 docx 文档（非 wiki）**复采；wiki 页只渲染 `code-block-header-toolbar`（代码块内嵌工具条 264×22） |
| **折叠块** | slash **一级菜单 24 项中不存在**「折叠块」 | 在 slash「更多/全部」分页中查找，或确认飞书网页版无此块类型 |
| **图片块 / 视频块默认宽与圆角** | 本文无图片块；slash 搜「图片」显示**「未能找到相关结果」**（32 高），键盘遍历也未被命中选择器 | 换**普通 docx**（非 wiki），或走顶栏「插入」入口 / 块手柄「转换为」 |
| **highlight 色板面板真实尺寸** | 四种触发（hover 800/1500/2500ms、`mousedown`、click）**均无法打开面板** | 需在**已选中带高亮的文本**时触发，或用真实鼠标轨迹（非 `mouse.move` 瞬移） |
| 行内「字体颜色」入口 | 气泡条 13 项中**无**字体颜色项，推测在 `more` 子菜单内 | 重新选区后 hover（非 click）展开 `more`，再进二级 |
| 封面 popover / 评论面板更多菜单 / 查找替换三选项 | 未采 | hover 封面图、评论气泡「…」、`Ctrl+F` 后逐个按钮 |
| B22–B25 四项**定义缺口**（协同存储位置 / 快照配额 / capability 映射 / poster 生成） | 采集解决不了，属**设计决策** | 见 [10-缺口与待补清单.md](./10-缺口与待补清单.md)，需产品定夺 |

> **slash 一级菜单实测清单（24 项，按序）**：文本 / 一级标题 / 二级标题 / 三级标题 / 四级标题 / 五级标题 / 有序列表 / 无序列表 / 代码块 / 引用 / 分隔线 / 任务 / 图片 / 视频或文件 / **分栏** / **高亮块** / 公式 / 电子表格 / 人员 / 群名片 / 云文档 / 日期提醒 / 日程 / 会议议程。

---
