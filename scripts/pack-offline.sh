#!/usr/bin/env bash
#
# lark-doc 内网离线打包
#
# 一条命令产出可拷进内网的离线包：
#
#   bash scripts/pack-offline.sh               # 完整流程（构建 + 打包 + 缓存）
#   bash scripts/pack-offline.sh --skip-build   # dist 已是最新，只打包
#   bash scripts/pack-offline.sh --no-cache     # 不打依赖缓存（内网有私服时用这个）
#
# 产出目录 dist-offline/：
#   lark-doc-<ver>.tgz      主包（可直接 npm install ./xxx.tgz）
#   npm-cache.tgz           npm 缓存（含全部 runtime 依赖，完全离线时用）
#   package.snippet.json    内网项目 dependencies 片段
#   INSTALL.md              内网安装说明
#
set -euo pipefail

# 宿主 NODE_OPTIONS 会带 WorkBuddy 的 shim，Node 14 构建时会崩，统一清掉
unset NODE_OPTIONS

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PKG_DIR"

NODE14_DIR="/Users/cjjxw/.nvm/versions/node/v14.21.3/bin"
NODE24_DIR="/Users/cjjxw/.nvm/versions/node/v24.22.0/bin"
OUT_DIR="$PKG_DIR/dist-offline"
CACHE="$HOME/.npm/_cacache"

SKIP_BUILD=0
NO_CACHE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-build) SKIP_BUILD=1; shift ;;
    --no-cache) NO_CACHE=1; shift ;;
    -h | --help) awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

# 统一剥掉系统代理：127.0.0.1:51253 会干扰 registry 访问
net() { env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY -u all_proxy "$@"; }

NAME="$(node -p "require('./package.json').name")"
VERSION="$(node -p "require('./package.json').version")"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"

echo "lark-doc 内网打包 · $NAME@$VERSION · 分支 $BRANCH"

[ -x "$NODE14_DIR/node" ] || { echo "✗ 缺少 Node 14：$NODE14_DIR/node"; exit 1; }
[ -x "$NODE24_DIR/npm" ] || { echo "✗ 缺少 Node 24 npm：$NODE24_DIR/npm"; exit 1; }

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# ---------- 1. 构建 ----------
if [ "$SKIP_BUILD" = 0 ]; then
  echo ""
  echo "[1/4] 构建四个产物（Node 14，约 4 分钟）"
  PATH="$NODE14_DIR:$PATH" npm run build
  echo "    ✓ commonjs"
  PATH="$NODE14_DIR:$PATH" npm run build:umd
  echo "    ✓ umd"
  PATH="$NODE14_DIR:$PATH" npm run build:esm
  echo "    ✓ esm"
  PATH="$NODE14_DIR:$PATH" npm run build:element
  echo "    ✓ element"
else
  echo ""
  echo "[1/4] 跳过构建，使用现有 dist"
fi

# ---------- 2. 产物齐备性断言 ----------
echo ""
echo "[2/4] 校验产物齐备"
NEED=(
  "dist/lark-doc.common.js"
  "dist/lark-doc.esm.js"
  "dist/lark-doc.umd.min.js"
  "dist/lark-doc-element.umd.min.js"
  "dist/lark-doc.css"
)
MISS=0
for f in "${NEED[@]}"; do
  if [ ! -f "$f" ]; then echo "    ✗ 缺少 $f"; MISS=1; else echo "    ✓ $f ($(du -h "$f" | cut -f1))"; fi
done
[ "$MISS" = 0 ] || { echo "✗ 产物不齐，停止打包"; exit 1; }

# 按需 chunk 也要带上，element 产物运行时会按脚本 URL 推导去加载它们
CHUNKS=$(ls dist/lark-doc-element.umd.min.*.js 2>/dev/null || true)
if [ -n "$CHUNKS" ]; then
  echo "    · 按需 chunk：$(echo "$CHUNKS" | wc -l | tr -d ' ') 个"
fi

# ---------- 3. 打 tarball ----------
echo ""
echo "[3/4] 生成 tarball"
TGZ="$("$NODE24_DIR/npm" pack --ignore-scripts --pack-destination "$OUT_DIR" 2>/dev/null | tail -1)"
[ -n "$TGZ" ] || { echo "✗ npm pack 失败"; exit 1; }
SHA="$(shasum -a 1 "$OUT_DIR/$TGZ" | awk '{print $1}')"
echo "    ✓ $TGZ"
echo "      sha1 = $SHA"

# ---------- 4. 依赖缓存（完全离线必需） ----------
if [ "$NO_CACHE" = 0 ]; then
  echo ""
  echo "[4/4] 预热并导出 npm 缓存（runtime 依赖全量）"
  STAGE="$(mktemp -d)"
  cat >"$STAGE/package.json" <<EOF
{
  "name": "lark-doc-offline-stage",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "$NAME": "file:$OUT_DIR/$TGZ",
    "vue": "2.7.14",
    "@tiptap/vue-2": "3.32.0"
  }
}
EOF
  # 独立缓存目录：只装这一次依赖，导出的缓存最小，且不污染全局 ~/.npm
  STAGE_CACHE="$STAGE/cache"
  echo "    · 安装依赖树到暂存缓存... ${STAGE_CACHE}"
  if ! (cd "$STAGE" && net "$NODE24_DIR/npm" install --cache "$STAGE_CACHE" --no-audit --no-fund >"$STAGE/install.log" 2>&1); then
    echo "    ! 依赖安装失败，跳过缓存导出（见 $STAGE/install.log）"
    tail -10 "$STAGE/install.log" | sed 's/^/        /'
  else
    TOP=$(ls "$STAGE/node_modules" 2>/dev/null | wc -l | tr -d ' ')
    echo "    ✓ 依赖树就绪（顶层 $TOP 个包）"
    tar czf "$OUT_DIR/npm-cache.tgz" -C "$STAGE" cache
    echo "    ✓ npm-cache.tgz ($(du -h "$OUT_DIR/npm-cache.tgz" | cut -f1))"
  fi
  echo "    · 暂存目录：$STAGE"
else
  echo ""
  echo "[4/4] 跳过依赖缓存（内网有 npm 私服时无需此步）"
fi

# ---------- 附：内网项目依赖片段 ----------
cat >"$OUT_DIR/package.snippet.json" <<EOF
{
  "dependencies": {
    "$NAME": "file:./$TGZ",
    "vue": "^2.7.14",
    "@tiptap/vue-2": "^3.32.0"
  }
}
EOF

# ---------- 附：安装说明 ----------
cat >"$OUT_DIR/INSTALL.md" <<EOF
# lark-doc 内网安装说明

版本：**$NAME@$VERSION** · sha1 \`$SHA\`

## 方式一：内网有 npm 私服（推荐）

把主包发布到私服，之后内网项目正常安装即可：

\`\`\`bash
npm publish ./$TGZ --registry=http://<内网私服>:4873/

# 内网项目
npm install $NAME --registry=http://<内网私服>:4873/
\`\`\`

> Verdaccio 等私服默认代理 npmjs.org，首次安装会自动缓存依赖，之后可完全离线。

## 方式二：完全离线（无任何外网出口）

\`\`\`bash
# 1. 恢复缓存
mkdir -p ~/.npm
tar xzf npm-cache.tgz -C ~/.npm

# 2. 项目里加依赖（见 package.snippet.json），然后离线安装
npm install --offline
\`\`\`

## 方式三：直接用 tgz（依赖仍需 registry）

\`\`\`bash
npm install ./$TGZ
\`\`\`

## 必须同时安装的 peerDependencies

本包把 Vue 声明为 peer 依赖，**必须由宿主项目自己安装**，否则运行时报 \`Cannot resolve 'vue'\`：

\`\`\`json
"dependencies": {
  "$NAME": "^$VERSION",
  "vue": "^2.7.14",
  "@tiptap/vue-2": "^3.32.0"
}
\`\`\`

## 按需 chunk 不能丢

element 产物用 \`publicPath: 'auto'\`，运行时按脚本 URL 推导 chunk 地址。
部署时必须把 \`lark-doc-element.umd.min.js\` 与它同目录的 \`*.chunk.js\`
（mermaid / math / office / highlight / markdown 等）一起拷贝，否则用到对应功能时 404。
EOF

echo ""
echo "✓ 完成：$OUT_DIR"
ls -lh "$OUT_DIR" | sed 's/^/    /'
echo ""
echo "  拷进内网后看 $OUT_DIR/INSTALL.md"
