---
pageClass: feature-guide
---

<script setup>
import FeatureDemo from '../examples/FeatureDemo.vue'
</script>

# 引用

<div class="feature-summary">

## 介绍

引用组件渲染块级引文（`<blockquote>`），常用于摘录、风险提示。与[高亮块](/blocks/callout)的区别：引用是纯排版语义，不带图标与底色。

</div>

<div class="feature-summary">

## 引入

在已有的 Vue 3 项目中安装示例版本，将基础用法里的完整组件代码复制到 `App.vue`。

```bash
npm install lark-doc@0.14.10
```

```js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'
```

</div>

## 基础用法 {#demo}

<FeatureDemo name="quote" />

## API

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| `features.insert` | 插入菜单总开关。 | `boolean` | true / false | `true` |
| `blockMenu.disabled: ['blockquote']` | 禁用块菜单「转为引用」。 | `string[]` | — | `[]` |

## 配置示例

```ts
new LarkDoc({
  element: '#editor',
  toolbarKeys: ['insert'],      // 引用入口在插入分组（别名 blockquote）
  content: '<blockquote><p>清晰的表达，让复杂的事变得简单。</p></blockquote>',
})
```

## 配置与用法

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
