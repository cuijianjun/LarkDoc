/**
 * 特性包：代码高亮（阶段 4）。
 *
 * dist/features/highlight.js：hljs core + 主产物支持的全部语言一次性注册，
 * 宿主引入即完成 'highlight' 注册。lite 主产物的代码块从纯文本降级恢复为
 * 完整语法高亮。语言清单与 core/nodeviews/code-block.js 的 languageLoaders
 * 保持一致（javascript 已含在 core 通道，这里补全其余 7 种）。
 */
import { registerFeature } from '../core/features/registry'
import hljs from 'highlight.js/lib/core.js'
import javascript from 'highlight.js/lib/languages/javascript.js'
import typescript from 'highlight.js/lib/languages/typescript.js'
import json from 'highlight.js/lib/languages/json.js'
import css from 'highlight.js/lib/languages/css.js'
import xml from 'highlight.js/lib/languages/xml.js'
import python from 'highlight.js/lib/languages/python.js'
import bash from 'highlight.js/lib/languages/bash.js'
import sql from 'highlight.js/lib/languages/sql.js'

const LANGUAGES = { javascript, typescript, json, css, xml, python, bash, sql }
Object.keys(LANGUAGES).forEach((name) => {
  hljs.registerLanguage(name, LANGUAGES[name])
})

registerFeature('highlight', () => Promise.resolve(hljs))
