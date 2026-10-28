#!/usr/bin/env bash
# 出「lark-doc 开发文档站」的内网部署包。
#
# 产物 dist-docs-intranet/：
#   site.tar.gz            静态站点（解压即用，无 Node 依赖）
#   site/                  解压后的同一份内容（本机可直接 nginx 指过来）
#   nginx-docs.conf        按 --base 生成好的 nginx 配置，改 3 个路径即可用
#   INSTALL-内网.md         内网侧操作手册
#   sha256.txt             校验值
#
# 用法：
#   bash scripts/pack-docs.sh                       # 根路径部署，base=/
#   bash scripts/pack-docs.sh --base /lark-doc/     # 子路径部署
#   bash scripts/pack-docs.sh --skip-install        # 复用已有 docs/node_modules
#   bash scripts/pack-docs.sh --out /tmp/docs-out
#
# 为什么要 Node 18+：包本身锁 Node 14（见 .nvmrc），但文档站是 VitePress 1.6，
# 在 Node 14 下会报 `SyntaxError: Unexpected token '??='`（报错完全不像版本问题）。
# 本脚本会主动拦截并提示。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCS="$ROOT/docs"
BASE="/"
OUT="$ROOT/dist-docs-intranet"
SKIP_INSTALL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --base)         BASE="$2"; shift 2 ;;
    --out)          OUT="$2"; shift 2 ;;
    --skip-install) SKIP_INSTALL=1; shift ;;
    -h|--help)      sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 1 ;;
  esac
done

# ---- 规范化 base：必须以 / 开头、以 / 结尾 ----
case "$BASE" in /*) ;; *) BASE="/$BASE" ;; esac
case "$BASE" in */) ;; *) BASE="$BASE/" ;; esac
# 子路径名（根路径时为空串）
SUBPATH="$(printf '%s' "$BASE" | sed 's#^/##; s#/$##')"

# ---- Node 版本闸门 ----
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "" >&2
  echo "✗ 当前 Node 是 $(node -v)，文档站构建需要 Node >= 18。" >&2
  echo "  本仓库 .nvmrc 锁的是 14.21.3（那是给 lark-doc 包构建用的），直接 nvm use 会踩雷。" >&2
  echo "  切换：nvm use 20  或  nvm use 18" >&2
  echo "  Node 14 下的真实报错是：SyntaxError: Unexpected token '??=' —— 看不出是版本问题。" >&2
  echo "" >&2
  exit 1
fi
echo "▸ Node $(node -v)  base=$BASE"

# ---- 装依赖 ----
if [ "$SKIP_INSTALL" -eq 0 ]; then
  if [ ! -d "$DOCS/node_modules" ]; then
    echo "▸ 安装文档站依赖（首次约 1~2 分钟）"
    ( cd "$DOCS" && npm ci )
  else
    echo "▸ 已有 docs/node_modules，跳过安装（强制重装请删掉该目录）"
  fi
fi

# ---- 构建 ----
rm -rf "$OUT"
mkdir -p "$OUT"
echo "▸ 构建静态站点"
( cd "$DOCS" && DOCS_BASE="$BASE" npx vitepress build . --outDir "$OUT/site" )
[ -f "$OUT/site/index.html" ] || { echo "✗ 构建产物缺少 index.html" >&2; exit 1; }

# ---- 校验产物里 base 是否真的生效（防 sed 式手改）----
if [ "$BASE" = "/" ]; then
  grep -q 'src="/assets/' "$OUT/site/index.html" \
    || { echo "✗ 产物资源路径不是根路径，base 未生效" >&2; exit 1; }
else
  grep -q "src=\"${BASE}assets/" "$OUT/site/index.html" \
    || { echo "✗ 产物资源路径不含 ${BASE}，base 未生效" >&2; exit 1; }
fi

PAGES="$(find "$OUT/site" -name '*.html' | wc -l | tr -d ' ')"
SIZE="$(du -sh "$OUT/site" | awk '{print $1}')"
echo "▸ 产物：${PAGES} 个页面 / ${SIZE}"

# ---- 打包 ----
( cd "$OUT" && tar czf site.tar.gz site )
echo "▸ 已打包 site.tar.gz（$(du -sh "$OUT/site.tar.gz" | awk '{print $1}')）"

# ---- 生成 nginx 配置 ----
if [ "$BASE" = "/" ]; then
  ROOT_LINE="/srv/www/lark-docs"
  LOC_PREFIX=""
  INDEX_LOC="    location = /index.html { add_header Cache-Control \"no-cache\" always; }"
else
  ROOT_LINE="/srv/www"
  LOC_PREFIX="/${SUBPATH}"
  INDEX_LOC="    location = ${BASE}index.html { add_header Cache-Control \"no-cache\" always; }"
fi

if [ "$BASE" = "/" ]; then
cat > "$OUT/nginx-docs.conf" <<NGINX
# lark-doc 开发文档站 —— 根路径部署（base=/）
# 用法：把 site/ 的内容放到 ${ROOT_LINE}，然后 include 本文件或整段并入 server {}。
# 已实测：nginx 1.29.1，nginx -t 通过。
server {
    listen 80;
    server_name docs.intra.example.com;

    root $ROOT_LINE;
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
        try_files \$uri \$uri.html \$uri/ =404;
    }

    # 带 hash 的静态资源可以永久缓存
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    # HTML 一律不缓存，否则更新后用户看到旧页面
    location ~* \\.html\$ {
        add_header Cache-Control "no-cache" always;
    }

$INDEX_LOC

    # VitePress 会生成 404.html，兜底用
    error_page 404 /404.html;
}
NGINX
else
cat > "$OUT/nginx-docs.conf" <<NGINX
# lark-doc 开发文档站 —— 子路径部署（base=${BASE}）
# 用法：把 site/ 的内容放到 ${ROOT_LINE}/${SUBPATH}/，然后 include 本文件。
# 关键：用 root + 同名目录，不要用 alias（alias 与 try_files 组合会让子路径首页 404）。
# 已实测：nginx 1.29.1，nginx -t 通过。
server {
    listen 80;
    server_name docs.intra.example.com;

    root $ROOT_LINE;
    charset utf-8;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_comp_level 6;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;

    location = / { return 302 ${BASE}; }

    location ${BASE} {
        try_files \$uri \$uri.html \$uri/ =404;
    }

    location ${BASE}assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    location ~* ^${BASE}.*\\.html\$ {
        add_header Cache-Control "no-cache" always;
    }

$INDEX_LOC

    error_page 404 ${BASE}404.html;
}
NGINX
fi
echo "▸ 已生成 nginx-docs.conf"

# ---- 安装手册 ----
if [ "$BASE" = "/" ]; then
  DEPLOY_DIR="$ROOT_LINE"
  URL_HINT="http://docs.intra.example.com"
  UNPACK_CMD="tar -xzf site.tar.gz -C $ROOT_LINE --strip-components=1"
else
  DEPLOY_DIR="${ROOT_LINE}/${SUBPATH}"
  URL_HINT="http://docs.intra.example.com${BASE%/}"
  UNPACK_CMD="tar -xzf site.tar.gz -C $DEPLOY_DIR --strip-components=1"
fi

# 从真实产物里取文件名，写进手册，避免内网侧还要自己 ls 找
STYLE_FILE="$(ls "$OUT/site/assets" 2>/dev/null | grep -E '^style\..*\.css$' | head -1)"
SEARCH_FILE="$(ls "$OUT/site/assets/chunks" 2>/dev/null | grep localSearchIndexroot | head -1)"

cat > "$OUT/INSTALL-内网.md" <<MD
# lark-doc 开发文档站 · 内网部署

本包是一份**纯静态站点**，内网侧不需要 Node、不需要 npm、不需要任何后端进程。

- base：\`$BASE\`
- 页面数：$PAGES
- 解压后体积：$SIZE

## 一、放到服务器

\`\`\`bash
mkdir -p "$DEPLOY_DIR"
$UNPACK_CMD
\`\`\`

## 二、配 nginx

把本目录的 \`nginx-docs.conf\` 并入站点配置（或整个 include），然后：

\`\`\`bash
nginx -t && nginx -s reload
\`\`\`

配置里已包含：gzip、assets 永久缓存、HTML 不缓存、404 兜底、charset utf-8。

## 三、验收

\`\`\`bash
# 1) 首页 200（同时确认 Content-Type 是 text/html）
curl -sI "$URL_HINT/" | grep -iE '^HTTP|^content-type'

# 2) 随便一篇文档 200
curl -sI "$URL_HINT/guide/getting-started.html" | grep -iE '^HTTP|^cache-control'

# 3) 静态资源是长缓存
curl -sI "$URL_HINT/assets/$STYLE_FILE" | grep -i '^cache-control'

# 4) 搜索索引在（内网搜索靠它，不依赖 Algolia）
curl -sI "$URL_HINT/assets/chunks/$SEARCH_FILE" | grep -iE '^HTTP|^content-length'

# 5) 不存在的页面走 404.html
curl -s "$URL_HINT/__nope__" | grep -o '<title>[^<]*</title>'
\`\`\`

浏览器再确认三件事：

1. 左上角能出 logo，右上角搜索框能搜到中文关键词
2. 左侧栏能点，正文代码块有高亮
3. 切一次暗色模式（右上角月亮图标）后刷新，主题能记住

## 四、更新

覆盖文件即可，不需要重启 nginx：

\`\`\`bash
$UNPACK_CMD
\`\`\`

HTML 已配 \`no-cache\`、assets 带 content hash，用户强刷一次就能拿到新版。要保证「秒回滚」，可以先解压到新目录再改 nginx 的 root 指向。

## 五、注意

- 文档正文里指向 GitHub / unpkg / jira 的链接，在内网点了打不开——这是内容层面的外链，不影响页面渲染。
- 站点本身零外网请求（已核验产物：字体、图标、搜索索引全部本地化）。
MD
echo "▸ 已生成 INSTALL-内网.md"

# ---- 校验值 ----
( cd "$OUT" && { command -v sha256sum >/dev/null && sha256sum site.tar.gz || shasum -a 256 site.tar.gz; } > sha256.txt )
echo "▸ 已生成 sha256.txt"

echo ""
echo "✓ 完成：$OUT"
echo "  site.tar.gz      $(du -sh "$OUT/site.tar.gz" | awk '{print $1}')   静态站点，解压即用"
echo "  site/            $(du -sh "$OUT/site" | awk '{print $1}')   同内容未压缩"
echo "  nginx-docs.conf  已按 base=$BASE 生成"
echo "  INSTALL-内网.md  内网操作手册"
echo ""
echo "内网只需要：拷 site.tar.gz → 解压 → nginx 指过去。"
