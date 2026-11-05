# 文档站内网部署

本文仅在仓库维护，讲的是**这套开发文档站（VitePress）本身**怎么再部署一份到内网。

> 如果你的目标是让内网业务系统用上 lark-doc 编辑器本体（npm 包、`dist/` 静态托管、协同服务反代），看 [内网服务器部署](./deployment-intranet.md)。两件事，别混。

## 一、现在是怎么发布的

仓库里已经有一条 GitHub Actions 流水线（`.github/workflows/deploy-docs.yml`）：

| 环节 | 取值 |
| --- | --- |
| 触发 | push 到 `master` 且文档、库源码、构建脚本或依赖变化；也可手动 `workflow_dispatch` |
| Node | 安装与 Vite 示例 22，库与 Webpack 示例 14.21.3，文档 20 |
| 依赖缓存 | 根及 `docs/package-lock.json` |
| 工作目录 | 根目录构建编辑器，再进入 `docs` |
| 安装 | `npm ci` |
| 构建 | 库构建与 vendor 同步 → Node14 Webpack 示例 → Node22 Vite/静态示例 → 全部资源检查 → Node20 文档构建 |
| 产物 | `docs/.vitepress/dist` |
| 发布 | `actions/upload-pages-artifact@v3` + `actions/deploy-pages@v4` |
| 访问 | `https://<user>.github.io/LarkDoc/` |

关键点：文档站是 `docs/` 下的**独立子包**（`name: lark-docs`、`private: true`、`vitepress ^1.6.3`），有独立的 `package.json` 与 `package-lock.json`。根 `package.json` 里没有任何 docs 脚本，别在根目录敲 `npm run docs:build`。

在线 demo 的 vendor 资源由当前提交构建，不提交旧资源。首次本地构建、内网出包前，按 [本地开发与验证](./development.md) 先完成库构建与 `node scripts/demo-sync-vendor.mjs`、六环境构建和 `node scripts/demo-build-examples.mjs --check`。随后再执行本文文档构建与静态托管步骤。

## 二、前提改动：base 可注入（已完成，你只需知道怎么用）

`base` 不是装饰品，它会渗透到**资源 URL、站内路由、本地搜索索引**三处。内网访问路径一旦不是 `/LarkDoc/`，页面就白屏、链接 404、搜索失效；而且**构建完再 sed 替换是不行的**——`hashmap.json` 和搜索索引里都有 base 派生出来的键。

所以 `docs/.vitepress/config.mts` 里已把 `base` 改成环境变量注入，默认值仍是 `'/LarkDoc/'`，GitHub Pages 那条链路行为完全不变。你只需要：

```bash
DOCS_BASE=/ npm run docs:build          # 内网根路径
DOCS_BASE=/lark-doc/ npm run docs:build # 内网子路径
```

首尾斜杠不用自己记，代码会补。用 `scripts/pack-docs.sh --base xxx` 时它也会帮你设好这个变量。

## 三、三条路线，先选一条

| | 路线 A · 构建机出静态包 | 路线 B · 内网自建 | 路线 C · 源码整体搬迁 |
| --- | --- | --- | --- |
| 内网需要什么 | 只要 nginx | Node ≥18 + npm 内网源 | 同 B，另加 git |
| 搬进去的体积 | 以本次实际包为准（`site.tar.gz`） | 完整仓库 + 构建依赖（大小以实际为准） | 同 B，另保留 Git 历史 |
| 内网改内容 | 改不了，要回构建机重建 | 可以，改完自己 build | 可以 |
| 首次准备 | 一条命令 | 配置 npm 镜像并按开发指南安装 | 同 B |
| 适用 | 内网只读文档，内容由研发维护 | 内网要能独立出包 | 内网要能提 PR / 看历史 |

**推荐路线 A。** 文档站的读者在内网，维护者在外网研发机，出包这件事天然应该在能上外网的那台机器做。内网只承担「解压 + nginx」，运维成本最低，也不会因为内网 npm 源不同步而构建失败。

下面 A 写全流程，B / C 只写差异点。

## 四、路线 A：构建机出静态包

### 4.1 一条命令

```bash
cd apps/lark-doc
# 先按本地开发指南构建库、同步 vendor，并构建/检查六环境示例

# 根路径部署（内网独立域名，如 docs.intra.example.com/）
bash scripts/pack-docs.sh

# 子路径部署（挂在已有门户下，如 docs.intra.example.com/lark-doc/）
bash scripts/pack-docs.sh --base /lark-doc/

# 自定义输出目录
bash scripts/pack-docs.sh --base /lark-doc/ --out /tmp/docs-out
```

脚本会：装依赖（没有 `docs/node_modules` 时）→ 构建 → 校验 base 真的生效 → 打包 → 生成 nginx 配置 → 生成内网手册 → 算校验值。

产物在 `dist-docs-intranet/`（已加入 `.gitignore`）：

| 文件 | 说明 |
| --- | --- |
| `site.tar.gz` | 静态站点，以本次实际包为准，解压即用 |
| `site/` | 同一份内容未压缩，本机可直接用 nginx 指过来验证 |
| `nginx-docs.conf` | 已按 `--base` 生成好的配置，改 1~2 个路径即可用 |
| `INSTALL-内网.md` | 内网侧操作手册（含真实文件名，不用现场 `ls`） |
| `sha256.txt` | 校验值 |

页面数量和体积随功能及示例变化，以脚本本次输出为准。

### 4.2 构建使用的 Node 版本

六个预览准备好之后，文档站与 `pack-docs.sh` 推荐使用 Node 20。
库/旧 Webpack 的 Node14 和现代 Vite 的 Node22 步骤见[本地开发与验证](./development.md)。
不要直接用仓库 `.nvmrc` 的 Node14 构建 VitePress。
内网服务器只是托管已构建的静态文件，不需要安装 Node。

### 4.3 搬进内网

```bash
# 在构建机上
scp dist-docs-intranet/site.tar.gz ops@内网跳板:/tmp/

# 在内网服务器上（根路径版）
sudo mkdir -p /srv/www/lark-docs
sudo tar -xzf /tmp/site.tar.gz -C /srv/www/lark-docs --strip-components=1

# 子路径版（站点放在 /srv/www/lark-doc/）
sudo mkdir -p /srv/www/lark-doc
sudo tar -xzf /tmp/site.tar.gz -C /srv/www/lark-doc --strip-components=1
```

`--strip-components=1` 是必须的，包内顶层是 `site/` 目录。

### 4.4 nginx

`nginx-docs.conf` 里是完整的 `server {}`，可以直接 `include`，也可以把内容并进已有站点块。

**根路径版**（站点落在 `/srv/www/lark-docs`）：

```nginx
server {
    listen 80;
    server_name docs.intra.example.com;

    root /srv/www/lark-docs;
    index index.html;
    charset utf-8;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_comp_level 6;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;

    add_header X-Content-Type-Options nosniff always;

    # 补全手输 URL 去掉 .html 的情况；纯静态站不需要 history 回退
    location / {
        try_files $uri $uri.html $uri/ =404;
    }

    # 带 hash 的静态资源可以永久缓存
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    # HTML 一律不缓存，否则更新后用户看到旧页面
    location ~* \.html$ {
        add_header Cache-Control "no-cache" always;
    }

    location = /index.html { add_header Cache-Control "no-cache" always; }

    # VitePress 会生成 404.html，兜底用
    error_page 404 /404.html;
}
```

**子路径版**（站点落在 `/srv/www/lark-doc/`）：

```nginx
server {
    listen 80;
    server_name docs.intra.example.com;

    root /srv/www;
    charset utf-8;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_comp_level 6;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;

    location = / { return 302 /lark-doc/; }

    location /lark-doc/ {
        try_files $uri $uri.html $uri/ =404;
    }

    location /lark-doc/assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    location ~* ^/lark-doc/.*\.html$ {
        add_header Cache-Control "no-cache" always;
    }

    location = /lark-doc/index.html { add_header Cache-Control "no-cache" always; }

    error_page 404 /lark-doc/404.html;
}
```

子路径版有两条硬规矩，都是实测踩出来的：

1. **必须用 `root` + 同名目录，不要用 `alias`。** `location /lark-doc/ { alias /srv/www/lark-docs/; try_files ...; }` 会让 `http://host/lark-doc/` 返回 **404**，而所有子页面正常返回 200 —— 这种「只有首页 404」的现象极难排查。目录名必须和 location 前缀同名（`/lark-doc/` 对应 `/srv/www/lark-doc/`）。
2. **HTML 的 `no-cache` 要用正则覆盖全部 `.html`。** 只给 `index.html` 加一条是不够的，子页面照样会被浏览器缓存，更新后用户看到旧内容。

加载并生效：

```bash
sudo nginx -t && sudo nginx -s reload
```

### 4.5 验收

```bash
# 1) 首页 200，且 Content-Type 是 text/html
curl -sI http://docs.intra.example.com/ | grep -iE '^HTTP|^content-type'

# 2) 随便一篇文档 200，且 HTML 不缓存
curl -sI http://docs.intra.example.com/guide/getting-started.html | grep -iE '^HTTP|^cache-control'

# 3) 静态资源是长缓存
curl -sI http://docs.intra.example.com/assets/style.<hash>.css | grep -i '^cache-control'

# 4) 搜索索引在（内网搜索靠它，不依赖 Algolia）
curl -sI http://docs.intra.example.com/assets/chunks/@localSearchIndexroot.<hash>.js | grep -iE '^HTTP|^content-length'

# 5) 不存在的页面走 404.html
curl -s http://docs.intra.example.com/__nope__ | grep -o '<title>[^<]*</title>'
```

第 3、4 条里的 `<hash>` 每次构建都不同，**别抄旧值**。真实文件名在 `dist-docs-intranet/INSTALL-内网.md` 里已经填好，或现场取：

```bash
ls /srv/www/lark-docs/assets/ | grep '^style\.'
ls /srv/www/lark-docs/assets/chunks/ | grep localSearchIndexroot
```

浏览器再确认三件事：

1. 左上角出 logo，右上角搜索框能搜到中文关键词
2. 左侧栏能点，正文代码块有高亮
3. 切一次暗色模式后刷新，主题能记住

### 4.6 更新

覆盖文件即可，不用重启 nginx：

```bash
sudo tar -xzf /tmp/site.tar.gz -C /srv/www/lark-docs --strip-components=1
```

HTML 是 `no-cache`、assets 带 content hash，用户正常刷新就能拿到新版，而旧资源仍可命中缓存。

要「秒回滚」的话，解压到带版本号的新目录（`/srv/www/releases/2026-10-27/`），再改 nginx `root` 指向 + `reload`，老目录留几天。

## 五、内网重新构建

内网维护者需要重新编译页面时，保留完整仓库、四个最小应用的锁文件，并配置可提供全部依赖的 npm 镜像。
按[本地开发与验证](./development.md)完成依赖安装、库和六环境预览构建后，再运行：

```bash
# 仓库根目录，Node20
bash scripts/pack-docs.sh --base /lark-doc/
```

不要只复制 Markdown 后直接调用 VitePress；页面会包含最小应用源码，还需要已构建的预览、字体和功能脚本。
出包脚本会检查这些资源的一致性，避免站点打开后示例窗口为空。
只读部署直接搬运路线 A 的 `site.tar.gz` 即可。

## 六、为什么这套站点能完全离线

内网部署最怕的是「页面打开了，但样式 / 字体 / 搜索全挂」。逐项核验过产物：

| 项 | 结论 |
| --- | --- |
| 字体 | `inter` 家族 woff2 全部本地，无 Google Fonts |
| logo / 图标 | 本地 `logo.svg`，无 icon CDN |
| 全文搜索 | VitePress `search.provider: 'local'`，索引产物 `assets/chunks/@localSearchIndexroot.<hash>.js`（约 500 KB），**不走 Algolia** |
| 外链 | 产物里的 `https://` 字符串只出现在文档正文的外链、`w3.org` 命名空间、`vuejs.org` 的报错文档 URL |

也就是说：**站点本身零外网请求**。正文里指向 GitHub / unpkg / jira 的链接在内网点开当然打不开，但那只是内容层面的外链，不影响任何页面渲染。

## 七、踩坑清单

| 现象 | 根因 | 处置 |
| --- | --- | --- |
| `SyntaxError: Unexpected token '??='` | Node 14 跑 VitePress 1.6 | 切 Node ≥18；`pack-docs.sh` 已拦截 |
| 页面白屏 / 链接全 404 / 搜索无结果 | `base` 与实际路径不符 | 用 `DOCS_BASE` 重新构建，**不要 sed 改产物** |
| 只有子路径首页 404，其余都 200 | `alias` + `try_files` 组合 | 改 `root` + 同名目录 |
| 更新后部分页面还是旧的 | 只有 `index.html` 配了 `no-cache` | 加 `location ~* \.html$` 正则覆盖全部 HTML |
| 搜索索引 404 | 抄了上次构建的 hash 文件名 | hash 每次构建都变，现场 `ls` 取真实名 |
| 缺 `.js` / `.woff2` 的 MIME | nginx `mime.types` 太老 | 现代版本（实测 1.29.1）自带 `application/javascript js;` 与 `font/woff2 woff2;`；老版本需手动补 |

## 八、和 GitHub Pages 的关系

两条线互不干扰，共用同一份源码：

- GitHub Pages：`push` 到 `master` → CI 里 `DOCS_BASE` 不设 → 落到默认 `/LarkDoc/`，与改造前一致。
- 内网：构建机上手动跑 `pack-docs.sh` → 显式传 `--base`。

要发布新版本文档，先 push 让公网更新，再在构建机重跑一次 `pack-docs.sh` 把包搬进内网。
