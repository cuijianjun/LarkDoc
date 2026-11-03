# 模板

模板组件在新建 / 清空文档时提供预置模板：空白文档、会议纪要、工作周报等。模板即一段 HTML，宿主可整体替换为自己业务的模板集。

## 配置示例

模板集是**工作台组件 `LarkDocWorkspace` 的 prop**（命令式门面 `new LarkDoc()` 不透传 `templates`，模板只在完整工作台的新建 / 清空入口出现）。

```vue
<script>
import { LarkDocWorkspace } from 'lark-doc'

export default {
  components: { LarkDocWorkspace },
  data() {
    return {
      templates: [
        { id: 'blank',   label: '空白文档', title: '未命名文档', html: '<p></p>' },
        { id: 'meeting', label: '会议纪要', title: '项目会议纪要', html: '<h1>会议纪要</h1><h2>行动事项</h2>…' },
      ],
    }
  },
}
</script>

<template>
  <LarkDocWorkspace :templates="templates" />
</template>
```

## 配置与用法

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `features.templates` | `boolean` | `true` | 关闭后模板选择入口隐藏。 |
| `templates`（Workspace prop） | `TemplateItem[]` | 内置 4 套 | 整体替换模板集；传空数组或非数组时回退内置 `TEMPLATES`。 |

### TemplateItem

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | ✅ | 模板稳定标识。 |
| `label` | `string` | ✅ | 模板名称（展示用）。 |
| `title` | `string` | ✅ | 应用后写入的文档标题。 |
| `html` | `string` | ✅ | 模板内容，HTML 字符串。 |

### 内置模板

| id | label | 内容要点 |
| --- | --- | --- |
| `blank` | 空白文档 | 空段落。 |
| `meeting` | 会议纪要 | 会议目标 / 讨论要点 / 行动事项表格 / 待确认。 |
| `weekly` | 工作周报 | 本周进展 / 问题 / 下周计划。 |
| `sample` | 旧 HTML 示例 | 功能演示用的长文（含表格、列表、引用、图片）。 |
