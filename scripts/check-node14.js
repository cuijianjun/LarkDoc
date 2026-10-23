'use strict'

// 最低版本门禁：构建/校验链只需 Node >= 14.21.3、npm >= 8.19.4。
// 产物语法等级由 browserslist 决定、与构建机 Node 版本无关，ES2022+ 运行时 API
// 已由入口 core-js polyfill 补齐，因此 Node 20 等更高版本构建/接入均合法。
// 这里仅兜底「版本太低」的情况，不再锁死精确版本。

const MIN_NODE_MAJOR = 14
const MIN_NODE_MINOR = 21
const MIN_NODE_PATCH = 3
const MIN_NPM_MAJOR = 8
const MIN_NPM_MINOR = 19
const MIN_NPM_PATCH = 4

const nodeVer = process.version.replace(/^v/, '').split('.').map((n) => parseInt(n, 10))
const [nMajor, nMinor, nPatch] = nodeVer

const nodeTooLow =
  nMajor < MIN_NODE_MAJOR ||
  (nMajor === MIN_NODE_MAJOR && nMinor < MIN_NODE_MINOR) ||
  (nMajor === MIN_NODE_MAJOR && nMinor === MIN_NODE_MINOR && nPatch < MIN_NODE_PATCH)

if (nodeTooLow) {
  console.error(
    `需要 Node >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}.${MIN_NODE_PATCH}，当前为 ${process.version}`
  )
  process.exit(1)
}

const npmMatch = process.env.npm_config_user_agent && process.env.npm_config_user_agent.match(/npm\/([^\s]+)/)

if (npmMatch) {
  const npmVer = npmMatch[1].split('.').map((n) => parseInt(n, 10))
  const [mMajor, mMinor, mPatch] = npmVer

  const npmTooLow =
    isNaN(mMajor) ||
    mMajor < MIN_NPM_MAJOR ||
    (mMajor === MIN_NPM_MAJOR && mMinor < MIN_NPM_MINOR) ||
    (mMajor === MIN_NPM_MAJOR && mMinor === MIN_NPM_MINOR && mPatch < MIN_NPM_PATCH)

  if (npmTooLow) {
    console.error(
      `需要 npm >= ${MIN_NPM_MAJOR}.${MIN_NPM_MINOR}.${MIN_NPM_PATCH}，当前 user-agent 为 ${process.env.npm_config_user_agent}`
    )
    process.exit(1)
  }

  console.log(`runtime ok: Node ${process.version}, npm ${npmMatch[1]}`)
} else {
  // 直接 `node` 运行（非 npm 触发）时无 npm_config_user_agent，跳过 npm 校验。
  console.log(`runtime ok: Node ${process.version}`)
}
