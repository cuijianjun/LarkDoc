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

> **规律**：飞书圆角只有 **0 / 4 / 6 / 50%** 四档。内容块一律 0，控件 6，内部子项 4，圆形控件 50%。

---

## 3. 阴影 Token（飞书通用阴影体系）

| Token | 值 | 实测出处 |
| --- | --- | --- |
| `--shadow-menu` | `rgba(31,35,41,0.04) 0 8px 24px 8px, rgba(31,35,41,0.04) 0 6px 12px 0` | `.ud__menu-normal` 下拉菜单 |
| `--shadow-fab` | `rgba(31,35,41,0.08) 0 6px 12px 0` | `.gpf-biz-help-center__trigger-button` 悬浮圆钮 |
| `--shadow-popover` | `rgba(31,35,41,0.1) 0 4px 8px 0` | `.cover-panel-popover-content-wrapper` |
| `--shadow-note` | `rgba(31,35,41,0.04) 0 10px 36px 10px, rgba(31,35,41,0.04) 0 ...` | 单元格批注便签 |

> **规律**：阴影色恒为**主文字色 #1F2329 的低透明度**，透明度只有 **0.04 / 0.08 / 0.1** 三档；越大越"重"（0.1 是小弹窗，0.04 是大菜单/长阴影）。

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
| 头像 | `._pp-header-avatar` | **32×32** |
| AI 按钮（豆包） | `.doc-header-ai-button_container` | 78×26 |
| 通用图标 | `.universe-icon` | **16×16** |
| 表格单元格 | `.docx-table_cell-block` | 100×41 |

### 6.3 层级（z-index）【实测】

| 元素 | z-index | position |
| --- | --- | --- |
| 字数统计气泡 | **60** | fixed |
| 帮助中心悬浮区 | **60** | fixed |
| 封面 popover | **80** | — |
| 菜单 | auto（继承父级） | relative |

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
| 代码块 | `.docx-code-block` | 820×97 | `16px 0` | 0 | 透明 | 0 |
| 引用 | `.docx-quote_container-block` | 822×26 | `8px -2px 8px 0` | `0 2px` | 透明 | 0 |
| └ 引用内层 | `.quote-container-block` | 820×26 | `0 -2px 0 0` | `0 2px 0 12px` | 透明 | 0 |
| 分隔线 | `.docx-divider-block` | 824×**25** | `8px -2px` | `0 2px` | 透明 | 0 |
| 表格 | `.docx-table-block` | 820×83 | `24px 0` | `0 0 2px` | 透明 | 0 |
| 表格单元格 | `.docx-table_cell-block` | 100×41 | 0 | `8px` | 透明 | 0 |
| ISV 块 | `.docx-isv-block` | 820×282 | `16px 0` | 0 | 透明 | 0 |

> ¹ **高亮块默认无背景色**（`rgba(0,0,0,0)`）。飞书的高亮块背景是**用户选色后才写入**，默认态透明。各色号配色【待补】。

---

## 7. 状态样式（待补）

| 状态 | 说明 |
| --- | --- |
| hover | 菜单项 hover 背景色【待补】 |
| active/选中 | 目录项 `active` 类名已确认存在，配色【待补】 |
| focus | 块 `focused` 类名已确认（`.docx-ordered-block.focused`），视觉差异【待补】 |
| disabled | 【待补】 |

---

## 8. 待验证清单

| 项 | 现状 | 需要处理 |
| --- | --- | --- |
| 正文究竟 14px 还是 16px | wiki 容器实测 14px；列表块 16px | 需在**普通 docx 文档**（非 wiki）复测 |
| H1 line-height 1.4 vs 1.8 | 飞书实测 46.8/26 = **1.8**；lark-doc 现有 1.4 | **需改 lark-doc 对齐 1.8** |
| 高亮块 callout 背景色 | 未采到（文档中无此块） | 待插入后采集 |
| 引用块配色 | 未采到 | 待插入后采集 |
| 代码块配色 | 未采到 | 待插入后采集 |
| 文本气泡条配色 | 未采到（选中空文本未触发） | 待补采 |
