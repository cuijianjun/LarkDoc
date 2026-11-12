/** Feishu language picker order and literal, case-insensitive subsequence search. */
export const CODE_BLOCK_LANGUAGES = Object.freeze([
  ['plaintext', 'Plain Text'], ['abap', 'ABAP'], ['ada', 'Ada'], ['apache', 'Apache'],
  ['apex', 'Apex'], ['armasm', 'Assembly language'], ['bash', 'Bash'], ['csharp', 'C#'],
  ['cpp', 'C++'], ['c', 'C'], ['cmake', 'CMake'], ['cobol', 'COBOL'], ['css', 'CSS'],
  ['coffeescript', 'CoffeeScript'], ['d', 'D'], ['dart', 'Dart'], ['delphi', 'Delphi'],
  ['diff', 'Diff'], ['django', 'Django'], ['dockerfile', 'Dockerfile'], ['erlang', 'Erlang'],
  ['fortran', 'Fortran'], ['gherkin', 'Gherkin'], ['go', 'Go'], ['graphql', 'GraphQL'],
  ['groovy', 'Groovy'], ['html', 'HTML'], ['handlebars', 'HTMLBars'], ['http', 'HTTP'],
  ['haskell', 'Haskell'], ['json', 'JSON'], ['java', 'Java'], ['javascript', 'JavaScript'],
  ['julia', 'Julia'], ['kotlin', 'Kotlin'], ['latex', 'LaTeX'], ['lisp', 'Lisp'], ['lua', 'Lua'],
  ['matlab', 'MATLAB'], ['makefile', 'Makefile'], ['markdown', 'Markdown'], ['nginx', 'Nginx'],
  ['objectivec', 'Objective-C'], ['glsl', 'OpenGL Shading Language'], ['php', 'PHP'],
  ['perl', 'Perl'], ['powershell', 'PowerShell'], ['prolog', 'Prolog'], ['properties', 'Properties'],
  ['protobuf', 'ProtoBuf'], ['python', 'Python'], ['r', 'R'], ['ruby', 'Ruby'], ['rust', 'Rust'],
  ['sas', 'SAS'], ['scss', 'SCSS'], ['sql', 'SQL'], ['scala', 'Scala'], ['scheme', 'Scheme'],
  ['shell', 'Shell'], ['solidity', 'Solidity'], ['swift', 'Swift'], ['toml', 'TOML'],
  ['thrift', 'Thrift'], ['typescript', 'TypeScript'], ['vbscript', 'VBScript'], ['vhdl', 'VHDL'],
  ['verilog', 'Verilog'], ['vbnet', 'Visual Basic'], ['xml', 'XML'], ['yaml', 'YAML'],
].map(([value, label]) => Object.freeze({ value, label })))

export function codeBlockLanguageOptions() { return CODE_BLOCK_LANGUAGES.slice() }

export function filterCodeBlockLanguages(query = '') {
  const needle = String(query).toLowerCase()
  return CODE_BLOCK_LANGUAGES.filter(({ label }) => {
    const source = label.toLowerCase()
    let cursor = 0
    for (const character of needle) {
      const index = source.indexOf(character, cursor)
      if (index < 0) return false
      cursor = index + 1
    }
    return true
  })
}

const LANGUAGE_ALIASES = Object.freeze({
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', node: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', shellscript: 'bash',
  html: 'xml', htm: 'xml', vue: 'xml', svg: 'xml', xhtml: 'xml',
  py: 'python', python3: 'python', c: 'cpp', toml: 'ini',
})

export function normalizeCodeLanguage(value) {
  const raw = String(value == null ? '' : value).trim().toLowerCase()
  if (!raw || raw === 'text' || raw === 'plain' || raw === 'none') return 'plaintext'
  return LANGUAGE_ALIASES[raw] || raw
}

// Existing official grammars stay lazy-loaded; supplemental grammars use the
// same registration/error-retry path and need no dependency or network request.
export const languageLoaders = {
  abap: () => import(/* webpackChunkName: "highlight" */ './code-language-grammars.js').then(module => module.abapLanguage),
  ada: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/ada.js'),
  apache: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/apache.js'),
  apex: () => import(/* webpackChunkName: "highlight" */ './code-language-grammars.js').then(module => module.apexLanguage),
  armasm: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/armasm.js'),
  bash: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/bash.js'),
  csharp: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/csharp.js'),
  cpp: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/cpp.js'),
  cmake: () => import(/* webpackChunkName: "highlight" */ 'highlight.js/lib/languages/cmake.js'),
  cobol: () => import(/* webpackChunkName: "highlight" */ './code-language-grammars.js').then(module => module.cobolLanguage),
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
  graphql: () => import(/* webpackChunkName: "highlight" */ './code-language-grammars.js').then(module => module.graphqlLanguage),
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
  solidity: () => import(/* webpackChunkName: "highlight" */ './code-language-grammars.js').then(module => module.solidityLanguage),
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
