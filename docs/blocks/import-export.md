<script setup>
import FeatureDemo from '../examples/FeatureDemo.vue'
</script>

# 导入导出

电脑端紧凑顶栏中，从「⋯ → 导入」选择格式，再选择本地文件。确认后会替换当前正文，可以撤销。导入和导出可以独立开关，Word 解析按需加载。

## 代码演示 {#demo}

<FeatureDemo name="import-export" />

## 配置

```js
new LarkDoc({
  element: '#editor',
  features: { importExport: true },     // 总闸：false 时两个入口一起消失
  importExport: {
    importEnabled: true,                 // false = 只留导出
    exportEnabled: true,                 // false = 只留导入
    importLabel: '导入', exportLabel: '导出',
    importFormats: ['html', 'json', 'md', 'docx'],
    exportFormats: ['html', 'json', 'md', 'txt', 'docx', 'print'],
  },
})
```

三层逐级收窄，按需组合：

| 层 | 作用 | 例子 |
| --- | --- | --- |
| `features.importExport` | 两个入口一起开关 | `false` |
| `importEnabled` / `exportEnabled` | 只关其中一个入口 | `importEnabled: false` |
| `importFormats` / `exportFormats` | 格式白名单 + 顺序 | `exportFormats: ['md', 'html']` |

## 格式对照

| id | 导入 | 导出 | 说明 |
| --- | --- | --- | --- |
| `html` | `.html` `.htm` | ✅ | 媒体写法由 `media.htmlMode` 决定，见[图片](/blocks/image) |
| `json` | `.json` | ✅ | **唯一无损往返**格式，要来回编辑就用它 |
| `md` | `.md` `.markdown` `.mark` `.txt` | ✅ | 四种扩展名均按 Markdown 解析 |
| `docx` | `.doc` `.docx` | ✅ | 旧版 Word 97–2003（`.doc`）导入正文文字。保留更多格式和媒体时，请先另存为 `.docx` |
| `txt` | — | ✅ | 只有正文文字 |
| `print` | — | ✅ | 调浏览器打印，可存成 PDF；打印前自动展开折叠块 |

几个细节：

- 两边格式互不影响：只允许导入 Markdown 的同时导出全部格式，是合法配置；
- `importFormats` 同时决定文件选择框的 `accept`，选中白名单外的扩展名会被挡下并提示，不会静默失败；
- 数组按内置目录去重；传空数组或全非法值会回落到默认列表，避免配错后入口变成死的。

::: warning DOCX 只做归档
DOCX 导出是「标题 + 段落文字」，不还原飞书式排版。要高保真 Word 交付，建议导 HTML 后由宿主自己转换。
:::
