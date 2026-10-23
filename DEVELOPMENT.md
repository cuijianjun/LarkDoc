# lark-doc 开发备忘（踩坑清单 / 回归防护）

这份文档是**写代码前必读**的防回归清单：每一条都是真实修过的 bug，写清了「症状 → 根因 → 唯一正确写法 → 由谁守护」。
改任何 UI / 交互 / 文档模型之前，先在这里找到对应域，确认自己没有把已修的问题再写回来。

当前版本：**0.9.1**

---

## 1. 环境与校验链

```bash
export PATH=$HOME/.nvm/versions/node/v14.21.3/bin:$PATH
cd apps/lark-doc
env -u NODE_OPTIONS npm run check     # 全量：offline → lark-doc → architecture → lint → build×4 → vditor
env -u NODE_OPTIONS npm run build     # 只构建
```

- **开发/构建环境只需 Node `>= 14.21.3` + npm `>= 8.19.4`**（`check-node14.js` 只做最低版本门禁，Node 20 等更高版本同样合法）；接入方运行时同样 `>=14.21.3`（`engines` 已放宽，ES2022+ API 由入口 core-js polyfill 补齐）。`env -u NODE_OPTIONS` 不能省（WorkBuddy 的 NODE_OPTIONS shim 会让 webpack 报错）。
- `npm run check` 必须 **EXIT=0 且 0 error**（warning 也要清掉）。
- demo 在 `apps/vue2-webpack-node14`（Node14 `npm run dev`，端口 8080，路由 `/lark-doc`），**通过软链加载 dist**，改源码后必须 `npm run build` 才能看到效果。
- 浏览器验证脚本用 **Node22** + `NODE_PATH=/Users/cjjxw/.workbuddy/binaries/node/workspace/node_modules` + `playwright-core`；dev server 必须用后台方式启动。
- 本环境里 bash `grep` 偶发空结果，重要判断用 Read / Grep 工具交叉确认。

## 2. 代码结构约定

- 编辑器主 SFC `LarkDocEditor.vue` 只留模板 / props / watch / 生命周期 / 内容管理；**UI 子域逻辑一律进对应 mixin**（`editor/` 目录：viewModes / commandMenu / tableTools / blockHandle / blockMenu / bubbleMenu / calloutColor / toolbarMenus / toolbarCollapse / headingNumber）。
- 图标唯一来源 `editor/icons.js`（16×16、stroke currentColor 1.5），组件用 `<lark-doc-icon name="...">`；**新增图标必须先注册**，模板引用未定义图标会渲染成空 span（不会报错，极难发现）。
- 下拉唯一原语 `LarkDocSelect.vue`，不要再写原生 `<select>`。
- 协同 / 权限走门面：`new LarkDoc({ session | providers/documentId/user/mode/capabilities })`，`doc.getSession()/can()/connectCollaboration()`，架构测试 `check-architecture.js` 守卫。

---

## 3. 回归防护清单

### 3.1 折叠 / 悬停高亮

| # | 症状 | 根因 | 正确写法 |
|---|---|---|---|
| P1 | 高亮完全看不见，但内联尺寸都有 | overlay 挂在 `.lark-doc-editor-content` 下，是 `.ProseMirror` 的**兄弟**，CSS 写成 `.lark-doc .ProseMirror .lark-doc-heading-hover-overlay` 整组不命中 | 选择器**不能**带 `.ProseMirror` 前缀 |
| P2 | 「看起来生效」其实是假绿 | 断言读了 `element.style.width` | 几何断言必须读 `getBoundingClientRect()` + `getComputedStyle().backgroundColor` |
| P3 | 折叠/高亮只对标题生效 | 把范围按 heading level 算 | 范围 = **缩进子树**，与块类型无关；入口 `TEXT_FOLD_TYPES` + `isFoldableBlock` + `foldedRange`，装饰层与 `handleHighlightRange` 共用 |
| P4 | 刷新后折叠状态丢失 | 持久化闸门写错 | 三闸门：`_foldsReady` 未就绪不写 / 读到偏好但零命中不写 / `foldableIdPositions(doc).size === 0` 不写（旧版第三个闸门写成「文档无 heading」，导致无标题文档的非标题折叠不落盘） |
| P5 | 同名标题折叠互相串 | 折叠键用「层级+文本+同名序号」派生 | 折叠集合 = `Set<blockId>`；旧 localStorage 派生键只在 `foldLarkDocByKeys` 里迁移 |
| P6 | 标题/段落后的**未缩进列表**没有折叠箭头（0.9.1） | 列表继承宿主的 `sectionIndent`(0)，子树判定里 `effective <= baseIndent` → 判成兄弟 | 宿主为**文本块**（段落/标题）时，未缩进列表算隐式子块：`effective = max(indent, baseIndent+1)`；同时 **`previousIndent = indent` 用原值**，否则后续兄弟基准被抬高 |
| P7 | 修 P6 后「代码块按整体外框命中」失效、列表后的代码块被吸收 | 把隐式 +1 做成全局规则 | 隐式子块**必须限定 HOST_IS_TEXT**（段落/标题），代码块不做宿主 |

- 块目标唯一入口：`documentOperations.resolveBlockTargetRange`（表格 > 列表 item > callout/blockquote/details/columns > 顶层块），不要再各处写内联容器判定。
- 高亮几何一律用编辑器自持 overlay（`.lark-doc-block-hover-segment` / `.lark-doc-heading-hover-segment`）绘制；**禁止写成块内联 CSS 变量**——装饰变化会重建 DOM 并擦掉内联变量。
- 折叠偏好落在 `localStorage['lark-doc:folds:<documentId|local>']`，Workspace 显式传 `fold-persist-key`。

### 3.2 blockId（块稳定标识）

- 所有「可视块」带 `attrs.blockId`（类型见 `BLOCK_ID_TYPES`）。**列表项是特例必须编号**（飞书把 `fold-block-id` 挂在 item 上）；结构性容器（tableRow / tableCell / column / detailsContent）刻意不编号。
- 补号唯一入口：插件 `appendTransaction` + `collectBlockIdFixes(doc, {doc: oldDoc, mapping})` + `ensureLarkDocBlockIds`（初始挂载 / setContent 各调一次）。补号事务带 `addToHistory:false` 与 meta `larkDocBlockIds`，宿主据此不冒泡 change。
- 三个易错点：
  1. `appendTransaction` 只能挂在 **plugin spec 顶层**，放进 props 不生效；
  2. `Mapping.appendMapping` **无返回值**，别写进 reduce；
  3. 块起始位置映射用 `assoc = +1`。
- 表格的 `data-block-id` **不进 DOM**：prosemirror-tables 的 TableView 自建 `<table>` 且不回写 attrs，浏览器断言要按此口径扣掉表格数。

### 3.3 块缩进

- 上限语义 = **前一个兄弟块的有效缩进 + 1**，硬上限 `MAX_BLOCK_INDENT = 5`（第 6 层，每级 25px）。
- 增加用 `stepBlockIndent`，**不要用 `clampBlockIndent` 做增加**（老数据超顶会被压回 0，出现「减一级没反应 / 跳 0」）；减少只受 0 下限约束。
- 缩进必须写 **`margin-left`**（不是 `padding-left`）：飞书缩的是块盒子，padding 会让盒子保持整列宽，悬停高亮与句柄几何全错。代码块同理。
- 列表 `Tab` 下沉要卡 `listItem` 祖先数 ≥ 5；`changeIndent` 要按「最近一个带 indent 的节点」找目标，否则代码块走工具栏无效。
- 老数据 / 外部 JSON 的超限缩进靠 `normalizeLarkDocIndents()`（meta `larkDocIndentNormalized`，`addToHistory:false`）在挂载与 setContent 后压回。
- 取块节点唯一入口 `nodeAtSafe(doc, pos)`（`doc.nodeAt` 在正文整体替换后会抛 `RangeError` 把渲染打崩）。
- 探针定位：空文本块光标用 `nodeAt + 1`，`+2` 会落到 doc 层导致误判「按钮禁用」。

### 3.4 编号（标题 + 列表）

- 标题编号是**装饰按钮**（`contentEditable=false`，`Decoration.widget(pos+1)`），编号值**不在正文文本里**，`getText()` 拿不到；模型只存 `numbering`(bool) + `numberingStart`(1..999 | null=继续)，每帧 `computeHeadingNumbers(doc)` 现算。
- 格式 `1.` / `1.1` / `1.1.1`（只有一级带尾点，前导 0 省略）；颜色 `#1456f0`，字号跟随标题。
- 列表标记也走装饰层（`.lark-doc-list-number` / `.lark-doc-list-bullet`），**必须关掉原生 marker**：原生 `::marker` 在 padding 里不占行内空间，会被六点句柄盖住。
- 序号按层级 `1.` / `a.` / `i.`，`<ol start>` / item 的 `numberStart` 起算，入口 `computeOrderedListNumbers` / `computeBulletItems`。
- 标题与列表序号**都可点**，共用 `heading-number-menu`（`kind: heading | list`，写入口 `applyBlockNumberStart`）；菜单三项文案固定为「继续编号 / 重新开始编号 / 设置编号的值」。
- hover 样式（0.9.1）：hover = `rgba(20,86,240,.1)` 背景 + 蓝色下划线（1.5px）；所属块 hover 时编号给更浅的 `.08` 背景。padding `0 2px` 与 `margin-left:-2px` 互相抵消，保证编号文字位置不变。
- **就地输入框踩坑**：Enter 提交后再触发一次 blur（input 卸载）会拿空 draft 把值覆盖成 1 → 必须有 `headingNumberApplying` 提交闸门 + 空值直接放弃；点菜单外部在编辑态按「提交」处理。
- **「继续编号」的两种语义**（`continueLarkDocListNumber`）：① item 自己有 `numberStart` → 清掉；② item 是列表首项且前面**紧邻**另一个 `ol` → 给列表打 `continueFrom`，由 `computeOrderedListNumbers` 接着前一个列表的末号排（不写死数字）。相邻两个列表都显示 `1.` 时点「继续编号」没反应就是这个缺口：只清起点等于什么都没做。
- **菜单的 `canContinue` 必须读实时状态**（`nodeAtSafe(editor.state.doc, pos)`，不能闭包里的 `state`）：同标签的编号会复用同一个 widget DOM，闭包捕获的是建 DOM 那一帧的旧状态 —— 设过起点后仍判成「已连续」，「继续编号」被误禁用、点了没反应。
- 标题编号的 `data-tooltip` 气泡必须靠**编号按钮自己的 `position: relative`** 定位：按钮是 static 时 `::after`（absolute）会挂到 `.ProseMirror` 上，气泡永远画在正文左上角、不跟数字。
- `button.lark-doc-list-number` 要显式 `min-height:0`（全局 button 30px 最小高会把行内序号撑开行高）。
- **顶层列表要「向后缩进一格」**：`ol` / `ul:not(taskList)` / `ul[taskList]` 的 `padding-left` 是 **24px**（不是 0）；序号是 `li > p` 内的装饰 widget，跟着 `li` 随 padding 右移。嵌套列表再 +24px（每层 24px，与块缩进的 `margin-left` 是两套独立体系，别混）。
- **任务列表复选框、callout emoji 都要和「首行文字」居中对齐**，别用 `margin-top` / `line-height: 1.2` 硬凑：
  - checkbox：`li > label` 给 `height: 1.8em`（= 正文行高 28.8px）+ `align-items: center`，`margin: 0`。旧写法 `margin: 10px 0 0` 会让框整体下沉 **10px**；`min-height: 28px` 也一并去掉。文字换行时仍锚定第 1 行。
  - callout `::before`：`font-size: 20px` 配 `line-height: 1.44`（= 28.8px，与正文首行等高），`1.2` 会让 emoji 比文字高 **3px**。
  - 量测口径：拿 `Range.selectNodeContents(块)` 的第 1 个 rect 当「首行行盒」，比它的中心与控件的 `getBoundingClientRect()` 中心，阈值 1px。见 `scripts/verify-browser-icon-align.js`。

### 3.5 弹窗 / 菜单 / 气泡条

- 块菜单（六点句柄）= AI 行 → 类型 icon 网格 → 创建副本 → 缩进/颜色子菜单 → 操作列表。**表格走独立分支**：隐藏类型网格 / 副本按钮 / 缩进颜色，改为「标题行、标题列开关 + 均分列宽」。
  - 表格命令先把光标落进表格首个 textblock 再调 `tableAction`；
  - 均分列宽**选区必须扩到首格→末格**，否则 `selectedRect` 只罩 1 列，均分按 1 列算；
  - 开关项点击后**保持菜单展开**（`clearBlockMenuCloseTimer()` + `handleHovering = true`）；
  - 事务重渲染会派生一次**假 mouseleave**（鼠标没动）触发 180ms 关闭定时器 → 用 `_keepMenuThroughRender` 350ms 窗口抑制。
- 气泡条（划词）= 飞书六段：AI｜标题级别▾｜对齐▾｜B S I U `</>`｜高亮 A + 取色▾｜复制；高亮复用 `toggleColorPalette('textBackground')`。
  - 气泡只在 `editor.isFocused` 时显示，**程序化 `setTextSelection` 点不亮**，浏览器探针必须真实 `page.mouse` 拖拽。
  - **标题级别与「缩进和对齐」两个下拉都「悬停 / 聚焦 / 点击」三入口展开**（飞书口径），别只留 `@click`；标题下拉 = 正文 + 一~九级标题共 10 项（少一级就会「工具栏能设、划词改不回来」）。
  - **标题级别下拉 = 工具栏与气泡条共用 `LarkDocHeadingMenu.vue`**（同一份选项 / 观感 / 选中态）。以前两处各写一套，分叉成「气泡条 152px、内边距 6、行高 32、蓝字选中」对「工具栏 155px、5、30、绿底」——同功能必须同款，改样式只改这一处（`.lark-doc-dropdown` + `.lark-doc-heading-menu`），别再往模板里抄第二份。
  - 菜单项要显式 `justify-content: flex-start`：`.lark-doc-tools button` 的 `justify-content: center` 会漏进工具栏那份菜单，导致项内容居中、气泡条左对齐，两边差 21px。
  - **下拉开 / 关**：鼠标离开触发器或弹层 160ms 后关闭（`scheduleBubbleHeadingClose` / `scheduleBubbleAlignClose`），跨 6px 间隙不闪；`openBubble*` 先 `cancelBubbleHoverClose()`。
  - **箭头与工具栏同款**：`chevronDown` 12px（不是 `caretSolid` 8px 实心三角），加 `lark-doc-caret` class 复用全局 `[aria-expanded="true"]` 的 180° 翻转。
  - **浮层要避让吸顶栏**：`bubbleSafeTop()` 取 `.lark-doc-topbar`/`.lark-doc-toolbar` 里 `position: sticky|fixed` 且 `top<=1` 的底边 + 6，作为菜单 `top` 的 clamp 下界；气泡条自身在上方放不下时翻到选区下方（`endCoords.bottom + 10`），否则会钻进工具栏。
  - 量测箭头尺寸要在 hover 后等 ≥700ms：`transform` 过渡未完时 `getBoundingClientRect()` 包围盒偏大（12×12 会量成 13×13）。
  - 列表项点标题 → `convertListItemToBlock`：`liftListItem` 提出列表 → blockId 重定位 → setNodeMarkup。**定位 listItem 别用 `$start.before($start.depth - 1)`**：`doc.resolve(paragraphPos)` 在块边界 depth 会少一层，会算成 ol 的 pos（拿不到编号）；要向上逐层 `node(depth).type.name === 'listItem'`。lift 后有序序号落到标题编号（`numbering`+`numberingStart`），紧跟的列表写 `start: index+1` 接号。
- 所有浮层（dropdown / select-menu / block-submenu / command-menu / template-list / bubble-align / heading-number-menu）**不显示滚动条**：`scrollbar-width:none` + `::-webkit-scrollbar{display:none}` + `overscroll-behavior:contain`。长列表靠分组/收纳控制条数。
  - 断言注意：`rect.width - clientWidth = 2px` 是**边框**不是滚动条，要减去 border。
- 命令组件入口：`__larkDoc.getWorkspace().$refs.document.executeCommand(id)`；`getEditor()` 是 Tiptap 实例。

### 3.6 排版（行距 / 字号，飞书实测）

| 块 | font-size | line-height | margin |
|---|---|---|---|
| 正文 `p` | 16px | 1.8（28.8px） | `0 0 8px` |
| H1 | 26px | 1.4（36.4px） | `26px 0 10px` |
| H2–H6 | 22 / 20 / 18 / 16 / 14px | 1.4 | `1em 0 8px` |

- `.ProseMirror` 全局 `line-height: 1.8`。以上数值取自飞书线上文档实测（页面大标题 34px/55.25px 属页面级，不在正文块内）。**不要凭手感改回 em 值或 1.75**。

### 3.7 持久化 / 兼容 / 离线

- 落库是 **ProseMirror JSON**（`{type:'doc',content:[...]}`），不是 HTML/Markdown；同段内容 JSON ≈ HTML 的 2.3 倍。
- provider 五方法 `load / save / snapshots / snapshot / restore`；`save(value)` 收到 `{title, json, updatedAt}`。
- **`LarkDoc` 门面没有 `record()`**，`record()` 只在 `LarkDocWorkspace`；`on('save')` payload 只有 `{status, manual, target, savedAt}`，**不含正文**（走 `getJSON()` 或 `change` 事件的 `{html, json, text}`）。
- 字段两套别混：落库用 `json`；导出 .json 文件用 `{schemaVersion, title, document}`，导入侧 `value.document || value`。
- Vditor 兼容**只做导入方向、只支持 `getHTML()`**（wangEditor 兼容已在 0.4.0 移除）：归一化层必须跑在 `sanitizeHTML` **之前**（class 白名单只有 `language-*` 与 `tiptap-mathematics-render`），产物用 `data-type` / `data-latex` / `data-checked` 承载语义。
  - 拆任务列表按「连续段」重建并插成**原列表的兄弟节点**（插进 `<ul>` 内部是非法嵌套）；任务项内容约束 `paragraph block*`，首子节点是 `<ul>` 时要把开头行内内容包成段落。
  - 表格 `colwidth` 个数必须等于 `colspan`，否则整条被丢弃；Vditor 不带列宽 → 按 720/列数 均分。
  - 幂等靠「转换时擦掉指纹」：`vditor-*` / `language-math` / `footnotes-*` 全清。
  - 不支持 plantuml（远程服务违反离线守卫）/ echarts（需执行 JS）/ graphviz（wasm）；图表统一降级 `pre > code.language-*`。
- 网络策略默认 `open`（正文媒体直连）；静态资源（KaTeX 字体、highlight.js、Emoji）**始终本地化**，由 `npm run check:offline` 守卫。
- **WC 宿主的 `title` 属性读完必须摘掉**（`LarkDocElement._stripTitleAttribute`）：自定义元素是 Light DOM 且铺满整个编辑器，`title` 是 HTML 原生 tooltip，留着它鼠标划过正文任意处都会弹一个灰色「文档标题」气泡（看着像编辑器自己画的假 tips）。摘除会再触发一次 `attributeChangedCallback`，用 `_titleAttrMuted` 吞掉；值另存 `_titleAttrValue`，实例重建（theme / content-format 变更）时补回，否则标题被清空。

### 3.8 图表（mermaid）

- vendored UMD（`src/assets/vendor/`）**必须排除在 babel 之外**（包与宿主 `vue.config.js` 都要 `rule('js').exclude.add(...)`），否则 core-js require 注入会让浏览器端脚本崩溃。
- 浏览器端识别 `.lark-doc-diagram` 预览层，不是 `code.language-mermaid`（node-view-content 不渲染 code 元素）。
- `flowchart / class / state` 用 `{ htmlLabels: false }` + 显式字体栈（mermaid 默认栈 + CJK 兜底，**禁止 'inherit'**）；标签是 SVG `<text>`，不要再加 foreignObject CSS 隔离规则（已删除）。

---

## 4. 验证资产

| 脚本 | 项数 | 覆盖 |
|---|---|---|
| `scripts/check-lark-doc-core.js`（随 `npm run check`） | — | 折叠子树 / 编号 / 缩进 / 命令等核心断言 |
| `scripts/check-vditor-html.js`（`check:vditor`） | 91 | Vditor HTML 导入 |
| `scripts/verify-browser-highlight-fold.js` | 74 | 悬停高亮 + 折叠（含几何） |
| `scripts/verify-browser-heading-number.js` | 38 | 标题编号菜单 / 交互 |
| `scripts/verify-browser-heading-menu.js` | 16 | 标题级别下拉（工具栏 ⇄ 气泡条）必须同款 |
| `scripts/verify-browser-list-marker.js` | 23 | 列表标记 |
| `scripts/verify-browser-list-number-menu.js` | 30 | 列表序号可点 + 浮层无滚动条 + 跨列表接号 |
| `scripts/verify-browser-icon-align.js` | 7 | 图标 / 控件与首行文字的垂直居中（任务框、callout emoji、列表标记、气泡条按钮） |
| `scripts/verify-browser-mermaid.js` | 12 | 图表渲染 |
| `scripts/verify-browser-element.js` | 14 | WC / element 场景 |

- 新增 UI 行为**顺手加断言**，不要只靠截图；截图只用于视觉核对。
- 文档站 `apps/lark-docs`（VitePress），构建被 safe-delete shim 拦时用 `--outDir docs/.vitepress/dist-check` 绕过；预览 `npx vitepress preview docs --port 4173`（不要用 `python -m http.server`，干净链接会 404）。

---

## 5. 打包与体积（优化结论 / 踩坑）

- **禁止给本包加 `sideEffects` 字段**（含 `sideEffects: false` 或白名单数组）。实测声明后本包自己的 webpack 构建（`build:esm`）把入口当无副作用裁剪，ESM 主包 raw 从 371KB 暴跌到 57KB、gzip 97KB→10KB，产物残缺。原因：本包入口通过 `import '../style.css'` 等副作用引入样式/资源，webpack 用它做 tree-shaking 时误判。**样式契约已由 `exports` 的 `./style.css` 子路径导出承担，宿主显式 `import 'lark-doc/style.css'`，无需靠 sideEffects。**
- **体积预算用 size-limit 8.2.6**（Node 14 下最新可用版；14.x 要求 Node ≥22.19，8.x 支持 `^14.0.0`）。配置在 package.json `size-limit` 字段，gzip 口径：ESM 110KB / UMD 300KB / Element 330KB / CJS 1100KB，超预算 exit 1。已挂进 `check` 与 `prepack`（`npm run size`）。测量的是**已构建的 dist 文件**（`@size-limit/file`，path 用 glob），必须 `build` 后跑。
- **Rspack/Rslib 已否决**：全部版本要求 Node ≥16（最新 ≥20.19），与本包 Node 14.21.3 硬约束冲突；且实测全量构建仅 53s，5-10x 加速省 43s，不值当。
- **starter-kit 扩展「瘦身」不可行**：`@tiptap/starter-kit` 顶层无条件 import 全部 21 项，`configure({ xxx: false })` 省不了体积（已进 bundle）。逐一排查确认 blockquote/horizontalRule/underline/strike/hardBreak 等均在工具栏/气泡条/导入导出被真实使用，dropcursor/gapcursor/trailingNode/undoRedo 来自 `@tiptap/extensions` 合并包（单扩展仅 226B，删了省不到 1KB 却损失撤销/光标体验）。`tiptap.esm.js` 135KB gzip 实为 prosemirror-view/core/model/state 内核，不可优化。
- **tiptap 3.32.0 升级**：20 个 `@tiptap/*` 统一版本，补齐 heading/ordered-list/code-block 三个隐式传递依赖为显式声明；`@tiptap/extensions` 仅合并 8 个杂项扩展（character-count/drop-cursor/focus/gap-cursor/placeholder/selection/trailing-node/undo-redo），heading/table/image 等核心扩展仍独立发布，不可迁移。
