// The pinned highlight.js 10.7.3 lacks these five languages. Keep their lexical
// rules separate rather than silently highlighting them as Java, SQL or JS.
// These are syntax highlighters, not validators or embedded-language parsers.
export function abapLanguage(hljs) {
  // SAP ABAP Keyword Documentation: Comments, Literals and String Templates.
  const keywords = {
    $pattern: /[A-Za-z_][A-Za-z0-9_-]*/,
    keyword: 'report program class endclass definition implementation public protected private section ' +
      'interface endinterface method methods endmethod class-methods data class-data types constants ' +
      'field-symbols parameters select-options type like value length decimals ref to table of standard ' +
      'sorted hashed key unique non-unique initial size read-only begin end include structure ' +
      'if elseif else endif case when others endcase do times enddo while endwhile loop at into ' +
      'assigning reference endloop check continue exit return try catch cleanup endtry raise exception ' +
      'create object call function perform form endform importing exporting changing returning using ' +
      'select single distinct from where and or not in between order by group having up endselect ' +
      'append insert modify delete read sort clear free refresh assign unassign move compute add ' +
      'subtract multiply divide concatenate split replace condense translate find write message ' +
      'new constructor conv cast cond switch reduce filter corresponding let for next base ' +
      'is bound assigned supplied eq ne lt le gt ge cp np ca na co cn cs ns',
    literal: 'abap_true abap_false abap_undefined',
    built_in: 'string xstring decfloat16 decfloat34 int8',
  }
  const field = { className: 'string', begin: /'/, end: /'|$/, contains: [{ begin: /''/ }] }
  const text = { className: 'string', begin: /`/, end: /`|$/, contains: [{ begin: /``/ }] }
  const number = { className: 'number', begin: /[+-]?\b\d+\b/, relevance: 0 }
  const template = {
    className: 'string', begin: /\|/, end: /\|/,
    contains: [hljs.BACKSLASH_ESCAPE, {
      className: 'subst', begin: /\{/, end: /\}/, keywords,
      contains: [field, text, number],
    }],
  }
  return {
    name: 'ABAP', case_insensitive: true, keywords,
    contains: [hljs.COMMENT(/^\*/, /$/), hljs.COMMENT(/"/, /$/), field, text, template,
      { className: 'meta', begin: /##[A-Za-z_][A-Za-z0-9_]*/ }, number],
  }
}

export function apexLanguage(hljs) {
  // Salesforce Apex Reference: Reserved Keywords; SOQL and SOSL Queries.
  const keywords = {
    keyword: 'abstract activate and any array as asc autonomous begin break bulk by case cast catch ' +
      'class collect commit const continue currency default delete desc do else end enum exception ' +
      'exit export extends final finally for from global goto group having hint if implements import ' +
      'in inner insert instanceof interface into join like limit loop merge new not nulls number ' +
      'object of on or outer override package parallel pragma private protected public retrieve ' +
      'return rollback select sort static super switch synchronized testmethod then this throw ' +
      'transaction trigger try undelete update upsert using virtual void webservice when where while ' +
      'after before count excludes first includes last order sharing with without inherited',
    literal: 'true false null',
    built_in: 'bigdecimal blob boolean byte char date datetime decimal double float id int integer ' +
      'list long map set short sobject string system time',
  }
  const number = { className: 'number', begin: /\b\d+(?:\.\d+)?(?:e[+-]?\d+)?[dDlL]?\b/, relevance: 0 }
  const query = {
    begin: /\[(?=\s*(?:select|find)\b)/, end: /\]/, keywords,
    contains: [hljs.APOS_STRING_MODE, hljs.C_LINE_COMMENT_MODE, hljs.C_BLOCK_COMMENT_MODE, number],
  }
  return {
    name: 'Apex', case_insensitive: true, keywords,
    contains: [hljs.C_LINE_COMMENT_MODE, hljs.C_BLOCK_COMMENT_MODE, hljs.APOS_STRING_MODE,
      { className: 'meta', begin: /@[A-Za-z_][A-Za-z0-9_]*/ }, query, number],
  }
}

export function cobolLanguage(hljs) {
  // GnuCOBOL Programmer's Guide §§2.1.16, 2.1.18–20 (fixed/free text).
  const fixedFormatOnly = (match, response) => {
    // Read this source's latest line directive; no state survives highlighting.
    const directives = /^(?:[^'"\r\n]{6} )?[ \t]*>>[ \t]*SOURCE(?:[ \t]+FORMAT)?(?:[ \t]+IS)?[ \t]+(FREE|FIXED)\b/gim
    const previousSource = match.input.slice(0, match.index)
    let format = ''
    let directive
    while ((directive = directives.exec(previousSource))) format = directive[1].toUpperCase()
    // Without an explicit format, do not mistake an opening string for a
    // sequence area. Unquoted column-seven */ lines retain the fixed default.
    if (format === 'FREE' || (!format && /['"]/.test(match[0].slice(0, 6)))) response.ignoreMatch()
  }
  return {
    name: 'COBOL', case_insensitive: true,
    keywords: {
      $pattern: /[A-Za-z0-9][A-Za-z0-9_-]*/,
      keyword: 'accept add all also alter and are area areas ascending assign at author before by ' +
        'call cancel close cobol collating column compute configuration contains content continue ' +
        'copy corresponding currency data date day debug-item debugging declaratives delete delimited ' +
        'depending descending display divide division else end end-add end-call end-compute ' +
        'end-delete end-divide end-evaluate end-if end-multiply end-perform end-read end-return ' +
        'end-rewrite end-search end-start end-string end-subtract end-unstring end-write environment ' +
        'equal error evaluate exception exit extend external fd file file-control filler ' +
        'first from function giving global go goback greater identification if in index indexed ' +
        'initialize input input-output inspect into invalid is just justified key leading left ' +
        'length less linkage local-storage lock memory merge mode move multiply native negative ' +
        'next not object-computer occurs of on open optional or order organization other output ' +
        'overflow packed-decimal padding perform pic picture pointer positive procedure program-id ' +
        'read record records redefines reference relative remainder renames replacing report ' +
        'repository reserve return returning reversed rewind rewrite right rounded run same sd ' +
        'search section select sentence separate sequence sequential sign size sort source-computer ' +
        'special-names standard start stop string subtract tallying test than then through thru ' +
        'times to trailing type unit unstring until up upon usage using value values varying when ' +
        'with working-storage write comp comp-1 comp-2 comp-3 comp-4 comp-5 binary',
      literal: 'zero zeros zeroes space spaces quote quotes high-value high-values low-value low-values null nulls true false',
    },
    contains: [
      // Fixed-format sequence columns may contain arbitrary change indicators.
      hljs.COMMENT(/^.{6}[*/]/, /$/, { 'on:begin': fixedFormatOnly }), hljs.COMMENT(/\*>/, /$/),
      // Sequence area/blank indicator are source layout, not numeric literals.
      { begin: /^[ \d]{6}(?=[ -])/, relevance: 0, 'on:begin': fixedFormatOnly },
      { className: 'meta', begin: />>/, end: /$/ },
      { className: 'string', variants: [
        { begin: /(?:\b(?:NX|NC|BX|X|N|Z|B))?'/, end: /'|$/, contains: [{ begin: /''/ }] },
        { begin: /(?:\b(?:NX|NC|BX|X|N|Z|B))?"/, end: /"|$/, contains: [{ begin: /""/ }] },
      ] },
      { begin: /\b(?:pic|picture)\s+(?:is\s+)?/, end: /(?=\s|\.)/,
        keywords: 'pic picture is',
        contains: [{ className: 'type', begin: /[AX0-9SVPZBCRD*+\-/$,()]+(?:\.[AX0-9SVPZBCRD*+\-/$,()]+)*/ }] },
      { className: 'number', begin: /[+-]?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/, relevance: 0,
        'on:begin': (match, response) => {
          const before = match.input[match.index - 1] || ''
          const after = match.input[match.index + match[0].length] || ''
          if (/[\w-]/.test(before) || /[\w-]/.test(after)) response.ignoreMatch()
        } },
    ],
  }
}

export function graphqlLanguage(hljs) {
  // GraphQL September 2025 specification §§2.1, 2.10 (case-sensitive names).
  return {
    name: 'GraphQL',
    keywords: {
      $pattern: /[_A-Za-z][_0-9A-Za-z]*/,
      keyword: 'query mutation subscription fragment on schema scalar type interface implements union enum input directive extend repeatable',
      literal: 'true false null', built_in: 'Int Float String Boolean ID',
    },
    contains: [
      hljs.HASH_COMMENT_MODE,
      { className: 'string', begin: /"""/, end: /"""/, contains: [{ begin: /\\"""/ }] },
      hljs.QUOTE_STRING_MODE,
      { className: 'variable', begin: /\$[_A-Za-z][_0-9A-Za-z]*/ },
      { className: 'meta', begin: /@[_A-Za-z][_0-9A-Za-z]*/ },
      { className: 'attr', begin: /[_A-Za-z][_0-9A-Za-z]*(?=\s*:)/, relevance: 0 },
      { className: 'number', begin: /-?\b(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?(?![_0-9A-Za-z])/, relevance: 0 },
    ],
  }
}

export function solidityLanguage(hljs) {
  // Solidity's official SolidityLexer.g4; integer widths are multiples of eight.
  const sizedTypes = Array.from({ length: 32 }, (_, index) => {
    const width = (index + 1) * 8
    return `int${width} uint${width} bytes${index + 1}`
  }).join(' ')
  return {
    name: 'Solidity',
    keywords: {
      $pattern: /[A-Za-z_$][A-Za-z0-9_$]*/,
      keyword: 'abstract anonymous as assembly break calldata catch constant constructor continue ' +
        'contract delete do else emit enum event external fallback for function if immutable import ' +
        'indexed interface internal is library mapping memory modifier new override payable pragma ' +
        'private public pure receive return returns storage struct try type unchecked using view virtual while ' +
        'error from global transient layout',
      literal: 'true false',
      built_in: 'address bool bytes string int uint fixed ufixed msg block tx abi this super ' +
        'assert require revert addmod mulmod keccak256 sha256 ripemd160 ecrecover selfdestruct ' +
        'wei gwei ether seconds minutes hours days weeks ' + sizedTypes,
    },
    contains: [hljs.C_LINE_COMMENT_MODE, hljs.C_BLOCK_COMMENT_MODE,
      { className: 'string', variants: [
        { begin: /(?:\b(?:hex|unicode))?"/, end: /"/, contains: [hljs.BACKSLASH_ESCAPE] },
        { begin: /(?:\b(?:hex|unicode))?'/, end: /'/, contains: [hljs.BACKSLASH_ESCAPE] },
      ] },
      { className: 'built_in', begin: /\bu?fixed\d+x\d+\b/, relevance: 0 },
      { className: 'number', begin: /\b0x[\da-fA-F](?:_?[\da-fA-F])*(?![\w$])|(?:\b\d(?:_?\d)*(?:\.\d(?:_?\d)*)?|\.\d(?:_?\d)*)(?:[eE]-?\d(?:_?\d)*)?(?![\w$])/, relevance: 0,
        'on:begin': (match, response) => {
          if (/[\w$]/.test(match.input[match.index - 1] || '')) response.ignoreMatch()
        } },
    ],
  }
}
