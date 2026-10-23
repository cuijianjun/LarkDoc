# 工具栏配置

## 概述

工具栏用 `toolbarKeys` 白名单 / `toolbarExcludes` 黑名单裁剪，key 对齐 AiEditor 的写法。分组粒度对应工具栏的 12 个按钮区，行内格式额外支持按 mark 单独裁剪；常用别名（`heading`、`table`、`undo`）会自动落到正确分组，未知 key 记录在 `instance.unknownToolbarKeys`，不会导致初始化失败。

## 配置内容

```ts
new LarkDoc({
  element: '#editor',
  // 只保留这些分组（按顺序不生效，顺序由内部分组决定）
  toolbarKeys: ['history', 'headings', 'bold', 'italic', 'insert', 'tables', 'ai'],
  // 再剔除个别分组或 mark
  toolbarExcludes: ['shortcuts', 'highlight'],
})
```

## 配置说明

### 分组 key（12 个）

| key | 覆盖的按钮 |
| --- | --- |
| `history` | 撤销、重做 |
| `headings` | 正文 / 一级 / 二级 / 三级标题 |
| `marks` | 行内格式整组 |
| `textStyle` | 文字颜色、字号、链接 |
| `blockStyle` | 对齐、缩进、行高、清除格式 |
| `insert` | 插入菜单（图片、表格、代码块、公式、表情、分割线、列表等） |
| `tables` | 表格工具条 |
| `ai` | AI 组件入口 |
| `search` | 查找替换 |
| `outline` | 目录面板 |
| `viewModes` | 阅读、演示、全屏、宽度 |
| `shortcuts` | 快捷键帮助面板 |

### 行内格式 key（8 个）

`bold`、`italic`、`underline`、`strike`、`code`、`subscript`、`superscript`、`highlight`。

单独列某个 mark 时自动打开 `marks` 分组，并只保留列出的 mark。

### 常用别名

| 别名 | 落到 |
| --- | --- |
| `heading` / `title` / `paragraph` | `headings` |
| `table` | `tables` |
| `image` / `images` / `emoji` / `math` / `formula` / `codeBlock` / `taskList` / `bulletList` / `orderedList` / `blockquote` / `callout` / `columns` / `column` / `divider` | `insert` |
| `undo` / `redo` | `history` |
| `find` | `search` |
| `toc` | `outline` |
| `fullscreen` / `read` / `reading` / `preview` / `slides` / `theme` | `viewModes` |
| `help` / `shortcut` | `shortcuts` |
| `link` / `color` / `font` / `fontSize` | `textStyle` |
| `align` / `indent` / `lineHeight` / `clear` | `blockStyle` |

### 排除规则

| 写法 | 效果 |
| --- | --- |
| `toolbarKeys: []` | 不展示任何分组（`[]` 视为空白名单）。 |
| `toolbarExcludes: ['marks']` | 整组隐藏。 |
| `toolbarKeys: ['bold']` | 只留加粗，`marks` 分组仅显示加粗。 |
| `toolbarExcludes: ['highlight']` | 其余 mark 保留，仅隐藏高亮。 |

::: tip 与 features 的区别
`toolbarKeys` 只控制**入口可见性**；`features` 关闭的是**能力本身**（命令不可用、历史 JSON 仍可读）。要彻底禁用某项能力，请改 `features`。
:::

### 自适应折叠与自绘下拉

工具栏按**实际测量宽度**自适应两种形态（`ResizeObserver` 驱动，无需配置）：

| 场景 | 形态 |
| --- | --- |
| 宽度足够 | 全部分组依次平铺（默认形态）。 |
| 宽度不够 | 从低优先级分组开始（视图与工具 → 插入 → 段落 → 文本样式 → 格式 → 标题 → 历史）整组收进末尾「更多 ▾」弹层，按组分节展示；宽度恢复时逆序自动展开。 |

全部下拉（字体 / 字号 / 行高 / 页面宽度 / 代码语言 / 单元格对齐 / 字数上限 / 模板 / 导出等）均为自绘组件（触发按钮 + fixed 定位选项列表），不再使用原生 `<select>`：支持键盘 ↑↓ / Enter / Esc、点击外部关闭、当前值 ✓ 高亮，且 `mousedown.prevent` 保证编辑器选区不丢失。

## 按宿主裁剪（各环境写法）

`toolbarKeys` / `toolbarExcludes` 与宿主无关，但**不同引入方式把配置传进去的位置不同**：命令式入口走 `new LarkDoc(options)`，SFC 走 `config` prop，Web Component 走 `el.options`。各环境可直接粘贴的完整 demo 见[各环境引入对照](/guide/environments)。
