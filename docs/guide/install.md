# 安装与离线

从[示例中心](/examples/)选择你的框架。这里说明如何安装 npm 版、使用内网包或把资源放到静态服务器。

## 在线安装 {#do-install-online}

Vue2、Vue3、React 和无框架应用使用相同命令：

```bash
npm install lark-doc@0.14.12 --save-exact
npm ls lark-doc
```

提交应用的锁文件，让本地和 CI 安装同一版本。Node 版本按应用的 Vite、Webpack 或 Vue CLI 要求选择。

## 内网安装 {#do-install-intranet}

如果收到的是独立交付的 `0.14.6-intranet.1`，将校验过的 tgz 放进应用的 `vendor/`，按[内网迁移](/guide/intranet-migration)安装。内网包带齐 SDK 的运行依赖，框架和业务依赖仍需由应用准备。

源码出包及版本规则见[开发手册的 SDK 与内网交付](https://github.com/cuijianjun/LarkDoc/blob/master/DEVELOPMENT.md#distribution)。

## 引入方式 {#do-import}

每个环境的完整工程见[示例中心](/examples/)。常规应用使用根入口；全量、lite 和可选特性的差异见[产物参考](/guide/build-artifacts)。

## 宿主配置 {#do-config}

Webpack4、Webpack5 和 Vite 的最小配置已放在各自环境页。已有应用保留自身配置，只加入 SDK、必要样式和生命周期；不要为编辑器替换整个应用工具链。

## 静态托管：复制完整 dist {#do-copy}

npm/bundler 接入通常无需此步。普通 HTML、CDN 或内网静态服务器需要：

```bash
mkdir -p public/vendor/lark-doc
cp -R node_modules/lark-doc/dist/. public/vendor/lark-doc/
```

```html
<script src="./vendor/lark-doc/lark-doc-element.umd.min.js"></script>
<lark-doc title="我的文档" storage="none"></lark-doc>
```

完整保留特性 JS、共享区块、CSS、fonts 和其它子目录；不要只复制主文件。UMD 相对主脚本定位资源，支持网站子路径。现代 bundler 使用 Element ESM 时由宿主接管动态 import，不要把静态 UMD 再次打进应用。

## 安装后验收 {#do-verify}

1. `npm ls lark-doc` 显示预期版本，确认不是旧源码 alias 或未更新的本地包。
2. 编辑器能显示、输入并触发正文更新；页面离开后能正常销毁。
3. 插入图表和公式，确认实际 SVG、公式及字体显示，Network 无资源 404。
4. 无上传接口时先测 base64；配置接口后，确认 multipart 请求、返回地址、图片加载与回调都正常。

[六环境示例](/examples/)可先验证编辑与 base64；[配置 Playground](/demo/)可检查图表和更多初始化配置；服务器模式需要你提供接口。GitHub Pages 不提供上传后端。常见错误见[排错对照](/guide/environments#env-troubleshoot)。
