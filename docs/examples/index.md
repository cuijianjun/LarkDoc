# 环境示例中心

选择与你的应用匹配的一页，从安装、引入和配置走到可运行的完整示例。每页都包含必要文件、生命周期清理、图片回调，以及由对应工具链构建的预览。

| 你的应用 | 完整示例 | 接入方式 |
| --- | --- | --- |
| Vue2，使用 Webpack5 或 Vue CLI5 | [Vue2 + Webpack5](/examples/vue2-webpack5) | `mounted` 创建，`beforeDestroy` 销毁 |
| Vue2，使用 Webpack4 或 Vue CLI4 | [Vue2 + Webpack4](/examples/vue2-webpack4) | 主入口配合实际 CSS 路径 |
| Vue3，使用 Vite | [Vue3 + Vite](/examples/vue3-vite) | `onMounted` 创建，`onBeforeUnmount` 销毁 |
| React，使用 Vite | [React + Vite](/examples/react-vite) | `useEffect` 创建并返回清理函数 |
| 普通 HTML，使用 script 或 CDN | [原生 HTML / CDN](/examples/html-cdn) | `window.LarkDoc.LarkDoc` 命令式创建 |
| 希望使用 `<lark-doc>` 标签 | [Web Component](/examples/web-component) | property 传对象，DOM 事件读变化 |

示例使用已发布的 `lark-doc@0.14.6`。已有项目只需安装 SDK，保留自己的框架与工具链；想从空目录练习，就按所选页面复制全部文件。Vue2 示例中的 Vue 与模板编译器必须匹配，SDK 本身不要求补装 Vue。

预览默认使用本地 base64 图片，不需要上传服务器；正文和上传回调会更新页面状态。服务器上传配置也放在各自页面中，接口由你的后端提供，文档站不提供上传服务。

已有应用使用 Vue2 + Vite、SSR 或 Node 测试时，见[其他环境与兼容说明](/guide/environments)。想自由修改初始化代码，可以打开<a href="../demo/" target="_blank" rel="noopener">Playground</a>。
