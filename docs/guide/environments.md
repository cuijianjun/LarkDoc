# 补充接入与排错

六个主要环境的安装、引入、配置和最小 demo 已集中到[统一示例中心](/examples/)。下面保留其它接入形式及常见问题，按需要查询。

## Vue2 + Webpack5 / Vue CLI5 {#env-vue2-wp5}

打开 [Vue2 + Webpack5 完整示例](/examples/vue2-webpack5)。已有 Vue CLI5 项目保留原有配置，只加入 SDK、样式和组件生命周期代码。

## Vue2 + Webpack4 / Vue CLI4 {#env-vue2-wp4}

打开 [Vue2 + Webpack4 完整示例](/examples/vue2-webpack4)。主入口无需旧的根 alias；CSS 和深子入口使用实际 `dist` 路径。标签方式使用独立 UMD script。

## Vue3 {#env-vue3}

打开 [Vue3 + Vite 完整示例](/examples/vue3-vite)。先使用命令式挂载；希望通过自定义标签接入时再看 [Web Component 完整示例](/examples/web-component)。

## React {#env-react}

打开 [React + Vite 完整示例](/examples/react-vite)。示例包含 effect 清理；React StrictMode 的创建、清理、再创建也应正常工作。

## 原生 HTML / CDN {#env-static}

打开 [HTML / CDN 完整示例](/examples/html-cdn)。页面包含完整 HTML、静态资源复制和运行命令。

## Vue2 + Vite {#env-vue2-vite}

保留应用已经匹配的 Vue2 Vite 插件、Vue 与模板编译器版本。编辑器代码使用 [Vue2 示例](/examples/vue2-webpack5)中的 `mounted` 创建与 `beforeDestroy` 销毁；不复制 Webpack 配置到 Vite。

该组合没有作为本轮独立运行路由重新验收，需按应用自己的插件版本构建验证。

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
const uploader = { onSuccess: event => console.log('图片已就绪', event.taskId) }

export default {
  components: { LarkDocEditor },
  data: () => ({ html: '<p>Vue2 组件示例。</p>', uploader }),
  methods: {
    onChange({ json }) { console.log('正文变化', json) },
  },
}
</script>
```

兼容组件负责在组件销毁时释放自己的编辑器。`LarkDocWorkspace` 提供含标题等能力的工作台；组件的 `config` 接收内部 features/layout/limits/toolbar 结构。Webpack4 的组件导入使用 `lark-doc/dist/lark-doc-vue2.common.js`，样式使用 `lark-doc/dist/lark-doc.css`。

需要全局注册时，在应用入口调用 `Vue.component('LarkDocEditor', LarkDocEditor)`；这是 Vue2 的组件注册，与 `lark-doc/full` 的全部特性注册是两件事。

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
