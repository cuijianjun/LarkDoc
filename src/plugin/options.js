import { normalizeBasePath } from './publicPath'

export const DEFAULT_PLUGIN_OPTIONS = Object.freeze({
  features: 'auto',
  basePath: undefined,
  fonts: true,
  injectStyles: false,
  copyAs: 'build',
})

const COPY_AS_VALUES = ['build', 'none']

function normalizeFeatures(features) {
  if (features === undefined || features === 'auto') return 'auto'
  if (!Array.isArray(features)) {
    throw new TypeError('[lark-doc] features 必须是 "auto" 或字符串数组')
  }
  if (features.some((feature) => typeof feature !== 'string' || !feature)) {
    throw new TypeError('[lark-doc] features 数组只能包含非空字符串')
  }
  return features.slice()
}

function normalizeBoolean(value, name) {
  if (typeof value !== 'boolean') {
    throw new TypeError(`[lark-doc] ${name} 必须是布尔值`)
  }
  return value
}

export function normalizePluginOptions(options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('[lark-doc] 插件选项必须是对象')
  }

  const normalized = {
    features: normalizeFeatures(options.features),
    basePath: normalizeBasePath(options.basePath),
    fonts: options.fonts === undefined ? DEFAULT_PLUGIN_OPTIONS.fonts : normalizeBoolean(options.fonts, 'fonts'),
    injectStyles: options.injectStyles === undefined
      ? DEFAULT_PLUGIN_OPTIONS.injectStyles
      : normalizeBoolean(options.injectStyles, 'injectStyles'),
    copyAs: options.copyAs === undefined ? DEFAULT_PLUGIN_OPTIONS.copyAs : options.copyAs,
  }

  if (!COPY_AS_VALUES.includes(normalized.copyAs)) {
    throw new TypeError('[lark-doc] copyAs 必须是 "build" 或 "none"')
  }

  return normalized
}

export const resolvePluginOptions = normalizePluginOptions
