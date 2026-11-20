---
pageClass: feature-guide
---

<script setup>
import FeatureDemo from '../examples/FeatureDemo.vue'
</script>

# 块句柄与拖拽

<div class="feature-summary">

## 介绍

块句柄组件在悬停块左侧显示把手，提供块级操作菜单：剪切 / 复制 / 翻译 / 创建副本 / 上下移动 / 删除，以及「转为…」类型切换、整块对齐与整块配色。按住把手可拖拽整块移动，拖拽过程显示落点指示线。

</div>

## 基础用法 {#demo}

<FeatureDemo name="block-handle" />

## API

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| `features.blockHandle` | 关闭后把手与块菜单不显示。 | `boolean` | true / false | `true` |
| `features.blockDrag` | 关闭后禁止拖拽移动（把手仍可用）。 | `boolean` | true / false | `true` |
| `blockMenu.disabled` | 禁用指定动作。 | `string[]` | — | `[]` |
| `blockMenu.allow` | 动作白名单，`null` 为全部。 | `string[] \| null` | — | `null` |

## 配置与用法

### 块菜单动作（id）

| id | 说明 | id | 说明 |
| --- | --- | --- | --- |
| `cut` / `copy` | 剪切 / 复制 | `moveUp` / `moveDown` | 上移 / 下移区块 |
| `translate` | 翻译 | `duplicate` | 创建副本 |
| `delete` | 删除区块 | | |

### 「转为…」类型

`paragraph`（正文）、`heading1`–`heading3`（标题）、`orderedList` / `bulletList` / `taskList`（列表）、`codeBlock`（代码块）、`blockquote`（引用）。

### 使用方式

| 操作 | 说明 |
| --- | --- |
| 悬停左侧把手 | 显示块菜单。 |
| 拖拽把手 | 移动整块，落点位置显示指示线。 |
| 菜单悬停停留 | 展开二级菜单（转为… / 对齐 / 颜色）。 |

## 把手的外观与提示

把手是左侧「块类型图标 + 六点」的胶囊按钮：42×26、圆角 6px、1px 描边。文本类块垂直中心对齐首行文字行盒；图片、视频、附件这类整框块改为**与块顶齐平**，右侧贴块左边缘 6px。类型图标按块类型切换，文件与视频使用回形针（同一套图标也用于菜单里的「转为…」网格）。

把手本身**不出悬停提示**：指针停上去就直接展开块菜单，`aria-label="块操作"` 只提供给读屏。菜单内的纯图标项仍按[提示规则](../guide/toolbar.md)出提示，带可见中文名的操作项与带下拉的触发项不出。这条差异是有意的——把手是「主动作 + 拖动」控件，再叠一层文案提示只会和菜单抢注意力。

拖拽使用浏览器原生 HTML5 拖放：`dragstart` 记录被拖块，`dragover` 计算落点，`drop` 后一次性移动整块并保持撤销历史；拖拽期间显示落点指示线，拖拽结束、拖拽期间文档被改动或拖拽源块已不存在时统一清理拖拽状态。只读状态或 `features.blockDrag: false` 时把手仍可打开菜单，但不发起拖拽。
