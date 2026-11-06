# lark-doc 开发与维护手册

根目录只维护两份文档：[README](./README.md) 面向使用者，本文汇总当前开发约束、交付流程和上线记录。具体模块规格与可运行示例仍在各自目录维护。

- [当前架构与维护约束](#architecture)
- [本地开发与验证](#development)
- [SDK 与内网交付](#distribution)
- [发布流程与记录规则](#release-process)
- [变更与上线记录](#release-history)
- [文档维护与历史追溯](#documentation)

<a id="architecture"></a>

## 当前架构与维护约束

- 编辑器基于 Tiptap / ProseMirror，默认使用原生 DOM renderer。库使用 Rollup；宿主继续使用原有 Webpack/Vite 与框架版本。当前约束以源码、锁文件和检查命令为准。
- `src/core/` 承担文档模型与块能力，`src/editor/`、`src/workspace/` 管理状态与交互，`src/ui/` 创建 DOM，`src/mount/` 维护 `mount/update/destroy/getInstance/getRoot` 五动作契约；框架适配器只转接生命周期和属性。
- 共享容器中的 UI 只操作自己的子树；优先复用 `src/ui/dom.js`、`src/ui/panels.js` 等现有原语。增量更新保留焦点、选区和悬停链，事件透传保留原事件的 `currentTarget`，条件段的 DOM、role 和 aria 语义保持一致。
- 正文版本不混入评论、Presence、权限或 AI 临时状态。默认编辑器不启用多人协同；服务端保存、鉴权和协同由宿主按需接入，见[业务保存与 Provider 接入](./docs/guide/view-integration.md)。
- 修改已有功能前查看[回归防护索引](./dev/04-回归防护清单.md)。异常应保留真实原因；异步加载失败、取消、重试、晚到结果及销毁都需要相应验证，不以静默 fallback 代替根因修复。

<a id="development"></a>

## 本地开发与验证

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

<a id="distribution"></a>

## SDK 与内网交付

以下命令用于准备尚未交付的新候选，版本示例说明两类包的关系。已发布的 `0.14.6` 和已交付的 `0.14.6-intranet.1` 保留原文件及校验码；后续修复应使用新的未发布版本，不覆盖旧包。

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

<a id="release-process"></a>

## 发布流程与记录规则

1. 每次开发或修复完成，在下方“未发布”增加一条用户可见变化，附对应提交和已完成的验证。内部重构、文档调整也应标明范围。
2. 发布前汇总该次实际包含的提交，确认兼容性或迁移要求；按[发布说明](./dev/07-发布.md)完成相应验证和审查，再执行获得授权的推送、npm 发布或站点部署。
3. 各渠道成功后，将相应条目归入“版本号｜日期”，分别记录 npm、内网交付、文档/Demo 的实际状态、源码提交/标签及验证结果。部分渠道未完成时保留明确状态，不将整次发布写成完成。
4. 仅提交到本地 master 的改动继续留在“未发布”。SDK 版本、文档站和内网包可以独立交付；文档上线不要求重复发布 npm，内网包不作为公开 `latest`。

单次记录包含：新增功能、问题修复、兼容/使用变化、提交与标签、实际发布渠道、验证范围与已知限制。没有变化的类别可以省略；历史耗时不充当新版本的性能验证。`package.json` 的版本号不代表本地 master 上的所有提交都已对外发布。

<a id="release-history"></a>

## 变更与上线记录

### 未发布

- **修复**：Mermaid 渲染失败后清理本次临时 SVG，覆盖视图销毁后的迟到失败，保留原错误信息和单次回调，不误删其他图表。提交 `ebce8ab31959bf19f4fc35f7264b0f6af4251977`，仅本地 master，尚未推送、发布或部署。
- **验证**：上述修复通过 Vue2.7.16 / Webpack4.47.0 / Chromium 的错误恢复、删除、六种默认图表检查；新增两个回归用例，完整 94 文件 / 2040 项测试、lint 和 Node14 产物检查通过。未新增 Windows 或其他浏览器复验。
- **文档**：根目录收敛为 README 与本手册，合并业务接入内容和有效开发约束，补齐上线记录，更新引用、分发文档清单和 CI 路径过滤。本次整理不改变编辑器运行行为，尚未推送或上线。

### 0.14.6｜2026-11-06

- **交付**：统一仓库内的 SDK 与 Windows 交付入口。公开 `lark-doc@0.14.6` 保留由宿主共享的运行依赖；独立离线包 `0.14.6-intranet.1` 带齐 107 个运行依赖包（45 个直接依赖）及协同契约依赖，并提供 Webpack4 兼容入口。原应用工具链不变，不单独交付缓存。
- **修复**：纠正 docx 的局部 nanoid 版本约束；协同子入口导出 Yjs，保留同格式、共享实例与构造器身份检查；Vue3 离线 demo 支持 pnpm 9/10，移除与其冲突的 npm 包管理器标记。
- **接入**：Windows 使用 Git Bash，Vue2 使用 npm，Vue3 使用 pnpm 9/10。服务器图片上传仍通过初始化配置设置 URL、响应映射和完整回调，包含成功、失败、取消与重试等行为。
- **发布状态**：公开 npm `0.14.6` 已发布，当次核验 `latest=0.14.6`；`v0.14.6` 指向源码提交 `ce12e60dd5f6716cbf1709b31ec562e4e3dd703f`，已推 GitHub。`0.14.6-intranet.1` 为独立离线交付，未作为公开 `latest` 发布。开发文档、六环境示例中心及可编辑 Playground 已部署。
- **验证**：当次 94 文件 / 2038 项测试、CI、性能门禁和 E2E 通过；Host 六环境 120/120 项功能检查通过；Windows 真断网的 npm8、pnpm9/10 安装、原应用构建及 60/60 项功能检查通过，VM 恢复原状态，独立审查批准。浏览器与本地模拟上传接口的结果不代替真实业务后端联调。
- **公开 SDK SHA256**：`27ecdbce55241a4d58f3ceb5c14a0b2db006e981253a757f01ff671b6ab7be00`。
- **离线 SDK SHA256**：`b48c4a5ef8eb0d015807f5b6d5f503c04d73ecdb28674ecbef580ff812e2a3ea`。两类包用途不同，禁止混发。
- [当次文档部署记录](https://github.com/cuijianjun/LarkDoc/actions/runs/42203564654) · [示例中心](https://cuijianjun.github.io/LarkDoc/examples/) · [Playground](https://cuijianjun.github.io/LarkDoc/demo/)。本版本不包含上方未发布的 Mermaid 残留修复。

### 0.14.5｜2026-11-06

- 恢复图表六类独立图标和工具栏、插入「＋」、斜杠菜单的一致交互；菜单支持悬停保活、延迟收起和视口避让。
- 补回自动保存开关/延迟、导入导出独立开关/格式/文案，以及媒体 HTML 回传和 HTML/Markdown 导出的配置接线。
- 修复应用 `uploader.onCallbackError` 被内部报告通道覆盖；高亮首次加载失败后，同一语言下次更新可恢复；图表显示具体错误原因。
- 新增初始化配置 `help.enabled/items/onAction`，默认帮助菜单和内置快捷键保持可用。
- 修复 Web Component 在异步保存未完成时因配置重建被旧草稿覆盖正文和标题的问题，保留首次和重新插入时的草稿恢复。
- 六环境接入示例集中安装、引入、配置和最小 demo；维护者资料保留在仓库。公开 npm 与文档/Demo 已发布，当次本地、六环境、线上检查及独立审查通过。
- 发布源码提交 `4266da6adf75b0260483cbcbf002e1fb853753df`，标签 `v0.14.5` 指向该提交；后续发布状态记录提交为 `552648971ef5043d9618e9d66cf52d322765b5da`。

### 0.14.4｜2026-11-05

- 库统一使用 Rollup，源码与运行时不依赖 Vue、Webpack；应用保持原有工具链，提供默认按需加载、full 与显式特性子入口。
- 图片可在初始化时配置 HTTP 上传接口、请求字段和响应映射，各框架共用上传与生命周期回调；配置 Playground 支持修改初始化代码。
- 公开 npm `0.14.4`、文档和 Demo 已发布。标签 `v0.14.4` 指向 `71cf501626acee868718ab3b6ce9e247ed50f21c`；后续 E2E 时序修复与验证记录提交为 `0bc3f23ec39a4e12a72aa8328b1cc35c0ef816be`，未重复发布该 npm 版本。

### 0.13.0 与更早阶段｜历史摘要

- 0.13.0 是框架无关迁移的过渡版本：统一 `new LarkDoc(options)`、特性子入口、资源本地化、构建插件和部分原生 DOM UI；当时仍残留 Vue 主壳。旧的 Vue 内联、Webpack alias、产物预算和未完成清单不作为当前接入要求。
- 2026-10-30 的旧工具链修复包括异步区块装载、代码语言别名、自动保存、导入导出、媒体 HTML 及 Demo 资源同步。仍有效的行为由当前源码、[配置参考](./docs/guide/configuration.md)和[回归防护](./dev/04-回归防护清单.md)维护。
- 更早版本的详细阶段记录和回归结果保留在 Git 历史；可从发布基线 `ce12e60` 的根目录文档查看，不将历史观察直接列为当前缺陷或性能承诺。

<a id="documentation"></a>

## 文档维护与历史追溯

README 提供使用入口；本文维护当前规则和上线记录；`docs/` 保存网站页面与实际最小应用；`dev/` 保存模块回归规范；`requirements/`、`specs/` 保留必要的需求和验收上下文。修改某个主题时更新其现有出处，通过链接引用，避免再创建平行方案。

根目录旧接入指南已并入[业务保存与 Provider 接入](./docs/guide/view-integration.md)；旧优化/框架迁移计划的有效约束汇入本文和[代码结构约定](./dev/03-代码结构约定.md)。过时计划、重复版本日志及旧回归报告已移出当前工作树，原文仍可在 Git 历史查看。README 的背景、免责声明与协议保持完整。
