<script setup>
import EnvironmentPreview from './EnvironmentPreview.vue'
</script>

# React + Vite

适合使用 React 和 Vite 的浏览器应用。本页最小工程使用 **Node 22.13.0、npm 8.19.4、lark-doc 0.14.10**，具体依赖固定在下面的 `package.json`。Vite 7 需要 Node 20.19+ 或 22.12+，已有项目继续遵守自己的工具链要求。

<EnvironmentPreview env="react-vite" title="React + Vite" />

预览运行下面的真实 React 工程。编辑正文后，页面的更新次数会变化；点击“读取 JSON”可读取标题和正文。选择或拖入图片，可以看到本地 base64 上传状态。

## 1. 安装

已有应用在项目根目录执行：

```bash
npm install lark-doc@0.14.10 --save-exact
```

保留已有的 React 和 Vite 配置。下面的独立工程用于从空目录练习，不需要拿它覆盖已有项目的配置，也不需要为 SDK 安装其他框架。

## 2. 引入与生命周期

```js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'
```

在 `useEffect` 中创建，并返回调用 `destroy()` 的清理函数。React StrictMode 在开发模式可能执行创建→清理→再创建，清理函数必须保留。本页配置保持固定；应用中变化的回调需要通过 ref 或合适的 effect 依赖管理，避免捕获旧值。

完整初始化、内容读取和上传回调都在下面的 `src/App.jsx` 中。默认主入口需要显式引入公共 CSS。

## 3. 完整最小工程

在新建目录中，按文件名保存以下五个文件；其中 `src` 是子目录。所有必需配置和组件均在本页，无需另建共用上传配置文件。

::: code-group

```json [package.json]
<!--@include: ./apps/react-vite/package.json-->
```

```js [vite.config.js]
<!--@include: ./apps/react-vite/vite.config.js-->
```

```html [index.html]
<!--@include: ./apps/react-vite/index.html-->
```

```jsx [src/main.jsx]
<!--@include: ./apps/react-vite/src/main.jsx-->
```

```jsx [src/App.jsx]
<!--@include: ./apps/react-vite/src/App.jsx-->
```

:::

示例显式使用 `storage: 'none'`，刷新后恢复初始内容。上传器没有配置 `action` 或 `upload`，图片在浏览器中读取为 base64，不请求上传服务器。

## 4. 启动与验收

在上述 `package.json` 所在目录执行：

```bash
npm install
npm run dev -- --port 4178
```

打开 `http://localhost:4178`。需要生成静态产物时执行 `npm run build`，输出到 `dist/`；`npm run preview -- --port 4178` 可预览构建结果。

1. 修改标题与正文，点击“读取 JSON”，确认读到当前值，正文更新次数增加。
2. 选一张图片或将图片拖入正文，确认图片显示，页面图片状态最终变为 `success（local）`。
3. 在应用内切换页面时保留卸载清理，取消当前编辑器未完成的任务。

## 可选：改为服务器上传

在 `useEffect` 中初始化编辑器时传入 `uploader`。 完整配置、返回字段和回调在[图片上传](/blocks/uploader#初始化配置-http-上传)。接口由应用后端提供。
