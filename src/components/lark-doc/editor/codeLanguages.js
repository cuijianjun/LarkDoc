/**
 * 代码语言清单（requirements/04 §2.2 ⑤，71 项**严格按此顺序**）。
 *
 * 三条必须守住的口径（改这个文件前先看）：
 *
 *   1. **顺序照抄，不要 `localeCompare` 重排**。清单是「字母序为主 + 几处刻意插位」：
 *      `C# → C++ → C`（不是 C → C# → C++）、`Go → GraphQL → Groovy → HTML → HTMLBars →
 *      HTTP → Haskell`、`SQL → Scala → Scheme → Shell`。这三处是飞书的历史排序，
 *      一按 locale 重排就和真机不一致。
 *   2. **`id` 是落库值，不是显示名**。§2.2 ⑥ 写「飞书存的是显示名」，但本库
 *      `core/blocks/code-block.js:11` 的 `renderHTML` 只放行 `/^[\w+-]{0,32}$/`
 *      （`C#` / `Plain Text` 会被兜成 `plaintext`），`utils/export/markdown.js:434`
 *      又把 `attrs.language` 直接写进 fence info —— 存显示名会让 `C#` 的代码块
 *      round-trip 后丢失语言、且导出成 ``` ```C# ``` 这种非法 fence。
 *      ⇒ 这里保留**内部存 id、界面显示显示名**的双轨，`CODE_LANGUAGE_LABELS` 只负责 UI。
 *   3. **`grammar` 为 `null` 表示本机 highlight.js 没有这门语法**（当前 11.x 依赖缺
 *      abap / apex / cobol / graphql / solidity / toml 六个文件）。它仍然可选、可落库，
 *      只是不高亮 —— 与「列了却选不动」是两回事，缺语法不该让选项消失。
 *
 * `html` / `shell` 走 highlight.js 的**别名**（`xml` / `bash`），加载器只需注册
 * 规范名，`getLanguage('html')` 会自动解析（hljs 11 alias 表）。
 */

/** @typedef {{id: string, label: string, grammar: string|null}} CodeLanguage */

/** 71 项，顺序与 04 §2.2 ⑤ 逐字一致。 */
export const CODE_LANGUAGES = Object.freeze([
  { id: 'plaintext', label: 'Plain Text', grammar: null },
  { id: 'abap', label: 'ABAP', grammar: null },
  { id: 'ada', label: 'Ada', grammar: 'ada' },
  { id: 'apache', label: 'Apache', grammar: 'apache' },
  { id: 'apex', label: 'Apex', grammar: null },
  { id: 'x86asm', label: 'Assembly language', grammar: 'x86asm' },
  { id: 'bash', label: 'Bash', grammar: 'bash' },
  { id: 'csharp', label: 'C#', grammar: 'csharp' },
  { id: 'cpp', label: 'C++', grammar: 'cpp' },
  { id: 'c', label: 'C', grammar: 'c' },
  { id: 'cmake', label: 'CMake', grammar: 'cmake' },
  { id: 'cobol', label: 'COBOL', grammar: null },
  { id: 'css', label: 'CSS', grammar: 'css' },
  { id: 'coffeescript', label: 'CoffeeScript', grammar: 'coffeescript' },
  { id: 'd', label: 'D', grammar: 'd' },
  { id: 'dart', label: 'Dart', grammar: 'dart' },
  { id: 'delphi', label: 'Delphi', grammar: 'delphi' },
  { id: 'diff', label: 'Diff', grammar: 'diff' },
  { id: 'django', label: 'Django', grammar: 'django' },
  { id: 'dockerfile', label: 'Dockerfile', grammar: 'dockerfile' },
  { id: 'erlang', label: 'Erlang', grammar: 'erlang' },
  { id: 'fortran', label: 'Fortran', grammar: 'fortran' },
  { id: 'gherkin', label: 'Gherkin', grammar: 'gherkin' },
  { id: 'go', label: 'Go', grammar: 'go' },
  { id: 'graphql', label: 'GraphQL', grammar: null },
  { id: 'groovy', label: 'Groovy', grammar: 'groovy' },
  { id: 'html', label: 'HTML', grammar: 'xml' },
  { id: 'htmlbars', label: 'HTMLBars', grammar: 'htmlbars' },
  { id: 'http', label: 'HTTP', grammar: 'http' },
  { id: 'haskell', label: 'Haskell', grammar: 'haskell' },
  { id: 'json', label: 'JSON', grammar: 'json' },
  { id: 'java', label: 'Java', grammar: 'java' },
  { id: 'javascript', label: 'JavaScript', grammar: 'javascript' },
  { id: 'julia', label: 'Julia', grammar: 'julia' },
  { id: 'kotlin', label: 'Kotlin', grammar: 'kotlin' },
  { id: 'latex', label: 'LaTeX', grammar: 'latex' },
  { id: 'lisp', label: 'Lisp', grammar: 'lisp' },
  { id: 'lua', label: 'Lua', grammar: 'lua' },
  { id: 'matlab', label: 'MATLAB', grammar: 'matlab' },
  { id: 'makefile', label: 'Makefile', grammar: 'makefile' },
  { id: 'markdown', label: 'Markdown', grammar: 'markdown' },
  { id: 'nginx', label: 'Nginx', grammar: 'nginx' },
  { id: 'objectivec', label: 'Objective-C', grammar: 'objectivec' },
  { id: 'glsl', label: 'OpenGL Shading Language', grammar: 'glsl' },
  { id: 'php', label: 'PHP', grammar: 'php' },
  { id: 'perl', label: 'Perl', grammar: 'perl' },
  { id: 'powershell', label: 'PowerShell', grammar: 'powershell' },
  { id: 'prolog', label: 'Prolog', grammar: 'prolog' },
  { id: 'properties', label: 'Properties', grammar: 'properties' },
  { id: 'protobuf', label: 'ProtoBuf', grammar: 'protobuf' },
  { id: 'python', label: 'Python', grammar: 'python' },
  { id: 'r', label: 'R', grammar: 'r' },
  { id: 'ruby', label: 'Ruby', grammar: 'ruby' },
  { id: 'rust', label: 'Rust', grammar: 'rust' },
  { id: 'sas', label: 'SAS', grammar: 'sas' },
  { id: 'scss', label: 'SCSS', grammar: 'scss' },
  { id: 'sql', label: 'SQL', grammar: 'sql' },
  { id: 'scala', label: 'Scala', grammar: 'scala' },
  { id: 'scheme', label: 'Scheme', grammar: 'scheme' },
  { id: 'shell', label: 'Shell', grammar: 'bash' },
  { id: 'solidity', label: 'Solidity', grammar: null },
  { id: 'swift', label: 'Swift', grammar: 'swift' },
  { id: 'toml', label: 'TOML', grammar: null },
  { id: 'thrift', label: 'Thrift', grammar: 'thrift' },
  { id: 'typescript', label: 'TypeScript', grammar: 'typescript' },
  { id: 'vbscript', label: 'VBScript', grammar: 'vbscript' },
  { id: 'vhdl', label: 'VHDL', grammar: 'vhdl' },
  { id: 'verilog', label: 'Verilog', grammar: 'verilog' },
  { id: 'vbnet', label: 'Visual Basic', grammar: 'vbnet' },
  { id: 'xml', label: 'XML', grammar: 'xml' },
  { id: 'yaml', label: 'YAML', grammar: 'yaml' },
])

/** id → 项，供 O(1) 反查（热路径：每个代码块渲染都要取一次显示名）。 */
export const CODE_LANGUAGE_BY_ID = Object.freeze(CODE_LANGUAGES.reduce((map, item) => {
  map[item.id] = item
  return map
}, Object.create(null)))

/** 浮层尺寸（§2.2 ④ 实测 219×317；旧记 219×771 是错值已作废）。 */
export const CODE_LANG_PICKER_SIZE = Object.freeze({ width: 219, height: 317 })
/** 定位口径（§2.2 ③）：左缘对齐按钮左缘、**顶 = 按钮底 + 3**。 */
export const CODE_LANG_PICKER_TOP_OFFSET = 3

/**
 * 「Mermaid 图表」——**图表块的入口，不是 71 项语言之一**（§2.2 ⑤ 那张表里没有它）。
 *
 * 为什么不并进 `CODE_LANGUAGES`：那张表是 04 §2.2 ⑤ 的逐字快照，多一项就与真机不一致
 * （`test/unit/code-lang-ui.test.js` 直接断言 `toHaveLength(71)`）。但把 mermaid 从下拉里
 * 拿掉等于砍掉「代码块 → 图表块」这条既有路径（`docs/blocks/code-block.md`：
 * `features.diagram` 关闭后语言下拉不再提供 Mermaid 图表），所以按开关**动态追加** ——
 * 开着 72 项、关掉回到 71 项，与 `scripts/check-vditor-html.js` 的两条断言同一口径。
 */
export const MERMAID_CODE_LANGUAGE = Object.freeze({ id: 'mermaid', label: 'Mermaid 图表', grammar: null })

/**
 * 下拉实际渲染的清单：71 项语言 +（图表开启时）Mermaid 图表。
 *
 * @param {{diagram?: boolean}} [options]
 * @returns {ReadonlyArray<CodeLanguage>}
 */
export function codeLanguageEntries(options) {
  const diagram = !options || options.diagram !== false
  return diagram ? CODE_LANGUAGES.concat([MERMAID_CODE_LANGUAGE]) : CODE_LANGUAGES
}

/** id → 显示名；未知 id 原样返回（历史文档里可能有自定义值）。 */
export function codeLanguageLabel(id) {
  if (id === MERMAID_CODE_LANGUAGE.id) return MERMAID_CODE_LANGUAGE.label
  const hit = CODE_LANGUAGE_BY_ID[id]
  return hit ? hit.label : id
}

/** 显示名 → id；未命中返回 `null`（调用方决定兜底）。 */
export function codeLanguageId(label) {
  if (label === MERMAID_CODE_LANGUAGE.label) return MERMAID_CODE_LANGUAGE.id
  const hit = CODE_LANGUAGES.filter((item) => item.label === label)[0]
  return hit ? hit.id : null
}

/**
 * 搜索过滤（§2.2 ③）：**子串匹配、大小写不敏感、保持原始顺序**。
 *
 * 三个刻意的选择：
 *   - 不按「匹配度」重排 —— 重排会让「Python」在输入 `p` 时跳位，与真机不一致；
 *   - 不 trim 中间空格 —— 输入 `c ` 就该只命中含空格的项；
 *   - 空串直接返回全量（不返回空数组），「无结果」的表现是**列表区空、无空态文案**。
 *
 * @param {string} query
 * @param {ReadonlyArray<CodeLanguage>} [list]
 * @returns {ReadonlyArray<CodeLanguage>}
 */
export function filterCodeLanguages(query, list = CODE_LANGUAGES) {
  const text = String(query || '')
  if (!text) return list
  const needle = text.toLowerCase()
  return list.filter((item) => item.label.toLowerCase().indexOf(needle) !== -1)
}

/**
 * 浮层定位纯函数。
 *
 * 左缘对齐锚点左缘（实测按钮 x=1148 → 浮层 x=1148，**没有** -1px 偏移；§2.2 ③ 的
 * 「-1px」是圆角/边框造成的读数误差，按 0 处理才对得齐）。上下放不下时翻到按钮上方，
 * 左右夹 8px 保证窄屏开得出来。
 */
export function codeLangPickerStyle(anchorRect, size = CODE_LANG_PICKER_SIZE, viewport = {}) {
  if (!anchorRect) return { left: 0, top: 0 }
  const width = size.width || CODE_LANG_PICKER_SIZE.width
  const height = size.height || CODE_LANG_PICKER_SIZE.height
  const left = Math.min(Math.max(anchorRect.left || 0, 8), Math.max(8, (viewport.width || 0) - width - 8))
  let top = (anchorRect.bottom || 0) + CODE_LANG_PICKER_TOP_OFFSET
  if ((viewport.height || 0) > 0 && top + height > (viewport.height || 0) - 8) {
    top = Math.max(8, (anchorRect.top || 0) - height - CODE_LANG_PICKER_TOP_OFFSET)
  }
  return { left, top: Math.max(8, top) }
}
