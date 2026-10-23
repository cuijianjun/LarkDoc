#!/usr/bin/env bash
#
# lark-doc 一键发布
#
#   一条命令跑完：版本号 → 全链校验 → 打包 → npm publish → sha1 校验 → git commit/tag/push
#
# 常规用法（默认 patch，即 0.11.2 → 0.11.3）：
#   bash scripts/release.sh                    # 或 npm run release
#   bash scripts/release.sh --minor            # 0.11.2 → 0.12.0
#   bash scripts/release.sh --version 1.0.0
#
# 常用开关：
#   --git-only       只提交推 GitHub：不动版本号、不发 npm、不打 tag
#   --skip-check     跳过 npm run check（dist 已是最新时用，省 ~40s）
#   --skip-publish   只提交 GitHub，不发 npm
#   --skip-git       只发 npm，不提交 GitHub
#   --no-wait        不等待 registry 读侧同步（默认最长等 ~5 分钟）
#   --include-new    把未跟踪的新文件也一起 commit（默认只提交已跟踪文件的改动）
#   --resume         发布中断后从断点继续（复用上次 bump 出来的版本号）
#   --dry-run        只打印计划，不改任何东西
#   -m "说明"         自定义 commit message（默认 "release: v<版本>"）
#
# 设计原则：全程非交互、可重入、每一步都自证。任何一步失败立刻停，退出码非 0。
#
set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PKG_DIR"

REGISTRY="https://registry.npmjs.org/"
# 构建/校验一律 Node 14（package.json engines 卡 14.21.3），发 npm 用 npm 11（实测 publish 全靠它）
NODE14_DIR="/Users/cjjxw/.nvm/versions/node/v14.21.3/bin"
NODE24_DIR="/Users/cjjxw/.nvm/versions/node/v24.22.0/bin"
STATE_DIR="$PKG_DIR/.release"
PENDING="$STATE_DIR/pending-version"
LOGFILE=""

# shellcheck disable=SC1091
NAME="$(node -p "require('./package.json').name")"
CURRENT="$(node -p "require('./package.json').version")"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

BUMP="patch"
EXPLICIT_VERSION=""
DO_CHECK=1
DO_PUBLISH=1
DO_GIT=1
DO_WAIT=1
DRY_RUN=0
RESUME=0
INCLUDE_NEW=0
GIT_ONLY=0
COMMIT_MSG=""

usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --patch | --minor | --major) BUMP="${1#--}"; shift ;;
    --version) EXPLICIT_VERSION="${2:-}"; shift 2 ;;
    --version=*) EXPLICIT_VERSION="${1#*=}"; shift ;;
    --skip-check) DO_CHECK=0; shift ;;
    --skip-publish) DO_PUBLISH=0; shift ;;
    --skip-git) DO_GIT=0; shift ;;
    --no-wait) DO_WAIT=0; shift ;;
    --include-new) INCLUDE_NEW=1; shift ;;
    --git-only) GIT_ONLY=1; shift ;;
    --resume) RESUME=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -m | --message) COMMIT_MSG="${2:-}"; shift 2 ;;
    -h | --help) usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage; exit 2 ;;
  esac
done

# ---------- 输出 ----------
T0=$(date +%s)
STEP=0
step() { STEP=$((STEP + 1)); printf '\n[%d] %s\n' "$STEP" "$1"; }
ok() { printf '    ✓ %s\n' "$1"; }
info() { printf '    · %s\n' "$1"; }
warn() { printf '    ! %s\n' "$1" >&2; }
die() {
  printf '\n✗ 失败：%s\n' "$1" >&2
  [ -n "$LOGFILE" ] && printf '  完整日志：%s\n' "$LOGFILE" >&2
  exit 1
}
elapsed() { echo "$(($(date +%s) - T0))s"; }

# ---------- 通用工具 ----------
# 统一剥掉系统代理：127.0.0.1:51253 会干扰 registry 访问
net() { env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY -u all_proxy "$@"; }
registry() { net curl -s --noproxy '*' --max-time 30 "$@"; }
need_cmd() { command -v "$1" >/dev/null 2>&1 || die "缺少命令：$1"; }

# 提交 + 推送。$1 = tag | notag，$2 = 默认 commit message
git_ship() {
  local want_tag="$1" default_msg="$2" msg
  if [ "$INCLUDE_NEW" = 1 ]; then git add -A; else git add -u; fi
  if git diff --cached --quiet; then
    info "无内容可提交，跳过 commit"
  else
    msg="${COMMIT_MSG:-$default_msg}"
    git commit -q -m "$msg"
    ok "$(git log --oneline -1)"
    git diff-tree --no-commit-id --name-only -r HEAD | sed 's/^/        /'
  fi
  if [ "$want_tag" = "tag" ] && ! git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null; then
    git tag -a "v$VERSION" -m "v$VERSION"
    ok "tag v$VERSION"
  fi
  git push -q origin "$BRANCH" || die "git push $BRANCH 失败"
  ok "push $BRANCH"
  if [ "$want_tag" = "tag" ]; then
    git push -q origin "v$VERSION" || die "git push tag 失败"
    ok "push tag v$VERSION"
  fi
}

[ -d "$STATE_DIR" ] || mkdir -p "$STATE_DIR"

echo "lark-doc 发布 $(basename "$PKG_DIR") · 当前 $NAME@$CURRENT · 分支 $BRANCH"
[ "$DRY_RUN" = 1 ] && echo "（dry-run：只打印计划，不做任何改动）"

# ---------- 1. 预检 ----------
step "预检"
need_cmd git
need_cmd node
need_cmd curl
[ -x "$NODE14_DIR/node" ] || die "Node 14 不存在：$NODE14_DIR/node"
[ -x "$NODE24_DIR/npm" ] || die "Node 24 的 npm 不存在：$NODE24_DIR/npm"
ok "Node 14 = $("$NODE14_DIR/node" -v) / npm $("$NODE14_DIR/npm" -v)"
ok "Node 24 = $("$NODE24_DIR/node" -v) / npm $("$NODE24_DIR/npm" -v)"

if ! git rev-parse --git-dir >/dev/null 2>&1; then die "当前目录不是 git 仓库"; fi
git remote get-url origin >/dev/null 2>&1 || die "缺少 git remote origin"
ok "git remote: $(git remote get-url origin)"
[ "$BRANCH" = "master" ] || warn "当前不在 master（${BRANCH}），将直接推送到 $BRANCH"

if [ "$DO_GIT" = 1 ]; then
  DIRTY="$(git status --porcelain --untracked-files=normal | grep -v '^?? ' || true)"
  NEWFILES="$(git status --porcelain --untracked-files=normal | grep '^?? ' || true)"
  if [ -n "$NEWFILES" ] && [ "$INCLUDE_NEW" = 0 ]; then
    warn "有未跟踪文件，默认不入库（需一并提交加 --include-new）："
    printf '%s\n' "$NEWFILES" | sed 's/^/        /'
  fi
  [ "$GIT_ONLY" = 0 ] && [ -z "$DIRTY" ] && info "工作区无已跟踪改动，本次只有版本号变更"
fi

if [ "$DO_PUBLISH" = 1 ] && [ "$GIT_ONLY" = 0 ]; then
  WHO="$(net "$NODE24_DIR/npm" whoami --registry="$REGISTRY" 2>/dev/null || true)"
  [ -n "$WHO" ] || die "npm 未登录（${REGISTRY}）。先 npm login"
  ok "npm 身份：$WHO"
fi

# ---------- 只提交 GitHub 的快路径 ----------
if [ "$GIT_ONLY" = 1 ]; then
  step "只提交 GitHub（版本不动、不发 npm、不打 tag）"
  if [ "$DRY_RUN" = 1 ]; then
    info "dry-run：将提交 $(git status --porcelain --untracked-files=no | wc -l | tr -d ' ') 个已跟踪改动"
    exit 0
  fi
  git_ship notag "chore: 同步改动"
  printf '\n✓ 已提交并推送（%s）\n' "$(elapsed)"
  exit 0
fi

# ---------- 2. 版本号 ----------
step "确定版本号"
if [ "$RESUME" = 1 ] && [ -f "$PENDING" ]; then
  VERSION="$(cat "$PENDING")"
  ok "resume：沿用上次未完成的版本 $VERSION"
elif [ -n "$EXPLICIT_VERSION" ]; then
  VERSION="$EXPLICIT_VERSION"
else
  VERSION="$(node -e '
    const arg = process.argv[1]
    const cur = require("./package.json").version
    if (/^\d+\.\d+\.\d+/.test(arg)) { process.stdout.write(arg); process.exit(0) }
    const [a, b, c] = cur.split("-")[0].split(".").map(Number)
    const next = arg === "major" ? a + 1 + ".0.0"
      : arg === "minor" ? a + "." + (b + 1) + ".0"
      : a + "." + b + "." + (c + 1)
    process.stdout.write(next)
  ' "$BUMP")"
fi

printf '%s' "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' || die "版本号不合法：$VERSION"
[ "$VERSION" != "$CURRENT" ] || die "版本号与当前 $CURRENT 相同"

if [ "$DO_PUBLISH" = 1 ]; then
  CODE="$(registry -o /dev/null -w '%{http_code}' "$REGISTRY$NAME/$VERSION" || echo 000)"
  if [ "$CODE" = "200" ]; then
    die "$NAME@$VERSION 已存在于 registry。换个版本号（如 --patch 会得到更高版本）或改用 --skip-publish"
  fi
  ok "registry 上 $VERSION 未被占用（HTTP ${CODE}）"
fi

if git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null; then
  die "git tag v$VERSION 已存在。删除后重试：git tag -d v$VERSION"
fi
ok "$CURRENT → $VERSION"

if [ "$DRY_RUN" = 1 ]; then
  printf '\n计划：bump 到 %s → ' "$VERSION"
  [ "$DO_CHECK" = 1 ] && printf 'npm run check → ' || printf '（跳过 check）→ '
  [ "$DO_PUBLISH" = 1 ] && printf 'npm publish → 校验 sha1 → ' || printf '（不发 npm）→ '
  [ "$DO_GIT" = 1 ] && printf 'git commit + tag v%s + push\n' "$VERSION" || printf '（不提交 git）\n'
  printf 'dry-run 结束，未做任何改动。\n'
  exit 0
fi

# ---------- 3. 版本号写入 ----------
step "写入版本号"
node -e '
  const fs = require("fs")
  const want = process.argv[1]
  const raw = fs.readFileSync("package.json", "utf8")
  const out = raw.replace(/("version":\s*")[^"]*(")/, "$1" + want + "$2")
  if (!out.includes("\"version\": \"" + want + "\"")) { console.error("改写 version 失败"); process.exit(1) }
  fs.writeFileSync("package.json", out)
' "$VERSION"
printf '%s' "$VERSION" >"$PENDING"
ok "package.json version = ${VERSION}（断点已记录，失败可 --resume）"

# ---------- 4. 全链校验 ----------
if [ "$DO_CHECK" = 1 ]; then
  step "全链校验 npm run check（Node 14，约 40s）"
  LOGFILE="$STATE_DIR/check-$VERSION.log"
  if ! PATH="$NODE14_DIR:$PATH" env -u NODE_OPTIONS npm run check >"$LOGFILE" 2>&1; then
    tail -30 "$LOGFILE" >&2
    die "npm run check 未通过（见 ${LOGFILE}）"
  fi
  ok "check EXIT=0"
  grep -E '✓ Vditor|ESM .*kB|CJS .*kB' "$LOGFILE" | sed 's/^/        /' || true
else
  step "跳过全链校验"
  [ -f dist/lark-doc.common.js ] || die "--skip-check 但 dist/lark-doc.common.js 不存在，先跑 npm run build"
  info "使用现有 dist（$(du -h dist/lark-doc.common.js | cut -f1)）"
fi

if [ "$DO_PUBLISH" = 0 ]; then
  step "打包（不发 npm）"
else
  step "打包并记录 sha1"
fi
# 四个构建目标都带 --no-clean，旧产物不会被清掉（见 DEVELOPMENT.md §6）
if [ -d dist/vendor ]; then
  info "清理旧构建残留 dist/vendor"
  rm -rf dist/vendor
fi
rm -f "$STATE_DIR"/lark-doc-*.tgz
PACK_JSON="$(net "$NODE24_DIR/npm" pack --ignore-scripts --json --pack-destination "$STATE_DIR" 2>"$STATE_DIR/pack.err" || true)"
PACK_PARSE="$(printf '%s' "$PACK_JSON" | node -e '
let s = ""
process.stdin.on("data", d => s += d).on("end", () => {
  let a
  try { a = JSON.parse(s) } catch (e) { process.exit(0) }
  const p = (a && a[0]) || {}
  const need = [
    "dist/lark-doc.common.js",
    "dist/lark-doc.esm.js",
    "dist/lark-doc.umd.min.js",
    "dist/lark-doc-element.umd.min.js",
    "dist/lark-doc.css"
  ]
  let status = "SKIP"
  if (Array.isArray(p.files)) {
    const have = new Set(p.files.map(f => f.path))
    const miss = need.filter(n => !have.has(n))
    status = miss.length ? "MISS:" + miss.join(",") : "OK"
  }
  process.stdout.write([p.shasum || "", p.filename || "", status].join("\n"))
})')"
TGZ_SHA="$(printf '%s\n' "$PACK_PARSE" | sed -n '1p')"
TGZ_NAME="$(printf '%s\n' "$PACK_PARSE" | sed -n '2p')"
PACK_STATUS="$(printf '%s\n' "$PACK_PARSE" | sed -n '3p')"
[ -n "$TGZ_SHA" ] || {
  cat "$STATE_DIR/pack.err" >&2 2>/dev/null || true
  die "npm pack 失败"
}
# 四份产物少一个就说明 files / 构建链有问题，宁可停在这里也别发出去
case "$PACK_STATUS" in
  OK) ok "$TGZ_NAME  sha1=$TGZ_SHA  四产物齐备" ;;
  SKIP) warn "npm pack --json 未返回 files 列表，跳过产物齐备性检查"; ok "$TGZ_NAME  sha1=$TGZ_SHA" ;;
  *) die "tarball 缺产物：${PACK_STATUS#MISS:}（检查 package.json files 与构建）" ;;
esac

# ---------- 5. 发布 ----------
if [ "$DO_PUBLISH" = 1 ]; then
  step "npm publish → $REGISTRY"
  LOGFILE="$STATE_DIR/publish-$VERSION.log"
  PUB_ARGS=(publish --ignore-scripts --registry="$REGISTRY")
  case "$NAME" in @*) PUB_ARGS+=(--access public) ;; esac
  [ -n "${NPM_OTP:-}" ] && PUB_ARGS+=(--otp="$NPM_OTP")
  if ! net "$NODE24_DIR/npm" "${PUB_ARGS[@]}" >"$LOGFILE" 2>&1; then
    tail -30 "$LOGFILE" >&2
    die "npm publish 失败（见 ${LOGFILE}）。修好后：bash scripts/release.sh --resume"
  fi
  ok "publish 返回 0"
  grep -E '^\+ |shasum|total files' "$LOGFILE" | sed 's/^/        /' || true

  # ---------- 6. 校验线上产物 ----------
  step "校验 registry 上的产物"
  if [ "$DO_WAIT" = 1 ]; then
    info "读侧同步有延迟（实测 HEAD 会 404 约 5 分钟，GET 却已 200），用 GET + sha1 判定"
    TRIES=40
  else
    TRIES=3
  fi
  GOT_SHA=""
  for i in $(seq 1 "$TRIES"); do
    CODE="$(registry -o "$STATE_DIR/dl.tgz" -w '%{http_code}' "$REGISTRY$NAME/-/$NAME-$VERSION.tgz" || echo 000)"
    if [ "$CODE" = "200" ]; then
      GOT_SHA="$(shasum -a 1 "$STATE_DIR/dl.tgz" | awk '{print $1}')"
      if [ "$GOT_SHA" = "$TGZ_SHA" ]; then
        ok "tarball GET 200，sha1 一致：$GOT_SHA"
        break
      fi
      warn "sha1 不一致（$GOT_SHA ≠ ${TGZ_SHA}），继续等…"
    else
      info "第 $i/$TRIES 次：HTTP ${CODE}，8s 后重试"
    fi
    [ "$i" = "$TRIES" ] && die "等待超时，线上 tarball 与本地不一致。稍后手动核：curl -s --noproxy '*' $REGISTRY$NAME/-/$NAME-$VERSION.tgz | shasum -a 1"
    sleep 8
  done

  TAGS="$(registry "$REGISTRY$NAME" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(JSON.stringify(j["dist-tags"]))}catch(e){process.stdout.write("?")}})')"
  ok "dist-tags: $TAGS"
  printf '%s' "$TAGS" | grep -q "\"latest\":\"$VERSION\"" || warn "latest 不是 ${VERSION}，检查是否使用了 --tag"
else
  step "跳过发布"
fi

# ---------- 7. git ----------
if [ "$DO_GIT" = 1 ]; then
  step "提交 GitHub"
  git_ship tag "release: v$VERSION

npm: $NAME@$VERSION
check: $([ "$DO_CHECK" = 1 ] && echo 'npm run check ✓' || echo 'skipped')"
else
  step "跳过 git"
fi

rm -f "$PENDING"

REMOTE_URL="$(git remote get-url origin)"
case "$REMOTE_URL" in
  git@github.com:*) REMOTE_HTTP="https://github.com/${REMOTE_URL#git@github.com:}"; REMOTE_HTTP="${REMOTE_HTTP%.git}" ;;
  *) REMOTE_HTTP="$REMOTE_URL" ;;
esac

printf '\n✓ 完成：%s@%s（%s）\n' "$NAME" "$VERSION" "$(elapsed)"
[ "$DO_PUBLISH" = 1 ] && printf '  npm     https://www.npmjs.com/package/%s/v/%s\n' "$NAME" "$VERSION"
[ "$DO_GIT" = 1 ] && printf '  github  %s\n' "$REMOTE_HTTP"
[ "$DO_PUBLISH" = 1 ] && printf '  使用方升级：npm install %s@^%s\n' "$NAME" "$VERSION"
exit 0
exit 0
