import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizePluginOptions } from './options'
import { discoverAssets } from './assets'

const PLUGIN_NAME = 'lark-doc-assets'
const MODULE_DIR = typeof __dirname === 'string'
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(MODULE_DIR, path.basename(MODULE_DIR) === 'plugin' ? '../..' : '..')
const DIST_DIR = path.join(PACKAGE_ROOT, 'dist')

function resolveOptions(options) {
  return normalizePluginOptions(options)
}

function resolveAssets(options) {
  return discoverAssets({
    distDir: DIST_DIR,
    features: options.features,
    fonts: options.fonts,
  })
}

function assetFileName(source) {
  return source.includes(`${path.sep}fonts${path.sep}`)
    ? path.join('fonts', path.basename(source))
    : path.basename(source)
}

function assetEntries(options) {
  if (options.copyAs === 'none') return []
  return resolveAssets(options).files.map((source) => ({
    source,
    fileName: assetFileName(source),
  }))
}

function readAssetEntries(options) {
  if (options.copyAs === 'none') return []
  const entries = assetEntries(options).map((entry) => ({
    ...entry,
    source: fs.readFileSync(entry.source),
  }))
  if (options.injectStyles) {
    entries.push({
      source: path.join(PACKAGE_ROOT, 'style.css'),
      fileName: 'lark-doc.css',
    })
    entries[entries.length - 1].source = fs.readFileSync(entries[entries.length - 1].source)
  }
  return entries
}

function applyWebpackOutput(options, compiler) {
  if (options.basePath === undefined) return
  compiler.options.output = compiler.options.output || {}
  compiler.options.output.publicPath = options.basePath
}

function emitWebpackAssets(options, compilation) {
  for (const entry of readAssetEntries(options)) {
    if (compilation.hooks.processAssets) {
      const RawSource = compilation.compiler.webpack?.sources?.RawSource
      if (!RawSource) throw new Error('[lark-doc] webpack 缺少 RawSource，无法复制资源')
      compilation.emitAsset(entry.fileName, new RawSource(entry.source))
    } else {
      compilation.assets[entry.fileName] = {
        source: () => entry.source,
        size: () => entry.source.length,
      }
    }
  }
}

class LarkDocWebpackPlugin {
  constructor(options = {}) {
    this.options = resolveOptions(options)
  }

  apply(compiler) {
    applyWebpackOutput(this.options, compiler)
    const emit = (compilation, callback) => {
      try {
        emitWebpackAssets(this.options, compilation)
        callback()
      } catch (error) {
        callback(error)
      }
    }

    if (compiler.hooks.thisCompilation) {
      compiler.hooks.thisCompilation.tap(PLUGIN_NAME, (compilation) => {
        if (!compilation.hooks.processAssets) return
        const stage = compiler.webpack?.Compilation?.PROCESS_ASSETS_STAGE_ADDITIONAL || 100
        compilation.hooks.processAssets.tap({ name: PLUGIN_NAME, stage }, () => {
          emitWebpackAssets(this.options, compilation)
        })
      })
    }
    if (compiler.hooks.emit) {
      compiler.hooks.emit.tapAsync(PLUGIN_NAME, (compilation, callback) => {
        if (compilation.hooks.processAssets) return callback()
        emit(compilation, callback)
      })
    }
  }
}

function createBundlerPlugin(options = {}) {
  const resolved = resolveOptions(options)
  let config

  return {
    name: PLUGIN_NAME,
    apply: 'build',
    configResolved(value) {
      config = value
    },
    config() {
      if (resolved.basePath === undefined) return undefined
      return { base: resolved.basePath }
    },
    configureServer(server) {
      const prefix = resolved.basePath || config?.base || '/'
      const route = prefix.endsWith('/') ? prefix : `${prefix}/`
      return () => {
        server.middlewares.use((request, response, next) => {
          if (!request.url || !request.url.startsWith(route)) return next()
          const relativeName = request.url.slice(route.length).split('?')[0]
          const file = path.resolve(DIST_DIR, relativeName)
          if (!file.startsWith(`${DIST_DIR}${path.sep}`) || !fs.existsSync(file)) return next()
          response.setHeader('Cache-Control', 'no-cache')
          fs.createReadStream(file).pipe(response)
        })
      }
    },
    generateBundle(outputOptions) {
      if (resolved.copyAs === 'none') return
      for (const entry of readAssetEntries(resolved)) {
        this.emitFile({ type: 'asset', fileName: entry.fileName, source: entry.source })
      }
      void outputOptions
    },
  }
}

export function larkDoc(options = {}) {
  return createBundlerPlugin(options)
}

larkDoc.vite = larkDoc
larkDoc.rollup = larkDoc
larkDoc.webpack = (options = {}) => new LarkDocWebpackPlugin(options)
larkDoc.rspack = larkDoc.webpack
larkDoc.raw = LarkDocWebpackPlugin

export const vite = larkDoc.vite
export const rollup = larkDoc.rollup
export const webpack = larkDoc.webpack
export const rspack = larkDoc.rspack
export const raw = larkDoc.raw
export { LarkDocWebpackPlugin }
export default larkDoc
