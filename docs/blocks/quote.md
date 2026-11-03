# 引用

引用组件渲染块级引文（`<blockquote>`），常用于摘录、风险提示。与[高亮块](/blocks/callout)的区别：引用是纯排版语义，不带图标与底色。

## 配置示例

```ts
new LarkDoc({
  element: '#editor',
  toolbarKeys: ['insert'],      // 引用入口在插入分组（别名 blockquote）
  content: '<blockquote><p>清晰的表达，让复杂的事变得简单。</p></blockquote>',
})
```

## 配置与用法

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `features.insert` | `boolean` | `true` | 插入菜单总开关。 |
| `blockMenu.disabled: ['blockquote']` | `string[]` | `[]` | 禁用块菜单「转为引用」。 |

### 使用方式

| 入口 | 操作 |
| --- | --- |
| 斜杠命令 | 输入 `/` 选择「引用」。 |
| 块句柄菜单 | 「转为引用」，可再转回正文。 |
| Markdown 输入 | 行首输入 `>` + 空格自动转换。 |
| 导入导出 | 导出 Markdown 时保留 `>` 语法。 |

::: tip 结构
引用内可包含段落、列表、标题等多块内容；引用内的引用继续嵌套。
:::
