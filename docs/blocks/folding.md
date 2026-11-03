# 折叠块

折叠范围是块的**缩进子树**，与块类型、标题级别都无关：块模型里每个块只有一个父块，子块靠缩进挂在父块下面，所以折叠一个块只带走缩进比它更深的块。

这一点与飞书一致，也是它与直觉最容易冲突的地方：

- **任意块**都能折叠：标题、普通段落、列表项（以及引用、高亮块等容器）只要下面挂了子块，左侧就出现折叠箭头；
- H2 后面没有缩进的 H3 / H4 是它的**兄弟块**，折叠 H2 不会带走它们；
- 缩进更深的普通段落、代码块、表格、列表都属于父块的子树，会被一起折叠；
- 块只有真正挂上了子块才会出现折叠箭头（老文档里块之间都没有缩进，于是没有可折叠内容）。

典型的两类「非标题折叠」：

```html
<!-- 段落 + 缩进代码块：折叠段落就收起代码块 -->
<p data-indent="0">你好</p>
<pre data-indent="1"><code>方法</code></pre>
<p data-indent="0">你好你好</p>

<!-- 列表项 + 内部代码块：折叠状态属于这个 item，不影响下一个 item -->
<ol>
  <li><p>b. 4</p><pre data-indent="1"><code>1</code></pre></li>
  <li><p>c. 5</p></li>
</ol>
```

目录（大纲）仍按**标题级别**排，和折叠范围是两套语义：H3 / H4 照样出现在 H2 下面。

折叠身份是块的**稳定 Block ID**（`attrs.blockId`），不是文档位置，也不是「层级 + 文本 + 同名序号」这类派生键。因此：

- 编辑、拖动、重命名后，折叠状态跟着**那个块**走；
- 两个同名块各自独立，折叠其中一个不会影响另一个；
- 删除某个块只带走它自己的折叠状态，不会串到相邻的同名块上。

折叠偏好按文档（`documentId`，无则 `local`）写入 `localStorage`，刷新 / 重新打开后自动恢复。

## 配置示例

```ts
new LarkDoc({
  element: '#editor',
  features: { folding: true },   // 关闭后箭头与菜单项隐藏
  documentId: 'doc-42',          // 决定折叠偏好存哪个键；Web Component 用 document-id 属性
  // 子块靠 data-indent 缩进挂在父块下面（= 飞书块模型里的父子关系）
  content: '<h2>第一节</h2><p data-indent="1">…</p><h2>第二节</h2><p data-indent="1">…</p>',
})
```

```ts
// 命令式（editor 是 Tiptap 实例）
const editor = doc.getEditor()

editor.commands.toggleLarkDocFold(pos)         // 按文档位置切换（内部换算成 blockId）
editor.commands.toggleLarkDocFoldById(id)      // 已知 blockId 时直接切换
editor.commands.resetLarkDocFolds()            // 全部展开
editor.commands.foldLarkDocByIds(['b1', 'b2']) // 按 id 批量折叠（宿主自建大纲 / 书签时用）
```

## 配置与用法

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `features.folding` | `boolean` | `true` | 关闭后折叠箭头与菜单项隐藏，已有折叠状态保留在 storage 里。 |
| `documentId` | `string` | `''` | 折叠偏好的分键依据；不传时落到 `local`，同一浏览器共用一个键。 |

### 使用方式

| 入口 | 操作 |
| --- | --- |
| 块左侧箭头 | 悬停任意有子块的块，点击左边缘的箭头展开 / 折叠（`aria-expanded` 同步状态）。 |
| 块句柄菜单 | 「折叠 / 展开」。 |
| 查找替换 | 命中隐藏内容时自动展开所在块。 |
| 大纲面板 | 跳转到被祖先块折叠的标题时，先展开祖先块。 |

### 块标识（blockId）

块级节点统一带 `attrs.blockId`，随 JSON 一起保存 / 导入 / 导出：

```json
{ "type": "heading", "attrs": { "level": 2, "blockId": "b7f3k2m1" } }
```

| 带 id 的节点 | 不带 id 的节点（纯结构性容器） |
| --- | --- |
| `paragraph` `heading` `blockquote` `callout` `columns` `details` `detailsSummary` `listItem` `taskItem` `bulletList` `orderedList` `taskList` `codeBlock` `image` `horizontalRule` `blockMath` `table` | `tableRow` `tableCell` `tableHeader` `column` `detailsContent` |

列表项是唯一的「既是骨架又能当块」的特例：飞书把 `fold-block-id` 直接挂在 item 上，折叠状态属于 item 而不是外层列表，所以 item 必须有独立 id。

其余结构性容器不编号是有意为之：父块已经携带 id，重复编号只会让 JSON 体积成倍增长。

补号时机（都发生在事务末尾，不进入撤销历史，也不会触发 `change` 事件）：

| 时机 | 说明 |
| --- | --- |
| 编辑器初始化 / `setContent()` | 老文档（无 id）一次性补齐。 |
| 任意改动文档的事务 | 新增块（回车分段、粘贴、拖入、AI 插入）补号；重复 id（复制粘贴、`split` 继承 attrs）重新编号。 |

重复 id 的判定不靠「先出现的保留」：以「旧位置经事务 mapping 映射后的位置」为准，离它更近的那个块保住原 id —— 粘贴在文档**前面**的副本不会抢走原块的折叠状态。

### 偏好存储

| 项 | 值 |
| --- | --- |
| localStorage 键 | `lark-doc:folds:<documentId \| local>` |
| 值 | blockId 数组，如 `["b7f3k2m1"]`（空数组代表「用户主动全部展开」） |
| 写盘闸门 | 内容替换期间不写；读到偏好但一条都没命中不写；文档里没有可折叠块不写 |

写盘闸门的第三条判定的是「**有没有可折叠块**」，不是「有没有标题」：段落 / 列表项挂了缩进子块也算可折叠块，没有标题的文档同样会恢复折叠位。

旧版本用「层级 + 文本 + 同名序号」派生键存储，读取时会自动换算成 blockId 并写回，无需手动迁移。

### 设计约定

- 与「目录面板收起」（`outlineCollapsed`）、「目录面板开关」（`outlineOpen`）是三套独立状态，互不影响。
- 折叠与悬停高亮共用同一套范围算法（缩进子树），两者永远一致：高亮到哪，折叠就折到哪。
- 列表项的折叠入口归 **item 自己**：item 内首个段落（列表的「标题行」）不再单独生成箭头，否则两个箭头会落在同一处、互相盖住。
- 悬停高亮的遮罩覆盖整棵子树并合成**一个矩形**（不分块、不在块间距里露白缝），与飞书的 `hovered-mask` 一致。
- 缩进层级每级 25px，硬上限 5 级（飞书最深第 6 层）。**能不能再缩一级由前一个块决定**（缩进 = 成为上一个块的子块）：第一个块缩不动，前块 2 级则最多到 3 级；减少缩进不受此限，可以一路减回文档开头。导入的老数据会被压回硬上限 5 级。代码块、引用、表格等容器块同样带 `indent`，缩进时整框位移、宽度同步变窄。
- 没有显式缩进的容器块（例如刚从缩进段落里插入的代码块，`indent` 仍是 0）沿用前一个块的层级，不会把父块的子树截断。
- 折叠区域以 `display:none` + `aria-hidden="true"` 隐藏；折叠后光标若落在被隐藏的后代里，会迁回调用的块。

::: tip 已知边界
折叠偏好只存在本机 `localStorage`，**不进入文档 JSON**，`save()` 的 payload 里也没有折叠信息。换设备 / 换浏览器不同步；要跨端一致，需要把折叠状态随文档一起落库（例如 `doc.attrs.foldState`）。
:::
