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

## 需要时再看

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

用 `npm --prefix docs run docs:preview` 查看文档产物。 [文档站部署](./deployment-docs-site.md)

- [开发手册](../../DEVELOPMENT.md)说明 SDK 出包、内网交付和发布流程。
- [业务接入](./view-integration.md)说明保存、权限与 Provider 的接线。
