# Web Component（跨框架接入）

`<lark-doc>` 自定义元素让编辑器脱离宿主框架：Vue 2 / Vue 3 / React / Svelte / 纯 HTML 都可以直接使用，**宿主无需安装 Vue**——内部使用原生 DOM renderer，不再内联 Vue 运行时；样式随 JS 注入，对外只暴露标签、属性、事件与命令式 API。

## 快速开始

从[Web Component 完整示例](/examples/web-component)开始：同一页包含安装、完整 HTML、上传配置、事件读取、生命周期清理和运行预览。本页作为属性、事件与方法参考。

无打包器时，完整托管 `dist/`，通过独立 script 加载 `lark-doc-element.umd.min.js`。现代 Vite / Webpack5 可用 `import 'lark-doc/element'`，它选择 Element ESM、注册标签并注入样式，重功能使用原生动态 import。

Webpack4 推荐根命令式 `LarkDoc` API，样式使用 `lark-doc/dist/lark-doc.css`；标签方案则独立加载 UMD。新的 Element ESM 使用 `import.meta.url`，不交给 Webpack4 打包，也不要把静态 UMD 再打进应用 bundle。

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
| `autosave` | JSON | 整段自动保存配置，如 `{"enabled":false,"delay":1200}`（变更重建实例） |
| `autosave-enabled` | boolean | 自动保存开关（热更新，走 `setAutoSave()`，不重建实例） |
| `autosave-delay` | number | 自动保存防抖毫秒（热更新，同上） |
| `autofocus` | boolean | 挂载后自动聚焦 |
| `mode` / `document-id` | string | 协同模式与文档标识 |
| `max-length` | number | 正文最大字符数（写入 `limits.maxLength`） |

**热更新规则**：`readonly` / `content-format` / `theme` / `title` / `user` / `autosave-enabled` / `autosave-delay` 变更会增量生效（不重建实例）；其余初始化属性变更可能重建：未显式传新 content 时保留当前正文与标题，但撤销历史不保证保留；显式 content 变更表示替换正文。

`autosave` 整段 JSON 只用于初始化，与两个标量同时存在时标量优先；标量属性运行中修改会调用门面 `setAutoSave()`，并按新值重排已排队的保存定时器，关闭不会留下一次「刚关却仍落盘」。属性被移除时回落默认值（`enabled:true` / `delay:650`）。

## 对象型能力（property 注入）

上传、AI、协同 Provider 这类对象/函数无法写进 HTML 属性，通过 `element.options` property 传入，保留函数和对象身份；不要 JSON 序列化成 attribute：

```js
const el = document.querySelector('lark-doc')
el.options = {
  uploader: { upload: async (file, ctx) => ({ url: await uploadFile(file, ctx) }) },
  ai: { endpoint: '/api/ai' },        // 只给地址；也可传 { protocol:'openai', baseURL, apiKey, model }
  persistence: myPersistenceAdapter,
}
```

只更新上传回调时保留其他对象配置：

```js
el.options = { ...el.options, uploader: nextUploader }
// 或取门面后更新：el.getInstance().setUploader(nextUploader)
```

Vue2 options 使用 uploader prop；Vue3 的 resolveVue3Attrs 保留 options 对象，可显式 `:options.prop="options"`；React 薄壳通过 effect 写 element.options。全部共用[上传器](/blocks/uploader)的十个方法/回调、URL/base64、可选 attchId 和 ctx.cancel 语义，不复制状态机。

::: tip AI 配置不是开关
`ai` 只负责「怎么生成」，`features.ai` 才是显不显示入口。`ai: { enabled: true }` 这类没有地址也没有钩子的写法会被判为无效并回退本地 Mock。三档写法见 [AI 组件](/blocks/ai)。
:::

::: warning 时序
connectedCallback 延迟到宏任务执行，因此命令式读取要等 lark-doc-ready。挂载前可写 options；挂载后仅改变 uploader / uploadImage 时会调用 doc.setUploader 原地更新，保留 Editor、正文、标题和撤销历史。其他初始化能力变更可能重建，不将上传热更新保证推广到所有 options。
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

库包统一由 Rollup 构建，应用继续使用自己的构建工具：

```bash
npm run build:element
```

- npm import `lark-doc/element` 选择 Element ESM，供现代 Vite/webpack5 使用，样式随 JS 注入；重功能使用原生动态 import。
- require/CDN 选择 `lark-doc-element.umd.min.js`，独立 script 直挂；配套 feature UMD 按主脚本同目录加载。不是 bundler 的默认 Element 格式。
- 两种格式均无 Vue / Webpack runtime。静态部署保留完整 dist、features、CSS 和 fonts，不能只复制主文件。
- 字体与 feature 均随包发布；Element ESM 通过 import.meta.url 定位字体，UMD 使用自身脚本目录。格式、语法降级与 runtime polyfill 的区别见[产物说明](/guide/build-artifacts)。

