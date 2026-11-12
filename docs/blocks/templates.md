# 模板

模板有三条独立流程：

- 编辑器 `/` 或 `＋` →「模板」在当前选区插入正文，不改文档标题；「更多模板」打开同页模板库，可搜索、只读预览并插入。
- 工作台顶部模板选择器在确认后替换整篇正文并更新标题，继续使用原 `TEMPLATES` 示例集。
- 独立的云盘模板库默认只回调 `onPreview` / `onUse`，由宿主预览或复制新文档；不会自动写入编辑器。

## 配置示例

下面的示例用于已有 Vue2 应用。工作台兼容组件从 `lark-doc/vue2` 引入，由宿主 Vue2 注册；库自身不导入 Vue，默认主入口不再导出 Vue2 组件。

`templates` 可用于 `new LarkDoc()`、`LarkDocWorkspace` 和 `LarkDocEditor`。传入数组会覆盖编辑器插入模板；工作台同时将该数组用于整文替换。显式 `[]` 保持空模板集，不回退默认内容。兼容组件 `LarkDocEditor` 原有的默认空数组语义保持。

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
| `templates` | `TemplateItem[]` | 按入口区分 | 未传或非数组时，编辑器使用 `INSERT_TEMPLATES`，工作台整文替换仍使用 `TEMPLATES`。空数组表示空模板集，初始内容回退为空段落。 |

### TemplateItem

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | ✅ | 模板稳定标识。 |
| `label` | `string` | ✅ | 模板名称（展示用）。 |
| `title` | `string` | ✅ | 模板标题；仅工作台整文替换时写入文档标题，编辑器插入不改标题。 |
| `html` | `string` | ✅ | 模板内容，HTML 字符串。 |

### 编辑器默认插入模板

默认快捷菜单依次提供读书笔记、个人总结、SWOT 分析思维导图、工作汇报、会议记录和「更多模板」。四份正文保留对应的标题、引用、分栏、高亮块、列表和表格结构。模板中的人名、日期和推荐书单为普通说明文本，不会通知他人或创建日程。

SWOT 模板包含当前未支持的思维导图，入口明确禁用；不会用空图、Mermaid 或截断正文替代。

「更多模板」只展示本地内置或宿主提供的数据，不伪造云端图库或使用人数。预览使用清理后的只读正文，支持上一个、下一个；Esc 或关闭按钮退出整个模板库。取消不改正文，插入作为独立撤销步骤。浮层期间映射原选区；文档替换、会话/文档身份变化、权限撤销、只读或模板功能关闭后，旧选择不能写入。

### 工作台内置示例

| id | label | 内容要点 |
| --- | --- | --- |
| `blank` | 空白文档 | 空段落。 |
| `meeting` | 会议纪要 | 会议目标 / 讨论要点 / 行动事项表格 / 待确认。 |
| `weekly` | 工作周报 | 本周进展 / 问题 / 下周计划。 |
| `sample` | 旧 HTML 示例 | 功能演示用的长文（含表格、列表、引用、图片）。 |

独立 `createTemplateLibrary()` 的默认模式及 `onUse` 复制合同保持不变；编辑器内部使用独立的 `mode: 'insert'` / `onInsert`，两条路径不混用。
