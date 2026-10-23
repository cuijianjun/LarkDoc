# 标题

## 概述

标题组件覆盖文档标题与正文章节标题。正文标题支持 H1–H9 九个层级（H7–H9 渲染为带 `data-level` 的 `div`，导出 HTML 时 H1–H6 落到语义化标签）。

要区分两套结构：

| 能力 | 依据 | 说明 |
| --- | --- | --- |
| 目录（大纲） | **标题级别** | H3 / H4 挂到 H2 下面，跟缩进无关。 |
| 折叠 / 悬停高亮 | **缩进子树** | 只有缩进比它更深的块才属于它；同级缩进的 H3/H4 是兄弟块。 |

折叠与高亮**不是标题专属**：段落、列表项只要挂了缩进子块，同样能折叠并整块高亮；详见[折叠块](/blocks/folding)。

标题还能挂**编号**（飞书的「标题编号」= 给标题挂有序列表编号），编号是块级 UI、不在正文文本里，详见[标题编号](#标题编号)。

## 配置内容

```ts
new LarkDoc({
  element: '#editor',
  title: '未命名文档',          // 文档标题
  features: { headings: true }, // 关闭后标题菜单不可用
  toolbarKeys: ['headings'],    // 工具栏保留标题分组
  content: '<h2>二级标题</h2><p>正文…</p>',
})
```

## 配置说明

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `title` | `string` | `'未命名文档'` | 文档标题，长度受 `limits.titleLength`（默认 120）约束。 |
| `features.headings` | `boolean` | `true` | 关闭后工具栏与块菜单的标题入口隐藏。 |
| `toolbarKeys` 含 `headings` | `string[]` | 全部展示 | 工具栏裁剪，别名 `heading` / `title` / `paragraph` 等价。 |
| `limits.titleLength` | `number` | `120` | 标题最大长度。 |

### 使用方式

| 入口 | 操作 |
| --- | --- |
| 工具栏 | 「正文 / H1 / H2 / H3」快速切换。 |
| 斜杠命令 | 输入 `/` 后选择标题层级。 |
| 块句柄菜单 | 「转为正文 / 转为一级 / 二级 / 三级标题」。 |
| 快捷键 | `Mod+Alt+1..3`（详见快捷键面板）。 |

### 数据契约

- HTML：`<h1>`–`<h6>`；H7–H9 为 `<div data-type="heading" data-level="7">`。
- JSON：`{ type: 'heading', attrs: { level: 1..9, indent: 0..5, blockId: 'b7f3k2m1' } }`。
- `indent` 是块的缩进层级（0–5，每级 25px），决定折叠范围与悬停高亮范围；`Tab` / `Shift-Tab` 或 `⌘]` / `⌘[` 调整。能不能再缩一级由**前一个块**决定（见[段落样式 · 缩进上限](/blocks/paragraph#缩进上限)），减少缩进则不受限。
- 缩进缩的是**整块盒子**：导出 HTML 用 `margin-left`（不是 `padding-left`），块宽同步变窄，和飞书一致；悬停高亮与句柄位置都跟着块盒子走。
- 0–5 是硬上限，到顶后工具栏 / 气泡 / 块菜单 / 快捷键全部停住，导入的老数据会被压回 5。
- `blockId` 是块的稳定标识（所有块级节点都有），折叠状态、后续评论锚点 / 协同定位都按它引用块；详见[折叠块 · 块标识](/blocks/folding#块标识-blockid)。

## 标题编号

飞书的「标题编号」实质是**给标题挂有序列表**（开放平台模型里就是 `ParagraphStyle.list: { type: 'number', number, indentLevel }`），所以编号不是正文文本，而是一个 `contenteditable="false"` 的块级按钮：`getText()` 和复制出来的正文都拿不到它，标题文字里也没有数字。

编号值本身**不落库**，只存两个开关（`numbering` / `numberingStart`），每帧按文档现算：

- 删除、移动、插入带编号的标题后编号自动接续，不留空号，也不需要任何补丁事务；
- 只统计 `numbering: true` 的标题，没开编号的标题不占号；
- 三级格式与飞书一致：H1 `1.`（带尾点）、H2 `1.1`、H3 `1.1.1`（多级不带点）；
- 文档从 H2 开始时显示 `1.` 而不是 `0.1`（前导 0 省略）；
- 更深层级出现新编号时，下层计数归零。

### 三项编号菜单

点击蓝色编号弹出与飞书同款的三项菜单（标题编号和列表序号共用同一套菜单与文案）：

| 菜单项 | 语义 | 写入的 attrs |
| --- | --- | --- |
| 继续编号 | 跟随上文连续编号（已经是连续态时禁用） | `numberingStart: null` |
| 重新开始编号 | 该层从初始编号 1 重开 | `numberingStart: 1` |
| 设置编号的值 | 就地数字输入框，从该值起算 | `numberingStart: N` |

「设置编号的值」与飞书一致：菜单就地变成数字输入框并预填当前编号的末位，`Enter` 提交、`Esc` 放弃、`↑` / `↓` 步进；点菜单外部按**提交**算（输完直接点正文不会丢值）。取值范围 1–999。

### 入口

| 入口 | 操作 |
| --- | --- |
| 编号按钮 | 点击弹出三项菜单。 |
| 块句柄菜单 | 「有序列表」作用在标题上 = 开启标题编号（作用在正文上才是真转有序列表）。 |
| 快捷键 | `Cmd+Shift+7`（Windows `Ctrl+Shift+7`）切换标题编号。 |
| 命令式 | `editor.commands.setLarkDocHeadingNumber(pos, { numbering, numberingStart })` / `toggleLarkDocHeadingNumber(pos)`。 |

### 编号的数据契约

- JSON：`{ "type": "heading", "attrs": { "level": 1, "numbering": true, "numberingStart": 7 } }`
- HTML：`<h1 data-numbering="true" data-numbering-start="7">`；`numberingStart` 为 `null`（继续编号）时不输出该属性。
- 关闭编号时 `numberingStart` 一并清空，避免下次开启时莫名其妙从 7 起算。
- 只读态点编号不弹菜单；`features.headings` 关闭后同样不响应。
- 编号是纯视图装饰：进入 `getHTML()` 的只有属性，不影响正文内容、光标与撤销粒度。
- 折叠箭头与编号落在同一个行内位置，渲染顺序是飞书的「▾ 2. 标题」。
