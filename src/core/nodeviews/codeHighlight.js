/**
 * 代码块的高亮层：highlight.js 与语法包全部懒加载，代码块不进首屏主包。
 *
 * 两条保留策略都是踩出来的：
 * 1. 分块没取到（离线包漏拷 chunk / CDN 404）时**不缓存失败结果**，下次渲染重试，
 *    宿主补上文件后无需刷新页面就能恢复高亮；
 * 2. 单门语言加载失败只降级本次渲染（`delete languagePromises[language]`），
 *    下次正文更新仍会再试。
 */
import { loadFeature } from '../features/registry'
import { languageLoaders, normalizeCodeLanguage } from './code-languages'

/* ---------- highlight.js 懒加载：代码块不在首屏，语法包不进主包 ---------- */
/* 阶段 4：接入特性注册表 —— 宿主加载 lark-doc/features/highlight.js（注册好
   全部语言的 hljs 实例）时优先用注册实例；否则走内置通道（core + javascript，
   其余语言再按需补）。 */
let hljs = null
let highlighterPromise
export function loadHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = loadFeature('highlight', () =>
      Promise.all([
        import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/core.js'),
        import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/javascript.js'),
      ]).then(([coreModule, javascriptModule]) => {
        const core = coreModule.default || coreModule
        core.registerLanguage('javascript', javascriptModule.default || javascriptModule)
        return core
      }),
    ).then((highlighter) => {
      hljs = highlighter
      return highlighter
    }).catch(() => {
      // 分块没取到（离线包漏拷 chunk、CDN 404）时**不要把失败结果缓存一辈子**：
      // 下次渲染重新试一次，宿主补上文件后无需刷新页面就能恢复高亮。
      highlighterPromise = null
      return null
    })
  }
  return highlighterPromise
}

const languagePromises = Object.create(null)
export function ensureLanguage(name) {
  const language = normalizeCodeLanguage(name)
  if (hljs && hljs.getLanguage(language)) return Promise.resolve(true)
  if (!languageLoaders[language] && language !== 'javascript') return Promise.resolve(false)
  if (!languagePromises[language]) {
    languagePromises[language] = loadHighlighter().then((highlighter) => {
      if (!highlighter) return false
      if (highlighter.getLanguage(language)) return true
      return languageLoaders[language]().then((module) => {
        highlighter.registerLanguage(language, module.default || module)
        return true
      })
    }).catch(() => false).then((loaded) => {
      // 失败只降级本次渲染；下次正文更新仍可加载同一语言。
      if (!loaded) delete languagePromises[language]
      return loaded
    })
  }
  return languagePromises[language]
}

export function escapeHTML(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
export function renderHighlighted(text, language, syntaxHighlight = true) {
  const normalized = normalizeCodeLanguage(language)
  if (!syntaxHighlight || normalized === 'plaintext' || !hljs || !hljs.getLanguage(normalized)) return escapeHTML(text)
  return hljs.highlight(text, { language: normalized, ignoreIllegals: true }).value
}

/** 判「这门语言的语法包已经在手上了」：closure 里原来直接读 `hljs`，现在走这个判定。 */
export function hasLanguage(language) {
  return !!(hljs && hljs.getLanguage(language))
}

