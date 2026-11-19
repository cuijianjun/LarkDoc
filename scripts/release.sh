#!/usr/bin/env bash
#
# lark-doc 一键发布
#
#   一条命令跑完：版本号 → 全链校验 → 打包 → npm publish → sha1 校验 → git commit/tag/push
#
# 常规用法（默认 patch，即 0.11.2 → 0.11.3）：
#   npm run ship                               # ← 最常用：一个命令同时发 npm + GitHub
#   npm run release                            # 同上（等价别名）
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
#   --approve        暂存包已上传、只差 2FA 批准时收尾：approve + 线上校验 + tag/push
#   --dry-run        只打印计划，不改任何东西
#
# npm 发布走「暂存（staged）」：npm 已把免 2FA token 的直接发布收窄为暂存流水线
# （https://gh.io/npm-gat-bypass2fa-deprecation）。stage publish 不需要 OTP，
# 批准（stage approve）必须 OTP —— 所以带 NPM_OTP 时一条命令跑完，
# 不带时脚本会把 stage id 落盘并停住，人工批准后用 --approve 收尾。
#   -m "说明"         自定义 commit message（默认 "release: v<版本>"）
#
# 设计原则：全程非交互、可重入、每一步都自证。任何一步失败立刻停，退出码非 0。
#
set -euo pipefail

# 经 `npm run ship` 调用时，宿主的 NODE_OPTIONS 会被传进来（本机是 WorkBuddy 的
# node-language-shim.cjs，Node 14 跑 check 时会直接崩）。这里统一清掉，
# 下游 node / npm 子进程一律拿干净环境 —— 所以不需要再手写 `env -u NODE_OPTIONS`。
unset NODE_OPTIONS

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PKG_DIR"

REGISTRY="https://registry.npmjs.org/"
# 构建/校验一律 Node 14（package.json engines 卡 14.21.3），发 npm 用 npm 11（实测 publish 全靠它）
NODE14_DIR="${LARK_DOC_NODE14_DIR:-$HOME/.nvm/versions/node/v14.21.3/bin}"
NODE24_DIR="${LARK_DOC_NODE24_DIR:-$HOME/.nvm/versions/node/v24.22.0/bin}"
STATE_DIR="$PKG_DIR/.release"
PENDING="$STATE_DIR/pending-version"
STAGED_FILE="" # 本次版本的 stage id 落盘路径，拿到 VERSION 后才定
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
APPROVE_ONLY=0
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
    --approve) APPROVE_ONLY=1; shift ;;
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
# 发布认证预检。npm whoami 能过不代表能 publish：账号 2FA 为 auth-and-writes 时，
# 非 bypass-2fa 的 token 必须在 publish 时带一次性密码，否则最后一步才 EOTP（白跑一次全链校验）。
# 有 NPM_OTP 就无需预检；否则按 token 类型提前判定，把失败点从 publish 提前到开头。
check_publish_auth() {
  if [ -n "${NPM_OTP:-}" ]; then
    ok "已提供 NPM_OTP，publish 时附带一次性密码"
    return 0
  fi
  local tok body verdict rc
  # npm 11 把 *_authToken 设为 protected，config get 读不到，只能从 userconfig 文件取
  if [ -n "${NPM_TOKEN:-}" ]; then
    tok="$NPM_TOKEN"
  else
    rc="$(net "$NODE24_DIR/npm" config get userconfig 2>/dev/null || echo "$HOME/.npmrc")"
    if [ -f "$rc" ]; then
      tok="$(awk -F= '/^[[:space:]]*\/\/registry\.npmjs\.org\/:_authToken[[:space:]]*=/{v=$2; gsub(/[[:space:]"]/,"",v); print v; exit}' "$rc")"
    fi
  fi
  if [ -z "$tok" ]; then
    warn "未读到 $REGISTRY 的 _authToken，无法预检 token 类型"
    return 0
  fi
  body="$(registry -H "Authorization: Bearer $tok" "${REGISTRY}-/npm/v1/tokens" 2>/dev/null || true)"
  verdict="$(TOK="$tok" node -e '
    let s = ""
    process.stdin.on("data", d => (s += d)).on("end", () => {
      const tok = process.env.TOK
      let list = []
      try { list = JSON.parse(s).objects || [] } catch (e) { process.stdout.write("unknown"); return }
      // 服务端只回脱敏值（npm_xxxx...abcd），用首尾片段认领当前 token
      const hit = list.find(o => typeof o.token === "string"
        && o.token.startsWith(tok.slice(0, 8)) && o.token.endsWith(tok.slice(-4)))
      process.stdout.write(!hit ? "unknown" : hit.bypass_2fa ? "yes" : "no")
    })
  ' <<<"$body" 2>/dev/null || echo unknown)"
  case "$verdict" in
    yes) ok "token 免 2FA：可自动 stage publish；批准（stage approve）仍要 OTP，最好带上 NPM_OTP" ;;
    no)
      die "当前 npm token 无法免 OTP 发布（账号 2FA = auth-and-writes）。两条路：
         ① 本次应急：认证器取 6 位码 →  NPM_OTP=123456 bash scripts/release.sh --resume
         ② 一劳永逸：https://www.npmjs.com/settings/~/tokens 建带 bypass 2FA 的 token，写进 ~/.npmrc：
              //registry.npmjs.org/:_authToken=npm_xxx
            它能免掉登录/暂存环节的 OTP，但批准仍需 OTP（npm 新政策），照样带 NPM_OTP 最省事" ;;
    *) warn "无法从 registry 确认 token 类型，继续（若 approve 报 EOTP，带 NPM_OTP 或去网页批准）" ;;
  esac
}
sri512() { node -e 'const fs = require("fs"), crypto = require("crypto"); process.stdout.write("sha512-" + crypto.createHash("sha512").update(fs.readFileSync(process.argv[1])).digest("base64"))' "$1"; }
check_public_tarball() {
  python3 - "$1" "$NAME" "$VERSION" <<'PY'
import json, sys, tarfile
from pathlib import PurePosixPath
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    for member in archive.getmembers():
        parts = PurePosixPath(member.name).parts
        if not parts or parts[0] != 'package' or '..' in parts or 'node_modules' in parts or not member.isfile():
            raise ValueError('Expected public SDK payload without bundled runtime: ' + member.name)
    manifest = json.load(archive.extractfile('package/package.json'))
    if manifest.get('name') != sys.argv[2] or manifest.get('version') != sys.argv[3] or manifest.get('bundleDependencies') or manifest.get('bundledDependencies'):
        raise ValueError('Expected matching public SDK identity and external runtime dependencies')
PY
}

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

# ---------- npm 暂存发布 ----------
# 统一入口：NPM_TOKEN 优先于 ~/.npmrc（npm 11 把 *_authToken 设为 protected，config get 读不到）
npm_stage() {
  local args=(stage "$@")
  [ -n "${NPM_TOKEN:-}" ] && args+=("--//registry.npmjs.org/:_authToken=${NPM_TOKEN}")
  args+=("--registry=$REGISTRY")
  net "$NODE24_DIR/npm" "${args[@]}"
}
staged_versions() {
  npm_stage list "$NAME" 2>/dev/null | awk -F': ' '/^version:/{print $2}' || true
}

# 校验 registry 上的产物。$1 = 期望 sha1，$2 = 期望 SHA512（都为空时只核 HTTP 200 + dist-tags，
# 用于「人工在网页批准」的场景：本地 tarball 已随临时目录清掉，只能信暂存时算过的哈希）
verify_registry() {
  local want_sha="$1" want_integrity="$2" tries code got_sha got_integrity tags
  if [ "$DO_WAIT" = 1 ]; then
    info "读侧同步有延迟（实测 HEAD 会 404 约 5 分钟，GET 却已 200），用 GET + sha1 判定"
    tries=40
  else
    tries=3
  fi
  got_sha=""
  for i in $(seq 1 "$tries"); do
    code="$(registry -o "$STATE_DIR/dl.tgz" -w '%{http_code}' "$REGISTRY$NAME/-/$NAME-$VERSION.tgz" || echo 000)"
    if [ "$code" = "200" ]; then
      got_sha="$(shasum -a 1 "$STATE_DIR/dl.tgz" | awk '{print $1}')"
      got_integrity="$(sri512 "$STATE_DIR/dl.tgz")"
      if [ -z "$want_sha" ] || { [ "$got_sha" = "$want_sha" ] && [ "$got_integrity" = "$want_integrity" ]; }; then
        check_public_tarball "$STATE_DIR/dl.tgz" || die "registry tgz 不是版本匹配的 public 产物"
        ok "tarball GET 200，public 版本正确：$got_sha"
        break
      fi
      warn "sha1 或 SHA512 不一致（sha1=$got_sha），继续等…"
    else
      info "第 $i/$tries 次：HTTP ${code}，8s 后重试"
    fi
    [ "$i" = "$tries" ] && die "等待超时，线上 tarball 与本地不一致。稍后手动核：curl -s --noproxy '*' $REGISTRY$NAME/-/$NAME-$VERSION.tgz | shasum -a 1"
    sleep 8
  done

  tags="$(registry "$REGISTRY$NAME" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(JSON.stringify(j["dist-tags"]))}catch(e){process.stdout.write("?")}})')"
  ok "dist-tags: $tags"
  printf '%s' "$tags" | grep -q "\"latest\":\"$VERSION\"" || die "latest 不是 ${VERSION}，发布后校验失败"
}

echo "lark-doc 发布 $(basename "$PKG_DIR") · 当前 $NAME@$CURRENT · 分支 $BRANCH"
[ "$DRY_RUN" = 1 ] && echo "（dry-run：只打印计划，不做任何改动）"

# ---------- 1. 预检 ----------
step "预检"
need_cmd git
need_cmd node
need_cmd curl

# 发布锁：防两个 ship 进程并发（踩过一次：旧进程还在等 registry 读侧时又起了一个，
# 新进程把 package.json 改成下一版，旧进程随后 commit/tag 就把错的版本号钉进了 tag）。
# 用 mkdir 而不是 [ -f ]，因为 mkdir 在文件系统层是原子的。
LOCK_DIR="$STATE_DIR/lock"
if mkdir "$LOCK_DIR" 2>/dev/null; then
  ok "发布锁已获取（PID $$）"
else
  LOCK_PID="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [ -n "$LOCK_PID" ] && kill -0 "$LOCK_PID" 2>/dev/null; then
    die "另一个发布进程正在运行（PID ${LOCK_PID}）。等它跑完再发；确认是残留锁就 rm -rf ${LOCK_DIR}"
  fi
  warn "发现残留锁（PID ${LOCK_PID:-未知} 已不存在），接管"
  printf '%s' "$$" >"$LOCK_DIR/pid"
fi
printf '%s' "$$" >"$LOCK_DIR/pid"
trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM

[ -x "$NODE14_DIR/node" ] || die "Node 14 不存在：$NODE14_DIR/node"
[ -x "$NODE24_DIR/npm" ] || die "Node 24 的 npm 不存在：$NODE24_DIR/npm"
ok "Node 14 = $("$NODE14_DIR/node" -v) / npm $("$NODE14_DIR/npm" -v)"
ok "Node 24 = $("$NODE24_DIR/node" -v) / npm $("$NODE24_DIR/npm" -v)"

if ! git rev-parse --git-dir >/dev/null 2>&1; then die "当前目录不是 git 仓库"; fi
git remote get-url origin >/dev/null 2>&1 || die "缺少 git remote origin"
ok "git remote: $(git remote get-url origin)"
# 发布安全阀（requirements/09 P0-08）：npm publish 只允许在 master 上执行，
# 防止 next 分支上的 beta 版本抢占 latest。分支收口走 --skip-publish / --git-only（都不发 npm）。
if [ "$BRANCH" != "master" ] && [ "$DO_PUBLISH" = 1 ] && [ "$GIT_ONLY" = 0 ]; then
  die "发布安全阀：当前不在 master（${BRANCH}），npm publish 被拦截（防止分支版本抢占 latest）。分支上收口请加 --skip-publish 或 --git-only，正式发版请切回 master。"
fi
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
  check_publish_auth
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

# ---------- 只差 2FA 批准的收尾快路径 ----------
# stage publish 不需要 OTP，approve 必须要 OTP。没给 NPM_OTP 时主流程会停在这里，
# 人工批准（CLI 或 npmjs.com 的 Staged Packages）后用 --approve 补完校验与 tag/push。
if [ "$APPROVE_ONLY" = 1 ]; then
  step "批准暂存包并收尾"
  VERSION="$(cat "$PENDING" 2>/dev/null || printf '%s' "$CURRENT")"
  STAGED_FILE="$STATE_DIR/staged-$VERSION.id"
  [ -f "$STAGED_FILE" ] || die "找不到 ${VERSION} 的 stage id（${STAGED_FILE}）。要重新发版：bash scripts/release.sh --version ${VERSION}"
  STAGE_ID="$(cat "$STAGED_FILE")"
  [ "$BRANCH" = master ] || die "收尾只允许在 master（当前 ${BRANCH}）"
  LOGFILE="$STATE_DIR/approve-$VERSION.log"
  : >"$LOGFILE"
  ok "版本 ${VERSION} / stage ${STAGE_ID}"

  if [ "$DO_PUBLISH" = 1 ]; then
    if [ -n "${NPM_OTP:-}" ]; then
      if npm_stage approve "$STAGE_ID" --otp="$NPM_OTP" >>"$LOGFILE" 2>&1; then
        ok "已批准（2FA）"
      else
        warn "approve 未成功（可能已在网页批准，或暂存已过期），继续核线上产物"
      fi
    elif grep -qx "$VERSION" <<<"$(staged_versions)"; then
      die "${VERSION} 仍在暂存队列且没给 NPM_OTP。二选一：
         ① 认证器 6 位码 → NPM_OTP=123456 bash scripts/release.sh --approve
         ② 网页批准 https://www.npmjs.com/settings/~/packages（Staged Packages 标签页）后重跑本命令"
    else
      info "暂存队列里已没有 ${VERSION}：视为已批准，直接核线上产物"
    fi
    verify_registry "" ""
  fi

  if [ "$DO_GIT" = 1 ]; then
    step "提交 GitHub"
    git_ship tag "release: v$VERSION

npm: $NAME@$VERSION"
  else
    step "跳过 git"
  fi
  rm -f "$PENDING" "$STAGED_FILE"
  printf '\n✓ 收尾完成：%s@%s（%s）\n' "$NAME" "$VERSION" "$(elapsed)"
  printf '  npm     https://www.npmjs.com/package/%s/v/%s\n' "$NAME" "$VERSION"
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
[ "$DO_PUBLISH" = 0 ] || printf '%s' "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$' || die "npm latest 发布仅接受 public 正式版本；内网版本请单独使用 intranet tag"
# bump 已写入 package.json 后，断点恢复或明确指定当前版本仍需完成校验/发布。
[ "$VERSION" != "$CURRENT" ] || [ "$RESUME" = 1 ] || [ -n "$EXPLICIT_VERSION" ] || die "版本号与当前 $CURRENT 相同"

if [ "$DO_PUBLISH" = 1 ]; then
  CODE="$(registry -o /dev/null -w '%{http_code}' "$REGISTRY$NAME/$VERSION" || echo 000)"
  case "$CODE" in
    404) ;;
    200) die "$NAME@$VERSION 已存在于 registry。请使用未发布的新版本" ;;
    *) die "无法确认版本是否可发布（registry HTTP ${CODE}），请恢复连接后重试" ;;
  esac
  ok "registry 上 $VERSION 未被占用（HTTP ${CODE}）"
  # 暂存项不占 registry 的版本号（/NAME/VERSION 仍 404），但会挡住再次发布：
  # E409 Cannot publish over previously staged version。所以这里要单独查暂存队列。
  if grep -qx "$VERSION" <<<"$(staged_versions)"; then
    die "${NAME}@${VERSION} 已在 npm 暂存队列里，再发会 E409（Cannot publish over previously staged version）。二选一：
       ① 批准它：NPM_OTP=<认证器 6 位码> bash scripts/release.sh --approve
       ② 丢掉它：npm stage list $NAME 查 id → npm stage reject <id>，然后重跑本命令"
  fi
  ok "暂存队列里没有 $VERSION"
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
  const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"))
  lock.version = want
  lock.packages[""].version = want
  fs.writeFileSync("package-lock.json", JSON.stringify(lock, null, 2) + "\n")
' "$VERSION"
printf '%s' "$VERSION" >"$PENDING"
STAGED_FILE="$STATE_DIR/staged-$VERSION.id"
rm -f "$STAGED_FILE"
ok "package.json version = ${VERSION}（断点已记录，失败可 --resume）"

# ---------- 4. 全链校验 ----------
if [ "$DO_CHECK" = 1 ]; then
  # npm run check 拆两段跑，各用各的 Node：
  #   门禁段必须现代 Node —— vitest@5 engines 要 ^22.12||^24||>=26，Node 14 起不来；
  #   yjs→lib0/webcrypto 在 Node 14 下取 crypto.webcrypto 为 undefined 直接崩。
  #   产物段（build*）仍按 package.json engines 卡 Node 14。
  #   注：scripts/check-node14.js 只卡版本下限（Node 20+ 构建合法），并非全链都要 14。
  LOGFILE="$STATE_DIR/check-$VERSION.log"
  : >"$LOGFILE"

  step "门禁校验 check:gate（Node 24，含 vitest / yjs，约 30s）"
  if ! PATH="$NODE24_DIR:$PATH" env -u NODE_OPTIONS npm run check:gate >>"$LOGFILE" 2>&1; then
    tail -30 "$LOGFILE" >&2
    die "check:gate 未通过（见 ${LOGFILE}）"
  fi
  ok "check:gate EXIT=0"

  step "产物校验 check:artifacts（Node 14，含 build* 与体积门禁，约 3min）"
  if ! PATH="$NODE14_DIR:$PATH" env -u NODE_OPTIONS npm run check:artifacts >>"$LOGFILE" 2>&1; then
    tail -30 "$LOGFILE" >&2
    die "check:artifacts 未通过（见 ${LOGFILE}）"
  fi
  ok "check:artifacts EXIT=0"

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
need_cmd python3
PACK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/lark-doc-sdk-${VERSION}.XXXXXX")"
info "SDK 工作目录：${PACK_DIR}（保留审计，发布后可删除）"
if ! PACK_JSON="$(PATH="$NODE24_DIR:$PATH" net "$NODE24_DIR/node" scripts/pack-sdk.mjs --work "$PACK_DIR/work" --out "$PACK_DIR/out" --node14 "$NODE14_DIR/node" --skip-build 2>"$STATE_DIR/pack.err")"; then
  cat "$STATE_DIR/pack.err" >&2
  die "public SDK 打包失败"
fi
PACK_PARSE="$(printf '%s' "$PACK_JSON" | node -e '
let s = ""
process.stdin.on("data", d => s += d).on("end", () => {
  let a
  try { a = JSON.parse(s) } catch (e) { process.exit(0) }
  const p = (Array.isArray(a) ? a[0] : a) || {}
  const need = [
    "dist/lark-doc.common.js",
    "dist/lark-doc.esm.js",
    "dist/lark-doc-element.umd.min.js",
    "dist/lark-doc.css"
  ]
  let status = "SKIP"
  if (Array.isArray(p.files)) {
    const have = new Set(p.files.map(f => f.path))
    const miss = need.filter(n => !have.has(n))
    status = p.mode !== "public" || p.runtime !== "external" || p.version !== process.argv[1] || p.name !== process.argv[2] || p.files.some(f => f.path.startsWith("node_modules/"))
      ? "UNSAFE" : miss.length ? "MISS:" + miss.join(",") : "OK"
  }
  process.stdout.write([p.shasum || "", p.filename || "", status, p.integrity || ""].join("\n"))
})' "$VERSION" "$NAME")"
TGZ_SHA="$(printf '%s\n' "$PACK_PARSE" | sed -n '1p')"
TGZ_NAME="$(printf '%s\n' "$PACK_PARSE" | sed -n '2p')"
PACK_STATUS="$(printf '%s\n' "$PACK_PARSE" | sed -n '3p')"
TGZ_INTEGRITY="$(printf '%s\n' "$PACK_PARSE" | sed -n '4p')"
[ -n "$TGZ_SHA" ] || {
  cat "$STATE_DIR/pack.err" >&2 2>/dev/null || true
  die "public SDK 打包结果无效"
}
# 四份产物少一个就说明 files / 构建链有问题，宁可停在这里也别发出去
case "$PACK_STATUS" in
  OK) ok "$TGZ_NAME  sha1=$TGZ_SHA  四产物齐备" ;;
  SKIP) die "public SDK 打包结果缺少 files 列表，无法验证产物" ;;
  UNSAFE) die "npm 发布仅接受版本匹配、共享外部依赖的 public SDK" ;;
  *) die "tarball 缺产物：${PACK_STATUS#MISS:}（检查 package.json files 与构建）" ;;
esac
[[ "$TGZ_NAME" == "$(basename "$TGZ_NAME")" && "$TGZ_NAME" == *.tgz ]] || die "SDK 文件名无效"
TGZ_PATH="$PACK_DIR/out/$TGZ_NAME"
[ -f "$TGZ_PATH" ] || die "最终 SDK tgz 不存在"
[ "$(shasum -a 1 "$TGZ_PATH" | awk '{print $1}')" = "$TGZ_SHA" ] || die "最终 SDK tgz 校验失败"
[ "$(sri512 "$TGZ_PATH")" = "$TGZ_INTEGRITY" ] || die "最终 SDK tgz SHA512/SRI 校验失败"
check_public_tarball "$TGZ_PATH" || die "最终 SDK tgz 不是版本匹配的 public 产物"

# ---------- 5. 发布（npm 暂存流水线） ----------
# npm 已把免 2FA token 的直接发布收窄为暂存：publish 会被 registry 暂存，
# 而 CLI 的非 stage 路径不读 stageId —— 于是日志显示 + NAME@VERSION、退出码 0，
# 包却没上线、版本号反被占住（下次 E409 previously staged version）。只能显式走 stage。
if [ "$DO_PUBLISH" = 1 ]; then
  step "npm stage publish → $REGISTRY"
  LOGFILE="$STATE_DIR/publish-$VERSION.log"
  : >"$LOGFILE"
  PUB_ARGS=(publish "$TGZ_PATH" --tag latest)
  case "$NAME" in @*) PUB_ARGS+=(--access public) ;; esac
  if ! npm_stage "${PUB_ARGS[@]}" >"$LOGFILE" 2>&1; then
    tail -30 "$LOGFILE" >&2
    if grep -q 'previously staged version' "$LOGFILE"; then
      die "该版本已在暂存队列（E409）。批准：NPM_OTP=<6 位码> bash scripts/release.sh --approve
        或丢掉：npm stage list $NAME 查 id → npm stage reject <id>"
    fi
    if grep -q 'EOTP' "$LOGFILE"; then
      die "stage publish 被 2FA 拦下（EOTP）：带 NPM_OTP=<认证器 6 位码> 重跑 --resume"
    fi
    die "npm stage publish 失败（见 ${LOGFILE}）。修好后：bash scripts/release.sh --resume"
  fi
  STAGE_ID="$(grep -oE 'staged with id [0-9a-fA-F-]{36}' "$LOGFILE" | awk '{print $NF}' | tail -1)"
  if [ -z "$STAGE_ID" ]; then
    info "未捕获 stage id（npm/registry 可能走了直接发布路径），以线上校验为准"
  else
    printf '%s' "$STAGE_ID" >"$STAGED_FILE"
    ok "已暂存：${STAGE_ID}（sha1=${TGZ_SHA}）"
    if [ -n "${NPM_OTP:-}" ]; then
      step "npm stage approve（2FA）"
      if ! npm_stage approve "$STAGE_ID" --otp="$NPM_OTP" >>"$LOGFILE" 2>&1; then
        tail -20 "$LOGFILE" >&2
        die "stage approve 失败。人工批准后收尾：bash scripts/release.sh --approve"
      fi
      ok "已批准上线"
    else
      cat >&2 <<EOF

    ! 包已暂存，但还没上线：批准必须 2FA，任何 token 都免不了这一步。
      stage id：${STAGE_ID}
      A) 认证器 6 位码 → NPM_OTP=123456 bash scripts/release.sh --approve
      B) 网页批准      → https://www.npmjs.com/settings/~/packages 的 Staged Packages 标签页
                         批准后 bash scripts/release.sh --approve
EOF
      die "${NAME}@${VERSION} 等待人工批准（未上线；版本号已被暂存占用，别再 bump 重发）"
    fi
  fi

  # ---------- 6. 校验线上产物 ----------
  step "校验 registry 上的产物"
  verify_registry "$TGZ_SHA" "$TGZ_INTEGRITY"

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

rm -f "$PENDING" "$STAGED_FILE"

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
