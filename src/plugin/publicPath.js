const NETWORK_PATH_PATTERN = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i

/**
 * 规范化插件资源基址。
 *
 * 资源必须由宿主本地提供，因此不接受 URL、协议相对地址或其它 URI scheme。
 * 未配置时保留 undefined，让各适配器使用自己的默认 public path。
 */
export function normalizeBasePath(basePath) {
  if (basePath === undefined) return undefined
  if (typeof basePath !== 'string') {
    throw new TypeError('[lark-doc] basePath 必须是字符串或 undefined')
  }

  const value = basePath.trim()
  if (!value) return '/'
  if (NETWORK_PATH_PATTERN.test(value)) {
    throw new Error('[lark-doc] basePath 必须是本地路径，禁止使用网络或 CDN 地址')
  }

  return value.endsWith('/') ? value : `${value}/`
}

export const normalizePublicPath = normalizeBasePath
