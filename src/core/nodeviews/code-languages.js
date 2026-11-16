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
