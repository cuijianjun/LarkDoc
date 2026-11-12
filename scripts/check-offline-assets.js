#!/usr/bin/env node
/**
 * 离线资产守卫。
 *
 * 目标：包在任何宿主里运行时，都不主动请求外部域名。
 * 这里检查三件事：
 *   1. 样式入口与包内样式只引用相对路径，字体文件确实随包发布；
 *   2. 源码里没有把 http(s) 地址直接交给 url()/src=/fetch/import 的地方；
 *   3. 构建产物里没有远程样式或其他 CDN 主机。
 */
const fs = require('fs')
const path = require('path')
const acorn = require('acorn') // Already used by check-legacy-syntax.js; no new dependency.

const root = path.resolve(__dirname, '..')
const failures = []
const notes = []

const BANNED_HOSTS = [
  'jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net',
  'fonts.googleapis.com', 'fonts.gstatic.com', 'ajax.googleapis.com',
  'cdn.bootcdn.net', 'lib.baomitu.com', 'at.alicdn.com', 'use.typekit.net',
  'polyfill.io', 'unpkg.zhimg.com', 'npm.elemecdn.com',
]

function fail(message) { failures.push(message) }
function note(message) { notes.push(message) }

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8')
}

function exists(file) {
  return fs.existsSync(path.join(root, file))
}

function listFiles(dir) {
  const absolute = path.join(root, dir)
  if (!fs.existsSync(absolute)) return []
  return fs.readdirSync(absolute).filter((name) => !name.startsWith('.')).map((name) => path.posix.join(dir, name))
}

function walk(dir) {
  const absolute = path.join(root, dir)
  if (!fs.existsSync(absolute)) return []
  const output = []
  fs.readdirSync(absolute, { withFileTypes: true }).forEach((entry) => {
    if (entry.name.startsWith('.')) return
    const relative = path.posix.join(dir, entry.name)
    if (entry.isDirectory()) output.push(...walk(relative))
    else output.push(relative)
  })
  return output
}

// A navigation anchor's href does not load a stylesheet. Prove its immutable
// DOM binding in the AST; minified variable names are reused across scopes, so
// a nearby createElement('a') regex is not sufficient. Unknown receivers fail.
function remoteResourceHrefCount(source) {
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true, allowHashBang: true })
  const references = []
  const rootScope = { parent: null, bindings: new Map(), function: true }
  const newScope = (parent, isFunction = false) => ({ parent, bindings: new Map(), function: isFunction })
  const functionScope = scope => scope.function ? scope : functionScope(scope.parent)
  const lookup = (scope, name) => !scope ? undefined : scope.bindings.has(name) ? scope.bindings.get(name) : lookup(scope.parent, name)
  function bind(pattern, scope, initializer = null) {
    if (!pattern) return
    if (pattern.type === 'Identifier') scope.bindings.set(pattern.name, { initializer, scope })
    else if (pattern.type === 'RestElement') bind(pattern.argument, scope)
    else if (pattern.type === 'AssignmentPattern') bind(pattern.left, scope)
    else if (pattern.type === 'ArrayPattern') pattern.elements.forEach(item => bind(item, scope))
    else if (pattern.type === 'ObjectPattern') pattern.properties.forEach(item => bind(item.type === 'RestElement' ? item.argument : item.value, scope))
  }
  function isAnchor(node, scope) {
    if (!node) return false
    if (node.type === 'Identifier') {
      const binding = lookup(scope, node.name)
      return !!binding && binding.initializer?.type === 'CallExpression' && isAnchor(binding.initializer, binding.scope)
    }
    const callee = node.type === 'CallExpression' && node.callee
    return !!callee && callee.type === 'MemberExpression' && !callee.computed
      && callee.object.type === 'Identifier' && callee.object.name === 'document' && lookup(scope, 'document') === undefined
      && callee.property.name === 'createElement' && node.arguments[0]?.type === 'Literal' && node.arguments[0].value === 'a'
  }
  function visit(node, outer) {
    if (!node || typeof node.type !== 'string') return
    const isFunction = /^(?:FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(node.type)
    if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') bind(node.id, outer)
    let scope = outer
    if (isFunction || ['BlockStatement', 'StaticBlock', 'CatchClause', 'ClassExpression', 'ClassDeclaration', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement'].includes(node.type)) scope = newScope(outer, isFunction || node.type === 'StaticBlock')
    if (isFunction) { bind(node.id, scope); node.params.forEach(param => bind(param, scope)) }
    if (node.type === 'CatchClause') bind(node.param, scope)
    if (node.type === 'ClassExpression' || node.type === 'ClassDeclaration') bind(node.id, scope)
    if (node.type === 'ImportDeclaration') node.specifiers.forEach(item => bind(item.local, scope))
    if (node.type === 'VariableDeclaration') node.declarations.forEach(item => {
      bind(item.id, node.kind === 'var' ? functionScope(scope) : scope, node.kind === 'const' && item.id.type === 'Identifier' ? item.init : null)
    })
    if (node.type === 'AssignmentExpression' && node.operator === '=' && node.left.type === 'MemberExpression') {
      const property = node.left.computed ? node.left.property.value : node.left.property.name
      if (property === 'href' && node.right.type === 'Literal' && typeof node.right.value === 'string' && /^https?:\/\//i.test(node.right.value)) references.push({ node: node.left.object, scope })
    }
    Object.values(node).forEach(value => {
      if (Array.isArray(value)) value.forEach(child => { if (child && typeof child.type === 'string') visit(child, scope) })
      else if (value && typeof value.type === 'string') visit(value, scope)
    })
  }
  visit(ast, rootScope)
  return references.filter(reference => !isAnchor(reference.node, reference.scope)).length
}

// 1. 样式入口
if (!exists('style.css')) fail('缺少公开样式入口 style.css')
else {
  const entry = read('style.css')
  const imports = entry.match(/@import\s+[^;]+;/g) || []
  imports.forEach((statement) => {
    if (/https?:\/\//.test(statement)) fail(`style.css 引入了远程样式：${statement.trim()}`)
    if (!/['"]\.?\//.test(statement)) fail(`style.css 只允许相对路径导入：${statement.trim()}`)
  })
  if (!/lark-doc\.css/.test(entry)) fail('style.css 必须引用包内 lark-doc.css')
}
// KaTeX 样式不再由 style.css 静态引入（118 KB，改由公式节点首次渲染时随 math 区块按需加载），
// 但仍必须是包内 vendored 文件、仍必须被源码引用——P0-04 拆块后引用点在 core/blocks/math.js。
{
  const source = read('src/core/blocks/math.js')
  // 阶段 4 起引用点是构建期 alias 指定符 'lark-doc/katex.css'
  // （Rollup feature target → vendored 真文件，lite target → 空 CSS）。
  if (!/(styles\/vendor\/katex\.css|lark-doc\/katex\.css)/.test(source)) {
    fail('KaTeX 样式必须由 src/core/blocks/math.js 引入（按需加载）')
  }
  const entry = read('style.css')
  if (/\/src\/styles\/vendor\/katex\.css/.test(entry)) {
    fail('style.css 不应再静态引入 KaTeX 样式，改为随 math 区块按需加载')
  }
}

const katex = 'src/styles/vendor/katex.css'
if (!exists(katex)) fail(`缺少本地 KaTeX 样式：${katex}`)
else {
  const css = read(katex)
  if (/url\(\s*['"]?(?:https?:)?\/\//i.test(css)) fail(`${katex} 仍包含远程字体地址`)
  const remoteFonts = css.match(/url\(\s*['"]?[a-z]+:\/\//gi) || []
  if (remoteFonts.length) fail(`${katex} 出现 ${remoteFonts.length} 个非相对字体地址`)
  if (!/url\(\.\/fonts\//.test(css)) fail(`${katex} 字体必须指向 ./fonts/`)
}

// 2. 字体资产
const fontFiles = listFiles('src/assets/fonts/katex')
const woff2 = fontFiles.filter((name) => name.endsWith('.woff2'))
const woff = fontFiles.filter((name) => name.endsWith('.woff'))
if (woff2.length < 19) fail(`KaTeX woff2 字体不全，当前 ${woff2.length} 个，至少需要 19 个`)
if (woff.length < 19) fail(`KaTeX woff 兜底字体不全，当前 ${woff.length} 个，至少需要 19 个`)
if (fontFiles.some((name) => name.endsWith('.ttf'))) note('检测到 ttf 字体，可考虑删除以减小包体')
note(`KaTeX 字体：${woff2.length} 个 woff2 + ${woff.length} 个 woff`)

// 3. 源码里的运行时出网点
const SOURCE_RULES = [
  { rule: /url\(\s*['"]?https?:\/\//i, label: 'CSS url() 远程资源' },
  { rule: /<script[^>]+src=['"]https?:\/\//i, label: '远程脚本' },
  { rule: /<link[^>]+href=['"]https?:\/\//i, label: '远程样式表' },
  { rule: /\bsrc\s*[:=]\s*['"]https?:\/\//i, label: '媒体地址直接写死远程域名' },
  { rule: /(?:fetch|axios(?:\.get|\.post)?)\s*\(\s*['"]https?:\/\//i, label: '运行时请求远程接口' },
  { rule: /import\s*\(\s*['"]https?:\/\//i, label: '动态导入远程模块' },
  { rule: /from\s+['"]https?:\/\//i, label: '远程模块导入' },
  { rule: /@import\s+(?:url\()?['"]?https?:\/\//i, label: '远程样式导入' },
]

walk('src').filter((file) => /\.(js|vue|css)$/.test(file)).forEach((file) => {
  const content = read(file)
  SOURCE_RULES.forEach(({ rule, label }) => {
    if (rule.test(content)) fail(`${file}：${label}`)
  })
  BANNED_HOSTS.forEach((host) => {
    if (content.indexOf(host) !== -1) fail(`${file}：出现被禁用的 CDN 主机 ${host}`)
  })
})

// 4. 构建产物
if (exists('dist')) {
  const distFiles = walk('dist')
  distFiles.filter((file) => file.endsWith('.css')).forEach((file) => {
    const css = read(file)
    if (/url\(\s*['"]?https?:\/\//i.test(css)) fail(`${file}：产物 CSS 含远程 url()`)
    BANNED_HOSTS.forEach((host) => {
      if (css.indexOf(host) !== -1) fail(`${file}：产物 CSS 引用 ${host}`)
    })
  })
  distFiles.filter((file) => file.endsWith('.js')).forEach((file) => {
    const js = read(file)
    BANNED_HOSTS.forEach((host) => {
      if (js.indexOf(host) !== -1) fail(`${file}：产物 JS 引用 ${host}`)
    })
    if (/fetch\(\s*["']https:\/\//.test(js)) fail(`${file}：产物内含远程 fetch`)
    // 阶段 4：dist 里的 https URL 大多是注释/文档链接（prosemirror.net 等，合法），
    // 真正要禁的是「运行时加载」模式 —— 命中即意味着包会在宿主页面发起外网请求。
    const RUNTIME_LOAD_RULES = [
      { rule: /import\s*\(\s*["']https?:\/\//i, label: '运行时动态导入远程模块' },
      { rule: /\.src\s*=\s*["']https?:\/\//i, label: '运行时注入远程脚本/媒体' },
    ]
    RUNTIME_LOAD_RULES.forEach(({ rule, label }) => {
      if (rule.test(js)) fail(`${file}：产物内含${label}`)
    })
    if (/(?:\.href|\[\s*["']href["']\s*\])\s*=\s*["']https?:\/\//i.test(js)) {
      try {
        if (remoteResourceHrefCount(js)) fail(`${file}：产物内含运行时注入远程样式表（非已证明的导航锚点）`)
      } catch (error) { fail(`${file}：远程 href 载入检查无法解析产物：${error.message}`) }
    }
  })
  const bundledFonts = distFiles.filter((file) => file.indexOf('fonts/') !== -1)
  if (!bundledFonts.length) fail('dist 未输出字体目录，宿主将无法离线渲染公式')
  else note(`产物字体：${bundledFonts.length} 个文件`)
} else note('未找到 dist，跳过产物检查')

// 5. 发布清单
const pkg = JSON.parse(read('package.json'))
const files = Array.isArray(pkg.files) ? pkg.files : []
if (!files.includes('style.css')) fail('package.json files 必须包含 style.css')
if (!files.includes('src')) fail('package.json files 必须包含 src（含本地字体与 vendored 样式）')

notes.forEach((message) => console.log(`  · ${message}`))
if (failures.length) {
  console.error(`\n离线资产检查失败（${failures.length} 项）：`)
  failures.forEach((message) => console.error(`  ✗ ${message}`))
  process.exit(1)
}
console.log('离线资产检查通过：样式与字体全部本地化，未发现运行时外部请求。')
