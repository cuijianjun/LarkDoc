# 06 · 视觉规格 Token（飞书实测）

> 全部数值来自飞书文档网页 `getComputedStyle` / `getBoundingClientRect` 真实读取【实测】。
> 采集环境：Chrome 1512×950，飞书 wiki 文档页（`docx-in-wiki`）。

---

## 0. 飞书原生 CSS 自定义属性【实测 2026-10-24 · batch81 · `getComputedStyle(document.documentElement)` 全量枚举 59 项】

> 🔥 **这是本文档最有价值的一节**：以下不是「推测 Token 名」，而是飞书**真实在 `:root` 上声明的 CSS 变量**，逐字枚举得来。复刻时**直接沿用同名变量**即可保证像素级一致。

### 0.1 标题阶梯（H1–H9）`--hN-font-size` / `--hN-margin-top` / `--hN-margin-bottom`

| 级别 | font-size | margin-top | margin-bottom |
| --- | --- | --- | --- |
| **H1** | **26px** | **26px** | **10px** |
| **H2** | **22px** | **22px** | 8px |
| **H3** | **20px** | **20px** | 8px |
| **H4** | **18px** | **18px** | 8px |
| **H5** | 16px | **18px** | 8px |
| **H6** | 16px | 16px | 8px |
| **H7** | 16px | 16px | 8px |
| **H8** | 16px | 16px | 8px |
| **H9** | 16px | 16px | 8px |

> 📐 **规律**：H1–H4 的 `margin-top` **等于** `font-size`（26/22/20/18）；H5 起字号锁 16px，但 H5 仍保留 18px 上边距。H2 及以上 `margin-bottom` 统一 **8px**，只有 H1 是 **10px**。
> `--todo-font-size: 16px`，`--todo-check-top: 2px`（复选框相对首行的下沉量）。

### 0.2 块与行间距

| 变量 | 值 |
| --- | --- |
| `--common-block-margin-top` | **16px** |
| `--common-block-margin-bottom` | **16px** |
| `--common-row-font-size` | **16px** |
| `--common-row-line-height` | **26px** |
| `--common-row-margin-top` | **8px** |
| `--common-row-margin-bottom` | **8px** |

### 0.3 表格

| 变量 | 值 |
| --- | --- |
| `--table-margin-bottom` | **24px** |
| `--table-cell-padding` | **8px** |
| `--table-cell-text-line-height` | **23px** |
| `--table-block-border-width` | **1px** |
| `--table-sticky-mask-bg` | **#f7f7f8** |

### 0.4 阴影 / 骨架屏 / 侧栏

| 变量 | 值 |
| --- | --- |
| `--box-shadow-color` | **`rgba(31, 35, 41, 0.1)`** ← 飞书所有阴影的统一底色 |
| `--workspace-sidebar-border-right-color` | **`rgba(31,35,41,0.04)`** |
| `--ENTERPRISE-TREE_SKELETON-START` | `rgba(31,35,41,.05)` |
| `--ENTERPRISE-TREE_SKELETON-END` | `rgba(31,35,41,.08)` |

### 0.5 调色板（indigo / purple）

| 变量 | 值 |
| --- | --- |
| `--palette-indigo-100` | **#e9eafb** |
| `--palette-indigo-500` | **#8d55ed** |
| `--palette-indigo-600` | **#4752e6** |
| `--palette-purple-350` | `rgba(183,145,250,0.13)` |
| `--palette-purple-500` | `rgba(91,101,245,0.13)` |
| `--R600` | **#D83931**（语义红） |
| `--G600` | **#2EA121**（语义绿） |

### 0.6 AI / 兜底色

| 变量 | 值 |
| --- | --- |
| `--AI-img-placeholder-bg` | **#f0f0fd** |
| `--doubao-sidebar-fallback-bg` | **#fcfcfc** |
| `--lark-cli-ai-rewrite-highlight-bg` | `rgba(255,149,0,0.2)` |
| `--lark-cli-ai-remote-rewrite-reveal-duration` | `1000ms` |
| `--ccm-insert-by` | `js` |
| `--safe-area-inset-left/right/bottom` | `0px` |

### 0.7 主题持久化【实测 · batch81】

飞书把外观设置存在 **`localStorage`**：

| key | 值（示例） | 含义 |
| --- | --- | --- |
| `view_mode` | `{"user":"7018536132879155201","setting":"light","fg":"1"}` | **主题**：`setting` = `light` / `dark`；`fg` 疑为「跟随系统」标记 |
| `WIKI_SIDEBAR_MODE` | `"MAIN"` | wiki 侧栏模式 |
| `<uid>_TEXTHIGHLIGHT_COLOR` | `{"color":"","backgroundColor":"rgba(255,246,122,0.8)"}` | **行内高亮色记忆**（按用户维度持久化，含前景/背景两个通道） |

配合 `<html data-theme="light">` 属性（实测 `documentElement.getAttribute('data-theme') === 'light'`）。
→ **复刻口径**：主题 = `html[data-theme]` 属性 + `localStorage.view_mode.setting` 双写；高亮色按 `用户ID_TEXTHIGHLIGHT_COLOR` 持久化。

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
| `--bg-table-cell` | **表格单元格底色** | **恒透明 `rgba(0,0,0,0)`** 【✅ 修正 2026-10-24 · batch90/91 两主题复测均为透明】——旧值 `#F2F3F5` 系早期 hover/选中态误读，**作废**，见 §4.8 结论③ |
| `--bg-page` | 侧栏 / wiki 树底 | `rgb(245, 246, 247)` → **#F5F6F7** 【实测 `.vmok-sidebar-container` `z90`】 |
| `--bg-code` | 代码块色层 | `#F5F6F7` + border `1px #DEE0E3`，radius 8 【见 6.5】 |
| `--bg-active-weak` | 气泡条热区项 hover 底 | `rgba(31, 35, 41, 0.05)` 【实测 `.panel-submenu-item.hot-area-unique` 44×24。**300/700/1300/2200ms 四点采样恒为 `0.05`** → 是稳定值，**不是过渡中间帧**（旧记作废）】 |
| `--bg-active` | 气泡条普通项 hover 底 | `rgba(31, 35, 41, 0.1)` 【实测 `.panel-menu-item`。旧 Token 名为 `--bg-active` 且与上行混用，此处拆开】 |
| `--bg-icon-hot` | 气泡条激活态图标位 | `rgba(31, 35, 41, 0.15)` 【实测 `.menu-icon` 24×24】 |
| `--bg-selected` | **「格式已生效」开关型按钮底**（Bold/Italic/Underline/Strikethrough/inlinecode 生效时） | **`rgb(224, 233, 255)` = `#E0E9FF`** 【实测 batch255 A2：`.panel-menu-item.menu-item-hovered.menu-item-actived`，**优先级高于 hover**，同时带 hovered 类仍取此值】 |
| `--icon-selected` | 上述状态下 svg `path` 的 `fill` | **`rgb(51, 109, 244)` = `#336DF4`** 【同上。🔴 只加在 `path` 上，`svg` 的 `color` 仍 `rgb(43,47,54)` → 必须写 `svg path { fill: #336DF4 }`，只改 `color` 无效】 |

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
| 面板容器 | `.callout-highlight-panel` | **230×262**，位于 841,472 | bg `#FFFFFF`，**radius `4px`**（🔴 见下方裁决修正），border `1px #DEE0E3`，padding `4px 10px 12px`，shadow `rgba(31,35,41,0.1) 0 6px 24px 0` |
| 分组标题 | `.group-title`（`<p>`） | 206×14 | 「字体颜色」「边框颜色」「填充颜色」，位于 854,y486/546/606 |
| 色块按钮 | `.callout-highlight-btn` | **26×26** | radius **4px**，border **2px**；未选中 `#FFFFFF`、选中 **`rgb(20,86,240)` #1456F0** |
| 色块内芯 | `.highlight-bg` | **22×22** | radius **2px** |
| 字体色块图形 | `.callout-highlight-btn.text > svg > path` | 10×11 | 颜色在 **`fill`** 上（不是 `color`），取 `getComputedStyle(path).fill` |
| 随机 | `.random` | 43×17，位于 1017,484 | color **`rgb(51,109,244)` #336DF4**，fs **12px**，含 15×12 universe-icon |
| 恢复默认 | `.callout-clear-highlight`（`<button>`） | **204×24**，位于 854,697 | bg 透明，radius **4px**，color **#1F2329**，fs **12px** |

> 🔴 **radius 口径二次裁决（2026-10-25 · batch353/354 直接实测，推翻上一次的「推理裁决」）**
> **结论：`border-radius: 4px`。**
> 上一次（batch264 B3）把本面板判为 **6px**，但那是**推理**不是实测 —— 依据是「同族 `.toolbar-highlight-panel` 是 6px，除尺寸外逐项一致，故取 6px」，且当时自己就注明了「**仍未做高亮块本体的直接实测**」（见下方保留的旧注）。
> 本次 batch353 递归 dump + batch354 专项复验，**两次独立实测**均得到：
> - `getComputedStyle(panel).borderRadius` = **`4px`**
> - `getComputedStyle(panel).borderTopLeftRadius` = **`4px`**
> - 全页 `.callout-highlight-panel` **`count: 1`**（不存在第二个隐藏实例干扰）
> - 祖先链 6 层（`.overlay-container` / `.overlay-wrapper` / `.overlay-root` / 块工具条 overlay）radius **全 `0px`**，不存在「外层 6px 圆角透出来」的可能
> ⇒ **「同族组件同套样式」的类比推理在本例失效**，两个面板确实用了不同半径。**本文档一律按 `4px`**；`02 §6 ④-3` / `03` / `04 §1.2` 已同步。
> ✅ **另一条附带修正**：面板自身 `position: relative` / `z-index: auto`，**z600 在祖先 `.overlay-container` 上**，不是面板自己的属性（旧记「面板 z 600」表述不准）。
> ⚠️ 仍未做的是「高亮块本体 `.callout-block` 圆角」的直接实测，但那是**另一件事**（本表只讲面板外框），不影响本裁决。

> ~~🔴 radius 口径裁决（2026-10-24 · batch264 B3）：本表旧写「radius 4px（不是 6）」与 `02 §6 ④-3` / `03` / `04 §1.2` 的 6 冲突，现统一为 6px。~~
> ~~依据：同族「文本选区高亮色板」`.toolbar-highlight-panel` 实测 = `radius 6px` …属同一组件同一套样式，故 callout 面板取 6px。~~
> ~~⚠️ 仍未做的是「高亮块本体」的直接实测（本文档无 callout 块，batch264 A0 为 `null`），但半径只影响面板外框，6px 已可定案。~~
> 🔺 **以上三条已作废**，原因见上一条（类比推理 ≠ 实测）。

#### 1.5.1 深色模式下的同一色板【实测 2026-10-24 · batch90 · 切 `data-theme=dark` 后同法采集】

面板与布局**完全不变**（同为 230×262 @723,472、色块 26×26、内芯 22×22、行 y = 507/567/627/657），**只有颜色换了一整套**：

| 项 | 浅色 | **深色** |
| --- | --- | --- |
| 面板 bg | `#FFFFFF` | **`rgb(41,41,41)` #292929** |
| 面板 shadow | `rgba(31,35,41,0.1) 0 6px 24px 0` | **`rgba(0,0,0,0.28) 0 6px 24px 0`** |
| 色块未选中 border | `#FFFFFF` | **`rgb(41,41,41)` #292929**（= 与面板同色，靠内芯色区分） |
| **色块选中 border** | `rgb(20,86,240)` **#1456F0** | **`rgb(76,136,255)` #4C88FF** |

> 🔑 **决定性结论：飞书的主色是「双值」**——浅色 **#1456F0**、深色 **#4C88FF**。
> 同一结论在别处得到交叉验证：表格列拖拽指示线 `.resizer-line` 浅色 `rgb(20,86,240)` / 深色 `rgb(76,136,255)`。
> **实现要点**：主色必须做成 `--brand` 变量按主题切换，**不能硬编码一个蓝**；凡是"选中/激活/拖拽"态都应读这个变量。

**深色色板 4 行 × 8 色（`.highlight-bg` 的 `background-color` 实测 · batch91 全量）**

| # | 语义 | 行① y507「字体颜色」 | 行② y567「边框颜色」 | 行③ y627「填充·浅档」 | 行④ y657「填充·深档」 |
| --- | --- | --- | --- | --- | --- |
| 0 | 默认 / 无 | `#F0F0F0`（svg fill） | `rgb(41,41,41)` **#292929** | `rgb(41,41,41)` **#292929** | `rgba(67,67,67,0.7)` **#434343·70%** |
| 1 | 灰 | 待补 | `rgb(67,67,67)` **#434343** | `rgba(55,55,55,0.6)` **#373737·60%** | `rgba(95,95,95,0.5)` **#5F5F5F·50%** |
| 2 | 红 | 待补 | `rgb(158,56,54)` **#9E3836** | `rgb(74,29,27)` **#4A1D1B** | `rgb(107,40,39)` **#6B2827** |
| 3 | 橙 | 待补 | `rgb(189,112,23)` **#BD7017** | `rgb(87,51,10)` **#57330A** | `rgb(132,81,23)` **#845117** |
| 4 | 黄 | 待补 | `rgb(199,179,0)` **#C7B300** | `rgb(92,85,20)` **#5C5514** | `rgb(135,123,16)` **#877B10** |
| 5 | 绿 | 待补 | `rgb(51,148,40)` **#339428** | `rgb(31,71,27)` **#1F471B** | `rgb(41,107,34)` **#296B22** |
| 6 | 蓝 | 待补 | `rgb(40,81,163)` **#2851A3** | `rgb(25,42,76)` **#192A4C** | `rgb(32,62,120)` **#203E78** |
| 7 | 紫 | 待补 | `rgb(101,51,189)` **#6533BD** | `rgb(54,29,97)` **#361D61** | `rgb(77,38,145)` **#4D2691** |

**面板文案与分组【实测 · batch91 · `p.children` 顺序 dump】**

| 元素 | 类名 | y / 高 | 浅色 color | **深色 color** |
| --- | --- | --- | --- | --- |
| 分组标题「字体颜色」 | `.group-title` | 486 / 14 | `rgb(31,35,41)` #1F2329，fs 12 | **`rgb(240,240,240)`** #F0F0F0 |
| 色块行容器① | `.highlight-menu-group` | 507 / **30** | — | — |
| 分组标题「边框颜色」 | `.group-title` | 546 / 14 | #1F2329 | **#F0F0F0** |
| 色块行容器② | `.highlight-menu-group` | 567 / **30** | — | — |
| 分组标题「填充颜色」 | `.group-title` | 606 / 14 | #1F2329 | **#F0F0F0** |
| 色块行容器③（**两行 16 色**） | `.highlight-menu-group` | 627 / **60** | — | — |
| 「随机」 | `.random` | 484 / 17 | **`rgb(51,109,244)` #336DF4** | **`rgb(76,136,255)` #4C88FF** |
| 「恢复默认」 | `.callout-clear-highlight` | 697 / 24 | #1F2329 | **#F0F0F0** |

> 📐 **面板高度反推**：4（padding-top）+ 14（标题）+ 9 + 30（行①）+ 14（标题）+ 9 + 30（行②）+ 14（标题）+ 9 + 60（行③，两行）+ 12（到「恢复默认」）+ 24 + 12（padding-bottom）≈ **262** ✅
> 「随机」与「字体颜色」标题**同处 y≈484–486 一行**（标题左、随机右），坐标 y484 vs y486 差 2px 是基线差。

> 📐 **深浅两套色板不是"同一色值改透明度"，是各自独立的一套去饱和暗色**：
> 浅色红 = `#F98E8B`（亮粉红），深色红 = `#9E3836`（暗砖红）——**不能靠 `filter: brightness()` 推导**。
> 深色档的饱和度明显压低（`#C7B300` 黄、`#339428` 绿、`#2851A3` 蓝都是"暗厅堂"色），这是为了让 #292929 底上的文字仍有对比度。
> **实现要点**：语义色板必须存 **2×3×8 = 48 个常量**，主题切换整组替换。

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

#### 6.1.1 完整 DOM 层级链【实测 2026-10-24 · batch80 · 全屏层递归 dump】

> 从 `body` 一路向下到正文容器的**真实嵌套顺序与各自矩形**。这条链决定了「侧边栏 300 / 顶栏 64」是怎么被减出来的，复刻时按此建骨架。

| # | class | x | y | w | h | bg |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `.layout-column.ccm-scope.wiki` | 0 | 0 | 1512 | 950 | `rgb(255,255,255)` |
| 2 | `.flex.layout-column` | 0 | 0 | 1512 | 950 | `#FFF` |
| 3 | `.app.layout-column.flex.suite-docx` | 0 | 0 | 1512 | 950 | `#FFF` |
| 4 | `.app-main-container.flex.layout-row.explorer-v3.is-suite` | 0 | 0 | 1512 | 950 | **透明** |
| 5 | `.app-main.main__content.layout-column.app-main-header-flexible` | **300** | 0 | **1212** | 950 | 透明 |
| 6 | `.flex.layout-column.suite-body` | 300 | **64** | 1212 | **886** | `#FFF` |
| 7 | `.garr-container.suite-body.flex.layout-column.garr-container-docx` | 300 | 64 | 1212 | 886 | `#FFF` |
| 8 | `.bear-web-x-container.docx-in-wiki.width-transition` | 300 | 64 | 1212 | 886 | **透明** |

**推导**

- **300 / 64 的减法发生在 #4 → #5 与 #5 → #6 两次**：#4 是 1512 满宽（侧边栏是它的兄弟，`layout-row` 横向排列）；#5 起始 x=300（被侧边栏挤掉）；#6 起始 y=64（被顶栏挤掉）。
- 因此 **1212 = 1512 − 300**，**886 = 950 − 64**。
- 只有 #7 / #8 是真正画白的（#FFF），#4/#5/#8 都是透明容器 → **背景色只写在 `garr-container` 与 `suite-body` 两层**，别到处刷白。
- `.docx-in-wiki` 是容器变体标记（wiki 内嵌文档），`.width-transition` 说明**宽度变化有过渡动画**（目录栏开合时会动）。

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
| └ 气泡条白色容器【batch247 实测】 | `.docx-menu-wrapper.docx-menu-wrapper-animation.ud-scrollbar.text-toolbar.menu-align-vertical` | **594×42 @(335,448)**，bg **#FFFFFF**，radius **6px**，shadow **`rgba(31,35,41,0.1) 0 4px 8px 0`**，内层 z **999** |
| **★ 文本选区遮罩**【batch246 实测】 | `.selected-mask` | bg **`rgba(20,86,240,0.18)`** = 品牌蓝 18%，z **10**，absolute；跨块时**整块高亮**（选区跨 3 块 → 遮罩 534×178） |
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

### 6.4 块容器规格总表【实测·插入后采集】

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
| 表格单元格（大表首列） | `.docx-table_cell-block` | **139**×**41** | 0 | `8px` | **透明**² | 0 |
| 表格单元格（其余） | `.docx-table_cell-block` | **100**×**40/41** | 0 | `8px` | **透明**² | 0 |

> **⚠️ 表格宽不等于 820**：`.docx-table-block` 是**块容器**（恒 820，与正文栏同宽），真正的 `TABLE.table` 只占**列宽之和**（3 列 × 100 = 300）。复刻时容器撑满、表格 `width: auto`。
> **⚠️ 单元格底色＝透明（不是 `#F2F3F5`）**：batch90/91 在浅/深两种主题下复测，`TD.docx-table_cell-block` 的 `backgroundColor` 均为 `rgba(0,0,0,0)`。早期读到的 `rgb(242,243,245)` 来自 hover/选中态或表头行的临时底，**已作废**。首行高 **41**、后续行 **40**（差 1px）。
> **单元格边框【实测 batch90】**：`T/R/B` 各 `1px solid #DEE0E3`，**`L` 为 `0px none`**；另有 `box-shadow: #DEE0E3 1px 0 0 0 inset` 补左线。深色下三线均变 **`#434343`**，左线仍 `0`。
> 完整 DOM 链与行列表头手柄见 **§6.8**。
| ISV 块 | `.docx-isv-block` | 820×282 | `16px 0` | 0 | 透明 | 0 |

> ¹ **高亮块默认无背景色**（`rgba(0,0,0,0)`）。飞书的高亮块背景是**用户选色后才写入**，默认态透明。各色号配色【见 §1.5 / §1.5.1】。
> ² **表格单元格恒透明**：网格线全部由 `border`（三边）+ `box-shadow inset`（补左线）绘制，不靠底色。

---

### 6.5 代码块完整规格【实测·DOM 递归 dump】

结构链：`.docx-code-block` → `.docx-code-block-container` → `.docx-code-block-inner-container` → `.code-block-resize` → `.resizable-wrapper` → `.editor-kit-code-block`

| 层 | 类名 | 尺寸 | 关键样式 |
| --- | --- | --- | --- |
| 外层块 | `.docx-code-block` | 820×97 | margin `16px 0`，padding 0，bg 透明 |
| 内容层 | `.editor-kit-code-block.code-block.code-fold-block` | 820×97 | **bg `#F5F6F7`**，padding `0 0 2px`，fs **14px**，lh 25.2px，color `rgb(43,47,54)` |
| 头部 | `.code-block-header` | 818×**32** | padding `8px 8px 0 0`，radius **`4px 4px 0 0`**，color `rgb(43,47,54)`，cursor `text` |
| 头部工具栏 | `.code-block-header-toolbar` | **270**×22 | 右对齐，三个控件左到右排列 |
| ├ 语言按钮容器 | `span.code-block-header-btn-con` | 96×22 | z **2**，`margin-right: 17px` |
| ├ 语言按钮 | `button.code-block-header-btn` | **96×22** | radius **4**，fs 13.33px，pad `0 4px`，color `#1F2329`（内层 span `#646A73`，pad `0 6px 0 0`），尾随 `chevronDown` svg **14×14** |
| ├ 自动换行 | `button.ud__button--link` | **84×22** | radius 4，fs 14px，pad `0 4px 0 2px`，`margin-right: 17px`，**开启态 bg `rgba(31,35,41,0.1)`**（关闭态透明）；前导 svg **22×22** |
| └ 复制 | `button.ud__button--link` | **56×22** | radius 4，fs 14px，pad `0 4px 0 2px`，bg 透明；前导 svg **22×22**，末尾 span 28×22 |
| 折叠键 | `.fold-wrapper` > `.fold-btn` | 24×24 / 16×16 | z **1**，绝对定位于 header 左上；内部 chevron svg **12×12**（path 9×6） |
| 标题/说明 | `.code-block-caption` | **496**×30 | `margin: 0 16px 0 28px`，fs 14px；占位文本色 `#646A73`，lh **30px**（与 header 的 25.2px 不同） |
| 内容区 | `.code-block-content` | 818×**53** | **fontFamily `SourceCodeProMac`**，fs **14px**，lh **22px**，padding `0 20px 0 0` |
| 行号槽 | `.code-block-line` | **55×53** | bg `#F5F6F7` |
| 代码行 | `.ace-line` | 715×**22** | fs 14px，lh 22px |

> **要点**：
> 1. 代码块**等宽字体是 `SourceCodeProMac`**（飞书自托管字体），font-size **14px**（比正文 16px 小），line-height **22px**（≈1.57，非 1.8）。
> 2. 内容区右内边距 20px、左靠行号槽 55px。
> 3. 头部按钮高度统一 **22px**、圆角 **4px**（不是 6），与通用菜单项圆角一致。
> 4. 语言下拉浮层 `.ud__popover.code-block__lang-picker` **219×317**（旧记 771 作废），z-index **1030**，**带搜索框**（可直接键入「JavaScript」过滤）；语言项无 `data-name`，只能按文本匹配。**71 项全清单 + 逐层尺寸见 `04 §2.2`**。
> 5. 容器圆角更正：`.editor-kit-code-block` **radius 8px**（不是 0），border `1px rgb(222,224,227)` #DEE0E3；头部 `.code-block-header` radius **`4px 4px 0 0`**。
> 6. 「JavaScript」下语言按钮宽 **96×22**（「Plain Text」下 90×22）。
> 7. **工具栏宽度以 270 为准**（早期记的 264 作废）：`96 + 17 + 84 + 17 + 56 = 270` ✓ —— 三个控件之间**没有 gap**，全是 `margin-right: 17px` 撑开。复刻时照此写，不要改成 flex gap。
> 8. **header 内三块的绝对 x 坐标（视口 1512、正文栏 820 宽实测）**：折叠键 `611` → 标题 `636` → 工具栏右端 `1418`。标题区宽 `496 = 818 - 8(pad) - 24(折叠键) - 24 - 270 - 8`，即**标题弹性撑满剩余宽度**，工具栏固定 270 贴右。
> 9. **「自动换行」默认是开启态**：`bg rgba(31,35,41,0.1)`（≈ `#1F2329` 10% 叠在白底 → `#E8E9EA`）。这是全站唯一一个「按钮自带浅灰底」的头部控件，容易漏。
> 10. **折叠键 `.fold-wrapper` 的 `z-index: 1`** 与语言按钮容器的 `z-index: 2` 是刻意分层：折叠键在 header 边缘外溢（24×24 而 header pad-top 只有 8），抬 z 是为了不被 header 背景裁掉。

#### 6.5.1 语法高亮配色【实测·JavaScript】

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

#### 6.5.2 深色下的语法高亮【实测 · batch88 · 同一段代码切主题对比】

同一文档、同一段 JS（`const a = 1; // test` / `function f(x)` / `const s = "hello"`），浅色与深色各插一次并逐 token 读 `color`：

| 类名 | **浅色** | **深色** | 是否随主题变 |
| --- | --- | --- | --- |
| `code-hljs-keyword` | `rgb(166,38,164)` #A626A4 | `rgb(166,38,164)` #A626A4 | ❌ **不变** |
| `code-hljs-number` | `rgb(152,104,1)` #986801 | `rgb(152,104,1)` #986801 | ❌ **不变** |
| `code-hljs-comment` | `rgb(160,161,167)` #A0A1A7（italic） | `rgb(160,161,167)` #A0A1A7（italic） | ❌ **不变** |
| `code-hljs-title function_` | `rgb(64,120,242)` #4078F2 | `rgb(64,120,242)` #4078F2 | ❌ **不变** |
| `code-hljs-string` | `rgb(80,161,79)` #50A14F | `rgb(80,161,79)` #50A14F | ❌ **不变** |
| `code-hljs-params` | `rgb(43,47,54)` #2B2F36 | `rgb(232,232,232)` #E8E8E8 | ✅ 变 |
| **默认（无 hljs 类）** | `rgb(43,47,54)` **#2B2F36** | `rgb(232,232,232)` **#E8E8E8** | ✅ 变 |
| 头部标签「代码块」 | `rgb(100,106,115)` #646A73 | `rgb(166,166,166)` #A6A6A6 | ✅ 变 |
| 头部按钮（自动换行/复制） | `rgb(100,106,115)` #646A73 | `rgb(166,166,166)` #A6A6A6 | ✅ 变 |

> 🎯 **决定性结论（省掉一整套工作量）**：
> **语法 token 色在两套主题下完全相同**——飞书直接用 Atom One Light 配色，深色下**不换**配色方案。深色里变的只有三处：**默认文本色 #2B2F36 → #E8E8E8**、**`params` #2B2F36 → #E8E8E8**（因为 params 就是默认色，同一条规则）、**头部标签/按钮 #646A73 → #A6A6A6**。
> 复刻实现：`.code-hljs-*` 七个类写**死色值**（不挂主题变量），只有「默认色」和「头部 UI」两个 token 挂 `--ld-*` 变量。
> ⚠️ 深色下 comment #A0A1A7 在 #1A1A1A 上对比度约 6.4:1 ✅，string #50A14F 约 5.0:1 ✅，keyword #A626A4 约 3.6:1（token 属装饰性文字，可接受；若要更严可只把 keyword 提到 #C678DD）。

---

### 6.6 高亮块（callout）完整规格【实测·插入后采集】

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

### 6.7 引用块左侧竖线【实测】

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

### 6.8 表格完整规格【实测·batch67/68 · hover 表格后采集】

#### 6.8.1 DOM 结构链（8 层）

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
              │ └ TD.docx-table_cell-block           100×41  bg 透明  padding 8px
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

> **单元格边框【实测 batch90】**：`T/R/B` = `1px solid **#DEE0E3**`，**`L` = `0px none`**（靠 `box-shadow: rgb(222,224,227) 1px 0 0 0 inset` 补左线，`border-collapse: separate` 避免双线）。深色下三线 → **`#434343`**，左线仍 `0`。
> **单元格底色＝透明**【✅ 修正 · batch90/91】：`rgba(0,0,0,0)`，浅深两主题一致。旧记的 `rgb(242,243,245)` **作废**。
> **列宽指示线** `.resizer-line`：**2×81**，浅 **#1456F0** / 深 **#4C88FF**；热区 `.resizer-line-hotzone` **10×81**，光标 `col-resize`。
> **空单元格**内是一个 `.docx-text-block.isEmpty`（87×23，fs **12px**），占位机制同 §7.2。

#### 6.8.2 行 / 列 / 块手柄（hover 表格时全部出现）

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
| 行内高亮（mark） | 已应用的高亮底色 = `rgba(255, 246, 122, 0.8)`，即 **#FFF67A @80%**（与色板黄色同色号，仅加 80% 不透明度）；完整 8 字体色 + 16 背景色见 **§7.2.1** |

### 7.2.1 行内字体色 / 背景色（`textHighlight`）配色【实测 · batch134 / 135】

**载体 DOM**：单个 `<span class="textHighlight textHighlight-{name}-text textHighlight-ccmtoken" data-string="true" data-leaf="true">`
→ 字体色写 **`color`**，背景色写 **`backgroundColor`**，**两者共用一个 span、可叠加**；「恢复默认」= 移除整组 `textHighlight*` 类。

**① 字体颜色 8 色（色板 × 正文落色）**

| # | 色板 `path.fill` | Hex | 名称 |
| --- | --- | --- | --- |
| 1 | `rgb(31,35,41)` | **#1F2329** | 默认（黑，= 正文色） |
| 2 | `rgb(143,149,158)` | **#8F959E** | 灰 |
| 3 | `rgb(216,57,49)` | **#D83931** | 红 |
| 4 | `rgb(222,120,2)` | **#DE7802** | 橙 |
| 5 | `rgb(220,155,4)` | **#DC9B04** | 黄（琥珀） |
| 6 | `rgb(46,161,33)` | **#2EA121** | 绿 |
| 7 | `rgb(36,91,219)` | **#245BDB** | 蓝 |
| 8 | `rgb(100,37,208)` | **#6425D0** | 紫 |

**② 背景颜色 16 色（两行 × 8）**

| # | 第 1 行（浅 / 半透明） | 第 2 行（实色） |
| --- | --- | --- |
| 1 | `rgb(255,255,255)` **#FFFFFF** | `rgba(222,224,227,0.8)` |
| 2 | `rgb(242,243,245)` **#F2F3F5** | `rgb(187,191,196)` **#BBBFC4** |
| 3 | `rgb(251,191,188)` **#FBBFBC** | `rgb(247,105,100)` **#F76964** |
| 4 | `rgba(254,212,164,0.8)` | `rgb(255,165,61)` **#FFA53D** |
| 5 | `rgba(255,246,122,0.8)` ← **默认** | `rgb(255,233,40)` **#FFE928** |
| 6 | `rgba(183,237,177,0.8)` | `rgb(98,210,86)` **#62D256** |
| 7 | `rgba(186,206,253,0.7)` | `rgba(78,131,253,0.55)` |
| 8 | `rgba(205,178,250,0.7)` | `rgba(147,90,246,0.55)` |

> ⚠️ **两行不是同一色的深浅变体**，是两套独立色号（第 3~8 列跨行无对应）。复刻时**照抄这张表**，别用 `lighten/darken` 推导。

**③ 色板控件像素（气泡条 `highlight submenu` 二级面板 230×202）**

| 组 | 类名 | 单块尺寸 | radius | 排布 |
| --- | --- | --- | --- | --- |
| 字体颜色 | `.toolbar-highlight-btn.text` | **26 × 26** | **4** | 单行 8 个，步进 **26**（total 208） |
| 背景颜色 | `.highlight-bg` | **22 × 22** | **2** | 两行 × 8，行偏移 **0 / 30** |

- 选中：`border: 2px #336DF4`；未选中：`border: 2px #FFFFFF`（白边占位防抖）
- hover：`border-color: #C2D4FF`（`rgb(194,212,255)`）+ 加 `ud__tooltip-open` 类
- 组标题 `p.group-title`：**206 × 14**，fs **12**，lh **14**
- 「恢复默认」`button.ud__button--outlined`：**204 × 24**，radius **6**，fs **12** / lh **20**

> 📐 **实现建议**：自研侧**不要照抄 `textHighlight-{name}-text` 类名** —— 实测「红 #D83931」对应的类是 `textHighlight-pink-text`，**飞书内部色名与视觉色名不一致**。用 `style="color:#D83931"` 或 `data-text-color="#D83931"` 存真值更安全。
> 代码块内 `code-hljs-*` 语法高亮**优先级更高**，会覆盖行内字体色 —— 复刻时也要让语法高亮后写。

### 7.3 行内元素（inline mark）配色【实测 · batch103 · 正文输入 URL 自动识别】

| 层级 | 标签 / class | 尺寸 | 字号 | 文字色 | 下划线 | 背景 |
| --- | --- | --- | --- | --- | --- | --- |
| 外层容器 | `SPAN.outer-u-container.docx-outer-link-container` | 156×19 | 16px | `rgb(31,35,41)` #1F2329 | `none` | 透明 |
| 中层包装 | `SPAN.link-wrapper.link-text-color.link-start.link-end.link` | 156×19 | 16px | `rgb(31,35,41)` | `none`，**装饰色 `rgb(51,109,244)`** | 透明 |
| **链接本体** | `A.link.contextmenu-without-copyperm` | 156×19 | 16px | **`rgb(51,109,244)` #336DF4** | **`text-decoration-line: none`** | 透明 |
| cursor | — | — | — | — | — | `pointer`（外层/中层是 `text`） |

对照：目录里的链接是**另一套** —— `A.container.catalogue__item-title`，14px、`rgb(100,106,115)` **#646A73**、无下划线、cursor `pointer`（见 6.2）。

> 🔑 **结论 1：飞书正文链接是 `#336DF4`，不是 `#3370EB` 也不是 `#1456F0`。** 三值分工：
> - **#1456F0** = 主按钮填充 / 色板选中 border / 聚焦描边
> - **#3370EB** = **深色主题下的主按钮填充**（查找替换「全部替换」实测）
> - **#336DF4** = **行内链接文字色 + 菜单项选中文字色**（浅色），深色下对应 **#4C88FF**
>
> 🔑 **结论 2（已由 batch130 修正，见 §7.5.3）**：`a.link` **自身恒为 `text-decoration-line: none`**。下划线**不在 `a` 上**，而挂在外层 `span.outer-u-container.docx-outer-link-container` 上，且只有该容器带 **`link-u`** 类时才画（`link-u` = 「链接视图」形态）。所以「有没有下划线」取决于**链接的显示形态**，不取决于插入方式，也不是「hover 才加」。**不要给 `a` 写 `text-decoration: underline`**，写到外层容器上。
>
> 📐 **结论 3：链接是三层嵌套**（容器 → 包装 → `a`），`a` 才是着色层，容器与包装都是 `#1F2329`。只给最外层上色会看不到效果。
>
> 📐 **结论 4：`link-start` / `link-end` 标记链接边界**，`link-wrapper` 是可复用的行内包装类（`link-text-color` 控制取色）。

#### 链接 hover 态【实测 · batch105 · hover 1200ms 后复读】

| 属性 | 常态 | hover | 是否变化 |
| --- | --- | --- | --- |
| `color` | `rgb(51,109,244)` | `rgb(51,109,244)` | ❌ 不变 |
| `background-color` | `rgba(0,0,0,0)` | `rgba(0,0,0,0)` | ❌ 不变 |
| `text-decoration-line` | `none` | **`none`** | ❌ **不变（不加下划线）** |
| `text-decoration-color` | `rgb(51,109,244)` | `rgb(51,109,244)` | ❌ 不变 |
| `cursor` | `pointer` | `pointer` | ❌ 不变 |

> 🔑 **结论 5：飞书正文链接 hover 时「什么都没变」** —— 不变色、不加下划线、不加背景。
> 但 hover 会弹出**链接悬浮卡**（`4d 链接 hover 浮层` 有 2728 字节数据），即 hover 的反馈是**浮层**而不是文字本身。
> 复刻时**不要**给 `a:hover` 写 `text-decoration: underline`（这是浏览器默认行为，必须显式 `text-decoration: none` 覆盖）。
> 📐 链接宽度随文本：156×19（`https://www.feishu.cn`）/ 162×19（`https://open.feishu.cn/`），高度恒 **19px**（16px 字 × 1.19）。

### 7.4 行内代码 `inline-code` 配色【实测 2026-10-24 · batch113 · 反引号输入规则触发】

| 层 | class | 尺寸 | bg | border | radius | padding | margin | color | font |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 外层 chip | `span.inline-code.inline-code_start.inline-code_end` | **35 × 24** | **`rgb(245,246,247)` #F5F6F7** | **`1px solid rgb(222,224,227)` #DEE0E3** | **4px** | `1px 0` | **`0 3px`** | `rgb(31,35,41)` | `SourceCodeProMac` |
| 内层文本 | 无类名 `span` | 33 × 20 | 透明 | — | **3px** | **`0 2px`** | `0` | `rgb(31,35,41)` | `SourceCodeProMac` |

> 🔑 **底色是 #F5F6F7（不是 #F2F3F5）**：比常见「浅灰底」更浅一档，且**必须配 1px `#DEE0E3` 描边**才有「芯片」感。只给底色会像选中态。
> 🔑 **描边色 `#DEE0E3` 与表格网格线、封面面板边框同值** → 可复用同一个 `--border-base` Token。
> 📐 字号/行高与正文完全一致（16 / 26），**只换字体不改字号**，所以行内代码不会把行距撑开。

### 7.5 行内链接 `link` 配色【实测 2026-10-25 · batch118 · `Cmd+K` 插入后读样式】

| 属性 | 实测值 | 说明 |
| --- | --- | --- |
| `color` | **`rgb(51,109,244)` = `#336DF4`** | 链接文字唯一色，与选中态同色 |
| `text-decoration-line` | **`underline`（在【外层容器】上，不是在 `a` 上）** | 见 §7.5.3 的分层真相：`a.link` 恒 `none`，外层 `.docx-outer-link-container.link-u` 才是载体 |
| `text-decoration-color` | **`rgb(51,109,244)`** | 与文字同色，非灰色 |
| `text-decoration-thickness` | `auto`（≈1.6px @16px） | 未单独设置 |
| `font-size` / `line-height` | **继承正文 16 / 28.8** | 链接**不放大不改行高** → 插链接不撑行距 |
| `cursor` | `pointer` | |

> 🔑 **双蓝分工，绝不可合并成一个 Token**：
> - **`#336DF4`** = 文字层强调 —— 行内链接文字 / 链接下划线 / 高亮色板面板「随机」文字 / 列表序号 / 部分选中态
> - **`#1456F0`** = 控件层强调 —— 主按钮填充 / 输入框聚焦描边 / 表格列宽拖拽线 / 色板选中描边
> 深色主题下同步双值：`#336DF4 → #4C88FF`（其余待 §11 补）。
>
> 🔑 **下划线用 `text-decoration` 而非 `border-bottom`**：换行时会自动按行断开（`border-bottom` 只画最后一行），这是长链接跨行的正确实现，复刻不要改。
>
> 🔑 **飞书把链接拆成三层嵌套 span**（见 [02 §15 ④-3](./02-块类型规格总表.md)），`link-start` / `link-end` 类用于标记区间首尾 —— 这是为了支持「一个链接横跨多个 inline 节点」时只在最外层画一次下划线。若你的编辑器能给 `a` 直接挂 `text-decoration`，**可以省略这三层**，视觉等价。

#### 7.5.1 链接相关的四个复用色（含已采过的）

| 用于 | 色值 | 是否已有 Token |
| --- | --- | --- |
| 链接卡 `440×42` 描边 | **`#DEE0E3`** | ✅ 复用 `--border-base`（表格网格线 / 行内代码描边 / 封面面板边框同值） |
| 链接卡「标题视图」右侧箭头 `item-arrow` 20×24 | **`#8F959E`** | ✅ 复用 `--text-tertiary`（气泡条 more 箭头同值） |
| 链接卡内 URL 文本项 | `#646A73` | ✅ 复用 `--text-secondary`（引用正文色） |
| 链接编辑条输入框聚焦描边 | **`#1456F0`** | ✅ 复用 `--brand-primary`（与分享弹窗输入框一致） |

#### 7.5.2 「标题视图」二级菜单【实测 2026-10-25 · batch128/129 · hover 卡内该项 2700ms】

**结论先说**：hover 卡里那项叫「标题视图」但是个**下拉触发器**，展开的是**链接的四种显示形态**——「链接视图 / 标题视图 / 卡片视图 / 预览视图」。早期把它猜成「把链接转成标题块」是错的（【待补】已作废）。

**容器三层**（与链接 hover 卡同一套壳，只换尺寸）：

| 层 | class | 尺寸 | 位置（视口 1512 实测） | 关键样式 |
| --- | --- | --- | --- | --- |
| 外层定位 | `.overlay-container` | **232 × 146** | @(783, 489) | `z-index: 600`，bg 透明 |
| 视觉壳 | `.docx-menu-wrapper.docx-menu-wrapper-animation` | 232 × 146 | @(783, 489) | **bg `#FFF`**，**radius 6px**，**z-index 999**，`line-height: 16px` |
| 内层容器 | `.docx-menu-container` | **230 × 144** | @(784, 490) | padding **8px** |

> 📐 **尺寸自洽校验**：`146 = 2×1(border) + 2×8(pad) + 4×32(item)` ✓；`232 = 2×1 + 2×8 + 214(item)` ✓。
> 📐 **两层 z 是硬要求**：外层 600（与命令条同级）、内层 999。只设一层会在表格/命令条里被压住。

**四个菜单项**（均为 `.panel-menu-item`，**214×32**，`padding: 4px`，`border-radius: 4px`）：

| # | 文本 | y | 左侧图标 svg | 状态标记 |
| --- | --- | --- | --- | --- |
| 1 | **链接视图** | 498 | 18×18（两条 path 10×10） | 常态 |
| 2 | **标题视图** | 530 | 18×18（无子 path） | **`.menu-item-actived`** + 右侧 `item-checked` |
| 3 | **卡片视图** | 562 | 18×18（path 15×14） | 常态 |
| 4 | **预览视图** | 594 | 18×18（path 14×14） | 常态 |

> 项间距恒 **32px**（498 / 530 / 562 / 594），x 起点 792 = `784 + 8(pad)`；item 右边界 1006 = `784 + 230 - 8` ✓。
> 图标色 **`rgb(43,47,54)` = `#2B2F36`**（注意：是 code 默认文本色，不是 `#1F2329`）。
> 内部结构：`.panel-menu-item` → `.menu-item-content`(206×24) → `.menu-icon`(24×24) + `.menu-item-main-box-wrapper`(166×22，**`margin-left: 16px`**) → `.menu-text`(166×22)。

**当前选中态的勾**（`.item-checked`）：

| 属性 | 值 |
| --- | --- |
| 尺寸 | **16 × 16**，定位于 item 右内边（@986，item 右界 1002 减 16） |
| 图标 | `span.universe-icon` 16×16 → svg 16×16 → path **13×9** |
| **颜色** | **`rgb(51,109,244)` = `#336DF4`** |

> 🔑 **`#336DF4` 第三次复用为「选中/激活」色**（前两次：链接文字、链接下划线）。它在飞书里承担的是「**当前值指示**」语义，不是「品牌主色」（`#1456F0`）。复刻时菜单勾选、单选选中、Tab 下划线一律用 `#336DF4`。

**hover 态**（父卡里那个「标题视图」触发器实测）：`background-color: rgba(31, 35, 41, 0.1)`，radius 4 —— 与代码块「自动换行」开启态**同一个值**，可复用 `--hover-fill: rgba(31,35,41,.1)`。

**一级卡 vs 二级卡尺寸差异（别混淆）**：

| | 一级链接卡 `.link-edit-container` | 二级视图菜单 |
| --- | --- | --- |
| 外框 | **440 × 42** | **232 × 146** |
| item 高度 | **24**（`menu-item-compact` / `is-link`） | **32**（`panel-menu-item`） |
| 用途 | 单行工具条（URL + 4 个按钮） | 多项竖向列表 |

#### 7.5.3 下划线到底挂在哪一层【实测 2026-10-25 · batch130 · 同一文档内两条链接逐层对比】

> ⚠️ **本文档此前有一处自相矛盾**：§7.3 记「链接无下划线」、§7.5 记「下划线常驻」。batch130 逐层 dump 后确认**两批测量都对，只是测了不同层**。

同一段落里两条链接，逐层读 `text-decoration-line`：

| 层 | 无下划线的那条 | 有下划线的那条 |
| --- | --- | --- |
| **外层** `span.outer-u-container.docx-outer-link-container` | `none`，class 无 `link-u` | **`underline`** / `rgb(51,109,244)`，class **含 `link-u`** |
| 中层 `span.link-wrapper.link-text-color.link-start.link-end` | `none`（装饰色 `#336DF4` 已预设） | `none`（同上） |
| 链接本体 `a.link.contextmenu-without-copyperm` | `none` | **`none`** |
| 最内 `span` | `none` | `none` |

> 🔑 **结论：`a` 永远 `none`。下划线的唯一载体是外层 `.docx-outer-link-container`，由 `link-u` 类开关。**
> `link-u` 里的 `u` = underline，对应二级菜单里「**链接视图**」这一形态（§7.5.2）。切到卡片视图/预览视图时该外层类会变、下划线随之消失。
>
> 🔑 **`Cmd+K` 新建的链接默认带 `link-u`（有下划线）**；本文档里早期由粘贴/自动识别产生的链接不带（无下划线）。所以「同一页面两种观感并存」是**形态差异不是 bug**。
>
> 📐 **复刻实现**：把 `text-decoration` 写在链接的**块级/行内包装器**上，用 `.ld-link--underline` 一个类控制；`a` 内部显式 `text-decoration: none`。这样切换四种视图只需换包装器类名，不用改 `a`。
>
> 📐 **链接高度随正文字号**：正文 16px 时链接 **156×19 / 162×19**；正文 14px 时 **126×18 / 134×18**。即高度 ≈ `字号 × 1.19`，**不是固定值** —— 复刻别写死 19px。

---

### 7.5.4 四个行内 mark 的**精确 style 串**（直接可抄）【实测 2026-10-25 · batch274 / batch275 · 气泡条逐项点击后读 `span[style]`】

> 这一节解决一个实现层的高频坑：**`text-decoration` 的写法不是只有 `underline` 一个词**。飞书对下划线和删除线都带了「避让 / 偏移」参数，少写就会和飞书差 1~2px。

| mark | 气泡条 `data-name` | 写入 `style` 的**完整串** | 附加 `class` | 备注 |
| --- | --- | --- | --- | --- |
| 加粗 | `Bold` | `font-weight:bold;` | — | **字面量是 `bold`，不是 `700`**（`getComputedStyle` 读回 `700`，但属性串里必须是 `bold`） |
| 斜体 | `Italic` | `font-style:italic;` | — | 无附加 |
| 下划线 | `Underline` | `text-decoration-skip-ink:none;text-underline-offset:0.2em;text-decoration: underline;` | **`underline`** | **三件套缺一不可**：`skip-ink:none` 让线穿过 `g/y/p` 降部；`offset:0.2em` 控线距基线距离 |
| 删除线 | `Strikethrough` | `text-decoration: line-through;` | **`strike-through`** | 注意 `line-through` 前**有空格** |

**叠加规则（batch274 三步实测）**：

| 状态 | `style` 串 | `spanCount` |
| --- | --- | --- |
| 仅 Bold | `font-weight:bold;` | **3** |
| + Italic | `font-style:italic;font-weight:bold;`（新 mark 插最前） | **3** |
| + Underline | `text-decoration-skip-ink:none;text-underline-offset:0.2em;text-decoration: underline;font-style:italic;font-weight:bold;` | **3** |
| **重载后（服务端规范化）** | `font-weight:bold;font-style:italic;text-decoration-skip-ink:none;text-underline-offset:0.2em;text-decoration: underline;` | **3** |

> 🔑 **两个必守点**：
> 1. **多 mark 必须合并到同一个 span** —— `spanCount` 恒 3（选中段 / 未选中段 / 行尾 `U+200B`），不随 mark 数增长。Tiptap 默认输出嵌套或兄弟节点，**必须自己实现合并序列化**（详见 [02 §15 ④-4](./02-块类型规格总表.md)）。
> 2. **序列化顺序按「服务端规范序」写**：`bold → italic → strike → underline`。编辑中瞬时 DOM 是「后加在前」，但落库/重载后飞书会归到规范序 —— **断言只认规范序**。

---

### 7.6 焦点环 Token【自定 · 飞书未暴露，属我方补全】

> **为什么单列**：`15 §9.3` 把 D9 定为 P2，理由是「焦点环会直接影响像素」。但实测结论是**飞书 web 端没有可复用的焦点环样式**——`§7.2 focus` 已证明块级 `.focused` 与常态五项全同（`outline: 3px none`）。也就是说**飞书把键盘焦点视觉交给了浏览器默认值**。
>
> 复刻时**不能也交给浏览器默认值**：浏览器默认 `outline` 是 `-webkit-focus-ring-color auto 1px`（Safari 是蓝色描边、Chrome 是黑色双环），跨端不一致且常被 CSS reset 掉（`outline: none`）。所以这里给一组**自定 Token**，明确标注「不是实测值」。

#### 7.6.1 Token 定义

```css
:root {
  /* 焦点环 —— 自定，非飞书实测 */
  --ld-focus-ring-color:   #1456F0;   /* 用品牌主色，不用 #336DF4（那是"当前值"语义） */
  --ld-focus-ring-width:   2px;
  --ld-focus-ring-offset:  2px;
  --ld-focus-ring-style:   solid;

  /* 兼容值：贴近宿主已有设计系统时覆盖这两项即可 */
  --ld-focus-ring-shadow:  0 0 0 var(--ld-focus-ring-width) var(--ld-focus-ring-color);
}

/* 唯一入口，全库只写这一条规则 */
.ld-focusable:focus-visible {
  outline: var(--ld-focus-ring-width) var(--ld-focus-ring-style) var(--ld-focus-ring-color);
  outline-offset: var(--ld-focus-ring-offset);
  border-radius: inherit;          /* 描边跟随控件圆角（4px / 6px），不额外造不规则 */
}
```

#### 7.6.2 三条硬约束

| # | 约束 | 原因 |
| --- | --- | --- |
| 1 | 一律用 **`:focus-visible`**，不用 `:focus` | `:focus` 会在**鼠标点击**后也画环 —— 飞书点击工具栏按钮没有任何环，用 `:focus` 会多出视觉噪声。`:focus-visible` 只在键盘导航时生效，与飞书观感一致 |
| 2 | **禁止全局 `outline: none`** | 代码里若出现 `*:focus { outline: none }` 又没补 `:focus-visible` 替代，等于把键盘可访问性彻底关掉。若必须 reset，只能写 `:focus:not(:focus-visible) { outline: none }` |
| 3 | 焦点环**不占布局** | 用 `outline` 而非 `box-shadow` / `border`。后两者会改变盒模型（哪怕 2px）导致悬停抖动；`outline-offset` 让它画在盒子外侧且不推挤邻居 |

#### 7.6.3 需要挂 `.ld-focusable` 的控件清单

| 区域 | 控件 | 备注 |
| --- | --- | --- |
| 气泡条 | 13 个项（含 4 个 submenu） | 项高 24，圆角 4 → 环也 4 |
| 子菜单 | `turninto` 12 项 / `align` 5 项 / `more` 7 项 / `highlight` 色块 | 项高 32，圆角 4 |
| 顶栏 | 标题输入 / 分享 / 更多 等按钮 | — |
| 工具栏 | 全部图标按钮 + 下拉触发器 | — |
| 正文 | **编辑器本体本身不挂** | 正文光标由 ProseMirror 自绘，不要抢 |

> ⚠️ **`highlight` 面板的色块是 26×26 / 22×22**：环 + offset 共 4px，色块间距若小于 4px 会互相压住。实测组内间距足够（§3.2.4 ④-4），但复刻时**改色板尺寸要同步验算间距**。

---

### 7.7 `prefers-reduced-motion` Token【自定 · 必须实现】

> **为什么必须做**：`15 §9.3` D9 的另一半。飞书 web 端**没有**处理这个媒体查询（实测 `matchMedia('(prefers-reduced-motion: reduce)')` 在飞书页面为 false 时无从验证其分支），所以这不是「复刻飞书」，而是「别让复刻品在无障碍设置下变成闪烁灾难」。
>
> **风险点是真实存在的**：气泡条与 4 个子菜单都是 `position: fixed` + 淡入/缩放，用户开着「减少动态效果」时连续展开会持续触发动画。

#### 7.7.1 Token 定义

```css
:root {
  --ld-motion-fast:    120ms;
  --ld-motion-normal:  200ms;
  --ld-motion-ease:    cubic-bezier(0.33, 0, 0.2, 1);   /* 弹出类统一曲线 */
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --ld-motion-fast:   0ms;
    --ld-motion-normal: 0ms;
  }
  /* 兜底：任何漏用 Token 的过渡/动画也一并关掉 */
  *, *::before, *::after {
    animation-duration:        0.01ms !important;
    animation-iteration-count: 1    !important;
    transition-duration:       0.01ms !important;
    scroll-behavior:           auto  !important;
  }
}
```

> 🔴 **用 `0.01ms` 而不是 `0ms`**：部分浏览器（旧版 Safari）对 `transition-duration: 0ms` 会**跳过 `transitionend` 事件**，导致依赖该事件关闭浮层的逻辑永久挂住。`0.01ms` 能被判定为「有过渡」从而正常触发事件，但人眼不可见。

#### 7.7.2 必须走 Token 的 9 处浮层

| # | 浮层 | 默认动画 | reduced 后 |
| --- | --- | --- | --- |
| 1 | 选区气泡条 | 淡入 + 4px 上移 | 直接出现 |
| 2 | `turninto` 面板 | 淡入 + 缩放 0.96→1 | 直接出现 |
| 3 | `align` 面板 | 同上 | 直接出现 |
| 4 | `more` 面板 | 同上 | 直接出现 |
| 5 | `highlight` 色板 | 同上（阴影更大，感知更强） | 直接出现 |
| 6 | 斜杠菜单 | 淡入 + 上移 | 直接出现 |
| 7 | 块菜单（拖拽手柄） | 淡入 | 直接出现 |
| 8 | 链接编辑卡 | 淡入 | 直接出现 |
| 9 | 全局 toast / 提示气泡 | 淡入 + 位移 | 直接出现 |

#### 7.7.3 唯一允许保留的动画

| 动画 | 为什么保留 |
| --- | --- |
| **协同光标移动** | 关掉会让远端光标「瞬移」，反而更难追踪；它是**位置指示**不是装饰。若实现成本高，可降级为「淡出后再出现在新位置」 |
| **折叠/展开箭头旋转** | 只旋转 90°，无位移，无闪烁风险。建议保 `--ld-motion-fast` 原值（120ms） |

> ⚠️ **其余一律 0**：包括 hover 背景色过渡。飞书 hover 本身几乎无过渡（`0.1` 是瞬时到位，`§7.1` 里「过渡中间帧」是子菜单展开动画外溢），所以关掉不影响还原度。

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
| **顶部「更多」菜单** | ✅ 外壳 175×820 **z1030**；根菜单 175×816 radius 6 border `#DEE0E3` pad `2px 0` **三层阴影**；普通项 **167×32** radius 4 pad `4px 8px` 图标 16×16 `#646A73`；子菜单项 173×32/34；**一级 23 项（当前租户；含「查看已存版本」）** | 见 [04 §4.2.1](../04-浮层与弹窗.md) |
| **分栏（grid）块** | ✅ 已采（slash `slash grid`，键盘选中插入） | 见 [02 §分栏](../02-块类型规格总表.md) |
| **「更多」4 个子菜单面板** | ✅ **3 个有面板**（下载为 120×108 / 文档权限 121×115 / 更多 198×142），**「翻译为英语」无面板**（是命令项，click 直接进入翻译模式）；hover **≥2000ms** 才展开，z **1050** | 见 [04 §4.2 ④-3](../04-浮层与弹窗.md) 与本文件 6.2 |
| **翻译模式改写「更多」菜单** | ✅ 160×344 / 项 152×32 / 分隔线 158×1，**9 项**；整体比普通态窄 **15px** → 菜单宽度**自适应，不可硬编码** | 见 [04 §4.2](../04-浮层与弹窗.md) |
| **气泡条 13 项顺序与绝对坐标** | ✅ 已采全（双击选词法）；**顺序陷阱**：Bold → **Strikethrough** → Italic → Underline（删除线在斜体**前**）；间隙：同组 32、跨分隔线 17、`more` 前 25 | 见 [03 §3.1 ④-2](../03-工具栏与菜单.md) |
| **highlight 按钮三层像素** | ✅ 热区 44×24 `rgba(31,35,41,0.05)` radius 4 / 图标位 24×24 `rgba(31,35,41,0.15)` / 色块 20×20 `rgba(255,246,122,0.8)` radius **2**；~~面板四种触发均打不开~~ → batch132/134 复核：**hover 不稳定、click 箭头位必开**，面板 **230×202** z600 | 见 [03 §3.2.4 ④-2/④-3](../03-工具栏与菜单.md) |
| **块 `focused` 态视觉差异** | ✅ **无任何视觉差异**（bg/shadow/border/outline/radius 全同），同目录 `.active` 结论 | 见 7.2 |
| **空块占位文案** | ✅ **不存在占位文案**（伪元素 content 为空串、无 `data-placeholder`）；只采到**占位色 Token `#BBBFC4`** | 见 7.2 |
| **表格完整规格** | ✅ 容器 820×83 / 实体 `TABLE.table` 300×81 / `border-collapse: separate` `border-spacing:0` / 首列 139 其余 100 / 高 41·40 / **单元格底透明** / 边框 T·R·B `1px #DEE0E3` + L `0`（`inset` 补左线）/ pad 8px / fs 12px / lh 21.6px / valign top | 见 **6.8** |
| **highlight 色板面板真实尺寸** | ✅ **230×262** @(723,472)，padding `4px 10px 12px`，bg #FFFFFF / 深 **#292929**，shadow 浅 `rgba(31,35,41,0.1) 0 6px 24px` / 深 `rgba(0,0,0,0.28) 0 6px 24px`。打开方式：**点块工具条 `callout-highlight` 后等 ~800ms**，不是 hover | 见 **1.5 / 1.5.1** |
| **深色模式下整套语义色板** | ✅ 4 行 × 8 色 = **32 色全采**（字体 / 边框 / 填充浅 / 填充深），与浅色**不是同色改透明度**，是各自独立的一套去饱和暗色 | 见 **1.5.1** |
| **飞书主色是「双值」** | ✅ 浅 **#1456F0** / 深 **#4C88FF**。交叉验证：色板选中态 border、表格 `.resizer-line`、面板「随机」文字色（#336DF4 / #4C88FF） | 见 **1.5.1** |
| **块级深浅对照（代码/高亮/表格）** | ✅ 已采全，5 条工程结论（外层恒透明 / 深色色层 #292929 比页面底 #1A1A1A **亮一档** / 表格底透明 / 主色双值 / **尺寸一律不变**） | 见 [11 §4.8](../11-主题切换.md) |
| **单元格底色冲突（原记 #F2F3F5）** | ✅ **判定为误读，作废**。batch90/91 浅深两主题复测 `TD` 均 `rgba(0,0,0,0)` | 见 **6.4 注② / 6.8.1** |
| **表格行 / 列 / 块手柄** | ✅ 全采：块手柄 44×30（白底 40×24）z9 / 行插入 16×40 @左外 24px / 列宽热区 10×81 + 线 2×81 **#1456F0** / 新增列符号 30×35 **z599** / 表头栏 300×10 | 见 **6.8.2** |
| **离屏 120×166 菜单（5 项）归属** | ✅ **就是帮助中心菜单**：`help-block.group-btns`（z60）→ `gpf-biz-help-center__*`，5 项 = 上传日志 / 联系客服 / 功能更新 / 帮助中心 / 快捷键，项 112×30，常驻离屏预挂载 | 见 6.2 末尾注 |
| **顶栏子面板 z-index** | ✅ **1050**，全站最高（压过一级菜单 1030） | 见 6.3 |
| **行内链接 `link` 配色** | ✅ **`#336DF4`**；**下划线挂外层容器 `.docx-outer-link-container.link-u`，`a` 自身恒 `none`**（batch130 分层实测，解开了 §7.3/§7.5 的矛盾）；字号行高继承正文、高度 = 字号×1.19；**`#336DF4`（文字层）≠ `#1456F0`（控件层）双蓝分工** | 见 **7.5 / 7.5.3**；三层 DOM 见 [02 §15 ④-3](../02-块类型规格总表.md) |
| **链接 hover 卡 / `Cmd+K` 编辑条** | ✅ 已采全：A 态 **440×42 z999**（`is-link` 184×24 + `edit-link` / `delete-ink` / `link-to-title` 108×24 / `item-arrow` `#8F959E` / `more`）、B 态 **434×82 z600**（pad 24 / input 280×32 `#336DF4` 聚焦 / 确认钮 80×32）；**卡宽恒 440 与 URL 长度无关** | 见 [04 §1.6](../04-浮层与弹窗.md) |
| **链接创建入口** | ✅ **`Cmd+K` 是唯一可靠入口**；「输入 URL + 空格」**不会**自动识别（batch114 实测 `a`/`href` 为空） | 见 [02 §15 ④-3](../02-块类型规格总表.md) |
| **行内字体色板 / 背景色板** | ✅ **8 字体色 + 16 背景色全采**（batch134）：面板 **230×202** z600 radius6 border `1px #DEE0E3`；字体色块 **26×26** radius4 步进 26、`path.fill` 即色值；背景色块 **22×22** radius2 两行 rely 0/30；组标题 **206×14 fs12**；「恢复默认」**204×24** radius6 fs12；hover 边框 `#C2D4FF`；**点选后不自动关闭** | 见 **§7.2.1** + [03 §3.2.4 ④-4](../03-工具栏与菜单.md) |
| **`textHighlight` mark 结构** | ✅ 单 span 双通道：`<span class="textHighlight textHighlight-{name}-text textHighlight-ccmtoken" data-string data-leaf>`，字体色 → `color`、背景色 → `backgroundColor`、**可叠加**；恢复默认 = 移除 `textHighlight*` 类 | 见 **§7.2.1** |

### 8.2 已定判 / 无需再采（原「仍未采到」清单 → **全部收口**）

> ✅ **本表 14 行已 100% 收口**：11 行「已采全」、3 行「已定判不做 / 属设计决策（非采集能解）」。**没有一项仍待采集**。

| 项 | 现状 | 采集建议 |
| --- | --- | --- |
| **顶部工具栏 `bear-web-toolbar` 按钮清单** | ✅ **已定判：不存在**（batch287 复核 `.bear-web-toolbar` 恒 0；页面根类 `bear-web-x-container catalogue-opened docx-in-wiki …`）。格式入口只有**气泡条 + 块工具条**，**V1 不做固定顶部工具栏** → [10 A13](./10-缺口与待补清单.md) | 无需再采 |
| **折叠块** | ✅ **已确认不存在**：slash **全量 84 节点（12 分类 + 72 项）**中无此块（旧记「90 节点 / 24 项 / 21 项」已作废）。折叠是标题/列表的**能力**，不是块类型 | 无需再采；`02 §12` 的 `details` 属 lark-doc 自有扩展 |
| **图片块 / 视频块默认宽与圆角** | ✅ **已收口**（batch313，走 `filechooser` 上传成功造块）：宽 = **`min(原图宽, 栏宽−20)`**（**不是固定 800**），圆角 0，`object-fit: fill`，小图（<3 KB）内联成 `data:image/png;base64,…`。13 层链 + 四角 `draggable-btn` 20×20 常驻 + `.image-area-container` 是点击热区 → [02 §11 ④-bis](./02-块类型规格总表.md) | 无需再采 |
| **highlight 色板面板真实尺寸** | ✅ **已采**（230×262），见 8.1 与 §1.5 | ~~需在选中带高亮文本时触发~~ 已解决：点 `callout-highlight` 按钮 |
| **引用 / 分割线 / 任务 / 无序 / 有序 五类块深浅规格** | ✅ **已收口**：五类块 light + dark 全采（主色双值 `#1456F0` / `#4C88FF`），逐类见 `02` 各节 ④ 与 [11 §4.9](./11-主题切换.md) | ~~batch93 采集中~~ 已完成 |
| **右键菜单（块上下文菜单）** | ✅ **已定判：飞书不做**（batch287 A1/A2/A3 三种块 `contextmenu` 的 `defaultPrevented` **恒 false**，浏览器原生菜单接管）⇒ **V1 不实现自定义右键菜单**，见 [03 §3.1 ⑥](./03-工具栏与菜单.md) | 无需再采 |
| **查找替换「More」三选项**（区分大小写 / 全字匹配 / 正则） | ✅ **已定判：飞书没有这三项**。`ud__tabs__tab-bar-more` 点开是**全局帮助菜单**（见 [04 §3.2 ④-3](./04-浮层与弹窗.md)），不是查找选项 ⇒ **V1 查找条不做这三个开关** | 无需再采 |
| **高亮块色板面板内部 DOM 层级** | ✅ **已收口（batch353/354 递归实测）**：完整 12 层树 + 32 色精确值 + 盒模型 26=22+2×2 + 选中/默认类名 + hover 三态 → [04 §1.2.1 ~ §1.2.6](./04-浮层与弹窗.md) | 无需再采 |
| ~~折叠块~~ | ✅ **已收口**：全量 84 节点中不存在，见上一行 | — |
| 行内「字体颜色」入口 | ✅ **已采**：唯一入口是气泡条 `highlight submenu`（44×24），**不在 `more` 内** | 见 **§7.2.1** + [03 §3.2.4](./03-工具栏与菜单.md) |
| 评论面板「更多」菜单 | ✅ 已采（见 [04 §7.3](./04-浮层与弹窗.md) 评论卡片六段式与「…」菜单）；**查找替换三选项已定判不存在**（同上） | — |
| **链接四种视图二级菜单** | ✅ 已采全：容器 **232×146** @z600（内层 999 / bg `#FFF` / radius 6），四选一「链接视图 / 标题视图 / 卡片视图 / 预览视图」，每项 **214×32** pad 4，勾选 `.item-checked` **16×16 色 `#336DF4`**，hover 底 `rgba(31,35,41,.1)` | 见 **7.5.2** |
| B22–B25 四项**定义缺口**（协同存储位置 / 快照配额 / capability 映射 / poster 生成） | 采集解决不了，属**设计决策** | 见 [10-缺口与待补清单.md](./10-缺口与待补清单.md)，需产品定夺 |

> **slash 菜单实测清单**（旧「一级 24 项」为**滚动可见部分**，非全量；以 [03 §3.4](./03-工具栏与菜单.md) 的 **84 节点 = 12 分类 + 72 项**为准）：文本 / 一级–三级标题（菜单内仅 H1–H3）/ 有序列表 / 无序列表 / 任务 / 代码块 / 引用 / 分隔线 / 分栏 / 高亮块 / 公式 / 表格 / 图片 / 视频或文件 / 电子表格 / 人员 / 群名片 / 云文档 / 日期提醒 / 日程 / 会议议程 …（完整 72 项见 03 §3.4）。

---
