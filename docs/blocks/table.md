# 表格

## 概述

表格组件支持行列增删、单元格合并 / 拆分、表头行 / 表头列切换、均分列宽与拖拽调宽，上限 9×9。工具条按当前光标所在单元格动态显示。

## 配置内容

```ts
new LarkDoc({
  element: '#editor',
  features: { tables: true },
  toolbarKeys: ['tables'],             // 表格工具条分组（别名 table）
  limits: { maxTableRows: 9, maxTableColumns: 9 },
  content: '<table><tr><th>事项</th><th>状态</th></tr><tr><td><p>…</p></td><td><p>进行中</p></td></tr></table>',
})
```

## 配置说明

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `features.tables` | `boolean` | `true` | 关闭后表格入口与工具条隐藏。 |
| `limits.maxTableRows` | `number` | `9` | 行数上限（硬上限 9）。 |
| `limits.maxTableColumns` | `number` | `9` | 列数上限（硬上限 9）。 |

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
