# 各环境引入对照

Vue2、Vue3、React 都可以使用同一个 `new LarkDoc(options)`。差异在于创建和销毁的生命周期；上传配置及回调保持一致。库使用 Rollup，应用继续使用原有构建工具。

## 先选接入方式

| 环境 | 安装与引入 | 配置 |
| --- | --- | --- |
| Vue2 / Vue3 / React / 无框架 | `npm i lark-doc@0.14.4 --save-exact`；主入口 + 公共 CSS | 命令式不需要 lark-doc 专属 alias |
| Webpack4 | 同一主入口；CSS 用 `lark-doc/dist/lark-doc.css` | 深入口写实际文件路径；Element 标签用独立 UMD script |
| Vue2 兼容组件 | `lark-doc/vue2` | 使用应用已有 Vue2 注册，不为库补装另一份 Vue |
| Web Component / Vue3 标签 | `lark-doc/element` | 对象通过 options property；Vue3 放行自定义标签 |
| React 标签薄壳 | `lark-doc/element` + `lark-doc/react` | `createReactLarkDoc(React)` 在模块级调用一次 |
| 静态 HTML | `dist/lark-doc-element.umd.min.js` | 整个 dist 同位托管 |
| SSR | 客户端动态 import | 不在服务端创建编辑器 |

普通默认/full/lite 需显式引 CSS。Element ESM/UMD 自动注入样式，不再单独引公共 CSS。Vue2 options 本身没有 Vue runtime import，但仍需要应用已有的 Vue2 执行组件生命周期。

以下示例是在**已有可运行应用**中添加编辑器，不要求新建或替换整套应用工具链。SSR 和 Node 的例子是接入模式说明，不等同于本轮重新运行了所有版本的 Nuxt/Next/Jest。

## 共用的上传配置

为了让三框架示例使用同一份回调，在示例组件旁放一个 `upload-config.js`：

```js
// src/upload-config.js
const report = (name, event) => {
  console.log(name, event.taskId, event.source, event.mode, event.status || '')
}

export const uploader = {
  // 默认本地 base64，不需要上传服务器。
  beforeUpload: (file, ctx) => {
    console.log('上传前检查', ctx.taskId, file.name)
    return true
  },
  onStart: event => report('开始', event),
  onProgress: event => console.log('进度', event.taskId, event.percent),
  onRetry: event => report('重试', event),
  onSuccess: event => report('取得图片结果', event),
  onError: event => console.error('失败', event.error.message),
  onCancel: event => report('取消', event),
  onReject: event => report('拒绝', event),
  onSettled: event => report('结束', event),
  onCallbackError: error => console.error('应用回调异常', error.message),
}
```

需要服务器上传时，只需向上面对象增加 `action` 和响应映射，其余回调不变：

```js
// 向现有 uploader 增加配置；接口和字段由你的后端决定。
Object.assign(uploader, {
  action: '/api/upload',
  fieldName: 'file',
  response: {
    success: { path: 'code', equals: 0 },
    url: 'data.url',
    attchId: 'data.id',
    message: 'message',
  },
})
```

该配置等待 `{ "code": 0, "data": { "url": "/images/a.png", "id": "123" } }`。选图、粘贴、拖拽、替换、裁剪均使用这份配置。直接粘贴已有图片 URL 不伪造文件上传回调；全部时序与失败处理见[上传器](/blocks/uploader)。

## Vue2 + Webpack5 / Vue CLI5 {#env-vue2-wp5}

保留应用自己的 `vue.config.js`、Vue2、vue-loader 和 Babel 配置；无需编辑器专属 alias 或 `transpileDependencies`。CSS 和字体沿用宿主已有处理规则。

```vue
<!-- src/Doc.vue；upload-config.js 与本文件同目录 -->
<template><div ref="host" /></template>

<script>
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'
import { uploader } from './upload-config.js'

export default {
  mounted() {
    // 放在实例字段中，避免把编辑器对象放进 Vue2 的 data 响应式系统。
    this.doc = new LarkDoc({
      element: this.$refs.host,
      title: 'Vue2 文档',
      content: '<p>选图、粘贴或拖入图片。</p>',
      storage: 'none',
      uploader,
      onUpdate: ({ json }) => console.log('正文变化', json),
    })
  },
  beforeDestroy() {
    if (this.doc) this.doc.destroy()
    this.doc = null
  },
}
</script>
```

## Vue2 + Vite {#env-vue2-vite}

编辑器代码与上面的 Vue2 示例相同。保留宿主已经匹配的 Vue2 Vite 插件，不为编辑器升级 Vite 或换插件。应用自己的 Vue 与模板编译器（如果使用）应保持版本匹配；这属于 Vue2 应用配置。

## Vue2 + Webpack4 / Vue CLI4 {#env-vue2-wp4}

使用相同的 Vue2 组件，只把 CSS import 改成实际路径：

```js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/dist/lark-doc.css'
```

Webpack4 不读取 package exports，但会按 module 选择根 ESM。当前主入口与其可达 chunk 已由库降语法，无需旧的 `lark-doc$` alias 或应用专属 Babel 规则。

- 深子入口也需实际路径，例如 Vue2 options 使用 `lark-doc/dist/lark-doc-vue2.common.js`。
- 新的 Element ESM 含 `import.meta.url`，面向现代 Vite/Webpack5；Webpack4 标签方案使用[独立 script 加载 UMD](#env-static)。
- 不用把整个 node_modules 都加入转译，也不要求更换应用打包器。

## Vue2 模板兼容组件 {#env-vue2-sfc}

已有 `<lark-doc-editor>` 用法可以继续使用。正文是 `v-model` / `value`，上传对象通过 `:uploader` 直接传入。

```vue
<template>
  <lark-doc-editor
    v-model="html"
    :uploader="uploader"
    @change="onChange"
  />
</template>

<script>
import { LarkDocEditor } from 'lark-doc/vue2'
import 'lark-doc/style.css'
import { uploader } from './upload-config.js'

export default {
  components: { LarkDocEditor },
  data: () => ({ html: '<p>Vue2 组件示例。</p>', uploader }),
  methods: {
    onChange({ json }) { console.log('正文变化', json) },
  },
}
</script>
```

兼容组件负责在组件销毁时释放自己的编辑器。`LarkDocWorkspace` 提供含标题等能力的工作台；组件的 `config` 接收内部 features/layout/limits/toolbar 结构。Webpack4 改用本节前述实际 JS 和 CSS 路径。

需要全局注册时，在应用入口调用 `Vue.component('LarkDocEditor', LarkDocEditor)`；这是 Vue2 的组件注册，与 `lark-doc/full` 的全部特性注册是两件事。

## Vue3：推荐命令式 {#env-vue3}

无需配置自定义标签识别。与 Vue2 使用同一份 `uploader`，生命周期名称不同：

```vue
<template><div ref="host" /></template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'
import { uploader } from './upload-config.js'

const host = ref(null)
let doc
onMounted(() => {
  doc = new LarkDoc({
    element: host.value,
    title: 'Vue3 文档',
    content: '<p>选图后查看同一套回调。</p>',
    storage: 'none',
    uploader,
    onUpdate: ({ json }) => console.log('正文变化', json),
  })
})
onBeforeUnmount(() => { if (doc) doc.destroy() })
</script>
```

### Vue3：可选自定义标签

只在使用 `<lark-doc>` 时，配置现有 Vue 插件识别该标签：

```js
// vite.config.js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
export default defineConfig({
  plugins: [vue({
    template: { compilerOptions: { isCustomElement: tag => tag === 'lark-doc' } },
  })],
})
```

```vue
<template>
  <lark-doc
    :options.prop="options"
    @lark-doc-change="onChange"
  />
</template>

<script setup>
import 'lark-doc/element'
import { uploader } from './upload-config.js'

const options = {
  title: 'Vue3 标签示例',
  content: '<p>回调通过 property 传递。</p>',
  storage: 'none',
  uploader,
}
const onChange = event => console.log('正文变化', event.detail.payload.json)
</script>
```

对象和函数不能写成 JSON attribute；使用 `:options.prop` 保留回调。标签移出 DOM 时自动销毁。需要标量属性映射工具时再使用 `lark-doc/vue3` 的 `resolveVue3Attrs`，它不负责注册元素；仍需先引 `lark-doc/element`。

## React：推荐命令式 {#env-react}

保留已有 React/Vite/CRA 配置。下面没有变化的 props，因此 effect 挂载一次；文档切换可通过 React 的 `key` 明确重新挂载。

```jsx
import { useEffect, useRef } from 'react'
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'
import { uploader } from './upload-config.js'

export default function DocEditor() {
  const host = useRef(null)
  useEffect(() => {
    const doc = new LarkDoc({
      element: host.current,
      title: 'React 文档',
      content: '<p>选图后查看上传回调。</p>',
      storage: 'none',
      uploader,
      onUpdate: ({ json }) => console.log('正文变化', json),
    })
    return () => doc.destroy()
  }, [])
  return <div ref={host} />
}
```

React 开发模式 StrictMode 可能执行一次创建→清理→再创建，必须保留 effect 的清理函数。实际应用传入会变化的回调时，应通过 ref 或适当的依赖处理，避免空依赖 effect 捕获旧数据。

### React：可选标签薄壳

工厂放模块级，配置对象保持稳定。该薄壳将上传函数写入元素 property：

```jsx
import * as React from 'react'
import 'lark-doc/element'
import { createReactLarkDoc } from 'lark-doc/react'
import { uploader } from './upload-config.js'

const LarkDocView = createReactLarkDoc(React)
const options = { storage: 'none', uploader }

export default function DocEditor() {
  return <LarkDocView
    title="React 标签示例"
    content="<p>回调完整透传。</p>"
    options={options}
    onChange={detail => console.log('正文变化', detail.payload.json)}
  />
}
```

薄壳由宿主传入 React，不在库里打入 React。元素离开 DOM 后自动销毁，薄壳释放事件监听。直接写 TSX 自定义标签时，还需由应用声明 JSX 标签类型；使用工厂无需手写标签。

## 原生 HTML / CDN / 内网静态托管 {#env-static}

先从已安装包复制**整个** `node_modules/lark-doc/dist/` 到服务器静态目录，例如 `public/vendor/lark-doc/`。不能只复制主 JS；公式、图表、Word、高亮和字体都有配套文件。

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <script src="./vendor/lark-doc/lark-doc-element.umd.min.js"></script>
</head>
<body>
  <lark-doc id="doc"></lark-doc>
  <script>
    const el = document.getElementById('doc')
    el.options = {
      title: '静态页示例',
      content: '<p>此页面无需 Vue 或 React。</p>',
      storage: 'none',
      uploader: {
        // 不配 action：本地 base64；接服务器时加入 action: '/api/upload'
        onSuccess: event => console.log('取得结果', event.taskId),
        onError: event => console.error(event.error.message),
        onSettled: event => console.log('任务结束', event.status),
      },
    }
    el.addEventListener('lark-doc-ready', () => console.log('编辑器已就绪'))
    el.addEventListener('lark-doc-change', event => console.log(event.detail.payload.json))
    window.addEventListener('pagehide', () => el.destroy(), { once: true })
  </script>
</body>
</html>
```

UMD 从主脚本同目录寻找 feature UMD；支持子路径部署，保留整个 dist 即可。服务器应正确返回 JS、CSS 与字体 MIME。GitHub Pages 上的[在线 demo](/demo/)也使用静态资源，服务器上传模式需要你提供可访问的上传接口。

## Node / jsdom 测试 {#env-node}

Node 可以 `require('lark-doc')` 加载 CJS，创建编辑器仍需要 DOM。它不是无 DOM 的服务端 HTML 渲染器。使用测试运行器已有 jsdom 环境，例如：

```js
// 已配置 jsdom 的测试文件
const { LarkDoc } = require('lark-doc')

test('读回正文', () => {
  document.body.innerHTML = '<div id="editor"></div>'
  const doc = new LarkDoc({
    element: '#editor', content: '<p>你好</p>', storage: 'none',
    network: { mode: 'offline' },
  })
  expect(doc.getHTML()).toContain('你好')
  doc.destroy()
})
```

按测试环境补足 ResizeObserver、matchMedia 等浏览器接口，不要把测试用空实现放进生产代码。Node14 普通 CJS 编辑通过不代表服务器原生提供 XMLHttpRequest；内置上传用于浏览器。

## SSR：Next / Nuxt {#env-ssr}

导入 Element 和创建编辑器都放到客户端生命周期中。`'use client'` 仍可能有服务端预渲染，不能据此在模块顶部导入依赖浏览器的 Element。

```jsx
// Next 客户端组件
'use client'
import { useEffect, useRef } from 'react'

export default function DocEditor() {
  const host = useRef(null)
  useEffect(() => {
    let doc
    let stopped = false
    import('lark-doc/element').then(({ mountLarkDoc }) => {
      if (!stopped) doc = mountLarkDoc(host.current, {
        content: '<p>只在客户端创建。</p>', storage: 'none',
      })
    })
    return () => { stopped = true; if (doc) doc.destroy() }
  }, [])
  return <div ref={host} />
}
```

Nuxt3 同样在 onMounted 中动态导入、onBeforeUnmount 中销毁。Nuxt2/Webpack4 不读取短子路径 exports，推荐在 mounted 中使用根命令式 API；如用标签，完整托管 dist 并用独立 script 加载 UMD，等待脚本加载完成后使用。

## 更新上传配置

```js
doc.setUploader(nextUploader)

// Web Component（Vue3/React 薄壳也走这一条）：
el.options = { ...el.options, uploader: nextUploader }
```

仅上传配置变化会原地更新，不重建编辑器、正文、标题与撤销历史。Vue2 兼容组件替换 `uploader` prop 同样生效。不要由此推断任意 options 变化都保留撤销历史。

## 排错对照 {#env-troubleshoot}

| 现象 | 先检查 |
| --- | --- |
| 样式缺失 | 默认/full/lite 是否显式引 CSS；Webpack4 是否用实际路径 |
| 图表、公式、Word 资源 404 | 静态部署是否保留完整 dist；是否把 UMD 又交给 bundler 打包 |
| `Failed to resolve component: lark-doc` | Vue3 标签是否配置 isCustomElement；命令式方案不需要此项 |
| `<lark-doc> 尚未注册` | 是否在薄壳之前引入 lark-doc/element |
| Webpack4 解析 import.meta 失败 | 是否误用新 Element ESM；改根命令式 API 或独立 UMD script |
| 上传回调不执行 | 是否把含函数对象序列化成 attribute/JSON；是否只是粘贴已有 URL |
| HTTP 成功但图片失败 | 检查业务成功条件、response.url 和图片地址是否可访问 |
| SSR 报 customElements/document 不存在 | 是否把导入和创建都放在客户端生命周期 |
| 切页面后仍有任务 | 是否调用 destroy；销毁会取消当前编辑器未完成的上传 |
| `Cannot find module vue` / Vue.extend 报错 | 是否还在消费旧包或旧源码 alias；当前主库不依赖 Vue |

安装和内网依赖搬运见[安装说明](/guide/install)，完整上传契约见[上传器](/blocks/uploader)，全量与按需产物见[产物说明](/guide/build-artifacts)。
