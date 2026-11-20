<script setup>
import EnvironmentPreview from './EnvironmentPreview.vue'
</script>

# Vue2 + Webpack5

适合使用 Vue2 和 Webpack5（包括 Vue CLI5）的应用。本页最小工程使用 **Node 14.21.3、npm 8.19.4、lark-doc 0.14.10**；Vue 与模板编译器版本由下面的 `package.json` 配对固定。

<EnvironmentPreview env="vue2-webpack5" title="Vue2 + Webpack5" />

预览运行下面的真实 Vue2 工程。编辑正文后，页面的更新次数会变化；点击“读取 JSON”可读取标题和正文。选择或拖入图片，可以看到本地 base64 上传状态。

## 1. 安装

已有应用在项目根目录执行：

```bash
npm install lark-doc@0.14.10 buffer@5.7.1 --save-exact
```

Webpack5 不再自动补齐 Node 的 `Buffer`，Word 导入依赖会用到它，因此这里一并安装浏览器实现 `buffer@5.7.1`。

保留已有的 Vue2、Vue CLI、Webpack 和 loader 配置。下面的完整工程用于从空目录练习，不需要拿它覆盖已有项目的配置。

## 2. 引入与生命周期

```js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'
```

在 `mounted` 里创建实例，在 `beforeDestroy` 里调用 `destroy()`。实例保存在普通实例字段上，避免放进 Vue2 的 `data` 响应式系统。初始化、内容读取和上传回调都在下面的 `src/App.vue` 中。

命令式接入不需要编辑器专属 alias 或 `transpileDependencies`。CSS、字体和图片由宿主的资源规则处理，下面的 Webpack 配置展示了一个最小组合。

## 3. 完整最小工程

在新建目录中，按文件名保存以下五个文件；其中 `src` 是子目录。所有必需配置和组件均在本页，无需另建共用上传配置文件。

::: code-group

```json [package.json]
<!--@include: ./apps/vue2-webpack5/package.json-->
```

```js [webpack.config.cjs]
<!--@include: ./apps/vue2-webpack5/webpack.config.cjs-->
```

```html [index.html]
<!--@include: ./apps/vue2-webpack5/index.html-->
```

```js [src/main.js]
<!--@include: ./apps/vue2-webpack5/src/main.js-->
```

```vue [src/App.vue]
<!--@include: ./apps/vue2-webpack5/src/App.vue-->
```

:::

示例显式使用 `storage: 'none'`，刷新后恢复初始内容。上传器没有配置 `action` 或 `upload`，图片在浏览器中读取为 base64，不请求上传服务器。

## 4. 启动与验收

在上述 `package.json` 所在目录执行：

```bash
npm install
npm run dev
```

打开 `http://localhost:4175`。需要生成静态产物时执行 `npm run build`，输出到 `dist/`。

1. 修改标题与正文，点击“读取 JSON”，确认读到当前值，正文更新次数增加。
2. 选一张图片或将图片拖入正文，确认图片显示，页面图片状态最终变为 `success（local）`。
3. 在应用内切换页面时保留 `beforeDestroy` 清理，取消当前编辑器未完成的任务。

## 可选：改为服务器上传

在 `mounted` 中初始化编辑器时传入 `uploader`。 完整配置、返回字段和回调在[图片上传](/blocks/uploader#初始化配置-http-上传)。接口由应用后端提供。
