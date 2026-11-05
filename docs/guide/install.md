# 安装与离线

首次接入请直接选择[示例中心](/examples/)中的环境；安装、引入、配置和最小 demo 都在同一页。本文补充锁版本、内网依赖和静态资源搬运。

## 在线安装 {#do-install-online}

Vue2、Vue3、React 和无框架应用使用相同命令：

```bash
npm install lark-doc@0.14.5 --save-exact
npm ls lark-doc
```

锁定版本并提交应用锁文件，保证本地和 CI 安装一致。普通编辑不声明 Vue 或协同 optional peer，不需要 `--legacy-peer-deps`；应用本身的依赖冲突应按实际报错处理。

Node14.21.3 的契约是库构建与普通 CJS 消费，应用仍遵守自身 Vite、Webpack 或 Vue CLI 的 Node 要求。源码开发工具与显式协同的要求见[开发说明](https://github.com/cuijianjun/LarkDoc/blob/master/DEVELOPMENT.md)。

## 内网安装 {#do-install-intranet}

`npm pack lark-doc@0.14.5` 得到的普通 tgz **不包含 node_modules 运行时依赖**。联网机器可以安装它；完全离线不能只带这一份包。

已有内网 npm 镜像时，将该版本及依赖同步到镜像，再用正常 npm 安装。仓库保留了历史离线出包辅助脚本：

```bash
# 在已经安装开发依赖的 LarkDoc 仓库根目录执行
bash scripts/pack-intranet.sh --version 0.14.5
```

该辅助脚本的打包依赖闭包尚未按本轮新增的外部依赖重新验收，不能把生成 tgz 当成本轮离线安装通过的证明。需要 npm 接入时优先同步完整依赖到内网镜像；无打包器的静态页面可使用下面的完整 dist 方案。历史搬运步骤见[内网迁移实战](/guide/intranet-migration)。

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
