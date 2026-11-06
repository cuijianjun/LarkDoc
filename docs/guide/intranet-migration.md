# 内网接入：两个 Windows 应用包与 Linux 文档包

按用途拿一个包即可。Windows 命令使用 **Git Bash**；SDK 的运行依赖随内网自包含 tgz 一起安装，不需要另设 npm 缓存或 pnpm store 路径。

## 选择你的环境 {#mig-host-matrix}

| 交付包 | 用途 | 开发环境 |
| --- | --- | --- |
| `lark-doc-vue2-webpack4-0.14.6-intranet.1-windows-x64.zip` | 在已有 Vue2 + Webpack4 应用接入 | Windows x64、Git Bash、npm |
| `lark-doc-vue3-0.14.6-intranet.1-windows-x64.zip` | 在已有 Vue3 应用接入 | Windows x64、Git Bash、pnpm 9/10 |
| 独立文档部署目录（含 `site.tar.gz`） | 部署本开发文档网站 | Linux、Nginx，无需 Node/npm |

应用沿用原有框架和构建工具。Vue3 随包参考 demo 使用 Vite；既有应用不必改用 Vite。

## 包里有什么 {#mig-pack}

两个 Windows 包各带 `README.md`、`vendor/lark-doc-0.14.6-intranet.1.tgz`、本环境 `demo/` 源码和校验清单。按对应 README 在自己的应用中接入，demo 用于对照。

`0.14.6-intranet.1` 是基于公开 `0.14.6` 单独构建的自包含离线版本，包含 SDK 的完整运行依赖。公开 npm 版保持由宿主共享依赖，普通 `npm pack lark-doc@0.14.6` 不能作为完全离线包。Windows 包使用经过校验的内网 tgz，代码中仍从 `lark-doc` 引入。它不负责原应用的 Vue、构建工具和其他业务依赖；这些依赖继续由原项目准备。

Linux 文档部署目录单独携带完整静态站点、Nginx 配置和部署说明，不重复塞进两个 Windows 包。

## 完全断网安装 {#mig-vendor}

先把所选包的 SDK tgz 复制到**原应用**的 `vendor/`，再执行对应命令。以下 `/d/` 表示 Windows 的 D 盘，路径换成你自己的目录。

### Vue2 + Webpack4 {#mig-vue2-wp4}

```bash
cd "/d/work/your-vue2-app"
mkdir -p "./vendor"
cp "/d/larkdoc-vue2/vendor/lark-doc-0.14.6-intranet.1.tgz" "./vendor/"
npm install "lark-doc@file:./vendor/lark-doc-0.14.6-intranet.1.tgz" --save-exact --offline --no-audit --no-fund
```

```js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/dist/lark-doc.css'
```

`lark-doc@file:` 让 npm 直接知道包名，可省去 npm 8 的一次完整识名解包；安装后仍从 `lark-doc` 引入。tgz 的全部运行依赖保留，不需要另带缓存。

在组件 `mounted()` 中创建实例，`beforeDestroy()` 中销毁。保留原项目已有的 Vue、CSS 和字体资源规则，不必照抄手写 demo 的 Webpack 配置。只有出现 `.woff`、`.woff2` 等文件编译错误时，才排查原项目资源规则。

### Vue3 {#mig-vue3-vite}

```bash
cd "/d/work/your-vue3-app"
mkdir -p "./vendor"
cp "/d/larkdoc-vue3/vendor/lark-doc-0.14.6-intranet.1.tgz" "./vendor/"
pnpm add "./vendor/lark-doc-0.14.6-intranet.1.tgz" --save-exact --offline
```

```js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'
```

在组件 `onMounted()` 中创建实例，`onBeforeUnmount()` 中销毁。使用 `pnpm-lock.yaml`，沿用原项目固定的 pnpm 版本。随包 demo 的具体版本及验证结果以其 README 为准，不把 npm 验证当作 pnpm 验证。

Vue2、Vue3 的完整最小组件、初始化参数和原应用验证步骤，都在各自包内的 README。SDK 实例使用普通字段或变量，不放进响应式对象。

### 补充环境 {#mig-vue2-wp5}

Vue2 + Webpack5 的安装与组件写法见[对应环境示例](/examples/vue2-webpack5)。本次交付的两个 Windows 包分别面向上表的 Vue2 + Webpack4、Vue3。

<span id="mig-element-assets"></span>

原生 HTML 和 Web Component 见[示例中心](/examples/)。静态托管需保留完整构建目录，包括图表异步 chunk、CSS 和字体。

## 可选：上传到公司 npm 仓库

此路线要求开发机能访问内网 npm。由管理员把同一个自包含 tgz 导入公司可发布仓库，开发者从公司的安装仓库安装。SDK 的运行依赖已经在 tgz 内，不需要逐个导入这些依赖。

仓库地址、登录和发布步骤集中在包内 README。发布仓库与安装仓库可能不同。同名同版本已存在时先核对内容，不能覆盖；内容不一致应由维护者重新生成独立版本。

例如管理员在解压后的包根目录执行，仓库地址改为公司的可发布仓库：

```bash
npm publish ./vendor/lark-doc-0.14.6-intranet.1.tgz --registry='http://npm.intra.example/repository/npm-hosted/' --tag intranet
```

已有应用的锁文件下载地址、scope 仓库设置也须指向内网；只添加 `--registry` 不会迁移原锁中的公网地址。要按私服实际返回的 `dist.tarball` 处理，不能只替换域名。

## Linux 部署开发文档

将维护者通过 `scripts/pack-docs.sh` 生成的文档部署目录单独传到 Linux，先阅读其中的 `INSTALL-内网.md`。它包含完整静态站点，不需要 Node/npm，也不需要在服务器重新构建。

根路径 `/` 的默认配置使用 `/srv/www/lark-docs`、端口 `80`。在部署目录执行：

```bash
sha256sum -c sha256.txt
sudo mkdir -p /srv/www/lark-docs
sudo tar -xzf site.tar.gz -C /srv/www/lark-docs --strip-components=1
sudo chmod -R a+rX /srv/www/lark-docs
# 先将 nginx-docs.conf 的域名、root、listen 改为公司实际配置
sudo cp nginx-docs.conf /etc/nginx/conf.d/larkdoc.conf
sudo nginx -t
```

校验通过后执行 `sudo nginx -s reload`，访问配置中的域名或服务器地址。已有站点请使用独立目录和端口，保留旧目录便于回退；历史交付包中的 `8088` 配置仍以其包内说明为准。

站点有本地搜索、六环境示例和可改代码的 Playground，必须复制完整资源。子路径部署需让维护者按目标 base 重新构建，不能替换产物中的字符串。维护者源文档继续在仓库维护，不要求 Linux 在线编译。

## 接入后检查

1. 原应用能显示编辑器、输入文字，并通过 `getJSON()` 读取正文。
2. 图表能生成 SVG，图片能显示，原应用构建与控制台没有错误。
3. 使用服务端图片上传时，在初始化的 `uploader` 中配置接口和回调，见[图片上传](/blocks/uploader)。默认本地 Base64 不代表业务后端已联调。
4. 完整业务应用空 `node_modules` 离线重装，需要另备该应用自身依赖；SDK 自包含包不替代整套应用工具链。

交付验收应分别核对 npm 空缓存、pnpm 空 store 的禁网安装和实际构建。Linux/macOS 验证不能作为 Windows Git Bash 已实机运行的证明，具体范围以随包 README 为准。

此前的 `lark-doc-0.14.5-intranet.tgz` 漏带了可选协同依赖，请换用完整内网 SDK。普通编辑只需 `import { LarkDoc } from 'lark-doc'`；需要协同时再引入 `lark-doc/collab`。修复版同时处理 Webpack4 的子入口与依赖语法，应用无需因此新增 alias 或更换构建工具。

`lark-doc/collab` 是已有的可选底层入口，默认编辑器不会启用多人协同，也不附带完整服务端。使用内网包的该入口时，从 SDK 导出的 `Yjs` 创建文档；不同物理副本或 ESM/CJS 的 Yjs 实例不能混用，即使版本相同。公开版原有共享方式与完整接法见[协同契约](/guide/collab-server)。

## 历史安装耗时参考

Windows 11 x64、Git Bash 5.2.37、Node 14.21.3 / npm 8.19.4，使用相同的历史 `0.14.5-intranet.2` tgz、物理断网及独立空缓存，按旧→新→新→旧顺序串行测试：

| npm 安装写法 | 两次耗时 | 平均 |
| --- | --- | --- |
| 匿名本地 tgz | 208.587 / 224.915 秒 | 216.751 秒 |
| `lark-doc@file:...` | 132.232 / 133.049 秒 | 132.641 秒 |

这组观察减少约 38.8%，来自省去 npm 8 的一次识名解包；SDK 文件没有裁剪。完整 Vue2 工程添加 SDK 为 210.277 秒，不能用独立 SDK 基准承诺所有应用的安装时间。pnpm 9/10 命令未改，复测波动不计为优化收益。这些是历史版本记录，不是当前新版本的 Windows 验收结果。
