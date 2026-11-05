# 本地开发与验证

这页面向需要修改 lark-doc 源码的人。如果只是把编辑器装进业务项目，先看 [快速开始](./getting-started)。
库使用 Rollup；你的 Vue CLI、Webpack 或 Vite 应用继续使用自己的工具链。

## 1. 下载项目并安装依赖

```bash
git clone https://github.com/cuijianjun/LarkDoc.git
cd LarkDoc
nvm use 22
npm ci
```

使用 Node 22.12+ 或 Node 24 安装和运行完整测试，提交 `package-lock.json` 以保持版本一致。
仓库 `.nvmrc` 的 Node 14.21.3 是兼容构建版本，不能运行 Vitest 5。应用项目另按自己的版本安装。

## 2. 构建库

```bash
nvm use 14.21.3
env -u NODE_OPTIONS npm run build:all
```

第一次会构建全部入口。之后相同输入和输出可使用缓存；改源码、依赖或版本会按需要重新构建。
产物在 `dist/`，包含默认、全量、按需、各框架适配器、Web Component 及配套资源。
不要只拿很小的入口文件：它还会引用同目录 chunk、功能脚本和字体。

## 3. 预览文档与 demo

在仓库根目录先同步刚构建的编辑器，然后进入独立的文档子包：

```bash
node scripts/demo-sync-vendor.mjs
node scripts/demo-sync-vendor.mjs --check
nvm use 20
cd docs
npm ci
npm run docs:dev
```

按终端地址打开文档，再点导航中的「在线演示」。GitHub Pages 默认路径为 `/LarkDoc/`。
Demo 提供完整编辑器、base64、服务器上传、图表四组示例，代码区可以直接修改。
服务器上传需要你填真实接口；静态页面不提供上传后端。配置和返回示例见 [上传器](../blocks/uploader)。

要检查可部署产物，仍在 `docs/` 中运行：

```bash
npm run docs:build
npm run docs:preview
```

构建会检查文档死链。`docs/public/demo/vendor/` 是生成资源，不提交到 Git；
更新库后重新 build 与 sync。GitHub Actions 会对同一提交重复这些步骤，避免文档与 demo 版本错开。

## 4. 修改后验证

回到仓库根目录，用现代 Node 跑单测和门禁：

```bash
cd ..
nvm use 22
env -u NODE_OPTIONS npm run check:gate
```

再用兼容版本校验发布产物：

```bash
nvm use 14.21.3
env -u NODE_OPTIONS npm run check:artifacts
```

图片上传定向检查可在现代 Node 下运行：

```bash
npx --no-install vitest run test/unit/http-upload.test.js test/unit/upload-provider.test.js
```

图表必须在浏览器确认出现 SVG；上传要检查真实请求、图片可显示、回调和失败/取消情况。
单测通过不能代替这些浏览器验证。构建耗时与各环境结果见 [性能与验证记录](./performance)。

## 5. 提交与发布

检查差异，只提交本次相关源码、文档和示例。推送 `master` 后，仓库的
[Pages 工作流](https://github.com/cuijianjun/LarkDoc/actions/workflows/deploy-docs.yml)
会构建并发布 [文档](https://cuijianjun.github.io/LarkDoc/) 与 [demo](https://cuijianjun.github.io/LarkDoc/demo/)。
等待 workflow 成功后，再打开线上页面确认版本、图表和上传示例。

维护者获得 npm 发布权限后，在 `master` 使用项目发布脚本：

```bash
npm run ship -- --dry-run
npm run ship -- --version <准备发布的新版本>
```

将占位版本换成未发布的真实版本。发布脚本会执行校验、打包、发布并核对 registry tarball，再推送标签。
如果中断，按错误修复后使用 `npm run ship -- --resume`。不要覆盖已经发布的版本。
源码细节和发布参数见仓库的
[开发导航](https://github.com/cuijianjun/LarkDoc/blob/master/dev/00-INDEX.md) 与
[发布说明](https://github.com/cuijianjun/LarkDoc/blob/master/dev/07-发布.md)。
