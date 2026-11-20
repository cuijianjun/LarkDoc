<script setup>
import EnvironmentPreview from './EnvironmentPreview.vue'
</script>

# 原生 HTML / CDN

用普通 `<div>` 容器运行编辑器。准备 Node/npm 获取 **lark-doc 0.14.10**，再用 Python 3 启动本地服务。

<EnvironmentPreview env="html-cdn" title="原生 HTML / CDN" />

预览使用下面的完整 HTML 与同版本 SDK 静态资源。修改正文、点击“读取 JSON”或插入图片，都能在页面上看到实际状态。

## 1. 安装与准备资源

在一个空目录执行：

```bash
npm init -y
npm install lark-doc@0.14.10 --save-exact
mkdir -p public/vendor
cp -R node_modules/lark-doc/dist/. public/vendor/
```

将完整 `dist/` 的内容复制到 `public/vendor/`，保留 feature 脚本、CSS、字体和所有子目录。上面的复制命令适用于 macOS/Linux；Windows 也可以直接复制目录内容。不要只复制主 JS，公式、图表、Word 与高亮会用到配套文件。

## 2. 引入与配置

HTML 使用普通 script 引入：

```html
<script src="./vendor/lark-doc-element.umd.min.js"></script>
```

主入口从同目录异步加载 runtime 和样式。先准备容器，等 `window.LarkDoc.runtimeReady` 完成，再从返回值取出 `LarkDoc` 构造器。

页面离开时调用实例的 `destroy()`，释放编辑器监听和未完成的图片任务。示例设置 `storage: 'none'`，刷新后恢复初始内容。

## 3. 完整 HTML

将以下内容保存为 `public/index.html`，与上面的 `vendor/` 目录同级：

```html [public/index.html]
<!--@include: ./apps/static/html-cdn.html-->
```

没有配置 `uploader.action` 和 `uploader.upload` 时，图片在浏览器中读取为 base64。页面状态来自真实的正文事件和上传回调。

## 4. 启动与验收

在 `public` 的上一级目录执行：

```bash
python3 -m http.server 4176 --directory public
```

打开 `http://localhost:4176`，通过 HTTP 访问，不直接双击 HTML。

1. 修改标题与正文，点击“读取 JSON”，确认读到当前值，正文更新次数增加。
2. 选一张图片或将图片拖入正文，确认图片显示，页面图片状态最终变为 `success（local）`。
3. 插入公式或图表，确认字体和配套脚本正常加载，Network 中没有资源 404。

部署时完整上传 `public/`。如果使用自己的 CDN，把 script 地址改为 CDN 上同版本的主 JS 地址，并在该地址的同目录保留 runtime、特性脚本、字体等整套配套资源；UMD 会相对主脚本定位它们。

## 可选：改为服务器上传

在 `public/index.html` 中替换示例里的 `uploader` 对象。 完整配置、返回字段和回调在[图片上传](/blocks/uploader#初始化配置-http-上传)。接口由应用后端提供。
