#!/usr/bin/env bash
#
# lark-doc 内网包（Node 14 / npm 6 专用，零 registry 请求）
#
# 与 pack-offline.sh 的区别：
#   pack-offline.sh  → 私服 / npm 缓存路线，要求两端 npm 大版本一致
#   pack-intranet.sh → 内网 npm 6 无法读 npm 10 的 cacache，因此改走
#                      「零运行时依赖 tgz + node_modules 直铺」两条都不解析 registry
#
# 用法：
#   bash scripts/pack-intranet.sh                 # 用 package.json 里的版本
#   bash scripts/pack-intranet.sh --version 0.11.6
#   bash scripts/pack-intranet.sh --skip-build    # dist 已最新，跳过构建
#   bash scripts/pack-intranet.sh --from-tgz <已打好的 tgz>
#       就地修包：不构建、不动工作树。修掉四类只有 npm 6 / Windows 才暴露的坑——
#         ① macOS tar 打出来的包混有 ._* / PaxHeader/*，npm 6 的 tar@2 解不开
#         ② bundleDependencies 里存在 dependencies 之外的名字，npm 6 会拿它们
#            去 registry 查版本 → Artifactory 401
#         ③ npm 6 会把「包内 node_modules 里、但没声明在 bundleDependencies 里」的包
#            当 extraneous 删掉，装完 require('lark-doc') 直接崩
#         ④ 全量 node_modules 里有 171 字符的深路径，Windows MAX_PATH 260 会
#            ENAMETOOLONG；这里只留 dist 真正外置的闭包
#       产出与源码模式相同：修好的 tgz + node_modules 直铺 zip + 安装说明
#   bash scripts/pack-intranet.sh --from-tgz <tgz> --vue-tgz <vue tgz>
#       vue 包带同一个 macOS tar 头（①），npm 6 下同样 ENOENT。给了就一起重打成
#       vue-<ver>-intranet.tgz 放进产物目录；不给则自动找源 tgz 同目录的 vue-*.tgz
#
# 产出 dist-intranet/：
#   lark-doc-<ver>-intranet.tgz          精简主包（dist + CJS 外置闭包，ESM 自包含）· 方案 1
#   lark-doc-<ver>-node-modules.zip      解压到项目根 → 直接得到 node_modules · 方案 2
#   lark-doc-<ver>-thin.tgz              方案 3：同一份 dist，但不带依赖，装时由内网私服提供
#   deps-tgz/                            方案 3 的 21 个单包 tgz，私服缺哪个 publish 哪个
#   deps-manifest.txt                    方案 3 依赖清单（包名@版本 · 根/传递），给运维核对私服
#   check-deps.js                        方案 3 内网自检：逐条问私服有没有
#   vue-<ver>-intranet.tgz               重打后的 vue（有 --vue-tgz / 同目录能自动发现时）
#   vue-<ver>-node-modules.zip           同上，但解压到项目根即得 node_modules/vue（方案 2 用）
#   INSTALL-内网.md                      三个方案的安装说明（Windows / npm 6）
#   sha256.txt
#
# 注意：thin / deps-tgz / deps-manifest / check-deps 这四项只在 --from-tgz 模式产出。
#       源码构建模式（不带参数）只出方案 1 / 2，其 md 也不提方案 3，两者保持一致。
#
set -euo pipefail

# 宿主 NODE_OPTIONS 带 WorkBuddy shim，Node 14 构建会崩
unset NODE_OPTIONS

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PKG_DIR"

NODE14_DIR="/Users/cjjxw/.nvm/versions/node/v14.21.3/bin"
NODE24_DIR="/Users/cjjxw/.nvm/versions/node/v24.22.0/bin"
OUT_DIR="$PKG_DIR/dist-intranet"

SKIP_BUILD=0
VER=""
FROM_TGZ=""
VUE_TGZ=""
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-build) SKIP_BUILD=1; shift ;;
    --version) VER="$2"; shift 2 ;;
    --from-tgz) FROM_TGZ="$2"; shift 2 ;;
    --vue-tgz) VUE_TGZ="$2"; shift 2 ;;
    -h | --help) awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

# 重打一个 tgz，去掉 macOS 扩展头（._* / PaxHeader / com.apple.*）。
# 判据只能靠"重打后 npm 6 装得上"——tar tzf 看不出 com.apple.provenance 这类扩展头，
# 原 vue-2.7.14-intranet.tgz 就是这样：条目干净、结构正常，npm 6 依然 ENOENT。
repack_clean_tgz() {
  local src="$1" out="$2" tmp
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/repack.XXXXXX")"
  if ! tar xzf "$src" -C "$tmp" 2>/dev/null || [ ! -d "$tmp/package" ]; then
    rm -rf "$tmp"
    return 1
  fi
  find "$tmp/package" \( -name '._*' -o -name '.DS_Store' -o -name 'PaxHeader*' \) -delete 2>/dev/null || true
  rm -f "$out"
  if ! ( cd "$tmp" && COPYFILE_DISABLE=1 tar czf "$out" --no-xattrs package ); then
    rm -rf "$tmp"
    return 1
  fi
  rm -rf "$tmp"
  return 0
}

# 跟 repack_clean_tgz 一样去掉 macOS 扩展头，额外把 package.json 里「运行期不需要」的
# 依赖字段整段删掉。只给 vue 用：
#   registry 上的 vue 2.7.14 声明了 dependencies = @vue/compiler-sfc + csstype（都是编译期
#   用的，main = dist/vue.runtime.common.js，运行时一个都不 require）；如果这份 tgz 是
#   「从装好的 node_modules/vue 里 npm pack 出来的」副本，还会多出一段 11 项的
#   bundleDependencies（@babel/* / nanoid / postcss …）。
#   两者在 npm 6 下都会回 registry 查版本：私服没有就 404（跟 lark-doc 那个 401 同一类
#   事故）；bundleDependencies 与实物对不上时还会顺手在 node_modules/vue/node_modules
#   里塞一份 vue 自己（npm ls 报 extraneous + 那句 optional SKIPPING 的 WARN）。
#   全删纯赚，运行时零影响。
repack_clean_tgz_dropdeps() {
  local src="$1" out="$2" tmp
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/repack.XXXXXX")"
  if ! tar xzf "$src" -C "$tmp" 2>/dev/null || [ ! -d "$tmp/package" ]; then
    rm -rf "$tmp"
    return 1
  fi
  find "$tmp/package" \( -name '._*' -o -name '.DS_Store' -o -name 'PaxHeader*' \) -delete 2>/dev/null || true
  "$NODE24_DIR/node" - "$tmp/package/package.json" <<'JSEOF' || { rm -rf "$tmp"; return 1; }
const fs = require('fs')
const f = process.argv[2]
const p = JSON.parse(fs.readFileSync(f, 'utf8'))
const dropped = []
for (const k of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
  const n = p[k] ? Object.keys(p[k]).length : 0
  if (n) dropped.push(`${k}:${n}`)
  delete p[k]
}
// bundleDependencies 是「npm pack 副本」才会带上的一段：声明 11 个包随包分发，
// npm 6 走 bundled 路径发现包里没有，就自己去 registry 找，还会为此在
// node_modules/vue/node_modules 里塞一份自己（npm ls 报 extraneous）。
for (const k of ['bundleDependencies', 'bundledDependencies']) {
  const n = Array.isArray(p[k]) ? p[k].length : 0
  if (n) dropped.push(`${k}:${n}`)
  delete p[k]
}
delete p.scripts // postinstall 之类一律不跑
fs.writeFileSync(f, JSON.stringify(p, null, 2) + '\n')
console.log('    ✓ vue package.json 清空非运行期依赖字段（' + (dropped.join(' ') || '无') + '）')
JSEOF
  rm -f "$out"
  if ! ( cd "$tmp" && COPYFILE_DISABLE=1 tar czf "$out" --no-xattrs package ); then
    rm -rf "$tmp"
    return 1
  fi
  rm -rf "$tmp"
  return 0
}

# ============================================================================
# 分支 A · --from-tgz：就地修包（不构建、不动工作树）
# ============================================================================
if [ -n "$FROM_TGZ" ]; then
  [ -f "$FROM_TGZ" ] || { echo "✗ 找不到文件：$FROM_TGZ"; exit 1; }
  SRC_TGZ="$(cd "$(dirname "$FROM_TGZ")" && pwd)/$(basename "$FROM_TGZ")"

  # vue 包带同一个 macOS tar 头，npm 6 下也装不上：没显式给就找源 tgz 同目录的 vue-*.tgz
  if [ -z "$VUE_TGZ" ]; then
    VUE_AUTO="$(ls "$(dirname "$SRC_TGZ")"/vue-*.tgz 2>/dev/null | head -1 || true)"
    [ -n "$VUE_AUTO" ] && VUE_TGZ="$VUE_AUTO"
  fi

  WORK="$(mktemp -d "${TMPDIR:-/tmp}/larkdoc-fix.XXXXXX")"
  trap 'rm -rf "$WORK"' EXIT

  # ---------- 1. 解包 ----------
  echo "[1/6] 解包"
  tar xzf "$SRC_TGZ" -C "$WORK" 2>/dev/null || { echo "✗ 解包失败"; exit 1; }
  [ -d "$WORK/package" ] || { echo "✗ tgz 里没有 package/ 顶层目录，不是 npm 包格式"; exit 1; }
  NAME="$(node -p "require('$WORK/package/package.json').name")"
  VER="$(node -p "require('$WORK/package/package.json').version")"
  echo "    $NAME@$VER · $(find "$WORK/package" -type f | wc -l | tr -d ' ') 个文件 · $(du -h "$SRC_TGZ" | cut -f1)"

  # ---------- 2. 清 macOS 垃圾条目 ----------
  echo ""
  echo "[2/6] 清理 macOS 元数据"
  JUNK="$(find "$WORK/package" \( -name '._*' -o -name '.DS_Store' -o -name 'PaxHeader*' \) | wc -l | tr -d ' ')"
  find "$WORK/package" \( -name '._*' -o -name '.DS_Store' -o -name 'PaxHeader*' \) -delete 2>/dev/null || true
  echo "    ✓ 删除 $JUNK 个 ._* / .DS_Store 残留"

  # ---------- 3. 修 package.json ----------
  echo ""
  echo "[3/6] 修 package.json"
  node - "$WORK/package/package.json" "$WORK/onlyb.txt" <<'NODE'
const fs = require('fs')
const file = process.argv[2]
const p = JSON.parse(fs.readFileSync(file, 'utf8'))
const nDeps = Object.keys(p.dependencies || {}).length
const nBundle = (p.bundleDependencies || p.bundledDependencies || []).length
const nExtra = (p.devDependencies ? Object.keys(p.devDependencies).length : 0)

const out = { ...p }
// ① 清空 dependencies：否则 npm 6 会逐个去 registry 解析 → 401
out.dependencies = {}
// ② 删 bundleDependencies：列表里有一堆「不在 dependencies 里」的名字，
//    npm 6 对这类名字没有版本范围可用，会拿 name@* 去 registry 查最新版
delete out.bundleDependencies
delete out.bundledDependencies
// ③ peer 只留 vue（@tiptap/vue-2 已在 dist 内联，宿主装了反而容易双实例）
out.peerDependencies = { vue: (p.peerDependencies && p.peerDependencies.vue) || '^2.7.14' }
delete out.peerDependenciesMeta
// ④ engines 去掉 npm>=8.19.4，避免内网 npm 6 打 notsup 警告
out.engines = { node: (p.engines && p.engines.node) || '>=14.21.3' }
// ⑤ 构建相关字段内网用不到，删掉减少误触
for (const k of ['devDependencies', 'overrides', 'packageManager', 'scripts', 'size-limit', 'sizeLimit', 'browserslist']) delete out[k]

out.larkDocIntranet = {
  note: '内网包：dependencies 已清空，运行时依赖随包内 node_modules 一并分发',
  fixedFrom: p.version,
  cjsExternalsBundled: nBundle,
}
fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n')
// 只出现在 bundleDependencies、不在 dependencies 里的名字数量 —— 就是 401 的导火索
const deps = Object.keys(p.dependencies || {})
const onlyBundle = (p.bundleDependencies || p.bundledDependencies || []).filter(n => !deps.includes(n))
fs.writeFileSync(process.argv[3], String(onlyBundle.length) + '\n' + onlyBundle.slice(0, 6).join(', ') + (onlyBundle.length > 6 ? ' …' : ''))
console.log(`    ✓ dependencies ${nDeps} → 清空（不去 registry 解析，稍后按包内实物回填精确版本）`)
console.log(`    ✓ bundleDependencies ${nBundle} → 重建（原表里 ${onlyBundle.length} 个不在 dependencies 里${onlyBundle.length ? '，正是 401 的来源' : '：源包本就没有 bundleDependencies'}）`)
console.log(`    ✓ devDependencies ${nExtra} → 移除，peer 仅保留 vue`)
NODE

  # ---------- 4. CJS 外置闭包 + 精简包组装 ----------
  # 外置清单来源：实测扫描 dist/*.js 里所有 require('裸名')，去掉相对路径、Node 内建、
  # vue（peer，必须外置单例）和 _process（webpack 浏览器 shim，原包里也没有，是死代码路径）。
  # 注意 bluebird 只存在于 mammoth/node_modules 下，原包顶层就没有，这里同样不需要。
  echo ""
  echo "[4/6] 组装精简包（dist + CJS 外置闭包）"
  ROOTS="jszip @xmldom/xmldom base64-js dingbat-to-unicode lop option underscore xmlbuilder isarray"
  CLOSURE="$(cd "$WORK/package" && ROOTS="$ROOTS" node -e '
const fs = require("fs"), path = require("path")
const roots = process.env.ROOTS.split(" ")
const seen = new Set(), out = []
function walk(name) {
  if (seen.has(name)) return
  seen.add(name)
  const dir = path.join("node_modules", name)
  if (!fs.existsSync(path.join(dir, "package.json"))) { console.error("MISSING " + name); process.exit(1) }
  const pj = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"))
  out.push(name)
  for (const d of Object.keys(pj.dependencies || {})) walk(d)
}
roots.forEach(walk)
console.log(out.join("\n"))
')" || { echo "    ✗ 闭包计算失败"; exit 1; }
  if printf '%s\n' "$CLOSURE" | grep -qx 'vue'; then
    echo "    ✗ 闭包里出现 vue，会破坏单例，终止"
    exit 1
  fi
  NCLOSURE="$(printf '%s\n' "$CLOSURE" | grep -c . || true)"
  echo "    ✓ CJS 外置闭包 $NCLOSURE 个包（ESM 用户其实一个都用不到）"

  # 剪掉类型声明和 sourcemap：跨机器 / Windows 都不需要，顺带压体积、压路径长度
  for p in $CLOSURE; do
    find "$WORK/package/node_modules/$p" \( -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' -o -name '*.map' \) -delete >/dev/null 2>&1 || true
  done

  rm -rf "$OUT_DIR"
  mkdir -p "$OUT_DIR"
  PKG="$WORK/lite/package"
  mkdir -p "$PKG/node_modules"
  cp -R "$WORK/package/dist" "$PKG/dist"
  cp "$WORK/package/package.json" "$PKG/package.json"
  for f in style.css README.md DEMO_INTEGRATION_GUIDE.md LICENSE; do
    [ -f "$WORK/package/$f" ] && cp "$WORK/package/$f" "$PKG/"
  done
  printf '%s\n' "$CLOSURE" | grep . > "$WORK/closure.txt" || true
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    mkdir -p "$PKG/node_modules/$(dirname "$p")"
    cp -R "$WORK/package/node_modules/$p" "$PKG/node_modules/$p"
  done < "$WORK/closure.txt"

  # files 字段跟着实际内容走；同时把随包分发的依赖写回 dependencies + bundleDependencies
  # 为什么要写回：npm 6 会把「没声明在 bundleDependencies 里的包内 node_modules」当 extraneous 删掉，
  # 实测装完 node_modules/lark-doc/node_modules 整个消失 → require('lark-doc') 直接崩。
  # 写成 dependencies（精确版本）+ bundleDependencies（同名同集）后，npm 6 走 bundled 路径，
  # 既保留依赖树，也不会去 registry 查版本（版本范围已经由包内 package.json 满足）。
  node -e '
const fs=require("fs"), path=require("path")
const root=process.argv[1], nm=path.join(root,"node_modules")
const names=fs.readFileSync(process.argv[2],"utf8").split("\n").map(s=>s.trim()).filter(Boolean).sort()
const deps={}
for (const n of names) {
  const pj=path.join(nm,n,"package.json")
  if (!fs.existsSync(pj)) { console.error("    \u2717 清单里的 "+n+" 没被拷进来"); process.exit(1) }
  deps[n]=JSON.parse(fs.readFileSync(pj,"utf8")).version
}
const f=path.join(root,"package.json")
const p=JSON.parse(fs.readFileSync(f,"utf8"))
p.files=["dist","style.css","README.md","DEMO_INTEGRATION_GUIDE.md"]
p.dependencies=deps
p.bundleDependencies=names
fs.writeFileSync(f, JSON.stringify(p,null,2)+"\n")
console.log("    ✓ dependencies / bundleDependencies 同集 "+names.length+" 个（版本取自包内实物）")
' "$PKG" "$WORK/closure.txt"

  # ---------- 5. 打 Windows 友好的两个产物 ----------
  echo ""
  echo "[5/6] 打包"
  TGZ_NAME="$NAME-$VER-intranet.tgz"
  ( cd "$WORK/lite" && COPYFILE_DISABLE=1 tar czf "$OUT_DIR/$TGZ_NAME" --no-xattrs package )

  NM="$WORK/nm"
  mkdir -p "$NM/node_modules"
  cp -R "$PKG" "$NM/node_modules/lark-doc"
  ZIP_NAME="$NAME-$VER-node-modules.zip"
  ( cd "$NM" && rm -f "$OUT_DIR/$ZIP_NAME" && zip -qr "$OUT_DIR/$ZIP_NAME" node_modules -x '*.DS_Store' -x '*__MACOSX*' )

  echo "    ✓ $TGZ_NAME ($(du -h "$OUT_DIR/$TGZ_NAME" | cut -f1) · $(tar tzf "$OUT_DIR/$TGZ_NAME" 2>/dev/null | wc -l | tr -d ' ') 个条目)"
  echo "    ✓ $ZIP_NAME ($(du -h "$OUT_DIR/$ZIP_NAME" | cut -f1) · 解压即得 node_modules/lark-doc)"

  # ---------- 5b. 方案 3：thin 包（不带依赖，依赖走内网私服） ----------
  # 前提：内网私服已经备齐这 $NCLOSURE 个包（版本对得上）。
  # 与主包的差别只有两点：① 包里没有 node_modules/lark-doc/node_modules；
  #                      ② package.json 删掉了 bundleDependencies。
  # dependencies 原样保留那 $NCLOSURE 个精确版本 → npm 6 会按 .npmrc 去私服拉。
  THIN_NAME="$NAME-$VER-thin.tgz"
  THIN_DIR="$WORK/thin/package"
  rm -rf "$WORK/thin"
  mkdir -p "$THIN_DIR"
  cp -R "$PKG/dist" "$THIN_DIR/dist"
  cp "$PKG/package.json" "$THIN_DIR/package.json"
  for f in style.css README.md DEMO_INTEGRATION_GUIDE.md LICENSE; do
    if [ -f "$PKG/$f" ]; then cp "$PKG/$f" "$THIN_DIR/"; fi
  done
  node -e '
const fs = require("fs"), path = require("path")
const root = process.argv[1]
const f = path.join(root, "package.json")
const p = JSON.parse(fs.readFileSync(f, "utf8"))
delete p.bundleDependencies
delete p.bundledDependencies
const names = Object.keys(p.dependencies || {})
if (!names.length) { console.error("    \u2717 thin 包 dependencies 为空，无法靠私服安装"); process.exit(1) }
if (fs.existsSync(path.join(root, "node_modules"))) { console.error("    \u2717 thin 包里还有 node_modules"); process.exit(1) }
p.files = ["dist", "style.css", "README.md", "DEMO_INTEGRATION_GUIDE.md"]
p.larkDocIntranet = {
  note: "thin 包：不含依赖，安装时由 registry 提供 dependencies 里的 " + names.length + " 个包",
  fixedFrom: (p.larkDocIntranet && p.larkDocIntranet.fixedFrom) || p.version,
}
fs.writeFileSync(f, JSON.stringify(p, null, 2) + "\n")
console.log("    \u2713 thin: dependencies " + names.length + " 个精确版本 · 无 bundleDependencies · 无 node_modules")
' "$THIN_DIR"
  rm -f "$OUT_DIR/$THIN_NAME"
  ( cd "$WORK/thin" && COPYFILE_DISABLE=1 tar czf "$OUT_DIR/$THIN_NAME" --no-xattrs package )
  echo "    ✓ $THIN_NAME ($(du -h "$OUT_DIR/$THIN_NAME" | cut -f1) · $(tar tzf "$OUT_DIR/$THIN_NAME" 2>/dev/null | wc -l | tr -d ' ') 个条目 · 依赖靠私服)"

  # 依赖清单 + 单包 tgz（给内网核对私服 / 给运维传私服）
  # 为什么还要单包 tgz：私服缺某几个包时，运维拿它 npm publish 上去比"自己去找同名同版本"快得多。
  DEPS_TGZ_DIR="$OUT_DIR/deps-tgz"
  rm -rf "$DEPS_TGZ_DIR"
  mkdir -p "$DEPS_TGZ_DIR"
  DTMP="$WORK/dtmp"
  while IFS= read -r cd_pkg; do
    [ -n "$cd_pkg" ] || continue
    CD_VER="$(node -p "require('$PKG/node_modules/$cd_pkg/package.json').version")"
    CD_FILE="$(printf '%s' "$cd_pkg" | tr '/@' '--')-$CD_VER.tgz"
    rm -rf "$DTMP"
    mkdir -p "$DTMP"
    cp -R "$PKG/node_modules/$cd_pkg" "$DTMP/package"
    ( cd "$DTMP" && COPYFILE_DISABLE=1 tar czf "$DEPS_TGZ_DIR/$CD_FILE" --no-xattrs package )
  done < "$WORK/closure.txt"
  echo "    ✓ deps-tgz/ $(ls "$DEPS_TGZ_DIR" | wc -l | tr -d ' ') 个单包 tgz ($(du -sh "$DEPS_TGZ_DIR" | cut -f1) · 私服缺包时交运维 publish)"

  node -e '
const fs = require("fs"), path = require("path")
const pkgdir = process.argv[1], closure = process.argv[2], out = process.argv[3]
const names = fs.readFileSync(closure, "utf8").split("\n").map(s => s.trim()).filter(Boolean).sort()
const rows = [], roots = new Set(["jszip", "@xmldom/xmldom", "base64-js", "dingbat-to-unicode", "lop", "option", "underscore", "xmlbuilder", "isarray"])
for (const n of names) {
  const pj = JSON.parse(fs.readFileSync(path.join(pkgdir, "node_modules", n, "package.json"), "utf8"))
  const deps = Object.keys(pj.dependencies || {})
  rows.push({
    spec: n + "@" + pj.version,
    role: roots.has(n) ? "根" : "传递",
    deps: deps.length ? deps.join(", ") : "-",
    name: n, ver: pj.version, depObj: pj.dependencies || {},
  })
}
const w1 = Math.max(...rows.map(r => r.spec.length)) + 2
const w2 = 6
const lines = []
lines.push("# " + process.argv[4] + " · 方案 3（thin 包）运行期依赖清单")
lines.push("#")
lines.push("# 内网私服只要备齐下面 " + rows.length + " 个包（版本必须对得上）即可，")
lines.push("# lark-doc 的 dist 已内联 tiptap / katex / docx / mammoth / highlight.js。")
lines.push("# 这些是 CJS 入口（dist/lark-doc.common.js）真正 require 出去的闭包；ESM 用户只需要 vue。")
lines.push("#")
lines.push("# 格式: <name>@<精确版本> | 角色 | 该包自己声明的 dependencies（npm 会一并解析，也必须在私服）")
lines.push("#")
lines.push("# 私服自检: 把本文件和 check-deps.js 放同一目录，执行  node check-deps.js")
lines.push("# 缺包补法: deps-tgz/ 里每个包一份 tgz，交给运维 npm publish 到私服")
lines.push("#")
for (const r of rows) lines.push(r.spec.padEnd(w1) + "| " + r.role.padEnd(w2) + "| " + r.deps)
lines.push("")
lines.push("# 机器可读（同内容，便于脚本解析）")
lines.push("# checks: " + rows.length)
fs.writeFileSync(out, lines.join("\n") + "\n")
console.log("    \u2713 deps-manifest.txt (" + rows.length + " 条 · " + rows.filter(r => r.role === "\u6839").length + " 根 + " + rows.filter(r => r.role === "\u4f20\u9012").length + " 传递)")
' "$PKG" "$WORK/closure.txt" "$OUT_DIR/deps-manifest.txt" "$NAME@$VER"

  # 内网自检脚本：逐条问私服要版本，报出缺哪些（npm 6 的 npm view 走 .npmrc 里的 registry）
  cat >"$OUT_DIR/check-deps.js" <<'CHECKDEP'
// 内网自检：deps-manifest.txt 里的包，私服到底有没有
// 用法：把 deps-manifest.txt 和本文件放同一目录，在项目根（或任意目录）执行
//   node check-deps.js
// 它会按当前 .npmrc 的 registry 逐条 npm view；全部 ok 再装 lark-doc。
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const manifest = path.join(__dirname, 'deps-manifest.txt')
if (!fs.existsSync(manifest)) {
  console.error('找不到 ' + manifest)
  process.exit(2)
}
const specs = fs
  .readFileSync(manifest, 'utf8')
  .split(/\r?\n/)
  .filter((l) => l && !l.startsWith('#') && l.includes('@'))
  .map((l) => l.split('|')[0].trim())
  .filter(Boolean)
console.log('检查 ' + specs.length + ' 个包（registry: ' + (function () {
  try { return execSync('npm config get registry', { stdio: 'pipe' }).toString().trim() } catch (e) { return '?' }
})() + '）')
const missing = []
for (const s of specs) {
  try {
    execSync('npm view ' + s + ' version', { stdio: 'pipe' })
    console.log('  ok    ' + s)
  } catch (e) {
    console.log('  MISS  ' + s)
    missing.push(s)
  }
}
console.log('')
if (!missing.length) {
  console.log('全部 ' + specs.length + ' 个包私服都有，可以直接走方案 3')
  process.exit(0)
}
console.log('私服缺 ' + missing.length + ' 个：')
for (const m of missing) console.log('  ' + m)
console.log('')
console.log('补法（二选一）：')
console.log('  a) 把 deps-tgz/ 里对应的 tgz 交运维 npm publish 到私服')
console.log('  b) 退回方案 1（主包已自带这些依赖，不需要私服）')
process.exit(1)
CHECKDEP
  echo "    ✓ check-deps.js (内网一条命令核对私服齐不齐)"

  # vue 包（peer，宿主提供单例）：坑 ① 在它身上同样成立，原包 npm 6 直接 ENOENT。
  VUE_OUT=""
  VUE_VER_OUT=""
  if [ -n "$VUE_TGZ" ]; then
    [ -f "$VUE_TGZ" ] || { echo "    ✗ 找不到 vue 包：$VUE_TGZ"; exit 1; }
    VUE_VER_OUT="$(tar xzOf "$VUE_TGZ" package/package.json 2>/dev/null | "$NODE24_DIR/node" -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).version)}catch(e){console.log("")}})
' || true)"
    [ -n "$VUE_VER_OUT" ] || { echo "    ✗ 读不出 vue 包版本：$VUE_TGZ"; exit 1; }
    VUE_OUT="$OUT_DIR/vue-$VUE_VER_OUT-intranet.tgz"
    repack_clean_tgz_dropdeps "$VUE_TGZ" "$VUE_OUT" || { echo "    ✗ vue 包重打失败：$VUE_TGZ"; exit 1; }
    VJUNK="$(tar tzf "$VUE_OUT" 2>/dev/null | grep -cE '(^|/)\._|PaxHeader' || true)"
    [ "$VJUNK" = "0" ] || { echo "    ✗ vue 包仍有 $VJUNK 个 AppleDouble / PaxHeader 条目"; exit 1; }
    echo "    ✓ $(basename "$VUE_OUT") ($(du -h "$VUE_OUT" | cut -f1) · $(tar tzf "$VUE_OUT" 2>/dev/null | wc -l | tr -d ' ') 个条目 · macOS 头已去)"

    # 方案 2（不走 npm）用得上：跟主 zip 一样，解压到项目根就是 node_modules/vue，
    # 省掉 Windows 上"解出 package/ 再改名成 vue"这一步。
    VUE_ZIP_NAME="vue-$VUE_VER_OUT-node-modules.zip"
    VUENM="$WORK/vuenm"
    rm -rf "$VUENM"; mkdir -p "$VUENM/node_modules/vue"
    tar xzf "$VUE_OUT" -C "$VUENM/node_modules/vue" --strip-components=1 2>/dev/null || {
      echo "    ✗ vue 包解包失败：$VUE_OUT"; exit 1; }
    ( cd "$VUENM" && rm -f "$OUT_DIR/$VUE_ZIP_NAME" && zip -qr "$OUT_DIR/$VUE_ZIP_NAME" node_modules -x '*.DS_Store' -x '*__MACOSX*' )
    echo "    ✓ $VUE_ZIP_NAME ($(du -h "$OUT_DIR/$VUE_ZIP_NAME" | cut -f1) · 解压即得 node_modules/vue)"
  else
    VUE_ZIP_NAME=""
    echo "    - 未提供 vue 包（--vue-tgz），产物不含 vue"
  fi

  # ---------- 6. 断言 ----------
  echo ""
  echo "[6/6] 校验"
  ENTRIES="$(tar tzf "$OUT_DIR/$TGZ_NAME" 2>/dev/null || true)"
  BADJUNK="$(printf '%s\n' "$ENTRIES" | grep -cE '(^|/)\._|PaxHeader' || true)"
  [ "$BADJUNK" = "0" ] || { echo "    ✗ 仍有 $BADJUNK 个 AppleDouble / PaxHeader 条目"; exit 1; }
  echo "    ✓ 无 ._* / PaxHeader（npm 6 的 tar@2 可解析）"

  NROOT="$(printf '%s\n' "$ENTRIES" | grep -cx 'package/package.json' || true)"
  [ "$NROOT" = "1" ] || { echo "    ✗ 顶层不是 package/"; exit 1; }
  echo "    ✓ 顶层结构 package/*"

  printf '%s' "$(tar xzOf "$OUT_DIR/$TGZ_NAME" package/package.json)" > "$WORK/inner.json"
  node -e '
const fs=require("fs"), path=require("path")
const p=require(process.argv[1]), pkgdir=process.argv[2]
const fail=[]
const deps=Object.keys(p.dependencies||{}).sort()
const bund=(p.bundleDependencies||p.bundledDependencies||[]).slice().sort()
const actual=fs.readFileSync(process.argv[3],"utf8").split("\n").map(s=>s.trim()).filter(Boolean).sort()
if (JSON.stringify(deps)!==JSON.stringify(actual)) fail.push("dependencies 与包内 node_modules 不一致")
if (JSON.stringify(bund)!==JSON.stringify(actual)) fail.push("bundleDependencies 与包内 node_modules 不一致")
for (const n of actual) {
  const v=JSON.parse(fs.readFileSync(path.join(pkgdir,"node_modules",n,"package.json"),"utf8")).version
  if (p.dependencies[n]!==v) fail.push(n+" 版本号与实物不符")
}
if ((p.engines||{}).npm) fail.push("engines.npm 未移除")
const peers=Object.keys(p.peerDependencies||{})
if (peers.length!==1 || peers[0]!=="vue") fail.push("peer 不是仅 vue")
if (!p.main || !p.module || !p.exports) fail.push("main/module/exports 缺失")
if (fail.length) { console.error("    ✗ "+fail.join("；")); process.exit(1) }
console.log("    ✓ dependencies=bundleDependencies="+actual.length+" 个 · 版本精确 · engines 仅 node · peer=vue")
' "$WORK/inner.json" "$PKG" "$WORK/closure.txt"

  # 关键断言：dist 里每一个 require 的裸名，精简包里都必须能解析到
  node -e '
const fs=require("fs"), path=require("path")
const root=process.argv[1], dist=path.join(root,"dist")
const builtins=new Set(require("module").builtinModules)
// 1) webpack 注入的 Node 垫片名：Node 里根本不存在，只出现在 typeof __larkDocRequire 判定后的死分支里
// 2) buffer 的传递依赖（ieee754 / isarray）：buffer 本身是垫片，它的依赖自然也不用装
// 3) bluebird：mammoth 依赖链残留，原包顶层也没有，dist 里那条 require 永远走不到
const DEAD=new Set(["_process","process","buffer","util","isarray","ieee754","bluebird"])
const bad=new Map()
const RE=/require\(\s*["\x27]([^"\x27]+)["\x27]\s*\)/g
for (const f of fs.readdirSync(dist)) {
  if (!f.endsWith(".js")) continue
  const s=fs.readFileSync(path.join(dist,f),"utf8")
  let m
  while ((m=RE.exec(s))) {
    const n=m[1].replace(/^node:/,"")
    if (n.startsWith(".") || n.startsWith("/")) continue
    // 注意：按"顶层包名"判定，不能拿完整 specifier 判
    // （dist 里是 require("bluebird/js/release/promise")、require("vue/dist/vue.runtime.common.js")）
    const top=n.startsWith("@") ? n.split("/").slice(0,2).join("/") : n.split("/")[0]
    if (builtins.has(top) || DEAD.has(top)) continue
    // vue 是 peer，由宿主提供"单例"，不要求装在包里，也不允许装进包里
    if (top==="vue") continue
    if (fs.existsSync(path.join(root,"node_modules",top,"package.json"))) continue
    if (!bad.has(top)) bad.set(top,[])
    bad.get(top).push(f)
  }
}
if (fs.existsSync(path.join(root,"node_modules","vue"))) {
  console.error("    ✗ 包里出现了 vue，会破坏宿主单例")
  process.exit(1)
}
if (bad.size) {
  console.error("    ✗ dist 引用了包里没有的包：")
  for (const [k,v] of bad) console.error("        "+k+"  ← "+v.slice(0,3).join(", "))
  process.exit(1)
}
console.log("    ✓ dist 全部 require 均在包内可解析 · vue 未被打进包（peer 单例）")
' "$PKG"

  # 长路径体检：Windows MAX_PATH 260，装上后 = 项目绝对路径 + 包内最长相对路径
  LONGEST="$(tar tzf "$OUT_DIR/$TGZ_NAME" 2>/dev/null | awk '{print length" "$0}' | sort -rn | head -1 || true)"
  LONGLEN="${LONGEST%% *}"
  echo "    ✓ 包内最长路径 $LONGLEN 字符（Windows MAX_PATH 260 下，项目路径可用 $((260 - LONGLEN)) 字符）"
  NESTED="$(ls "$PKG/node_modules" 2>/dev/null | wc -l | tr -d ' ')"
  NATIVE="$(find "$PKG" -name '*.node' 2>/dev/null | wc -l | tr -d ' ')"
  [ "$NATIVE" = "0" ] || { echo "    ✗ 有 $NATIVE 个 native 模块，不能跨机器直铺"; exit 1; }
  echo "    ✓ 0 个 native 模块，可跨机器直铺"

  ( cd "$OUT_DIR" && shasum -a 256 *.tgz *.zip > sha256.txt )
  # 注意按完整文件名取，不能再 grep "intranet.tgz"——vue 包也叫 *-intranet.tgz，会抓错行
  SHA="$(awk -v f="$TGZ_NAME" '$2==f {print substr($1,1,12)}' "$OUT_DIR/sha256.txt")"
  VUE_SHA=""
  if [ -n "$VUE_OUT" ]; then
    VUE_SHA="$(awk -v f="$(basename "$VUE_OUT")" '$2==f {print substr($1,1,12)}' "$OUT_DIR/sha256.txt")"
    [ -n "$VUE_SHA" ] || { echo "    ✗ vue 包没进 sha256.txt"; exit 1; }
    echo "    ✓ sha256.txt 含 $(ls "$OUT_DIR"/*.tgz "$OUT_DIR"/*.zip | wc -l | tr -d ' ') 个产物"
  fi
  ONLYB="$(head -1 "$WORK/onlyb.txt")"
  ONLYB_EG="$(tail -1 "$WORK/onlyb.txt")"
  # 401 那一行的根因描述必须跟着实际数据走：源包可能本来就没有 bundleDependencies
  if [ "${ONLYB:-0}" -gt 0 ] 2>/dev/null; then
    ONLYB_ROW="\`bundleDependencies\` 里有 **$ONLYB 个**名字不在 \`dependencies\` 中（$ONLYB_EG）。"
  else
    ONLYB_ROW="源包 \`dependencies\` 里全是构建期包（\`@tiptap/*\` · \`katex\` · \`marked\` · \`docx\` …，dist 已 webpack 内联），且这份源包没有 \`bundleDependencies\`；早先那份 \`-intranet.tgz\` 则是另一头的毛病——模板拿 \`ls node_modules\` 生成了 75 个 \`bundleDependencies\` 名字，跟包内实物对不上。两头结果一样：npm 6 拿不到版本范围就 \`名字@*\` 回 registry 查最新版。"
  fi

  # 说明文档里跟 vue 有关的几段（没给 vue 包时退化成"自备 vue"）
  # 注意：这里是双引号赋值，`\`` 得到的是一个反引号；heredoc 展开变量时
  # 不会再解析反斜杠，所以**不要**写成 `\\\``（那会多留一层反斜杠）
  VUE_FILE=""
  VUE_HEADER=""
  VUE_ROW_NOTE=""
  VUE_SECTION=""
  VUE_JSON_LINE=""
  VUE_HINT="自备 Vue2"
  VUE_FLAT_NOTE=""
  if [ -n "$VUE_OUT" ]; then
    VUE_FILE="$(basename "$VUE_OUT")"
    VUE_HINT="用本目录的 \`${VUE_FILE}\`（**别用原始的**，npm 6 装不上）"
    VUE_FLAT_NOTE="项目里没有 Vue2 时，把 \`${VUE_ZIP_NAME}\` 也解压到项目根目录（同样得到 \`node_modules\\vue\\\`）；已有 Vue2 就**别解**，会覆盖项目正在用的版本。"
    VUE_HEADER=" · vue \`${VUE_FILE}\` sha256 前缀 \`${VUE_SHA}\`"
    VUE_ROW_NOTE="\`${VUE_FILE}\` 是同一个坑：\`tar tzf\` 看条目完全干净、结构也正常，但 npm 6 就是 \`ENOENT\`。判据只能是「重打后装得上」，本目录已提供重打版本"
    VUE_JSON_LINE=",
  \"vue\": \"file:./vendor/${VUE_FILE}\""
    VUE_SECTION="### 内网项目还没有 vue 时

Vue2 是 \`lark-doc\` 的 peer（必须单例，不能被打进包里）。项目里已有 Vue2 就跳过这节；
没有的话装这份**重打过的** \`${VUE_FILE}\`（原版在 npm 6 下装不上，见上表第 2 条）：

1. 拷到 \`vendor\\${VUE_FILE}\`
2. \`package.json\` 的 \`dependencies\` 里加 \`\"vue\": \"file:./vendor/${VUE_FILE}\"\`
3. \`npm install\` 一次装完两个包（实测 \`added 23 packages from 26 contributors\`、registry 请求 0 条）

---

"
  else
    VUE_ROW_NOTE="原 vue 包同样命中此坑，需用脚本的 \`--vue-tgz\` 一并重打"
  fi

  # md 表格里不能出现 `|`（管道命令会把表格切断），体积先算成变量
  TGZ_SIZE="$(du -h "$OUT_DIR/$TGZ_NAME" | cut -f1)"
  THIN_SIZE="$(du -h "$OUT_DIR/$THIN_NAME" | cut -f1)"

  cat >"$OUT_DIR/INSTALL-内网.md" <<EOF
# lark-doc 内网安装（Windows · Node 14.21.3 · npm 6.14.18）

版本 **$NAME@$VER** · sha256 前缀 \`$SHA\` · 源包 \`$(basename "$SRC_TGZ")\`$VUE_HEADER

## 为什么要重做这一份

原包在 npm 6 下有**三个独立**的坑，任意一个都会让安装失败：

| # | 报错 | 根因 | 本包的处理 |
|---|---|---|---|
| 1 | \`code E401 · unable to authenticate, need: Basic realm="artifactory Realm"\` | ${ONLYB_ROW}没凭证即 401，实测只发出 \`GET /nanoid\` 一条请求就挂 | \`dependencies\` 与 \`bundleDependencies\` **重建为同一集合**（版本精确取自包内实物，npm 6 走 bundled 路径，0 请求） |
| 2 | \`code ENOENT · Cannot cd into '...unpack-xxxx'\` | 包是 macOS 的 \`tar czf\` 打的，混进 \`._package\`（AppleDouble 资源叉）、\`PaxHeader/package\` 和 \`com.apple.provenance\` 扩展头。npm 6 的 tar@2 解不开 | 用 \`COPYFILE_DISABLE=1 tar --no-xattrs\` 重打。**$VUE_ROW_NOTE** |
| 3 | 装完没报错，但 \`require('lark-doc')\` 崩在 \`Cannot find module 'vue/dist/vue.runtime.common.js'\` | npm 6 会把「包内 \`node_modules\` 里、但没声明在 \`bundleDependencies\` 里」的包当成 extraneous **直接删掉**。实测 \`added 1 package in 0.912s\`，\`node_modules/lark-doc/node_modules\` 整个消失 | 把随包分发的 $NCLOSURE 个依赖**回填成 \`dependencies\`（精确版本）+ \`bundleDependencies\`（同名同集）**，npm 6 走 bundled 路径：既保留依赖树，也不发 registry 请求 |

顺带把体积从 106M 降到 $(du -h "$OUT_DIR/$TGZ_NAME" | cut -f1)：原包裹的是**全量** \`node_modules\`（含 \`docx\` 那种 171 字符的深路径，Windows 上一装就容易 \`ENAMETOOLONG\`）。本包只保留 dist 真正外置的 $NCLOSURE 个包，最长路径 $LONGLEN 字符。

### 实测记录（npm 6.14.4 + Node 14.21.3，指向一个只会返回 401 的假私服）

\`\`\`
npm install --no-audit --no-fund
added 23 packages from 26 contributors in 1.666s
\`\`\`

- 私服请求：**0 条**（\`hits.log\` 空）
- 顶层只有 \`lark-doc\` 和 \`vue\` 两个包，\`node_modules/lark-doc/node_modules\`：**$NCLOSURE 个**，与 \`dependencies\` / \`bundleDependencies\` 完全一致
- 全程**没有** \`npm WARN optional SKIPPING OPTIONAL DEPENDENCY\`，也不会多出一层 \`node_modules/vue/node_modules/vue\`
- 冒烟：\`typeof require('lark-doc').LarkDoc === 'function'\`，导出 **27** 个名字

方案 3（thin 包 + 私服）也在同一套环境实测过，只把「假 401 私服」换成「能正常 serve 这 $NCLOSURE 个包的本地 registry」：

\`\`\`
npm install --no-audit --no-fund          # 装 lark-doc-<ver>-thin.tgz
added 23 packages from 26 contributors in 2.708s
\`\`\`

- 私服请求：**42 条** = $NCLOSURE 个包各 1 次 packument + 1 次 tgz（\`jszip\` / \`@xmldom/xmldom\` 多探一次版本范围）；**没有一条是 lark-doc 自己**，本体走 \`file:\`
- 顶层 \`node_modules\` **23** 个（$NCLOSURE 个依赖 + \`lark-doc\` + \`vue\`）
- 冒烟：\`typeof require('lark-doc').LarkDoc === 'function'\`，导出 **27** 个名字


---

## 方案 1（推荐）：放 vendor，一条命令

1. 把 \`$TGZ_NAME\` 拷进内网项目，例如 \`vendor\\$TGZ_NAME\`
2. \`package.json\` 里加：

\`\`\`json
"dependencies": {
  "lark-doc": "file:./vendor/$TGZ_NAME"$VUE_JSON_LINE
}
\`\`\`

3. 在项目根目录执行（cmd / PowerShell 都一样）：

\`\`\`
npm install ./vendor/$TGZ_NAME --no-audit --no-fund
\`\`\`

> ⚠️ **不要加 \`--legacy-peer-deps\`**。那是 npm 7+ 的参数，npm 6 会直接报 \`unknown option\`。
> npm 6 本来就不装 peer，最多打一行 \`requires a peer of vue\` 的 WARN，忽略即可。

4. 自检：

\`\`\`
node -e "console.log(require('lark-doc/package.json').version)"
node -e "console.log(typeof require('lark-doc').LarkDoc)"
\`\`\`

---

$VUE_SECTION## 方案 2（兜底）：不走 npm

用资源管理器把 \`$ZIP_NAME\` **解压到项目根目录**，或：

\`\`\`powershell
Expand-Archive -Path .\\$ZIP_NAME -DestinationPath . -Force
\`\`\`

Win10 1803+ 自带 tar.exe 也行（zip 就是 zip，tar 能读）：

\`\`\`
tar xf $ZIP_NAME
\`\`\`

得到 \`node_modules\\lark-doc\\\`（自带 $NCLOSURE 个依赖，0 个 native 模块）。
\`package.json\` 里写精确版本 \`"lark-doc": "$VER"\`。

$VUE_FLAT_NOTE

⚠️ 之后别跑 \`npm ci\`（它会先删 node_modules）。要增删别的依赖，到能联网的机器上改完再整体搬回来。

---

## 方案 3：\`file:\` 装本体，$NCLOSURE 个依赖走内网私服

适用：内网私服里**已经有这些通用小包**（jszip / underscore / pako …），只缺 \`lark-doc\` 自己。

### 包里少了什么

\`$THIN_NAME\` 和方案 1 的主包是**同一份 dist**，差别只有两处：

| | 主包 \`$TGZ_NAME\` | thin 包 \`$THIN_NAME\` |
|---|---|---|
| \`node_modules/lark-doc/node_modules\` | 有（$NCLOSURE 个） | **没有** |
| \`package.json\` 的 \`bundleDependencies\` | 有 | **删掉了** |
| \`dependencies\` | 同 $NCLOSURE 个精确版本 | 同 $NCLOSURE 个精确版本 |

所以 npm 6 装 thin 包时不是「直接拷包内依赖」，而是按 \`.npmrc\` 的 registry 把这
$NCLOSURE 个包**逐个拉一遍**。这就是方案 3 的代价，也是它能用在「私服齐全」场景的原因。

### 内网侧要准备的文件

| 文件 | 用途 |
|---|---|
| \`$THIN_NAME\` | 要装的包本体（**不放 node_modules，所以比主包小**） |
| \`deps-manifest.txt\` | $NCLOSURE 个依赖的清单（包名@版本 · 根/传递 · 各自 deps），给运维核对私服 |
| \`check-deps.js\` | 一条命令自检，逐条问私服有没有这些版本 |
| \`deps-tgz/\` | $NCLOSURE 个单包 tgz，私服缺哪个就让运维 publish 哪个 |

### 3.1 先自检

把上面 4 样拷进内网同一目录（例如 \`vendor\\\`）：

\`\`\`
cd vendor
node check-deps.js
\`\`\`

全 \`ok\` 再往下；出现 \`MISS\` 先补包（见 3.3）。

### 3.2 安装

\`package.json\`：

\`\`\`json
"dependencies": {
  "lark-doc": "file:./vendor/$THIN_NAME"$VUE_JSON_LINE
}
\`\`\`

\`\`\`
npm install --no-audit --no-fund
\`\`\`

\`.npmrc\` 里要有内网私服地址，例如：

\`\`\`
registry=http://nexus.内网域名/repository/npm-group/
\`\`\`

验证：

\`\`\`
node -e "console.log(require('lark-doc/package.json').version)"
node -e "console.log(typeof require('lark-doc').LarkDoc)"
\`\`\`

### 3.3 私服缺包怎么补

\`deps-tgz/\` 里一个文件就是一个能直接 publish 的单包 tgz：

\`\`\`
npm publish .\\deps-tgz\\<包名>-<版本>.tgz --registry http://nexus.内网域名/repository/npm-hosted/
\`\`\`

具体缺哪个、该是什么版本，\`check-deps.js\` 会把 \`包名@版本\` 直接列出来，照抄文件名即可。
补完让内网再跑一次 \`node check-deps.js\`，全 ok 就能装。

### 3.4 和方案 1 的关键差别

| | 方案 1 主包 | 方案 3 thin 包 |
|---|---|---|
| 装的时候问私服几次 | **0 次**（实测） | $NCLOSURE 次（每个依赖一次 packument + 一次 tgz） |
| 私服必须有这 $NCLOSURE 个包 | 不需要 | **需要** |
| 删了 \`node_modules\` 重装 / \`npm ci\` | 能 | 能（依赖从私服来） |
| 内网能不能换依赖版本 | 不能，被包内实物锁死 | 能，改 \`dependencies\` 走私服解析 |
| 拷贝体积 | $TGZ_SIZE | $THIN_SIZE |

一句话：**私服齐全、想让依赖走正常 npm 解析 → 方案 3；私服不齐或不想碰 registry → 方案 1。**

---

## 三种方案怎么选

| | 方案 1 \`file:\` + npm | 方案 2 解压直铺 | 方案 3 thin + 私服 |
|---|---|---|---|
| lark-doc 是否发 registry 请求 | 否（已在 npm 6 + 假 401 私服下实测 0 请求） | 不涉及 npm | 是，$NCLOSURE 个依赖各拉一次 |
| 项目其余依赖 | npm 6 仍会重建整棵树 | 完全不碰 | npm 6 仍会重建整棵树 |
| 能扛 \`npm ci\` | 能 | 不能 | 能（依赖在私服） |
| 要拷进内网 | 1 个 tgz（项目缺 Vue2 时 2 个） | 2 个 zip | 1 个 tgz + $NCLOSURE 个包在私服 |
| 何时用 | **先试这个** | 方案 1 报的是**别的包**的错时 | 私服已有这些通用包，或想走正常依赖解析 |

---

## 注意事项

1. **\`vue\` 由宿主提供**（peer \`^2.7.14\`），不会被塞进 lark-doc 包里。内网项目已有 Vue2 就不用再装；没有的话${VUE_HINT}。
2. **不要装 \`@tiptap/vue-2\`**：dist 已内联 tiptap，宿主再装容易双实例。
3. **样式要单独引**：\`import 'lark-doc/style.css'\`。
4. **\`dist\` 整个目录都拷**：\`math/mermaid/office/markdown\` 是动态 import 目标，缺了要到运行时才 404。
5. 覆盖升级**必须换版本号**，同版本号重打会让 \`npm ci\` 报 \`EINTEGRITY\`。
6. 若 Windows 上 npm 6 报 \`EPERM\`/\`EBUSY\`：关掉占用的编辑器 / 杀毒实时扫描再装，或在项目目录用管理员 cmd。
7. 解压后若 Windows 提示路径过长，把项目根目录挪到短路径（如 \`D:\\proj\`）。
8. 装完如果还看到 \`npm WARN optional SKIPPING OPTIONAL DEPENDENCY: vue@2.7.14\`，说明用的 vue 包是**旧的**（\`npm pack\` 出来的副本带 11 项 \`bundleDependencies\`，npm 6 会拿它们去私服查版本）。本目录重打过的 \`vue-2.7.14-intranet.tgz\` 已把 \`dependencies\` / \`bundleDependencies\` 一并清空，正常不会出现这句；真出现了就检查 \`vendor\` 里是不是还留着旧包。
EOF

  echo ""
  echo "✓ 完成：$OUT_DIR"
  ls -lh "$OUT_DIR" | tail -n +2 | sed 's/^/    /'
  exit 0
fi

NAME="$(node -p "require('./package.json').name")"
[ -n "$VER" ] || VER="$(node -p "require('./package.json').version")"
MAIN_VER="$(node -p "require('./package.json').version")"

echo "lark-doc 内网包 · $NAME@$VER · 目标 Node 14 / npm 6"

[ -x "$NODE24_DIR/npm" ] || { echo "✗ 缺少 npm（用于 npm pack）：$NODE24_DIR/npm"; exit 1; }
[ "$VER" = "$MAIN_VER" ] || echo "  ! 版本覆盖：package.json 是 ${MAIN_VER}，产物打 $VER"

# ---------- 1. 构建 ----------
if [ "$SKIP_BUILD" = 0 ]; then
  [ -x "$NODE14_DIR/node" ] || { echo "✗ 缺少 Node 14：$NODE14_DIR/node"; exit 1; }
  echo ""
  echo "[1/4] 构建产物（Node 14）"
  PATH="$NODE14_DIR:$PATH" npm run build 2>&1 | tail -3 | sed 's/^/    /'
  PATH="$NODE14_DIR:$PATH" npm run build:umd 2>&1 | tail -2 | sed 's/^/    /'
  PATH="$NODE14_DIR:$PATH" npm run build:esm 2>&1 | tail -2 | sed 's/^/    /'
  PATH="$NODE14_DIR:$PATH" npm run build:element 2>&1 | tail -2 | sed 's/^/    /'
else
  echo ""
  echo "[1/4] 跳过构建，使用现有 dist"
fi

# ---------- 2. 断言：ESM 自包含 ----------
echo ""
echo "[2/4] 校验产物"
NEED=(
  "dist/lark-doc.esm.js"
  "dist/lark-doc.common.js"
  "dist/lark-doc.umd.min.js"
  "dist/lark-doc-element.umd.min.js"
  "dist/lark-doc.css"
  "dist/tiptap.esm.js"
  "dist/vendor.esm.js"
)
for f in "${NEED[@]}"; do
  [ -f "$f" ] || { echo "    ✗ 缺少 $f"; exit 1; }
done
echo "    ✓ 7 个必需产物齐备"

# ESM 只允许 import vue，其余必须已在 dist 内部（否则零依赖不成立）
# 只取形如 from"vue" / from"@scope/pkg" 的片段，代码里的字符串字面量会被过滤掉
BARE="$(grep -oE 'from *"[a-zA-Z@][^"]*"' dist/lark-doc.esm.js dist/tiptap.esm.js dist/vendor.esm.js \
  | sed -E 's/^[^:]*://; s/^from *"//; s/"$//' \
  | grep -E '^(@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$' \
  | sort -u || true)"
BAD="$(echo "$BARE" | grep -v '^vue$' | grep -v '^$' || true)"
if [ -n "$BAD" ]; then
  echo "    ✗ ESM 仍有裸依赖，零依赖包不成立："
  echo "$BAD" | sed 's/^/        /'
  exit 1
fi
echo "    ✓ ESM 外部依赖仅 vue（其余已内联）"

# ---------- 3. 组装零运行时依赖主包 ----------
echo ""
echo "[3/4] 生成零依赖 tgz"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/larkdoc-intranet.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE/package"
cp -R dist "$STAGE/package/dist"
for f in style.css README.md DEMO_INTEGRATION_GUIDE.md; do
  [ -f "$f" ] && cp "$f" "$STAGE/package/"
done

# 关键改动：清空 dependencies、去掉 npm 8 的 engines 约束、去掉构建 scripts
node - "$STAGE/package/package.json" "$VER" <<'NODE'
const fs = require('fs')
const [, , out, ver] = process.argv
const p = JSON.parse(fs.readFileSync('./package.json', 'utf8'))
const intranet = {
  name: p.name,
  version: ver,
  description: p.description,
  main: p.main,
  module: p.module,
  unpkg: p.unpkg,
  exports: p.exports,
  sideEffects: p.sideEffects,
  files: ['dist', 'style.css', 'README.md', 'DEMO_INTEGRATION_GUIDE.md'],
  // 零运行时依赖：dist 已内联 tiptap / katex / docx / mammoth 等全部实现
  dependencies: {},
  // @tiptap/vue-2 已内联，不再要求宿主提供；只留 vue
  peerDependencies: { vue: '^2.7.14' },
  peerDependenciesMeta: { vue: { optional: false } },
  // 内网 npm 6 不满足 npm>=8.19.4，去掉避免 EBADENGINE
  engines: { node: '>=14.21.3' },
  keywords: p.keywords,
  license: p.license,
  repository: p.repository,
  larkDocIntranet: {
    note: '内网构建：dependencies 已清空，CJS 外置包见 node-modules 包',
    builtFrom: p.version,
    cjsExternals: ['jszip', '@xmldom/xmldom', 'base64-js', 'bluebird', 'dingbat-to-unicode', 'lop', 'option', 'underscore', 'xmlbuilder'],
  },
}
if (p.author) intranet.author = p.author
fs.writeFileSync(out, JSON.stringify(intranet, null, 2) + '\n')
NODE

TGZ_NAME="$NAME-$VER-intranet.tgz"
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY -u all_proxy \
  "$NODE24_DIR/npm" pack "$STAGE/package" --ignore-scripts --pack-destination "$OUT_DIR" 2>/dev/null \
  | tail -1 | sed 's/^/    /'
BUILT="$(ls "$OUT_DIR"/*.tgz | head -1)"
[ -n "$BUILT" ] || { echo "✗ npm pack 失败"; exit 1; }
[ "$(basename "$BUILT")" = "$TGZ_NAME" ] || mv "$BUILT" "$OUT_DIR/$TGZ_NAME"
echo "    ✓ $TGZ_NAME ($(du -h "$OUT_DIR/$TGZ_NAME" | cut -f1))"

# 断言：tgz 内 package.json 确实没有 dependencies
INNER="$(tar -xzOf "$OUT_DIR/$TGZ_NAME" package/package.json)"
echo "$INNER" | grep -q '"dependencies": {}' || { echo "✗ tgz 内 dependencies 未清空"; exit 1; }
echo "    ✓ tgz 内 dependencies 为空，安装过程零 registry 请求"

# ---------- 4. node_modules 直铺包 ----------
echo ""
echo "[4/4] 生成 node_modules 直铺包"

# CJS 入口外置的 9 个根包 + 它们的依赖闭包
ROOTS=(jszip @xmldom/xmldom base64-js bluebird dingbat-to-unicode lop option underscore xmlbuilder)
CLOSURE="$(ROOTS="${ROOTS[*]}" node -e '
const fs = require("fs"), path = require("path")
const roots = process.env.ROOTS.split(" ")
const seen = new Set()
const out = []
function walk(name) {
  if (seen.has(name)) return
  seen.add(name)
  const dir = path.join("node_modules", name)
  if (!fs.existsSync(path.join(dir, "package.json"))) { console.error("MISSING " + name); process.exit(1) }
  const pj = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"))
  out.push(name)
  for (const d of Object.keys(pj.dependencies || {})) walk(d)
}
roots.forEach(walk)
console.log(out.join("\n"))
')"

NM_STAGE="$STAGE/nm"
mkdir -p "$NM_STAGE/node_modules"
cp -R "$STAGE/package" "$NM_STAGE/node_modules/lark-doc"
echo "$CLOSURE" | while read -r p; do
  [ -n "$p" ] || continue
  mkdir -p "$NM_STAGE/node_modules/$(dirname "$p")"
  cp -R "node_modules/$p" "$NM_STAGE/node_modules/$p"
done

NATIVE="$(find "$NM_STAGE/node_modules" -name '*.node' 2>/dev/null | wc -l | tr -d ' ')"
[ "$NATIVE" = "0" ] || { echo "✗ 发现 $NATIVE 个 native 模块，不能跨机器直铺"; exit 1; }
PKG_COUNT="$(ls "$NM_STAGE/node_modules" | wc -l | tr -d ' ')"

NM_TGZ="$NAME-$VER-node-modules.tgz"
tar czf "$OUT_DIR/$NM_TGZ" -C "$NM_STAGE" node_modules
echo "    ✓ $NM_TGZ ($(du -h "$OUT_DIR/$NM_TGZ" | cut -f1) · $(( $(echo "$CLOSURE" | wc -l | tr -d ' ') + 1 )) 个包 · 0 native)"

# ---------- 校验信息 ----------
( cd "$OUT_DIR" && shasum -a 256 *.tgz > sha256.txt )
SHA1="$(grep "intranet.tgz" "$OUT_DIR/sha256.txt" | awk '{print substr($1,1,12)}')"
NCLOSURE="$(echo "$CLOSURE" | wc -l | tr -d ' ')"

cat >"$OUT_DIR/INSTALL-内网.md" <<EOF
# lark-doc 内网安装（Node 14.21.3 / npm 6.14.18）

版本 **$NAME@$VER** · sha256 前缀 \`$SHA1\`

本包已经处理掉 401 的根因：**dependencies 被清空**，tiptap / katex / docx / mammoth /
highlight.js 全部内联在 \`dist\` 里。npm 装它不需要任何 registry 请求。

本机实测（npm 6.14.12 + 死 registry \`http://127.0.0.1:9/\`）：

\`\`\`
added 1 package in 1.535s     # 零 HTTP 请求，无 401
\`\`\`

---

## 方案 1（推荐）：换包，命令不变

把 \`$TGZ_NAME\` 放到内网项目 \`vendor/\` 下，\`package.json\` 改成：

\`\`\`json
"dependencies": {
  "lark-doc": "file:./vendor/$TGZ_NAME"
}
\`\`\`

然后就是你原来那条命令，一条即可：

\`\`\`bash
npm install ./vendor/$TGZ_NAME --no-audit --no-fund
\`\`\`

> npm 6 没有 \`--legacy-peer-deps\`（那是 npm 7+ 的参数），加了会报 unknown option。
> npm 6 本来就不装 peer，只会打一行 \`requires a peer of vue\` 的 WARN，可以忽略。

**为什么这样就不再 401**：原来那个 tgz 声明了 28 个 runtime 依赖，npm 要逐个去
Artifactory 解析，没有凭证就 401。现在这些依赖要么已内联进 dist，要么不再是必需的，
所以 npm 只为「本包」做一次本地解包，不发任何请求。

验证：

\`\`\`bash
npm ls lark-doc
node -e "console.log(require('lark-doc/package.json').version)"
\`\`\`

⚠️ 覆盖升级时**必须换版本号**。同一版本号重新 pack，tgz 字节变了但 lockfile 里的
integrity 没变，\`npm ci\` 会报 \`EINTEGRITY\`。

---

## 方案 2（兜底）：完全不跑 npm

如果连 \`npm install\` 都不敢跑（担心 npm 6 重建整棵依赖树时又碰到别的私有包），
直接用直铺包：

\`\`\`bash
tar xzf $NM_TGZ -C <项目根目录>
\`\`\`

得到 \`node_modules/lark-doc\` + $NCLOSURE 个 CJS 外置包，共 $PKG_COUNT 个顶层目录，全部纯 JS（0 个 native 模块）。

\`package.json\` 里写**精确版本**（不要 \`^\`）：

\`\`\`json
"lark-doc": "$VER"
\`\`\`

⚠️ 之后**不要执行 \`npm install\` / \`npm ci\`**。npm 6 的 \`npm ci\` 会先 \`rm -rf node_modules\`，
直铺的包会被删掉。要增删别的依赖时，到能联网的机器上改完再整体搬回来。

---

## 两种方案取舍

| | 方案 1 \`file:\` + npm | 方案 2 直铺 |
|---|---|---|
| 命令 | 一条 \`npm install\` | 一条 \`tar\` |
| lark-doc 是否产生 registry 请求 | 否（实测） | 不涉及 npm |
| 项目其余依赖 | npm 6 仍会重建整棵树，需 lock 完整 | 完全不碰 |
| 抗 \`npm ci\` | 是 | 否 |
| 可重复安装 | 是 | 否 |
| 适用 | 内网项目本身能正常 \`npm install\` | 连 npm 都不敢跑 |

先试方案 1，一条命令就知道行不行；若报的是**别的包**的错（不是 lark-doc），说明项目
自身依赖树需要联网，改用方案 2。

---

## 注意事项

1. **\`vue\` 仍由宿主提供**（peer，^2.7.14）。内网项目已有 Vue2 就行，不用额外装。
2. **\`@tiptap/vue-2\` 不再是必需的**：dist 已内联 tiptap，宿主装不装、装的哪个版本都不影响，
   也不会出现「两套 tiptap 实例 / keyed plugin」冲突。本包的 peer 里已删掉它。
3. **走 \`import\` / webpack \`module\` 字段**：webpack 4/5 默认 \`mainFields\` 会命中
   \`dist/lark-doc.esm.js\`（自包含，外部只 import \`vue\`）。已用 webpack 5 在只有 vue 的环境下
   实测构建通过（0 warning）。若项目强制 \`mainFields: ['main']\`，会走 \`dist/lark-doc.common.js\`，
   需要 $NCLOSURE 个 CJS 外置包——方案 2 的直铺包已全部带上。
4. **样式要单独引**：\`import 'lark-doc/style.css'\`。
5. **按需 chunk 不能丢**：\`dist\` 里的 \`math.esm.js\` / \`mermaid.esm.js\` / \`office.esm.js\` /
   \`markdown.esm.js\` 等是动态 import 的目标，CDN 部署时整个 dist 一起拷，
   否则用到公式/图表/导入导出时才会 404。
6. **本包不能 \`npm publish\` 到公共 registry 供他人复用**：\`dependencies\` 被清空，
   只适合内网这种「dist 已自包含」的场景。
EOF

echo ""
echo "✓ 完成：$OUT_DIR"
ls -lh "$OUT_DIR" | tail -n +2 | sed 's/^/    /'
echo ""
echo "  内网侧看 $OUT_DIR/INSTALL-内网.md（方案 1：vendor + npm install，一条命令）"
