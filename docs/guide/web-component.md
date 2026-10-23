# Web Component（跨框架接入）

`<lark-doc>` 自定义元素让编辑器脱离宿主框架：Vue 2 / Vue 3 / React / Svelte / 纯 HTML 都可以直接使用，**宿主无需安装 Vue**——Vue 运行时与全部样式已经打包进产物内部（架构对齐 AiEditor：框架依赖只存在于包内部，对外只暴露标签、属性、事件与命令式 API）。

## 快速开始

### 方式一：`<script>` 直接引入（零构建）

```html
<!-- 产物自带 Vue 运行时与样式，无需再引 css -->
<script src="node_modules/lark-doc/dist/lark-doc-element.umd.min.js"></script>

<lark-doc title="会议纪要" theme="light">
  <h1>标签内的 HTML 会成为初始内容</h1>
  <p>长正文直接写在这里，不用往属性里塞转义字符串。</p>
</lark-doc>

<script>
  const el = document.querySelector('lark-doc')
  el.addEventListener('lark-doc-change', (event) => {
    console.log(event.detail.payload.html)
  })
  el.getJSON() // 与命令式门面同名的方法都代理到了元素上
</script>
```

### 方式二：npm + 打包器（Vue 2 / Vue 3 / React 通用）

```js
import 'lark-doc/element' // 自动注册 <lark-doc>
// 样式已随产物注入；若在 lib 模式下使用请另行 import 'lark-doc/style.css'
```

```vue
<template>
  <lark-doc :title="docTitle" @lark-doc-change="onChange" ref="editor" />
</template>
<script>
export default { // Vue 2 与 Vue 3 写法完全一致（事件用 addEventListener/@lark-doc-* 均可）
  methods: { onChange(event) { this.$emit('save', event.detail.payload.json) } },
}
</script>
```

```jsx
// React
function Editor() {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    const onChange = (e) => console.log(e.detail.payload.text)
    el.addEventListener('lark-doc-change', onChange)
    return () => el.removeEventListener('lark-doc-change', onChange)
  }, [])
  return <lark-doc ref={ref} theme="light" />
}
```

## HTML 属性

属性经声明式映射表（`src/web-component/attributes.js`）解析，**新增属性只需在表里加一行**。布尔属性按 HTML 规范：存在即 true（`readonly=""` 也是 true）。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `content` | string | 初始内容（HTML / Tiptap JSON 字符串）；与标签内 HTML 同时存在时以属性为准 |
| `content-format` | `auto` \| `vditor` \| `html` | 旧数据归一化策略，同门面 `contentFormat` |
| `title` | string | 文档标题 |
| `readonly` | boolean | 只读（热更新） |
| `theme` | `light` \| `dark` | 主题（热更新） |
| `placeholder` | string | 空文档占位文案 |
| `toolbar-keys` | list | 逗号分隔，如 `history,headings,marks` |
| `toolbar-excludes` | list | 逗号分隔的排除项 |
| `features` / `limits` / `layout` / `network` / `capabilities` / `user` | JSON | 对应门面 options 同名字段 |
| `storage` | `none` \| `local` | 本地草稿 |
| `autofocus` | boolean | 挂载后自动聚焦 |
| `mode` / `document-id` | string | 协同模式与文档标识 |
| `max-length` | number | 正文最大字符数（写入 `limits.maxLength`） |

**热更新规则**：`readonly` / `content-format` / `theme` / `title` / `user` 变更会增量生效（不重建实例）；其余属性（含 `content`）变更会**重建实例**（运行时内容回到初始值，请先用 `getJSON()` 保存现场）。

## 对象型能力（property 注入）

上传、AI、协同 Provider 这类对象/函数无法写进 HTML 属性，通过 `element.options` 传入（赋值会触发重建）：

```js
const el = document.querySelector('lark-doc')
el.options = {
  uploader: { upload: async (file) => url },
  ai: { enabled: true },
  persistence: myPersistenceAdapter,
}
```

::: warning 时序
`connectedCallback` 延迟到宏任务执行，因此**命令式调用必须等 `lark-doc-ready`**；`el.options = {...}` 要在挂载完成前或重建前设置。同步脚本阶段直接调 `el.getJSON()` 会得到 null。
:::

## 事件

全部为 `CustomEvent`（`bubbles` + `composed`，可在任意祖先上委托监听）。`detail` 结构统一：

```ts
{
  type: 'change' | 'ready' | ...,
  document: LarkDoc,  // 命令式门面实例
  editor: TiptapEditor | null,
  payload: object | null,    // 纯数据（html/json/text/save 结果等），可结构化克隆
}
```

| 事件名 | 触发时机 |
| --- | --- |
| `lark-doc-ready` | 编辑器就绪 |
| `lark-doc-change` / `lark-doc-update` | 内容变化 |
| `lark-doc-title-change` | 标题变化 |
| `lark-doc-save` | 持久化保存完成 |
| `lark-doc-import-report` | 旧数据（Vditor HTML）导入报告 |
| `lark-doc-error` | 内部异常（挂载失败、属性非法等），宿主可据此兜底 |
| `lark-doc-destroy` | 实例销毁 |
| `lark-doc-mounted` | DOM 挂载完成（element 层直接派发，比 `lark-doc-ready` 更早） |

## 方法与实例

常用方法已直接代理到元素上：`getJSON / getHTML / getText / getTitle / setTitle / setContent / importVditor / insert / insertText / focus / undo / redo / setReadonly / isReadonly / save / getConfig / getSession / can / connectCollaboration / disconnectCollaboration / getImportReport`。

需要全量 API 时取命令式门面实例：

```js
const doc = el.getInstance()   // 或 el.document
doc.on('change', handler)      // 门面级 on/off 事件
doc.off('change', handler)
```

## 生命周期与健壮性

- **重复注册保护**：模块重复执行（HMR、多入口）不会重复 `customElements.define`；
- **挂载防抖**：`connectedCallback` 延迟一拍，宿主 `appendChild` 后再设置 property 也能生效；
- **移动保护**：`disconnectedCallback` 延迟复查 `isConnected`，框架移动/复用 DOM 节点不会误销毁编辑器；
- **重连重建**：元素被移除后重新插入会重新挂载，标签内初始内容通过 slot 缓存恢复；
- **错误边界**：任何内部异常都收敛为 `lark-doc-error` 事件 + console.error，不会向宿主抛未捕获异常。

## 构建产物

```bash
npm run build:element   # dist/lark-doc-element.umd.min.js + 若干按需区块
```

- 产物内置 Vue 运行时与样式（CSS 由 JS 注入 `<style>`），首屏一个文件即可；
- 重依赖按逻辑拆成按需区块，只在真正用到时下载：`math`（KaTeX + 公式样式）、
  `office`（docx 导出 / mammoth 导入）、`markdown`（marked / turndown）、`highlight`（代码高亮）、
  `mermaid`（图表渲染器）；
- 部署时把 **`dist/` 整目录**同位托管（主文件 + `lark-doc-element.umd.min.*.js` 各按需区块 + `fonts/`）：`publicPath:'auto'` 按主文件自身 URL 推导区块地址，放在任意子目录都成立，无需任何配置；
- 想复用宿主自己的一份 mermaid 时，挂载前置 `window.mermaid` 即可（检测到就不再加载内置副本），或给元素设 `options.performance.diagramScriptUrl` 走 `<script>` 注入分支。

## 演示

`examples/element-demo.html` 是一个零框架宿主演示（属性配置、能力注入、事件日志、卸载重建）。本地预览：

```bash
cd apps/lark-doc && npm run build:element
python3 -m http.server 8765
# 打开 http://localhost:8765/examples/element-demo.html
```
