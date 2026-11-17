/**
 * 特性包：代码高亮（阶段 4）。
 *
 * dist/features/highlight.js：hljs core + 主产物支持的全部语言一次性注册，
 * 宿主引入即完成 'highlight' 注册。lite 主产物的代码块从纯文本降级恢复为
 * 完整语法高亮。八种常用语法继续同步注册；其余定义通过 highlight.languages
 * 服务按需提供，不进入主产物的初始图。
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

// Keep all literal import edges inside this optional feature (including supplemental grammars).
const LANGUAGE_LOADERS = {
  abap: () => import(/* webpackChunkName: "highlight" */ '../core/nodeviews/code-language-grammars.js').then(module => module.abapLanguage),
  ada: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/ada.js'),
  apache: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/apache.js'),
  apex: () => import(/* webpackChunkName: "highlight" */ '../core/nodeviews/code-language-grammars.js').then(module => module.apexLanguage),
  armasm: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/armasm.js'),
  bash: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/bash.js'),
  csharp: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/csharp.js'),
  cpp: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/cpp.js'),
  cmake: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/cmake.js'),
  cobol: () => import(/* webpackChunkName: "highlight" */ '../core/nodeviews/code-language-grammars.js').then(module => module.cobolLanguage),
  css: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/css.js'),
  coffeescript: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/coffeescript.js'),
  d: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/d.js'),
  dart: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/dart.js'),
  delphi: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/delphi.js'),
  diff: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/diff.js'),
  django: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/django.js'),
  dockerfile: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/dockerfile.js'),
  erlang: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/erlang.js'),
  fortran: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/fortran.js'),
  gherkin: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/gherkin.js'),
  go: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/go.js'),
  graphql: () => import(/* webpackChunkName: "highlight" */ '../core/nodeviews/code-language-grammars.js').then(module => module.graphqlLanguage),
  groovy: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/groovy.js'),
  handlebars: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/handlebars.js'),
  http: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/http.js'),
  haskell: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/haskell.js'),
  json: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/json.js'),
  java: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/java.js'),
  julia: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/julia.js'),
  kotlin: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/kotlin.js'),
  latex: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/latex.js'),
  lisp: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/lisp.js'),
  lua: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/lua.js'),
  matlab: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/matlab.js'),
  makefile: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/makefile.js'),
  markdown: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/markdown.js'),
  nginx: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/nginx.js'),
  objectivec: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/objectivec.js'),
  glsl: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/glsl.js'),
  php: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/php.js'),
  perl: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/perl.js'),
  powershell: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/powershell.js'),
  prolog: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/prolog.js'),
  properties: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/properties.js'),
  protobuf: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/protobuf.js'),
  python: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/python.js'),
  r: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/r.js'),
  ruby: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/ruby.js'),
  rust: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/rust.js'),
  sas: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/sas.js'),
  scss: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/scss.js'),
  sql: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/sql.js'),
  scala: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/scala.js'),
  scheme: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/scheme.js'),
  shell: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/shell.js'),
  solidity: () => import(/* webpackChunkName: "highlight" */ '../core/nodeviews/code-language-grammars.js').then(module => module.solidityLanguage),
  swift: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/swift.js'),
  ini: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/ini.js'),
  thrift: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/thrift.js'),
  typescript: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/typescript.js'),
  vbscript: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/vbscript.js'),
  vhdl: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/vhdl.js'),
  verilog: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/verilog.js'),
  vbnet: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/vbnet.js'),
  xml: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/xml.js'),
  yaml: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/yaml.js'),
}
const pendingLanguages = Object.create(null)

export function loadLanguage(name) {
  if (!Object.prototype.hasOwnProperty.call(LANGUAGE_LOADERS, name) && !Object.prototype.hasOwnProperty.call(LANGUAGES, name)) return Promise.reject(new Error(`不支持的代码语言：${name}`))
  if (!pendingLanguages[name]) {
    pendingLanguages[name] = (LANGUAGES[name] ? Promise.resolve(LANGUAGES[name]) : Promise.resolve().then(LANGUAGE_LOADERS[name]))
      .catch(error => { delete pendingLanguages[name]; throw error })
  }
  return pendingLanguages[name]
}

registerFeature('highlight.languages', () => ({ loadLanguage }))
