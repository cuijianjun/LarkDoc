# 内网服务器部署

本文面向「把 lark-doc 部署到一台无外网出口的内网服务器」这个场景，覆盖从出包、分发、静态托管、nginx 反向代理、协同服务转发，到校验和回滚的完整链路。

> 应用接入按当前版本的[安装说明](/guide/install)和[环境示例中心](/examples/)执行。下文 nginx、旧 npm6 出包与体积记录保留为历史部署参考，不代表本次发布重新验证了对应服务器与离线 helper；部署时仍需按目标环境验收。示例域名、路径和版本号请替换成实际值。
>
> 分工：**本文讲服务器侧**（出包 → 分发 → 托管 → nginx → 校验 → 回滚）；**宿主工程怎么改代码才能在内网编译通过**见[内网迁移实战（Vue2/3）](/guide/intranet-migration)。

## 0. 先明确：部署的是什么

lark-doc 是一个**前端库**（Tiptap 3 + 原生 DOM 的 npm 包），不是独立后端应用。所以「部署」实际是三件互不耦合的事：

| # | 要做的事 | 产物 | 目标位置 |
|---|---|---|---|
| ① | 把 npm 包交给宿主项目 | `lark-doc-<ver>-intranet.tgz` | 宿主的 `node_modules/` |
| ② | 把 `dist/` 静态资源托管上网 | `dist/` **整目录** | nginx 静态目录 |
| ③ | 转发两类长连接/接口 | — | nginx 反代 |

只有协同（多人实时编辑）需要额外部署一个 WebSocket 服务端，而这个服务端**不在本仓库**（独立包 `@lark-doc/collab-server`，见[协同服务端契约](/guide/collab-server)）。不做协同就完全不需要它。

### 部署拓扑

```
                          内网 nginx  <wiki.intra.example.com>
                          │
   ┌──────────────────────┼──────────────────────────┬─────────────────────┐
   │                      │                          │                     │
   ▼                      ▼                          ▼                     ▼
/                  /vendor/lark-doc/*           /api/*               /collab  (WS)
宿主应用 SPA        lark-doc dist 静态资源       宿主业务后端         协同服务端
(history 路由)      (整目录 + 长缓存)           (REST + SSE)         (hocuspocus :9010)
```

### 最省事的判断

- **已有打包器的任意框架宿主** → 可直接用默认入口 `new LarkDoc()`；内部为原生 DOM，无 Vue peer。Webpack4 根入口按 module 解析已兼容的 ESM，无需专属 alias；CSS 使用 `lark-doc/dist/lark-doc.css`。
- **想使用标签或 Vue3 / React 薄壳** → 现代打包器可选 `lark-doc/element` 的 ESM；静态方式则完整托管 dist 并独立 script 引 UMD。Webpack4 标签方式使用后一种。两者均不依赖 Vue。
- **宿主是纯静态页 / 老系统 / 不想接打包器** → 只做 ②，一个 `<script>` 引 element 产物即可，**不用装 npm 包**。
- **要多人协同** → 再补 ③ 里的 `/collab`，并且**必须**用打包器接（UMD 不发协同产物，原因见 6.4）。

---

## 1. 形态选型

默认 ESM / CJS 与 Element 按挂载方式选择；旧 options 组件另走 `lark-doc/vue2`，不要混用实例：

| 形态 | 引入方式 | 入口产物 | 适用 | 需要 npm 包 |
|---|---|---|---|---|
| **ESM**（推荐） | `import { LarkDoc } from 'lark-doc'` | `dist/lark-doc.esm.js`（`module`） | Webpack4 / Webpack5 / Vite / Rollup | 是 |
| **CJS** | `require('lark-doc')` | `dist/lark-doc.common.js`（`main`） | Node / SSR / 只读 `main` 的老打包器 | 是 |
| **Web Component** | npm import 或独立 script 注册标签 | ESM: `lark-doc/element`；静态: `dist/lark-doc-element.umd.min.js` | 任意框架 / 无框架，**无 Vue 运行时，样式随 JS 注入** | 否（可直接 `<script>`） |
| **legacy options** | `import { LarkDocEditor, LarkDocWorkspace } from 'lark-doc/vue2'` | `dist/lark-doc-vue2.esm.js` / `dist/lark-doc-vue2.common.js` | 既有 Vue2 宿主注册普通 options 对象；产物不 import Vue | 是 |

> **选型建议**：有打包器选根 ESM；静态页选 Element UMD；Node require 选 CJS。CJS 通过相对 `require()` 加载兄弟 chunk，不是内联所有重依赖的单文件；各入口均无 Vue runtime。当前不再独立生成 `lark-doc.umd.min.js`，`unpkg` / `jsdelivr` 指向 Element。体积与预算以 `npm run size` 和[产物说明](/guide/build-artifacts)为准；ESM 首屏还需计算 `tiptap` / `vendor` 初始区块，不能只报主文件。

---

## 2. 流程一：出包（在有外网的构建机上）

### 2.1 环境

```bash
# 完整安装开发依赖使用 Node22+；已安装依赖后的库构建验证使用 Node14.21.3
node -v
npm -v    # npm >= 8.19.4
```

仓库有 `check:node14` 守卫，Node 版本不对会直接报错。宿主项目（如 `apps/vue2-webpack-node14`）的 `engines` 也锁 `node 14.21.3` / `npm 8.19.4`。

### 2.2 历史离线出包 helper（使用前单独验收）

普通 npm/tgz 不包含完整依赖。当前推荐将固定 SDK 版本和应用完整依赖同步到内网 npm 镜像，或验证完整离线缓存，再执行普通安装；具体步骤见[内网迁移实战](/guide/intranet-migration#mig-pack)。静态 UMD 则直接托管整个 dist。

以下为仓库保留的旧交付 helper，**本轮未重新验证它在当前依赖闭包下的产物**。使用前必须在目标 npm/操作系统断网安装、构建并检查实际运行，不能沿用旧版依赖数量结论：

```bash
cd apps/lark-doc
bash scripts/pack-intranet.sh
```

它会 `unset NODE_OPTIONS`（宿主 Node 的 shim 会让 Node 14 构建崩溃）、自己切 Node 14 构建 / Node 24 跑 npm，产出 `dist-intranet/` 目录。用 `package.json` 里的版本，或用 `--version` 指定：

```bash
bash scripts/pack-intranet.sh --version 0.12.0
bash scripts/pack-intranet.sh --skip-build      # dist 已是最新，跳过约 4 分钟的构建
```

产出清单：

| 文件 | 用途 | 方案 |
|---|---|---|
| `lark-doc-<ver>-intranet.tgz` | 历史脚本组装的主包；需核对当前 ESM/CJS 实际依赖闭包 | 方案 1 |
| `lark-doc-<ver>-node-modules.zip` | 解压到项目根 → 直接得到 `node_modules` | 方案 2 |
| `INSTALL-内网.md` | 安装说明（Windows / npm 6 视角） | — |
| `sha256.txt` | 校验值 | — |
| `lark-doc-<ver>-thin.tgz` + `deps-tgz/` + `deps-manifest.txt` + `check-deps.js` | 依赖交给内网私服 | 方案 3（**仅 `--from-tgz` 模式产出**） |
| 宿主框架的离线依赖 | 仅宿主应用自身使用该框架时自行准备；不是 lark-doc 的依赖 | 按宿主需要 |

> `dist-intranet/` 已在 `.gitignore` 中，产物不入库。

### 2.3 手工构建（需要单独产物时）

`npm run build` 生成根入口的 ESM 与 CJS，其余入口按需要单独构建：

```bash
npm run build          # → dist/lark-doc.esm.js + dist/lark-doc.common.js，以及配套区块与 CSS
npm run build:esm      # → dist/lark-doc.esm.js + 初始及按需区块
npm run build:element  # → dist/lark-doc-element.umd.min.js + 按需区块
npm run build:vue2     # → dist/lark-doc-vue2.common.js + dist/lark-doc-vue2.esm.js，以及配套区块
npm run build:collab   # → dist/lark-doc-collab.esm.js + dist/lark-doc-collab.common.js
```

filesystem cache 按 Node 主版本、target 与构建变体隔离；构建耗时以实际输出为准。

### 2.4 出包前必跑的闸门

```bash
npm run check            # = check:gate + check:artifacts，全绿才算能发
```

展开：

- `check:gate` = `check:deploy`（`check:node14` + `check:offline` + `check-ecs-images` + `check-session-providers`）+ `check:code`（核心契约 + 架构 + 单测）+ `check:ui`（主题 token + 对比度）+ `lint`
- `check:artifacts` = `ensure-artifacts.mjs`（全部入口按构建脚本去重）+ `check:lite` + `check:legacy` + `check:vditor` + `size`

**只查体积**：`npm run size`。ESM、Element、CJS、collab、lite 五项 gzip 上限以 `package.json` 的 `size-limit` 为唯一来源；测量后只收紧，不因超限放宽。

**只要最快的自检**：`npm run check:quick`（架构 + 契约 + lint，不含构建）。

---

## 3. 流程二：内网分发（三条路线）

先判断内网环境，再选路线。**判断依据只有一条：内网 npm 大版本**。

| 内网 npm | 选哪条 | 原因 |
|---|---|---|
| npm 6.x（老 Linux / Windows / MediaWiki 式项目） | **方案 1 或 2** | npm 6 读不了 npm 10 写出的 cacache，且不认 `exports`、会对未声明的依赖回 registry 查版本 |
| npm 8+ | 方案 1 或 3 | 正常解析，私服可用就走方案 3 |

### 3.1 方案 1（推荐）：`file:` + tgz

```bash
# 1. 把 dist-intranet/ 整个目录拷进内网（U 盘 / scp / 跳板机）
# 2. 放到项目里
mkdir -p vendor
cp dist-intranet/lark-doc-0.12.0-intranet.tgz vendor/

# 3. package.json 加依赖
```

```json
{
  "dependencies": {
    "lark-doc": "file:./vendor/lark-doc-0.12.0-intranet.tgz"
  }
}
```

```bash
# 4. 装
npm install --no-audit --no-fund
```

旧版记录：`added 34 packages from 68 contributors in 2.824s`、私服请求 0 条。这不是当前版本安装耗时或零网络请求的承诺；普通 tgz 仍需要它的运行时依赖。

> 当前 SDK 无 Vue peer，无需 `--force` 或 `--legacy-peer-deps`。旧 npm6 现场曾出现不识别该参数的报错；应用自己的依赖冲突应单独处理。
>
> **不要为了 lark-doc 安装 `@tiptap/vue-2`**。当前产物直接使用 `@tiptap/core` 与原生 DOM，不需要 Vue Tiptap 适配器；宿主若另有 Vue 编辑器，其依赖应单独管理。

### 3.2 方案 2（兜底）：直接铺 `node_modules`

当 npm 彻底装不上（权限、锁文件、极端老版本）时用这个，绕过所有解析逻辑：

```bash
# 在项目根执行
unzip -o dist-intranet/lark-doc-0.12.0-node-modules.zip
```

zip 里就是 `node_modules/lark-doc/...` 的完整结构，解压即用。

> ⚠️ 之后**绝对不要跑 `npm ci` 或 `npm install`**，它们会先删掉 `node_modules/`，你刚铺的东西全没了。要装别的包，先把 zip 重新铺一遍，或在 `package.json` 里把 `lark-doc` 写成 `file:` 引用。

### 3.3 方案 3：thin 包 + 内网私服

适合「内网有 Verdaccio / Artifactory，不想每次拷全量 tgz」的场景。**只有 `--from-tgz` 模式才产出这套文件**：

```bash
# 在构建机上，从已有 tgz 就地生成
bash scripts/pack-intranet.sh --from-tgz dist/lark-doc-0.12.0.tgz
```

然后在内网：

```bash
# 1. 先自检私服缺哪些包
node check-deps.js --registry=http://<私服>:4873/

# 2. 缺哪个 publish 哪个
for f in deps-tgz/*.tgz; do
  npm publish "$f" --registry=http://<私服>:4873/
done
npm publish lark-doc-0.12.0-thin.tgz --registry=http://<私服>:4873/

# 3. 正常装
npm install lark-doc --registry=http://<私服>:4873/
```

`deps-manifest.txt` 是 21 项的依赖清单（包名@版本，标注根/传递），给运维核对私服有没有。

### 3.4 npm 6 的三个致命坑（已在脚本里修掉，但要知道症状） {#deploy-npm6}

以下三条是旧版现场记录，保留用于迁移排错；其中 Vue require、21 项闭包和旧体积不代表当前产物。当前 lark-doc 无 Vue runtime，分发清单应以本轮实际包为准：

| # | 报错 | 根因 | 脚本怎么修的 |
|---|---|---|---|
| 1 | `E401 unable to authenticate, need: Basic realm="artifactory Realm"` | `bundleDependencies` 里有 75 个名字**不在** `dependencies` 里，npm 6 没有版本范围可用，就拿 `名字@*` 回 registry 查最新版 | `dependencies` 与 `bundleDependencies` 重建为**同一集合**（版本取包内实物），走 bundled 路径，**0 请求** |
| 2 | `ENOENT Cannot cd into '...unpack-xxxx'` | macOS `tar czf` 混进了 `._package`、`PaxHeader/package`、`com.apple.provenance` 扩展头 | `COPYFILE_DISABLE=1 tar --no-xattrs` 重打。**`vue-2.7.14-intranet.tgz` 也是同坑**：`tar tzf` 看起来干净，但 npm 6 就是 ENOENT |
| 3 | 装完无报错，但 `require('lark-doc')` 崩在 `Cannot find module 'vue/dist/vue.runtime.common.js'` | npm 6 把「包内 `node_modules` 里有、但没声明在 `bundleDependencies` 里」的包当成 extraneous **删掉**（实测 `added 1 package`，`node_modules/lark-doc/node_modules` 整目录消失） | 21 个随包依赖回填成 `dependencies`（精确版本）+ `bundleDependencies`（同名同集） |

体积从 106 MB 压到 8.3 MB——只留 `dist` 真正外置的 21 个包，最长路径 75 字符，避开 Windows `ENAMETOOLONG`（260）。

### 3.5 分发注意事项（照抄，别省）

1. **lark-doc 已无 Vue peer 或运行时依赖**；Vue2 宿主自身的框架依赖由宿主管理，不要为编辑器补装 Vue2。
2. **不要装 `@tiptap/vue-2`**（见 3.1）。
3. **样式**：默认 / full / lite ESM 与 CJS 均需显式引公共 CSS；只有 Element ESM/UMD 自动注入样式。普通宿主使用 `import 'lark-doc/style.css'`；webpack 4 **不认 `exports` 字段**，那行要写全 `lark-doc/dist/lark-doc.css`（`package.json` 里 `"style": "style.css"` 但 `exports["./style.css"] = "./dist/lark-doc.css"`，就是这个坑的来源）。
4. **`dist/` 整目录都要拷**。`math` / `mermaid` / `office` / `markdown` / `highlight` 及其共享区块是按需资源，少一个就运行时 404（见第 4 节）。
5. **覆盖升级必须换版本号**。同版本号重打会让 `npm ci` 报 `EINTEGRITY`（integrity 哈希变了但 lock 文件没变）。
6. Windows 遇到 `EPERM` / `EBUSY`：关掉编辑器 / 杀毒软件的文件占用手，或重开 shell。
7. 路径过长：项目挪到 `D:\proj` 这类短路径。
8. 当前包不声明 Vue optional peer；若仍因 lark-doc 请求 Vue，先核对版本、旧锁文件与 alias，而不是补装 Vue。

### 3.6 校验

```bash
cd dist-intranet && sha256sum -c sha256.txt
```

装完在项目里冒烟：

```bash
node -p "require('lark-doc/package.json').version"
node -e "const m = require('lark-doc'); console.log(typeof m.LarkDoc, Object.keys(m).length)"
# 期望首项为 function；导出数量不作为版本契约
```

---

## 4. 流程三：静态资源托管 + nginx

### 4.1 唯一硬规则：`dist/` 整目录同位托管

静态 Element UMD 运行时**按主 `<script>` 自身的 URL 推导同目录特性资源地址**，不再使用 Webpack 的 publicPath。现代 Element ESM 交给宿主构建器处理动态 import。静态方式需满足：

- `dist/` 里的文件必须**全部**放在同一个目录下（不能只拷 `lark-doc-element.umd.min.js`）。
- 这个目录可以是任意子路径（`/vendor/lark-doc/`、`/static/lib/ld/` 都行），只要整目录一致。
- **不需要单独拷 `vendor/`**。0.11.0 起 mermaid 是普通按需区块，`dist/vendor/` 已不产出，老残留可直接删。

`dist/` 里必须一起走的文件：

```
lark-doc-element.umd.min.js          ← 主文件
lark-doc-element.umd.min.math.js      ← KaTeX
lark-doc-element.umd.min.mermaid.js
lark-doc-element.umd.min.office.js    ← docx / mammoth
lark-doc-element.umd.min.markdown.js  ← marked / turndown
lark-doc-element.umd.min.highlight.js
fonts/                                ← KaTeX 字体，缺了公式变豆腐块
lark-doc.css
```

（ESM 对应 `*.esm.js`；CJS 对应 `lark-doc.common.js`、`lark-doc.common.*.js` 与 CSS / 字体；legacy 使用自己的前缀，同样不能漏拷兄弟区块。）

### 4.2 目录布局

推荐带版本号，便于原子切换和回滚：

```
/srv/www/wiki/                          # 宿主应用（index.html + js/ + css/）
/srv/static/vendor/lark-doc/
├── 0.12.0/
│   ├── lark-doc-element.umd.min.js
│   ├── ...（dist 全部内容）
│   └── fonts/
└── current -> 0.12.0                   # 软链，切版本只改它
```

```bash
# 部署
mkdir -p /srv/static/vendor/lark-doc/0.12.0
cp -r dist/* /srv/static/vendor/lark-doc/0.12.0/
ln -sfn /srv/static/vendor/lark-doc/0.12.0 /srv/static/vendor/lark-doc/current
```

nginx 用 `current` 提供服务，前端固定引用 `/vendor/lark-doc/current/...`。

静态 UMD 从主文件所在目录加载 `lark-doc-element.umd.min.<feature>.js` 等按需资源，nginx 顺着软链解析到版本目录，整目录规则天然成立。

**软链两个坑（实测踩过）：**

1. **别写成相对路径的裸名字再跨目录用。** `ln -s 0.12.0 current` 看起来最简洁，但软链目标是相对**软链自身所在目录**解析的；一旦你在别的目录执行（比如 `ln -s static/lark-doc/0.12.0 static/lark-doc/current`），就变成 `static/lark-doc/static/lark-doc/0.12.0` 这种断链，表现为**全部静态资源 404，但 `Cache-Control` 头还正常返回**（因为 location 命中了，只是文件找不到）——很容易误判成 nginx 配错。要么用绝对路径（上面给的写法），要么 `cd` 到该目录后再 `ln -s 0.12.0 current`。
2. **`ln -sfn` 不会替换已存在的同名目录。** 如果 `current` 已经被误建成真实目录，`ln -sfn` 会在它**里面**建一个 `0.12.0`，于是请求变成 `/vendor/lark-doc/current/0.12.0/...`。先 `ls -ld current` 确认它是个 `l` 开头的软链，不是 `d`。

验证软链没断：

```bash
ls -l /srv/static/vendor/lark-doc/current          # 应以 l 开头
curl -s -o /dev/null -w '%{http_code}\n' \
  https://wiki.intra.example.com/vendor/lark-doc/current/lark-doc-element.umd.min.js   # 期望 200
```

### 4.3 完整 nginx 配置

```nginx
# /etc/nginx/conf.d/wiki.conf

# ---------- 上游 ----------
upstream lark_doc_api {
    server 10.0.0.21:8080;
    keepalive 32;
}

upstream lark_doc_collab {
    server 10.0.0.22:9010;
    # 多实例时见 6.3
}

# ---------- 80 跳 443 ----------
server {
    listen 80;
    server_name wiki.intra.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;                              # nginx < 1.25.1 改成 listen 443 ssl http2;
    server_name wiki.intra.example.com;

    ssl_certificate     /etc/nginx/certs/intra.crt;
    ssl_certificate_key /etc/nginx/certs/intra.key;

    root  /srv/www/wiki;
    index index.html;

    # ---------- gzip ----------
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_comp_level 6;
    gzip_types
        text/plain text/css
        application/javascript application/json
        image/svg+xml;

    # ---------- 安全头 ----------
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header Referrer-Policy same-origin always;

    # 导入 docx / 贴大图
    client_max_body_size 64m;

    # ============================================================
    # 1) 宿主应用（history 路由，必须 try_files）
    # ============================================================
    location / {
        try_files $uri $uri/ /index.html;
    }

    # index.html 绝不缓存，否则发版后用户拿不到新入口
    location = /index.html {
        add_header Cache-Control "no-store" always;
    }

    # ============================================================
    # 2) lark-doc 静态资源（dist 整目录，长缓存）
    # ============================================================
    location /vendor/lark-doc/ {
        alias /srv/static/vendor/lark-doc/;
        autoindex off;

        # 注意：location 内的 types 会整体覆盖继承的 mime.types，
        # 所以这里必须列全，否则 .woff2 会返回 text/html
        types {
            application/javascript  js mjs;
            text/css                css;
            application/json        json map;
            font/woff2              woff2;
            font/woff               woff;
            font/ttf                ttf;
            image/svg+xml           svg;
            image/png               png;
        }

        # 文件名带 hash，可长缓存
        add_header Cache-Control "public, max-age=31536000, immutable" always;

        # 只有被别的站点跨域引用时才需要
        # add_header Access-Control-Allow-Origin "*" always;
    }
    # fonts/ 也由上面这条 location 服务（KaTeX 字体），不用单独配一段

    # ============================================================
    # 3) 业务 API
    # ============================================================
    location /api/ {
        proxy_pass http://lark_doc_api;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection        "";
        proxy_read_timeout 120s;
    }

    # ============================================================
    # 4) AI 接口：SSE，必须关 buffering
    # ============================================================
    location /api/ai/ {
        proxy_pass http://lark_doc_api;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header Connection        "";

        proxy_buffering off;              # ← 不关这个，前端只会在结束时一次性收到全文
        proxy_cache off;
        chunked_transfer_encoding on;

        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # ============================================================
    # 5) 协同 WebSocket
    # ============================================================
    location /collab {
        proxy_pass http://lark_doc_collab;

        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host            $host;
        proxy_set_header X-Real-IP       $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 3600s;         # 长连接不要被 60s 默认值掐断
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }
}
```

校验并重载：

```bash
nginx -t && nginx -s reload
```

> 上面这份配置已在 nginx **1.29.1** 上跑过真实 `nginx -t` 与端到端 `curl` 验证：`.js` / `.css` / `.woff2` 的 Content-Type 全部正确，`/lark-doc` 走 `try_files` 返回 `index.html` 且带 `no-store`。低版本 nginx 只需把 `http2 on;` 改回 `listen 443 ssl http2;`。

### 4.4 关于 MIME（别靠猜，一条 curl 定生死）

先说结论：**现代 nginx（≥ 1.11）自带的 `mime.types` 里已经有 `application/javascript js;` 和 `font/woff2 woff2;`**，只要 `http { include mime.types; }` 在，不写 `types` 块也是对的。

那为什么 4.3 还要显式写？因为内网环境经常中招这三种情况：

1. 内网硬化镜像把 `mime.types` 精简过，或者 `http` 块里压根没 include；
2. nginx 版本很老（Debian/CentOS 遗留系统），当时 `mime.types` 里还没有 `woff2`；
3. 有人在 `http` 里重写了 `default_type`，把未知类型变成了 `text/html`。

三种情况的症状一样：

- `.js` 若被当 `text/plain` 返回，浏览器拒绝执行（`Refused to execute script ... MIME type ('text/plain') is not executable`）。
- `.woff2` 若被当 `text/html` 返回，KaTeX 字体加载失败，公式渲染成空白或方框，控制台报 `Failed to decode downloaded font`。

> ⚠️ 一个必须知道的副作用：**`location` 内的 `types` 会整体覆盖继承来的 `mime.types`**，不是追加。所以要么全部列全（4.3 就是这么做的），要么一条都别写、只依赖继承。**半写半不写是最坑的**——那样 `.css` 会突然变成 `text/plain`。

实测（nginx 1.29.1，本机验证）：4.3 的配置下

| 请求 | Content-Type |
|---|---|
| `.../lark-doc-element.umd.min.js` | `application/javascript` |
| `.../lark-doc-element.umd.min.math.js` | `application/javascript` |
| `.../lark-doc.css` | `text/css` |
| `.../fonts/KaTeX_Main-Regular.woff2` | `font/woff2` |

验证命令（部署后必跑）：

```bash
curl -sI https://wiki.intra.example.com/vendor/lark-doc/current/lark-doc-element.umd.min.js \
  | grep -i content-type          # 期望 application/javascript

curl -sI https://wiki.intra.example.com/vendor/lark-doc/current/fonts/KaTeX_Main-Regular.woff2 \
  | grep -i content-type          # 期望 font/woff2
```

---

## 5. 流程四：宿主应用部署

### 5.1 history 路由必须配 `try_files`

参考宿主 `apps/vue2-webpack-node14` 用 `mode: 'history'`，路由表包含 `/lark-doc`、`/lark-doc-wc`、`/lark-doc-templates`、`/embed-demo/*` 等。nginx 不配 fallback，直接刷新 `/lark-doc` 就是 404：

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

（4.3 里已包含。）

### 5.2 环境变量（构建期注入）

Vue CLI 的 `VUE_APP_*` 是**构建时**打进 bundle 的，改完必须重新 `npm run build`：

```bash
# .env.production
VUE_APP_LOG_LEVEL=info
VUE_APP_AI_BASE_URL=                                  # 留空 → 走相对路径 /api，由 nginx 反代
VUE_APP_COLLAB_URL=wss://wiki.intra.example.com/collab
VUE_APP_DOCUMENT_NAME=demo-document
```

- `VUE_APP_AI_BASE_URL` 留空最省事：`src/services/ai.js` 里拼的是 `${AI_BASE_URL}/api/ai/chat`，留空即 `/api/ai/chat`，同源、不跨域、不吃 CORS。
- `VUE_APP_COLLAB_URL` 生产必须是 **`wss://`**（4.3 已配 TLS，用 `ws://` 会被浏览器按混合内容拦掉）。
- 内网域名/端口变了只改这里，不要改代码。

接口清单（对齐后端时用）：

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/ai/chat` | SSE，`Accept: text/event-stream`，事件体 `{type:'chunk'\|'error'\|'done'}` |
| POST | `/api/ai/retrieve` | `{query, topK:5}` → `{items}` |

### 5.3 区分 npm Element ESM 与静态 UMD

现代 Webpack5 / Vite 的 `import 'lark-doc/element'` 会解析到 Element ESM，样式自动注入，字体与动态 import 由宿主已有规则处理。无需套用旧 UMD 的 publicPath 或手动把资源复制到 `js/` 的规则。

静态 UMD 则完整复制 dist，通过独立 `<script src="…/lark-doc-element.umd.min.js">` 引用。主脚本按自身 URL 找同目录特性资源。不要把静态 UMD 再打入应用 bundle。

资源 404 时先确认采用哪条路线：ESM 检查宿主构建输出及 base/publicPath；静态 UMD 检查主脚本目录、特性 JS、fonts 是否完整。可复制例子见[Web Component 完整示例](/examples/web-component)。

### 5.4 webpack 4 宿主

Webpack4 不读 package exports，但会按 module 选择根 ESM。当前根入口和可达 chunk 已由库降语法，不需要 SDK 专属 alias / Babel 规则，也不要求更换应用工具链：

```js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/dist/lark-doc.css'
```

深入口写实际路径，例如 Vue2 options 使用 `lark-doc/dist/lark-doc-vue2.common.js`。新的 Element ESM 使用 import.meta.url，面向现代打包器；Webpack4 标签方案使用 5.5 的独立 UMD script。

<details>
<summary>0.12 及更早版本的老写法（alias 到 common.js + babel 降语法）</summary>

旧版没有 `browser` 字段，webpack 4 会命中 `module` 的 ESM 产物（含 `import.meta`）或在 lib 单文件上撞到 `?.` / `??`。三处写全路径 + 一条 babel 规则：

```js
// 1. 主入口
resolve: { alias: { 'lark-doc$': 'lark-doc/dist/lark-doc.common.js' } }

// 2. 样式
import 'lark-doc/dist/lark-doc.css'

// 3. Element
import 'lark-doc/dist/lark-doc-element.umd.min.js'
```

外加：CJS 产物里有 `?.` / `??`，webpack 4 的默认 babel 不会降级它。要对这一个文件单独挂一条 babel 规则，且**必须**关掉配置文件继承：

```js
{
  test: /lark-doc\.common\.js$/,
  use: [{
    loader: 'babel-loader',
    options: {
      configFile: false,     // ← 不关会用宿主 babel.config.js，把整个 lib 重编一遍
      babelrc: false,
      sourceType: 'script',
      plugins: ['@babel/plugin-proposal-optional-chaining', '@babel/plugin-proposal-nullish-coalescing-operator'],
    },
  }],
}
```

> 此处仅为旧版本迁移记录；当前版本不需要上述两个 Babel 插件或 alias。当前方案见[内网迁移实战 · 方案 A](/guide/intranet-migration#mig-vue2-wp4)。

</details>

### 5.5 `<script>` 直挂（无打包器）

```html
<script src="/vendor/lark-doc/current/lark-doc-element.umd.min.js"></script>
<!-- Element UMD 自动注入样式，无需再引公共 CSS。 -->

<lark-doc id="doc" title="文档标题" style="height:100vh"></lark-doc>

<script>
  const el = document.getElementById('doc')
  el.addEventListener('lark-doc-ready', e => console.log('ready', e.detail))
  el.addEventListener('lark-doc-change', e => console.log('change', e.detail.payload))
</script>
```

属性、事件、热更新规则见 [Web Component（跨框架）](/guide/web-component)。**关键一点**：`content` 变更会**重建实例**（不是增量），所以改内容前先 `getJSON()` 保住现场再赋值。

---

## 6. 流程五：协同服务（可选）

### 6.1 先确认要不要

不做协同 → 跳过整节，`/collab` 那段 nginx 删掉即可。

要做协同 → 需要**两个**东西：

1. 一个 WebSocket 服务端（独立包 `@lark-doc/collab-server`，**不在本仓库**）
2. 宿主用打包器接 `lark-doc/collab` 子入口

### 6.2 服务端契约（给运维/后端对齐用）

服务端代码不在本仓库，但契约是硬的（完整版见[协同服务端契约](/guide/collab-server)）：

| 项 | 要求 |
|---|---|
| 传输 | WebSocket，Hocuspocus 兼容协议 |
| 协议版本 | `COLLAB_PROTOCOL_VERSION = 1`，握手**双向校验**，不一致抛 `E_PROTOCOL_MISMATCH`（不回退、不半连） |
| `documentId` | 由宿主给（建议 `<workspaceId>/<docId>`），服务端当**不透明字符串**处理 |
| 落盘 | 键 = `documentId`，值 = `Y.encodeStateAsUpdate` 的二进制 |
| 鉴权 | `onAuthenticate({ token, documentName }) → { user: { id, name, color }, capabilities }`，失败拒连 |
| 只读 | `capabilities.canEdit === false` 时**服务端也必须拒写**（双保险） |
| 快照 | `POST /documents/:id/snapshots`、`GET /documents/:id/snapshots/:sid` |
| 首次播种 | 由**服务端**负责，多客户端同时进入只播种一次 |
| Node 版本 | 服务端 18+（本仓是 14，所以刻意分包） |

客户端侧两个硬要求：

- `new Y.Doc({ gc: false })` —— 评论锚点用 `Y.RelativePosition`，开了 GC 锚点会失效。
- 协同模式下**不传 `content`**，并且必须关掉 `StarterKit` 的 `undoRedo`（否则会和 yjs 的 undo 打架）。

### 6.3 nginx 反代 + 多实例

单实例就是 4.3 里的 `location /collab`。注意三件事：`Upgrade` 头、`Connection "upgrade"`、`proxy_read_timeout 3600s`（默认 60s 会周期性断连，用户表现为「每隔一分钟掉线重连」）。

**多实例必须做会话粘性**，因为 Yjs 文档状态在**进程内存**里，同一 `documentId` 落到不同实例就是两个孤立的世界：

```nginx
upstream lark_doc_collab {
    ip_hash;                      # 最简方案；或
    # hash $arg_documentId consistent;   # 按文档粘，更均匀
    server 10.0.0.22:9010;
    server 10.0.0.23:9010;
}
```

更正规的做法是用 hocuspocus 的 Redis 扩展做跨实例同步，此时 sticky 可以由 Redis 兜底（但仍有性能收益）。

如果内网前面还有一层 SLB/F5，**那一层也要开粘性**，只配 nginx 不够。

### 6.4 为什么 UMD / Element 不发协同产物

`lark-doc-element.umd.min.js` 把 tiptap **内联**了。如果再额外引入独立构建的 `collab` 子入口，需要防止产生两份 tiptap：

- `Node` / `Slice` 的 `instanceof` 判断失效
- `ySyncPluginKey` 不是同一个对象

症状非常迷惑：**连接成功、peer 数量正常、光标能看到，但正文永不同步**，而且只在生产构建出现（开发态 source 层是单实例，看不出问题）。

结论：**纯 CDN + Element 场景暂不支持协同**，要协同必须走 ESM 打包器接入。CI 里 `hocuspocus/server` 只允许出现在 `test/`，也是同一道防线。

---

## 7. 流程六：断网配置

内网服务器没有外网出口时，必须显式关掉外链行为，否则编辑器会挂起等超时。

### 7.1 `network.mode` 三态

| 值 | 行为 | 适用 |
|---|---|---|
| `'open'`（默认） | 不拦截，允许任意外链 | 有外网 |
| `'allowlist'` | 只放行指定 host，其余拦截 | 内网 + 少量可信图床 |
| `'offline'` | 拦截**全部**外链，图片降级为占位块 | **纯内网** |

```js
// JS 接入
new LarkDoc({
  element: el,
  network: {
    mode: 'offline',
    allowlist: ['img.intra.example.com'],   // mode='allowlist' 时生效
  },
})
```

```html
<!-- Element 接入 -->
<lark-doc network='{"mode":"offline"}'></lark-doc>
```

`offline` 模式下的行为：拦截点有三处——`transformPastedHTML`（粘贴带外链的 HTML）、`setContent()` 时的 JSON 遍历、ImageNode 渲染。被拦下的图片降级成占位块，**原始地址保留在 `data-original-src`**，后续内网化时还能批量捞回来。

### 7.2 外链图转存内网

如果用户会从外网复制带图内容，配 `imageProxy` 让宿主把图存到内网 OSS / MinIO：

```js
network: {
  mode: 'allowlist',
  imageProxy: async (src) => {
    const r = await fetch('/api/oss/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: src }),
    })
    const { url } = await r.json()
    return url      // 返回内网可访问地址；返回 null 则保持原样
  },
}
```

### 7.3 包本身是零 CDN 依赖的

不用担心漏配：KaTeX 字体与样式随包、emoji 是内置字符表、代码高亮是本地 chunk。CI 有 `scripts/check-offline-assets.js` 守这条线。

出包前自检：

```bash
node scripts/check-offline-assets.js
```

### 7.4 验收

1. 打开 DevTools → Network，勾 **Disable cache**，刷新。
2. 过滤器里逐条排除：只应出现 `wiki.intra.example.com` 的请求。
3. 出现任何外部域名 → 回查 `network.mode` 是否真的生效（Element 形态注意 `network` 是 **JSON 字符串**属性，写错会静默走默认 `open`）。
4. 粘贴一段带外链图片的 HTML，确认图片变占位块而不是一直转圈。

---

## 8. 流程七：上线校验

按顺序走，任一步失败就停。

### 8.1 产物完整性

```bash
cd dist-intranet && sha256sum -c sha256.txt
```

### 8.2 包可加载

```bash
node -p "require('lark-doc/package.json').version"
node -e "const m=require('lark-doc'); console.log(typeof m.LarkDoc, Object.keys(m).length)"
# 期望首项为 function；导出数量不作为版本契约
```

### 8.3 静态资源全在

```bash
BASE=https://wiki.intra.example.com/vendor/lark-doc/current
for f in \
  lark-doc-element.umd.min.js \
  lark-doc-element.umd.min.math.js \
  lark-doc-element.umd.min.mermaid.js \
  lark-doc-element.umd.min.office.js \
  lark-doc-element.umd.min.markdown.js \
  lark-doc-element.umd.min.highlight.js \
  lark-doc.css ; do
  printf '%-46s %s\n' "$f" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/$f")"
done
# 全部应是 200
```

### 8.4 浏览器验收清单

| # | 操作 | 期望 |
|---|---|---|
| 1 | 刷新 `/lark-doc` | 不 404（`try_files` 生效） |
| 2 | 编辑器正常渲染 | 工具栏、正文、光标都在 |
| 3 | 输入公式 `$a^2+b^2=c^2$` | 渲染成公式，**不是豆腐块**（字体 OK） |
| 4 | 插入 mermaid 代码块 | 渲染成图，不是空白 |
| 5 | 导入一个 `.docx` | 成功，控制台无 404 |
| 6 | 粘贴带格式的 HTML | 样式正确（markdown chunk 在） |
| 7 | 代码块 | 有语法高亮 |
| 8 | 斜杠菜单 / 块菜单 | 浮层不被吸顶栏裁切 |
| 9 | （协同）两个浏览器同时编辑 | 双向同步，光标可见 |
| 10 | （协同）断网 1 分钟再恢复 | 自动重连，内容一致 |
| 11 | DevTools Network | 只有内网域名（第 7.4 节） |
| 12 | 保存后刷新 | 内容还在（持久化适配器通了） |

第 3/4/5/6/7 条任一条失败，基本都是**按需 chunk 没拷全**或**静态资源 URL 或宿主部署基址不匹配**，回 4.1 / 5.3 对号入座。

---

## 9. 流程八：回滚

### 9.1 静态资源（秒级，无需重启）

```bash
# 切回上一版
ln -sfn /srv/static/vendor/lark-doc/0.11.6 /srv/static/vendor/lark-doc/current
```

前端页面引的是 `current` 路径，`Cache-Control: immutable` 只对**具体文件路径**生效，`current/xxx.js` 解析后的实际内容变了，但缓存键还是 `current/xxx.js` —— 所以回滚后要**让用户强刷**，或者更稳的做法是：index.html 里带版本号（`/vendor/lark-doc/0.12.0/...`），回滚时连 index.html 一起换。

推荐后者：目录布局保持 `/vendor/lark-doc/<ver>/`，nginx 里把 `current` 软链换成 `$lark_doc_version` 变量，或者干脆让宿主构建时写死版本路径。

### 9.2 npm 包

**必须换版本号回滚，不能同版本号重打。** 同版本号重打会让 `npm ci` 报 `EINTEGRITY`（lock 里的 integrity 与实物不符），而且内网没有 registry 修不了这个冲突。

```bash
# 正确的回滚：把旧版本的 tgz 放进 vendor/，改 package.json 引用
cp dist-intranet/lark-doc-0.11.6-intranet.tgz vendor/
# package.json: "lark-doc": "file:./vendor/lark-doc-0.11.6-intranet.tgz"
rm -rf node_modules/lark-doc
npm install --no-audit --no-fund
```

### 9.3 事后核对

```bash
node -p "require('lark-doc/package.json').version"     # 确认版本真的回去了
```

---

## 10. 排错对照

### 10.1 安装/引入阶段

| 报错 | 原因 | 处理 |
|---|---|---|
| `E401 ... Basic realm="artifactory Realm"` | npm 6 拿 `名字@*` 去 registry 查版本 | 用 `dist-intranet/` 的包（3.4 #1） |
| `ENOENT Cannot cd into '...unpack-xxxx'` | macOS tar 扩展头 | 用 `pack-intranet.sh` 重打的包（3.4 #2） |
| `Cannot find module 'vue/dist/vue.runtime.common.js'` | 使用了旧产物或旧 alias | 当前运行时不依赖 Vue；核对包版本、锁文件与主入口 |
| `unknown option '--legacy-peer-deps'` | npm 6 没这参数 | 去掉它（3.1） |
| `EINTEGRITY` | 同版本号重打了包 | 换版本号（3.5 #5） |
| `Cannot find module 'lark-doc/element'` | Webpack4 不读 exports | 标签方案使用独立 UMD script，不在 Webpack4 中打包新 Element ESM（5.4 / 5.5） |
| 样式不生效 | 同上，`style.css` 解析失败 | 写全 `lark-doc/dist/lark-doc.css`（5.4） |
| `Vue packages version mismatch` | 宿主 Vue / compiler 不一致，或仍在用旧编辑器产物 | 对齐宿主自己的框架依赖；当前编辑器无需 Vue 或 `@tiptap/vue-2` |
| `Failed to resolve component: lark-doc` | 没注册 / 没引 element 产物 | 见 [Web Component](/guide/web-component) |
| `customElements is not defined` | jsdom / 老浏览器 | 换环境，或改用 ESM 形态 |

### 10.2 运行时/资源阶段

| 现象 | 原因 | 处理 |
|---|---|---|
| 公式变豆腐块 / 空白 | `fonts/` 没拷，或 `.woff2` MIME 错 | 4.1 + 4.4 |
| mermaid 图不渲染 | `*.mermaid.js` chunk 404 | 4.1 |
| 导入 docx 报 404 | `*.office.js` chunk 404 | 4.1 |
| 粘贴 HTML 样式丢失 | `*.markdown.js` chunk 404 | 4.1 |
| 代码块无高亮 | `*.highlight.js` chunk 404 | 4.1 |
| 按需资源 404 | 混用 Element ESM / UMD 或部署目录不完整 | 按 5.3 区分接入方式，再核对基址与输出 |
| 刷新子路由 404 | history 路由没配 `try_files` | 5.1 |
| AI 回复一次性蹦出来（不是流式） | nginx 缓冲了 SSE | `proxy_buffering off`（4.3 第 4 段） |
| 协同每分钟掉线 | `proxy_read_timeout` 用了默认 60s | 4.3 第 5 段 |
| 协同连上了但正文不同步 | 双 tiptap 实例（UMD/Element 引了 collab） | 改用 ESM 形态（6.4） |
| 协同多实例内容分裂 | 没有会话粘性 | 6.3 |
| `E_PROTOCOL_MISMATCH` | 服务端与客户端协议版本不一致 | 对齐 `COLLAB_PROTOCOL_VERSION = 1`（6.2） |
| 编辑器卡住约 30s 才出内容 | 断网环境有外链在等超时 | 配 `network.mode: 'offline'`（7.1） |

完整版（19 条）见[各环境引入对照](/guide/environments)。

---

## 附：一次性检查清单

出包机：

- [ ] `node -v` = 14.21.3
- [ ] `npm run check` 全绿
- [ ] `npm run size` 五项达标
- [ ] `node scripts/check-offline-assets.js` 通过
- [ ] npm 路线已准备完整依赖镜像 / 缓存；若使用旧离线 helper，已在目标环境断网安装与构建验收
- [ ] `sha256sum -c sha256.txt` 通过

内网服务器：

- [ ] 静态 UMD 的 `dist/` **整目录**已就位，包含 fonts、全部特性与共享区块
- [ ] nginx `types` 显式声明 `application/javascript` + `font/woff2`
- [ ] `curl -I` 验证 `.js` / `.woff2` 的 `Content-Type`
- [ ] 宿主 `location /` 有 `try_files ... /index.html`
- [ ] `location = /index.html` 是 `no-store`
- [ ] `/api/ai/` 有 `proxy_buffering off`
- [ ] `/collab` 有 `Upgrade` / `Connection "upgrade"` / `proxy_read_timeout 3600s`
- [ ] 多实例协同开了 `ip_hash`
- [ ] `VUE_APP_COLLAB_URL` 是 `wss://`
- [ ] `network.mode` 为 `offline` 或 `allowlist`
- [ ] 第 8.4 节 12 条浏览器验收全过

宿主工程（Vue 2 / Vue 3，逐条见[内网迁移实战](/guide/intranet-migration)）：

- [ ] `package.json` 里 `lark-doc` 指向实际离线包；宿主框架依赖单独管理，不为编辑器额外安装 Vue
- [ ] `node_modules` 是在**内网机**上装出来的（不是从联网机整包拷的）
- [ ] Webpack4 宿主：根入口直接使用 `lark-doc`；CSS / 深子路径写实际文件，未保留旧 SDK alias / 专属转译规则
- [ ] 仍使用旧版本时，按该版本实际语法需求配置 Babel，不把历史配置误当作当前契约
- [ ] webpack5 宿主：没有误加 `transpileDependencies: ['lark-doc']`
- [ ] 任意框架均可用默认入口；若选 Element 静态方式，`public/vendor/lark-doc/` 下是完整 `dist/`
- [ ] 内网首启 `npm run build` 零报错，产物里能搜到 `lark-doc`
