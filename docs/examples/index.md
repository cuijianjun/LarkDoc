# 环境示例中心

按你项目里的框架和打包器选一页。每页都能直接试编辑器，也提供启动命令和完整代码。还没选框架时，可以先试[原生 HTML](/examples/html-cdn)。

| 你的应用 | 完整示例 | 接入方式 |
| --- | --- | --- |
| Vue2，使用 Webpack5 或 Vue CLI5 | [Vue2 + Webpack5](/examples/vue2-webpack5) | `mounted` 创建，`beforeDestroy` 销毁 |
| Vue2，使用 Webpack4 或 Vue CLI4 | [Vue2 + Webpack4](/examples/vue2-webpack4) | 用实际 CSS 路径引入样式 |
| Vue3，使用 Vite | [Vue3 + Vite](/examples/vue3-vite) | `onMounted` 创建，`onBeforeUnmount` 销毁 |
| React，使用 Vite | [React + Vite](/examples/react-vite) | `useEffect` 创建并清理 |
| 普通 HTML，使用 script 或 CDN | [原生 HTML / CDN](/examples/html-cdn) | 等待 `runtimeReady` 后创建 |
| 希望使用 `<lark-doc>` 标签 | [Web Component](/examples/web-component) | property 传对象，DOM 事件读变化 |

此处是固定依赖的六环境兼容工程，使用 `lark-doc@0.14.10`。功能页演示使用 `lark-doc@0.14.12`。先编辑正文并读取 JSON，再选图试用浏览器本地预览。Vue 2 示例的 Vue 与模板编译器版本需要匹配。

接入自己的上传接口时看[图片上传](/blocks/uploader)。Vue2 + Vite、SSR 或 Node 测试见[兼容与排错](/guide/environments)。
