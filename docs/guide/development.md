# 本地开发与验证

第一次开发 LarkDoc，准备 Git、Node.js 22（22.13.0 或更高的 22.x）和 Python 3。库还保留 Node 14.21.3 / npm 8.19.4 的兼容构建，日常测试和 Vue 3 示例用 Node 22。

## 1. 预览当前 dev 分支

```bash
git clone --branch dev https://github.com/cuijianjun/LarkDoc.git
cd LarkDoc
npm ci
NODE_OPTIONS=--max-old-space-size=8192 npm run build:all
python3 -m http.server 8080 --bind 127.0.0.1
```

打开 [本地编辑器](http://127.0.0.1:8080/examples/element-demo.html)，在第一个示例里试着编辑正文。源码在 `src/`，构建结果在 `dist/`。修改源码后，在另一个终端重新构建并刷新页面。

## 2. 运行 Vue 3 示例

从仓库根目录进入已有示例。

```bash
cd docs/examples/apps/vue3-vite
npm ci
npm run dev -- --host 127.0.0.1
```

打开 Vite 打印的地址。可以试试编辑正文、上传图片和读取 JSON。示例使用锁定的 `lark-doc@0.14.6`，验证本分支源码请用第 1 步。 [Vue 3 接入说明](../examples/vue3-vite.md)

## 3. 启动 Docker 后端

需要已启动的 Docker 和 Docker Compose。在单独的 `lark-doc-backend` 仓库里，先确认 `docker-compose.local.yml` 中挂载到 `/opt/larkdoc-dev` 的宿主路径指向第 1 步的前端仓库根目录，再运行以下命令。

```bash
docker compose -f docker-compose.local.yml up --build --wait
curl --fail http://127.0.0.1:8793/readyz
```

就绪后打开 [Docker 联调页](http://127.0.0.1:8793/examples/element-demo.html)，用 Alice 和 Bob 演示账号测试评论和协同。已有数据库卷的迁移步骤、镜像和 Kubernetes 本地部署见后端仓库的 `ops/deployment.md`。

## 4. 检查与提交

回到前端仓库根目录。修改文档先检查链接、命令和 Git 差异。修改源码时先运行 `npm run test:affected -- 路径`，把「路径」替换成改动的文件，再运行 `npm run check:quick`。合并或提交代码前运行 `npm run check:code`。发布前运行 `npm run check` 和 `npm run verify:all`。

前端和后端分开检出时，将环境变量 `LARK_DOC_BACKEND_ROOT` 设为后端仓库的绝对路径。证据检查需要读取该仓库的 `test/evidence/schema.json`。

```bash
git status --short
git diff --check
```

只暂存这次要交付的文件。开发变更写在[开发手册的「未发布」](../../DEVELOPMENT.md#release-history)，各渠道实际发布后再更新状态。提交当前 dev 分支后，用 `git push origin dev` 推到 GitHub。

## 进阶开发

### 按入口构建

在仓库根目录执行，输出都在 `dist/`。日常先用 Node 22 安装依赖。验 Node 14 兼容构建时，安装完成后切换到 Node 14.21.3 / npm 8.19.4。

| 要构建的入口 | 命令 | 主要输出 |
| --- | --- | --- |
| 默认 `lark-doc` | `npm run build` | `lark-doc.esm.js` 和 `lark-doc.common.js`。单格式命令为 `npm run build:esm` 和 `npm run build:cjs` |
| `lark-doc/full` | `npm run build:full` | `lark-doc-full.esm.js` 和 `lark-doc-full.common.js` |
| `lark-doc/lite` | `npm run build:lite` | `lark-doc-lite.esm.js` |
| Element UMD | `npm run build:element` | `lark-doc-element.umd.min.js`、runtime、polyfills、样式和 UMD 按需区块 |
| Element ESM | `ROLLUP_TARGET=elementEsm node scripts/build-rollup.mjs` | `lark-doc-element.esm.js` 及其依赖区块 |
| Vue 2 | `npm run build:vue2` | `lark-doc-vue2.esm.js` 和 `lark-doc-vue2.common.js` |
| Vue 3、React 和其他 SDK 子入口 | `npm run build:adapters` | Vue 3、React、模板、评论、版本、Provider、迁移的 `.mjs` 文件 |
| 协同 | `npm run build:collab` | `lark-doc-collab.esm.js` 和 `lark-doc-collab.common.js`。静态演示用的浏览器协同入口由 `build:all` 构建 |
| 构建插件 | `npm run build:plugin` | `plugin.mjs` 和 `plugin.cjs` |
| 按需功能 | `npm run build:features` | `dist/features/` 下的功能模块及对应 Element UMD 区块 |
| 完整预览和发布目录 | `NODE_OPTIONS=--max-old-space-size=8192 npm run build:all` | 全部入口、共享依赖、按需区块、样式和产物清单 |

只重建单个按需功能时，可指定目标，例如 `ROLLUP_TARGET=feature:math node scripts/build-rollup.mjs`。需要它的 Element UMD 区块时，将目标换成 `feature:math:umd`。

### 按改动选择检查

源码改动先运行第 4 步的受影响测试和快速检查，再按下表加测。需要跑指定单测时，例如 `npx --no-install vitest run test/unit/http-upload.test.js test/unit/upload-provider.test.js`。

| 改动 | 加测 |
| --- | --- |
| 文档模型、块、编辑器命令 | `npm run check:lark-doc`。在预览里执行受影响的编辑操作，再试撤销、重做和重新打开 |
| 工具栏、菜单、主题和移动端 | `npm run check:ui`。在本地预览按改动选跑浏览器目标，例如 `npm run verify -- overlays mobile`，查看焦点、窄屏和触控 |
| 评论和协同 | 定向跑 `test/unit/comments-ui.test.js`、`test/unit/collab-editor.test.js` 或对应契约，再用 Docker 联调页的两个账号验证权限、同步和断线重连 |
| 上传器和媒体 | 跑上面的两支上传单测。在联调环境验证上传成功、失败、取消和重试，确认图片回显与宿主回调 |
| 图表和公式 | 运行 `npm run verify -- mermaid math`，在浏览器确认图表 SVG、公式字体和按需资源加载 |
| SDK 导出、构建脚本或依赖 | `npm run check:gate`，再执行下节产物检查。兼容性相关改动用 Node 14.21.3 验产物并在受影响宿主中试运行 |
| 文档站或六环境示例 | 按本页末尾构建。示例改动先过 `examples:check`，再打开受影响页面测试编辑、图片和读取 JSON |

浏览器目标用 `npm run verify:list` 查看。运行前启动目标场景的本地宿主，相关入口见[验证资产](../../dev/05-验证资产.md)。

### 验证构建产物

在仓库根目录用构建时的 Node 和 npm 运行 `npm run artifacts:check`。它核对源码、依赖、运行环境和产物内容。退出码 `0` 表示可复用，`1` 表示需要重建或补齐产物。这条命令只读。

对完整发布目录运行 `npm run check:artifacts`。它会按需重建，检查 lite、兼容语法、Vditor 导入、Rollup 产物及预压缩文件。排查某一项时可单独运行下列命令。遇到缺失的入口或构建图，先完成 `build:all`。

| 想确认什么 | 命令 |
| --- | --- |
| `package.json` 的入口和导出文件都存在 | `npm run check:pkg` |
| Rollup 入口、模块格式和协同外部依赖 | `npm run check:rollup` |
| lite 的按需行为和旧宿主语法 | `npm run check:lite`、`npm run check:legacy` |
| 各项 gzip 体积是否符合预算 | `npm run size`。逐项看实测字节数和上限 |

查找完整产物时看 `dist/lark-doc-manifest.json`。需要追踪首屏依赖和按需区块时看 `dist/lark-doc-graph.json`，体积检查也读取这份构建图。

要交付 SDK 时，从最终安装包在目标宿主做一次安装、引入和运行验证。公开包和内网离线包的生成与验收命令见[开发手册](../../DEVELOPMENT.md#distribution)。

### 构建文档站和全部示例

在仓库根目录执行。以下命令用 `nvm` 切换预先安装的 Node 版本。

```bash
nvm use 22
npm ci
npm --prefix docs run examples:install
nvm use 14.21.3
NODE_OPTIONS=--max-old-space-size=8192 npm run build:all
node scripts/demo-sync-vendor.mjs
npm --prefix docs run examples:webpack
nvm use 22
npm --prefix docs run examples:vite
npm --prefix docs run examples:check
nvm use 20
npm --prefix docs ci
npm --prefix docs run docs:build
```

修改站点页面时，用 `npm --prefix docs run docs:dev` 边写边看，或用 `npm --prefix docs run docs:preview` 查看构建产物。默认站点路径为 `/LarkDoc/`。 [文档站部署](./deployment-docs-site.md)

- [开发手册](../../DEVELOPMENT.md)说明 SDK 出包、内网交付和发布流程。
- [业务接入](./view-integration.md)说明保存、权限与 Provider 的接线。
