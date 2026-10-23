# 代码块

## 概述

代码块组件提供语言选择、语法高亮（highlight.js 按需动态加载，本地 chunk 无外网请求）、行内复制与编辑态切换。可通过 `performance.syntaxHighlight` 关闭高亮以减小包体积感知。

语言选为 **Mermaid 图表** 时，代码块升级为图表块：**默认直接渲染图表**（与 Vditor 行为一致），点「编辑源码」可切回源码编辑，渲染器（mermaid，本地 vendored 产物）只在首次渲染时按需加载。

图表块使用**独立外观**（白底卡片），不与深色代码框共用样式；工具栏提供独立的「图表」按钮，下拉可选流程图 / 时序图 / 甘特图 / 饼图 / 状态图 / 类图直接插入。

## 配置内容

```ts
new LarkDoc({
  element: '#editor',
  features: { codeBlocks: true, diagram: true },
  performance: { syntaxHighlight: true },  // false 时纯文本渲染
  toolbarKeys: ['insert'],                 // 图表入口在插入分组（斜杠命令 / 加号菜单搜「图表」）
  content: '<pre><code class="language-js">console.log("hi")</code></pre>',
})
```

## 配置说明

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `features.codeBlocks` | `boolean` | `true` | 关闭后代码块入口与命令不可用。 |
| `features.diagram` | `boolean` | `true` | 关闭后语言下拉不再提供 Mermaid 图表，预览按钮与渲染器加载一并禁用；已有 mermaid 代码块退化为纯源码展示。 |
| `performance.diagramScriptUrl` | `string \| null` | `null` | 自托管渲染器地址。默认用包内 vendored 产物：源码打包的宿主自动落盘；直接消费预构建 `dist` 的宿主需把 `dist/vendor/` 拷进站点静态目录，或传此参数指定地址。 |
| `performance.syntaxHighlight` | `boolean` | `true` | 关闭后不做语法高亮。 |
| `blockMenu.disabled: ['codeBlock']` | `string[]` | `[]` | 禁用块菜单「转为代码块」。 |

### 数据契约

代码块支持块级缩进，落库字段是 `attrs.indent`：

```json
{ "type": "codeBlock", "attrs": { "language": "javascript", "indent": 2, "blockId": "b7f3k2m1" } }
```

导出 HTML 时写成 `data-indent="2"`，消费方按 `margin-left: 2 × 25px` 还原即可；导入时读同一个属性。

缩进上限由**前一个块**决定，不是固定的绝对层级：飞书的块缩进本质是「成为上一个块的子块」，所以第一个块一级都缩不了，前一个块 2 级时后一个块最多到 3 级。到顶后所有入口都会停住——

| 入口 | 到顶后的行为 |
| --- | --- |
| 工具栏「增加缩进」/ 气泡菜单 | 按钮禁用，title 提示「当前内容块已达最大缩进层级」，再点不写事务 |
| 块句柄菜单「增加缩进」 | 菜单项禁用，带「已达到最大缩进」提示 |
| `⌘]` / Tab（列表） | 键盘事件被吞掉，层级不变 |
| 导入的 JSON / HTML | 挂载与 `setContent` 时一次性压回硬上限 5 级，不进撤销栈 |

**减少缩进不受此限**：只受 0 下限约束，可以一路减回文档开头。

`limits.maxIndent` 只能把上限**调低**（例如宿主只允许 3 级），设成 99 也还是 5。

### 使用方式

| 入口 | 操作 |
| --- | --- |
| 斜杠命令 / 插入菜单 | 新建代码块；输入「图表」或 `mermaid` 可直接插入带示例源码的图表块。 |
| 工具栏「图表」按钮 | 下拉选择图表类型（流程图 / 时序图 / 甘特图 / 饼图 / 状态图 / 类图），插入对应示例源码的图表块。 |
| 块句柄菜单 | 「转为代码块」，正文与代码块互转。 |
| 语言选择 | 代码块右上角切换语言，高亮随之更新；选 Mermaid 立即进入图表渲染。 |
| 块缩进 | 块句柄菜单「增加缩进 / 减少缩进」或 `⌘]` / `⌘[` 让**整个代码框**右移（不是框内文本），每级 25px；能缩多深由前一个块决定，减少缩进可以一路回到 0——与飞书一致。`Tab` 在代码块内仍是插入两个空格。 |
| Markdown 输入 | 行首输入 ``` + 语言名回车转换。 |
| 图表预览 | mermaid 块**默认渲染图表**且为独立白底卡片外观；块工具栏「编辑源码 / 预览图表」随时切换，渲染失败时自动显示源码便于修正。 |

### 图表渲染

- 支持 mermaid 语法（流程图、时序图、甘特图、饼图等），本地渲染，不请求外部服务。
- 编辑源码后 300ms 防抖重新渲染；渲染失败（语法错误）时自动展开源码区并显示提示，源码始终保留。
- 渲染器不参与打包：首次渲染时才注入 `<script>` 加载本地 vendored 产物（约 3.3MB，浏览器有缓存后几乎零成本），首屏体积零增加。
- `securityLevel: 'strict'`，标签文本中的 HTML 会被转义，不执行脚本。

::: warning 部署资源
渲染器是**运行时资源**（`<package>/dist/vendor/mermaid.<hash>.js`），不在 JS 包里：
- 源码打包（webpack/vite alias 到 src）：file-loader / 资源模块自动落盘，无需处理；
- 直接消费预构建 `dist`：把 `node_modules/lark-doc/dist/vendor/` 拷进站点静态目录，或配置 `performance.diagramScriptUrl` 指向自托管地址。加载失败时预览层会显示「图表渲染失败」，源码不受影响。
:::

### 数据契约

```html
<pre><code class="language-js">…</code></pre>
```

- JSON：`{ type: 'codeBlock', attrs: { language: 'js' }, content: […] }`。
- 图表与普通代码块**共用同一契约**（`language: 'mermaid'`），源码即正文；导出 Markdown 输出 ```mermaid 围栏块，其他工具（如 Vditor）可直接消费。
- 关闭 `features.diagram` 不影响已存数据——只是不再渲染预览。
