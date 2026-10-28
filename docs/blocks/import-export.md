# 导入导出

导入导出组件覆盖 HTML、Markdown、JSON、纯文本、DOCX、打印 / PDF 六种导出目标，导入侧支持 HTML、JSON、Markdown、DOCX。Markdown 转换基于 marked / Turndown 本地完成，DOCX 按需动态加载 `docx` 依赖（不进入编辑器首包）。

## 配置示例

```ts
new LarkDoc({
  element: '#editor',
  features: { importExport: true },   // 关闭后工具栏导入导出入口隐藏
})
```

> 转换工具函数（`markdownToHtml` / `htmlToMarkdown` / `exportDocx`）是包内部实现，**未从入口具名导出**；宿主接入导入导出走 `features.importExport` 开关即可，无需直接调用。

## 配置与用法

| 能力 | 方向 | 依赖 | 说明 |
| --- | --- | --- | --- |
| 导入 Markdown | md → HTML | `marked` | 斜杠菜单 / 工具栏导入入口，选择 `.md` 文件。 |
| 导入 HTML | html → 文档 | 内建 | 保留可识别的节点，未知标签降级为文本。 |
| 导入 JSON | json → 文档 | 内建 | Tiptap JSON 原样还原。 |
| 导入 DOCX | docx → 文档 | `docx`（动态加载） | 复杂布局按正文格式降级。 |
| 导出 HTML | 文档 → .html | 内建 | 完整样式需自行带上 `lark-doc/style.css`。 |
| 导出 Markdown | 文档 → .md | `turndown` | 表格 / 分栏 / 高亮块等复杂结构退化为顺序文本。 |
| 导出纯文本 | 文档 → .txt | 内建 | 仅正文文本。 |
| 导出 DOCX | 文档 → .docx | `docx`（动态加载） | 标题加粗 + 段落纯文本，适合归档而非排版还原。 |
| 导出 JSON | 文档 → .json | 内建 | Tiptap JSON 原样保存（含 `schemaVersion` 与 `title`），可再导入。 |
| 打印 / PDF | 文档 → 打印 | 浏览器 `window.print()` | 打印前自动展开折叠块，打印后折回。 |

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `features.importExport` | `boolean` | `true` | 总开关。 |
| `features.persistence` | `boolean` | `true` | 本地草稿自动保存（浏览器 localStorage），与导入导出独立。 |

::: warning DOCX 定位
DOCX 导出面向「内容归档」，不还原飞书式排版。需要高保真 Word 交付时，建议导出 HTML 后由宿主侧转换。
:::
