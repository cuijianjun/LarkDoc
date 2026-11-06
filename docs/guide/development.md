# 本地开发与验证

这页仅在仓库维护，说明如何修改源码并运行文档和六环境示例。应用接入请到[线上示例中心](https://cuijianjun.github.io/LarkDoc/examples/)选择一个环境。

## 1. 下载与安装

```bash
git clone https://github.com/cuijianjun/LarkDoc.git
cd LarkDoc
nvm use 22
npm ci
npm --prefix docs run examples:install
```

`examples:install` 按各自锁文件安装四个最小应用。HTML 与 Web Component 直接使用静态资源，不另装框架。
首次构建需要联网下载依赖；已有应用保持自己的工具链。

| 用途 | 本仓库验证版本 |
| --- | --- |
| 库兼容构建、Vue2 Webpack4/5 示例 | Node 14.21.3 / npm 8.19.4 |
| 完整测试、Vue3/React Vite 示例 | Node 22.13.0 或受支持的更高版本 |
| VitePress 文档站 | Node 20，独立 `docs/package-lock.json` |

`.nvmrc` 指向库的 Node 14。不要用它运行 Vitest 5 或 Vite 7。

## 2. 构建库与 Vue2 示例

仍在仓库根目录：

```bash
nvm use 14.21.3
env -u NODE_OPTIONS npm run build:all
node scripts/demo-sync-vendor.mjs
npm --prefix docs run examples:webpack
```

库产物在 `dist/`。默认、全量、lite、适配器和自定义元素均由 Rollup 构建，应用的 Webpack/Vite 不受影响。
`demo-sync-vendor.mjs` 将当前库产物同步给配置 Playground 和静态页面。
两个 Vue2 工程分别使用真实 Webpack4、Webpack5 编译。

### 按入口构建与检查


完整开发依赖安装和 Vitest 使用 Node22.13.0 / npm8.19.4。依赖安装后，库保留 Node14.21.3 / npm8.19.4 的构建契约；不提高宿主 Node 下限来规避兼容问题。

```bash
npm ci --no-audit --no-fund
npm run build          # 默认 ESM + CJS
npm run build:full     # full ESM + CJS
npm run build:element  # Element ESM / UMD 及配套资源
npm run build:vue2     # Vue2 options ESM + CJS
npm run build:lite
npm run build:features
npm run build:all
npm run check:pkg
npm run check:rollup
npm run check:lite
npm run check:legacy
npm run size
```

上述命令描述构建与验收方式，不代表当前 worktree 的全部验收已经完成。`npm run pack:sdk` 默认生成公开包，保留由宿主共享的 external 依赖；显式加 `--intranet-version 0.14.6-intranet.1` 才生成基于公开 `0.14.6` 的自包含离线包。普通 `npm pack lark-doc@0.14.6` 不能代替内网包；出包与发布流程见[仓库开发入口](https://github.com/cuijianjun/LarkDoc/blob/master/DEVELOPMENT.md)。

构建复用按输入和产物完整性判断；`npm run artifacts:check` 只检查，不自动重建。保持子进程使用同一 Node/npm 入口，避免 PATH 中其他 npm 导致重复构建或环境漂移。

## 3. 构建 Vue3、React 与静态示例

```bash
nvm use 22
npm --prefix docs run examples:vite
npm --prefix docs run examples:check
```

Vite 示例按各自锁定的 `lark-doc@0.14.6` 构建，和页面中的 npm 安装示例一致。
`examples:check` 会检查全部六个预览，缺文件、源码变化或产物被修改时会报错，避免发布旧预览。

示例说明在 `docs/examples/`，可复制的最小工程在 `docs/examples/apps/`。
Markdown 直接包含真实应用文件，所以页面代码与实际构建共用一个来源。

## 4. 预览与构建文档站

```bash
nvm use 20
cd docs
npm ci
npm run docs:dev
```

按终端地址打开站点，再点击「示例中心」。默认部署前缀是 `/LarkDoc/`。
每个环境页都有运行预览，也能在新窗口单独打开。

准备静态站点时，仍在 `docs/` 执行：

```bash
npm run docs:build
npm run docs:preview
```

构建前会检查 Playground 与六环境预览资源，构建时会检查文档死链。
仅修改说明文字时直接重建文档；修改最小应用或构建脚本后，先重建对应示例并运行 `examples:check`。
生成目录 `docs/public/demo/vendor/`、`docs/public/examples-runtime/`、`docs/.vitepress/dist/` 不提交 Git。
GitHub Pages 工作流会从源码重新构建。

## 5. 按修改范围验证

回到仓库根目录，运行对应检查：

| 修改内容 | 命令与验证 |
| --- | --- |
| 文档文字、导航 | Node20：`npm --prefix docs run docs:build`，检查链接与页面 |
| 六环境最小应用 | 按第 2、3 步构建，`npm --prefix docs run examples:check`，逐页测试编辑、图片和读回 JSON |
| 上传器等源码 | Node22：`npx --no-install vitest run test/unit/http-upload.test.js test/unit/upload-provider.test.js`，再 `npm run check:gate` |
| 库导出、构建或发布 | Node22：`npm run check:gate`；Node14：`npm run check:artifacts` |

图表要在浏览器确认真实 SVG 与公式字体；图片要确认可显示及回调结果。
服务器上传需要自己的接口，静态站点不提供后端。单测不能代替业务接口联调。

## 6. 提交与发布

检查差异，只提交源码、锁文件、文档和构建脚本。推送 `master` 后，
[Pages 工作流](https://github.com/cuijianjun/LarkDoc/actions/workflows/deploy-docs.yml)
会发布文档、统一示例中心和配置 Playground。等待成功后，逐个打开六个路由与预览，刷新深链接，检查资源和控制台。

只有维护者需要发布新 SDK 版本时才使用 npm 发布脚本：

```bash
npm run ship -- --dry-run
npm run ship -- --version <未发布的新版本>
```

文档调整不需要重复发布已存在的 npm 版本。构建与发布细则见
[开发导航](https://github.com/cuijianjun/LarkDoc/blob/master/dev/00-INDEX.md)和
[发布说明](https://github.com/cuijianjun/LarkDoc/blob/master/dev/07-发布.md)。
