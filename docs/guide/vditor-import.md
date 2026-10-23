# 旧数据导入（Vditor）

## 概述

Vditor 的主存储格式是 Markdown，但对外的 HTML 导出（`getHTML()`）里保留了它自己的扩展语义，这些结构不是标准 HTML，直接塞进 Tiptap 会丢内容或错语义：

| 旧结构 | Vditor 产物 | 直接解析的结果 |
| --- | --- | --- |
| 行内公式 | `<span class="language-math">E=mc^2</span>` | 变纯文本，`inlineMath = 0` |
| 块公式 | `<div class="language-math">\int…</div>` | 变普通段落，`blockMath = 0` |
| 任务列表 | `<li class="vditor-task"><input type="checkbox">` | 复选框丢失，退化成普通列表 |
| 图表 | `<div class="language-mermaid">graph TD…</div>` | 脱离代码块，换行被折叠 |
| 脚注 | `<sup class="footnotes-ref"><a href="#footnotes-def-1">1</a></sup>` | 变成指向中文的死链 |
| 目录占位 | `<p>[TOC]</p>` | 残留字面量 |

本包内置归一化层：**默认自动识别**（`contentFormat: 'auto'`）这类 HTML，在 `sanitizeHTML` 之前改写成本 schema 的契约，再交给 ProseMirror 解析。业务代码无需改数据、无需预处理。

::: tip 只处理 HTML
只支持 `getHTML()` 导出的 HTML。Markdown（`getValue()`）与 Lute AST（`exportJSON()`）不在范围内——如果手里是 Markdown，先调 `vditor.getHTML()` 再导入。
:::

## 配置内容

```ts
import { LarkDoc, isVditorHtml, normalizeVditorHtml } from 'lark-doc'

const html = vditor.getHTML() // Vditor 导出的 HTML

// 1. 自动识别（推荐）：命中指纹才转换，普通 HTML 完全不受影响
const doc = new LarkDoc({
  element: '#editor',
  content: html,
  // 默认 network.mode = 'open'，旧图床的 http 图片直接显示，无需额外配置
  onImportReport: (report) => console.log('转换报告', report),
})

// 2. 强制按 Vditor 结构归一化（数据来源明确时使用）
doc.importVditor(html)

// 3. 单独预处理，再交给任何编辑器 / 后端
if (isVditorHtml(html)) {
  const { html: normalized, report } = normalizeVditorHtml(html)
  console.log(normalized, report)
}
```

## 配置说明

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `contentFormat` | `'auto' \| 'vditor' \| 'html'` | `'auto'` | `auto` 按指纹识别；`vditor` 强制归一化；`html` 明确跳过归一化（Word 粘贴误判时用）。 |
| `onImportReport` | `(report) => void` | - | 转换完成回调，等价事件 `import-report`。 |

### 实例方法与导出

| API | 返回 | 说明 |
| --- | --- | --- |
| `doc.importVditor(html)` | `boolean` | 强制按 Vditor 产物导入，跳过指纹检测。 |
| `doc.getImportReport()` | `object \| null` | 最近一次转换统计；非旧数据为 `null`。 |
| `doc.setContent(html, { format })` | `boolean` | 按指定 `format` 写入内容。 |
| `isVditorHtml(html)` | `boolean` | 指纹识别，命中 `vditor-*` 类名 / `language-math` / 图表 `language-*` / `footnotes-*` 之一。 |
| `detectLegacyHtml(html)` | `{ legacy, source }` | `source` 目前为 `'vditor'` 或 `null`。 |
| `normalizeVditorHtml(html, options?)` | `{ html, converted, report }` | 纯函数式归一化；`options.force` 强制、`options.skip` 跳过。 |

### 转换映射表

| 旧结构 | 转换后 | 说明 |
| --- | --- | --- |
| `span.language-math` | `span[data-type="inline-math"][data-latex]` | 公式源码进 `data-latex`，KaTeX 由节点视图渲染。 |
| `div.language-math` | `div[data-type="block-math"][data-latex]` | 同上，独占一行。 |
| `li.vditor-task` + `input[type=checkbox]` | `ul[data-type="taskList"] > li[data-type="taskItem"][data-checked]` | 连续任务项合并为一个清单；普通项留在原 `<ul>`；隐藏 checkbox 移除。 |
| `div.language-mermaid` 等 | `pre > code.language-mermaid` | 转为 mermaid 代码块，源码完整保留（含换行）；配合 `features.diagram` 可渲染成图表。 |
| `table` | 单元格补 `colwidth` | Vditor 不输出列宽，按列数均分（720 / n）；单元格内补 `<p>`。 |
| `sup.footnotes-ref > a` | `sup` | 去掉指向定义区的死链，保留上标数字。 |
| `div.footnotes-defs-div` | 拆壳 | 移除 `↩` 回跳链接，保留分隔线与有序列表。 |
| `p` 内只有 `[TOC]` | 移除 | 本包有自己的大纲面板；计入 `report.dropped`。 |
| `video` / `audio` / `iframe` | 段落 + 原地址链接 | schema 无媒体节点，降级但不丢地址。 |
| `vditor-*` 类名、`data-block` 等内部属性 | 移除 | 避免污染导出 HTML，同时保证幂等。 |

### 图表直接渲染（0.5.0 起，0.6.0 起默认渲染）

`div.language-mermaid` 归一化为 `codeBlock + language: 'mermaid'` 后，配合图表功能（`features.diagram`，默认开启）**直接渲染成图，无需任何切换**：

- 导入后即显示图表（与 Vditor 行为一致）；工具栏「查看源码 / 预览图表」随时切换。
- 也可以通过插入菜单的「图表」命令（搜索 `图表` / `mermaid`）新建带示例源码的图表块。
- mermaid 渲染器是本地 vendored 产物，**首次渲染时才按需加载**（不参与主包打包，首屏体积零增加）。
- 渲染失败（语法错误）时自动展开源码区并显示提示，源码始终保留；关闭 `features.diagram` 后退化为纯源码展示。
- 其余图表语言（echarts / plantuml / graphviz 等）保留为代码块源码——plantuml 依赖远程渲染服务、echarts 需执行任意代码，均违反离线与安全约束。

详见[代码块 · 图表渲染](/blocks/code-block#图表渲染)。

### 自然兼容的部分

`h1–h6`、`strong`/`em`/`del`、`u`、`code`、`pre > code.language-*`、`blockquote`、`hr`、`ul`/`ol`/`li`、`a`、`img`、`table` 家族、`details`、`mark`、`sup`/`sub` 都无需转换，ProseMirror 直接解析。

### 网络与图片

Vditor 的图片是绝对地址。默认 `network.mode: 'open'`，**http 地址直接加载，不需要任何配置**。只有在主动开启离线 / 白名单时才需要处理：

```ts
// 收敛到图床白名单
network: { mode: 'allowlist', allowlist: ['img.your-corp.com'] }

// 完全离线：图片显示占位块，保留 data-original-src，不报错
network: { mode: 'offline' }
```

### 转换报告

```ts
{
  source: 'vditor',
  math: 2, inlineMath: 1, blockMath: 1,
  taskList: 1, taskItem: 2,
  diagram: 2,      // 转为图表块的图表数（直接渲染）
  table: 1,
  footnote: 1,
  video: 1,
  dropped: ['toc'], // 主动丢弃的结构
}
```

### 校验

```bash
cd apps/lark-doc
npm run build && npm run check:vditor
```

`check:vditor` 用 jsdom 跑 88 项断言：先校验归一化后的 DOM（公式契约、任务项勾选、图表代码块换行、列宽均分、脚注死链、`[TOC]` 移除），再真实挂载编辑器断言 Tiptap JSON（`inlineMath`/`blockMath`/`taskList`/`codeBlock.language`）与导出 HTML 无 `vditor-` 残留，验证图表默认渲染、源码/预览切换、渲染器懒注入与 `features.diagram` 关闭态，以及「图表」插入命令注册，并验证二次归一化不再改写。

::: warning 范围说明
- **只做导入与显示**：不提供反向导出（不需要把新格式写回 Vditor HTML）。
- **只支持 `getHTML()`**：Markdown 与 Lute AST 不在范围内。
- **表格列宽无法还原**：Vditor 的 HTML 不带列宽信息，只能按列数均分。
- **图表仅 mermaid 可渲染**：其余图表语言降级为代码块，源码不丢。
:::
