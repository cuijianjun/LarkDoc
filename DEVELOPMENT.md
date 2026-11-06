# lark-doc 开发入口

**只想在应用里使用编辑器**：打开[统一示例中心](https://cuijianjun.github.io/LarkDoc/examples/)，选择一个环境。安装、引入、配置和可运行代码都在对应页面。

**准备修改本仓库源码**：按[本地开发与验证](./docs/guide/development.md)依次完成安装、库构建、六环境预览和检查。完整操作集中在这一页。

| 目录 | 内容 |
| --- | --- |
| `src/` | 编辑器、工作台、上传器和框架适配器 |
| `docs/examples/` | 六个环境的说明页和真实最小应用源码 |
| `docs/` | 使用手册与文档站 |
| `dev/` | 修改各模块时需要遵守的开发约束 |
| `test/`、`scripts/` | 测试、构建与发布工具 |

库兼容构建使用 Node 14.21.3；完整测试和 Vite 示例使用 Node 22.13.0+；文档站独立使用 Node 20。
应用继续使用自己的工具链。具体命令与顺序见上面的开发页，不要直接用 Node 14 跑 Vitest 或 Vite 7。

日常按[开发导航](./dev/00-INDEX.md)选择相关章节。发布规则见[发布说明](./dev/07-发布.md)，当前版本以 `package.json` 为准。

线上文档面向 SDK 调用者。本地开发、[历史性能验收](./docs/guide/performance.md)与[文档站部署](./docs/guide/deployment-docs-site.md)只在仓库维护，不编译进线上页面或搜索索引；修改相关能力时仍需同步这些源文件。

Windows 内网交付按[两环境迁移](./docs/guide/intranet-migration.md)操作：两个 Windows 包各含 SDK、对应最小 demo、Git Bash 说明和校验清单，Linux 静态文档单独打包。Vue2 使用 npm，Vue3 使用 pnpm 9/10。SDK 自包含只覆盖其运行依赖，原应用的 Vue、Webpack/Vite 和业务依赖由原项目准备。

公开 SDK 与 Windows 内网交付使用同一个仓库出包入口，不依赖维护者电脑上的外置脚本。先按[本地开发与验证](./docs/guide/development.md)安装固定开发依赖并构建库，将 `LARK_DOC_NODE14_DIR` 设为本机 Node 14.21.3 的 `bin` 目录，再用 Node 22+、Python 3 执行：

```bash
npm run pack:sdk -- --out /tmp/larkdoc-sdk --work /tmp/larkdoc-sdk-work \
  --node14 "$LARK_DOC_NODE14_DIR/node"
```

输出目录和工作目录必须在仓库外，使用新目录，不能覆盖已交付版本。默认生成公开版 `lark-doc-0.14.6.tgz`，保留 external 依赖，由宿主安装并共享；`scripts/release.sh` 只发布经过验证的这份公开 tgz 为 `latest`。

内网自包含包显式指定独立版本：

```bash
npm run pack:sdk -- --out /tmp/larkdoc-intranet-sdk --work /tmp/larkdoc-intranet-sdk-work \
  --node14 "$LARK_DOC_NODE14_DIR/node" --intranet-version 0.14.6-intranet.1
```

内网构建以公开 `0.14.6` 的源码、产物和固定依赖图为基础，补齐 `collabDependencies`，在暂存目录处理 107 个运行依赖包（45 个直接依赖）、Webpack4 子入口与依赖语法，再完整归档。原仓库 `node_modules` 不被改写，SDK 不包含 Vue、Webpack 或 Vite。普通 `npm pack lark-doc@0.14.6` 不含这套离线闭包。

组装前，在 `/tmp/larkdoc-intranet-locks/vue2-webpack4/package-lock.json` 和 `/tmp/larkdoc-intranet-locks/vue3-vite/pnpm-lock.yaml` 备好已按最终内网 tgz 生成、核验的完整锁；它们须包含 `0.14.6-intranet.1` 的全部 SDK 依赖元数据。使用内网 tgz 的实际 SHA256 组装两套 Windows 包：

```bash
SDK_SHA256="$(shasum -a 256 /tmp/larkdoc-intranet-sdk/lark-doc-0.14.6-intranet.1.tgz | awk '{print $1}')"
node scripts/pack-windows-intranet.mjs \
  --sdk /tmp/larkdoc-intranet-sdk/lark-doc-0.14.6-intranet.1.tgz \
  --sdk-sha256 "$SDK_SHA256" \
  --locks /tmp/larkdoc-intranet-locks \
  --out /tmp/larkdoc-windows \
  --work /tmp/larkdoc-windows-work
```

每个 ZIP 只有 README、单份 `vendor/SDK.tgz`、对应最小 `demo/` 源码与锁文件、SHA256 清单。Vue2 使用 npm 锁；Vue3 使用共享的 pnpm 9/10 锁。仓库中的四个规范示例仍使用公开 `0.14.6`；打包器从它们复制应用源码，验证传入的内网锁后将 SDK 路径与 SRI 对应到交付 tgz，保留其他依赖；缺少匹配版本和完整依赖图的锁时直接停止。Windows 接收端不需要 Python，不附带另一个缓存或应用 `node_modules`。

不要再次对完整内网 SDK 执行普通 `npm pack`：它可能裁掉仅通过 peer 引入的包。也不要直接在源码目录执行 `npm publish`；源码发布保护会阻止此操作。正式发布使用[发布脚本](./dev/07-发布.md)，发布的是经过验证的公开 tgz；内网包使用独立版本供离线交付或公司 npm 使用。

验收应从最终 tgz 开始：Windows Git Bash 下分别用 npm 8、pnpm 9 和 10 的空缓存/store断网安装，再在已备原工具依赖的应用中测试启动、构建、六类图表及完整上传回调。保留具体版本、原始命令、锁文件、SHA256 和实际结果。SDK 安装与整套应用从零重装是两个范围，不应混用耗时。

文档服务器只需要静态站点与 Nginx。联网出包机使用 Node 20，并在库、示例和文档依赖准备完成后执行：

```bash
bash scripts/pack-docs.sh --base / --skip-install --out /tmp/larkdoc-docs
```

把生成目录中的 `site.tar.gz`、`nginx-docs.conf`、`INSTALL-内网.md` 和 `sha256.txt` 单独交给 Linux 运维；无需带前端 `node_modules`。按生成的安装说明调整域名、目录和端口，先校验新目录，再切换站点，保留旧版本方便回退。维护文档仍保留在仓库，调用者不关心的开发资料不进入线上导航或搜索。
