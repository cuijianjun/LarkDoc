# 模板

模板组件在新建 / 清空文档时提供预置模板：空白文档、会议纪要、工作周报等。模板即一段 HTML，宿主可整体替换为自己业务的模板集。

## 基本用法

原生模板库从 `lark-doc/templates` 引入 `createTemplateLibrary`（同名兼容导出 `LarkDocTemplateLibrary`），提供搜索、分类、预览与使用回调，不依赖 Vue。它与下方工作台的 `templates` prop 是两个独立入口；默认主入口不导出 Vue2 模板组件。

```js
import { createTemplateLibrary } from 'lark-doc/templates'
import 'lark-doc/style.css'

const library = createTemplateLibrary({
  host: document.body,
  handlers: {
    onUse: template => console.log('由宿主创建文档', template),
    onPreview: template => console.log('预览模板', template),
    onClose: () => library.close(),
  },
})
library.update({ templates: [] }) // 传入宿主模板集
library.open()
// 页面卸载时：library.destroy()
```

下面的示例用于已有 Vue2 应用。工作台兼容组件从 `lark-doc/vue2` 引入，由宿主 Vue2 注册；库自身不导入 Vue，默认主入口不再导出 Vue2 组件。

模板集是**工作台组件 `LarkDocWorkspace` 的 prop**（命令式门面 `new LarkDoc()` 不透传 `templates`，模板只在完整工作台的新建 / 清空入口出现）。

```vue
<script>
import { LarkDocWorkspace } from 'lark-doc/vue2'
import 'lark-doc/style.css'

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

Webpack4 不读取短子路径 exports：组件改从 `lark-doc/dist/lark-doc-vue2.common.js` 引入，样式改为 `lark-doc/dist/lark-doc.css`。组件会在销毁时释放自身编辑器；框架生命周期示例见[各环境接入](/guide/environments#env-vue2-sfc)。

## 配置与用法

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `features.templates` | `boolean` | `true` | 关闭后模板选择入口隐藏。 |
| `templates`（Workspace prop） | `TemplateItem[]` | 内置 4 套 | 整体替换模板集；未传或非数组时使用内置 `TEMPLATES`。空数组表示空模板集，初始内容回退为空段落。 |

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
