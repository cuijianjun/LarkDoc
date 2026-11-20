---
pageClass: feature-guide
---

<script setup>
import FeatureDemo from '../examples/FeatureDemo.vue'
</script>

# 表格

<div class="feature-summary">

## 介绍

表格组件支持行列增删、单元格合并 / 拆分、表头行 / 表头列切换、均分列宽与拖拽调宽，上限 9×9。工具条按当前光标所在单元格动态显示。

</div>

## 基础用法 {#demo}

<FeatureDemo name="table" />

## API

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| `features.tables` | 关闭后表格入口与工具条隐藏。 | `boolean` | true / false | `true` |
| `limits.maxTableRows` | 行数上限（硬上限 9）。 | `number` | 1–9 | `9` |
| `limits.maxTableColumns` | 列数上限（硬上限 9）。 | `number` | 1–9 | `9` |

## 配置与用法

### 工具条动作（命令 id）

| id | 说明 | id | 说明 |
| --- | --- | --- | --- |
| `addRowBefore` / `addRowAfter` / `deleteRow` | 行操作 | `mergeCells` / `splitCell` | 合并 / 拆分单元格 |
| `addColumnBefore` / `addColumnAfter` / `deleteColumn` | 列操作 | `toggleHeaderRow` / `toggleHeaderColumn` | 表头行 / 列 |
| `clearCellContent` | 清空单元格 | `distributeColumns` | 均分列宽 |
| `deleteTable` | 删除表格 | | |

### 使用方式

| 入口 | 操作 |
| --- | --- |
| 插入菜单 | 拖选行列数网格新建（默认 3×3）。 |
| 工具条 | 光标进入表格后出现，覆盖上表全部动作。 |
| 拖拽 | 列边界拖拽调宽；表格边界线高亮提示落点。 |

### 数据契约

单元格内容为独立的块结构（`<td><p>…</p></td>`），因此表格单元格内支持标题、列表、代码块等任意内容；导出 Markdown 时退化为管道表格（复杂内容丢失格式，导出 DOCX 时按纯文本处理）。
