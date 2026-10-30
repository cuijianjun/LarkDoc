# 导入导出

导入导出组件覆盖 HTML、Markdown、JSON、纯文本、DOCX、打印 / PDF 六种导出目标，导入侧支持 HTML、JSON、Markdown、DOCX。Markdown 转换基于 marked / Turndown 本地完成，DOCX 按需动态加载 `docx` 依赖（不进入编辑器首包）。

## 配置示例

```ts
new LarkDoc({
  element: '#editor',
  features: { importExport: true },   // 总闸：关闭后导入/导出两个入口一起消失
  importExport: {
    importEnabled: true,               // 只留导入：把 exportEnabled 设 false
    exportEnabled: true,               // 只留导出：把 importEnabled 设 false
    importLabel: '导入', exportLabel: '导出',
    importFormats: ['html', 'json', 'md', 'docx'],
    exportFormats: ['html', 'json', 'md', 'txt', 'docx', 'print'],
  },
})
```

三个层次，逐层收窄：

| 层次 | 作用 | 例 |
| --- | --- | --- |
| `features.importExport` | 总闸，两个入口一起开关 | `false` |
| `importExport.importEnabled` / `exportEnabled` | 分区开关，只关其中一个入口 | 只留导出：`importEnabled: false` |
| `importExport.importFormats` / `exportFormats` | 格式白名单 + 顺序 | `exportFormats: ['md', 'html']` |

格式 id 与文件扩展名的对应关系：

| id | 导入扩展名 | 导出 | 备注 |
| --- | --- | --- | --- |
| `html` | `.html` `.htm` | ✅ | 导出时媒体写法由 `config.media.htmlMode` 决定 |
| `json` | `.json` | ✅ | 唯一无损往返格式 |
| `md` | `.md` `.markdown` | ✅ | 导出是简化版，复杂块退化为顺序文本 |
| `docx` | `.docx` | ✅ | 导出是纯文本段落 |
| `txt` | — | ✅ | 仅正文文字 |
| `print` | — | ✅ | 调浏览器打印，可另存为 PDF |

- 两边格式**各自独立**：只允许导入 Markdown（`importFormats: ['md']`）的同时照常导出全部格式，是合法配置；
- `importFormats` 同时决定文件选择框的 `accept`；选中不在白名单里的扩展名会被直接挡下并提示「不支持的文件格式，可导入：…」，不会静默失败；
- 数组按内置目录顺序去重；传空数组或全非法值回落到默认列表（防止配错后入口变成死的）。

## 能力与依赖

| 能力 | 方向 | 依赖 | 说明 |
| --- | --- | --- | --- |
| 导入 Markdown | md → HTML | `marked` | 从顶部「导入」选 `.md` 文件。 |
| 导入 HTML | html → 文档 | 内建 | 保留可识别的节点，未知标签降级为文本。 |
| 导入 JSON | json → 文档 | 内建 | Tiptap JSON 原样还原。 |
| 导入 DOCX | docx → 文档 | `docx`（动态加载） | 复杂布局按正文格式降级。 |
| 导出 HTML | 文档 → .html | 内建 | 媒体写法由 `config.media.htmlMode` 决定；完整样式需自行带上 `lark-doc/style.css`。 |
| 导出 Markdown | 文档 → .md | `turndown` | 表格 / 分栏 / 高亮块等复杂结构退化为顺序文本。 |
| 导出纯文本 | 文档 → .txt | 内建 | 仅正文文本。 |
| 导出 DOCX | 文档 → .docx | `docx`（动态加载） | 标题加粗 + 段落纯文本，适合归档而非排版还原。 |
| 导出 JSON | 文档 → .json | 内建 | Tiptap JSON 原样保存（含 `schemaVersion` 与 `title`），可再导入。 |
| 打印 / PDF | 文档 → 打印 | 浏览器 `window.print()` | 打印前自动展开折叠块，打印后折回。 |

> 转换工具函数（`markdownToHtml` / `htmlToMarkdown` / `exportDocx`）是包内部实现，**未从入口具名导出**；宿主接入导入导出配置 `importExport` 即可，无需直接调用。

## 配置项

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `features.importExport` | `boolean` | `true` | 总开关。 |
| `importExport.importEnabled` | `boolean` | `true` | 「导入」按钮显隐。 |
| `importExport.exportEnabled` | `boolean` | `true` | 「导出」下拉显隐。 |
| `importExport.importLabel` / `exportLabel` | `string` | `'导入'` / `'导出'` | 按钮文案。 |
| `importExport.importFormats` | `string[]` | `['html','json','md','docx']` | 允许导入的格式。 |
| `importExport.exportFormats` | `string[]` | `['html','json','md','txt','docx','print']` | 导出下拉项与顺序。 |
| `features.persistence` | `boolean` | `true` | 本地草稿保存，与导入导出独立。 |

::: warning DOCX 定位
DOCX 导出面向「内容归档」，不还原飞书式排版。需要高保真 Word 交付时，建议导出 HTML 后由宿主侧转换。
:::
