import fs from 'fs'
import path from 'path'

const ELEMENT_ASSET_RE = /^lark-doc-element\.umd\.min(?:\.([^.]+))?\.js$/
const FEATURE_ASSET_RE = /^lark-doc-element\.umd\.min\.([^.]+)\.js$/

function assertDirectory(dir, label) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`[lark-doc] 找不到 ${label} 目录：${dir}`)
  }
}

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name)
    return entry.isDirectory() ? listFiles(file) : [file]
  }).sort()
}

function normalizeAssetOptions(input, maybeOptions) {
  if (typeof input === 'string') return { distDir: input, ...(maybeOptions || {}) }
  return input || {}
}

/**
 * 动态发现发布包里的字体和 element 按需区块。
 * `features: 'auto'` 收集 dist 中当前实际存在的所有区块；数组只选择指定后缀。
 */
export function discoverAssets(input, maybeOptions) {
  const options = normalizeAssetOptions(input, maybeOptions)
  const distDir = options.distDir
  if (typeof distDir !== 'string' || !distDir) {
    throw new TypeError('[lark-doc] discoverAssets 需要有效的 distDir')
  }
  assertDirectory(distDir, 'dist')

  const features = options.features === undefined ? 'auto' : options.features
  if (features !== 'auto' && (!Array.isArray(features) || features.some((feature) => typeof feature !== 'string' || !feature))) {
    throw new TypeError('[lark-doc] discoverAssets 的 features 必须是 "auto" 或字符串数组')
  }

  const fontsDir = path.join(distDir, 'fonts')
  const fonts = options.fonts === false ? [] : (() => {
    assertDirectory(fontsDir, 'dist/fonts')
    return listFiles(fontsDir)
  })()

  const elementFiles = fs.readdirSync(distDir)
    .filter((name) => ELEMENT_ASSET_RE.test(name))
    .map((name) => path.join(distDir, name))
    .sort()
  const main = elementFiles.find((file) => path.basename(file) === 'lark-doc-element.umd.min.js')
  if (!main) {
    throw new Error(`[lark-doc] 找不到 element 主产物：${path.join(distDir, 'lark-doc-element.umd.min.js')}`)
  }

  const chunks = elementFiles.filter((file) => {
    const match = path.basename(file).match(FEATURE_ASSET_RE)
    return !match || features === 'auto' || features.includes(match[1])
  })

  if (Array.isArray(features)) {
    const missing = features.filter((feature) => !chunks.some((file) => path.basename(file) === `lark-doc-element.umd.min.${feature}.js`))
    if (missing.length) {
      throw new Error(`[lark-doc] 未找到指定特性资源：${missing.join(', ')}；请确认 dist 中存在对应 element 区块`)
    }
  }

  return { fonts, chunks, files: [...fonts, ...chunks] }
}

/** 将发现的资源转成构建期复制条目；copyAs=none 明确返回空数组。 */
export function getAssetEntries(input, maybeOptions) {
  const options = normalizeAssetOptions(input, maybeOptions)
  if (options.copyAs === 'none') return []
  const assets = options.assets || discoverAssets(options)
  const outputDir = options.outputDir
  if (typeof outputDir !== 'string' || !outputDir) {
    throw new TypeError('[lark-doc] getAssetEntries 需要有效的 outputDir')
  }
  const entries = []
  for (const source of assets.fonts) {
    entries.push({ from: source, to: path.join(outputDir, 'fonts', path.basename(source)) })
  }
  for (const source of assets.chunks) {
    entries.push({ from: source, to: path.join(outputDir, path.basename(source)) })
  }
  return entries
}

/** 执行资源复制；copyAs=none 不触碰文件系统。 */
export function copyAssets(input, maybeOptions) {
  const options = normalizeAssetOptions(input, maybeOptions)
  const entries = getAssetEntries(options)
  for (const entry of entries) {
    fs.mkdirSync(path.dirname(entry.to), { recursive: true })
    fs.copyFileSync(entry.from, entry.to)
  }
  return entries.map((entry) => entry.to)
}

export const findAssets = discoverAssets
