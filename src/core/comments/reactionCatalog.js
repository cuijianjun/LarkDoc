/**
 * 评论表情目录（188 项离线 PNG 雪碧图）按需加载。
 *
 * 目录近 1MB，不进主包：第一次打开选择器时才动态 import，失败后允许重试。
 */
let promise = null

export const loadReactionCatalog = () => promise || (promise = import('./reaction-catalog.json')
  .then(module => typeof module.default === 'function' ? module.default() : module.default || module)
  .catch((error) => { promise = null; throw error }))
