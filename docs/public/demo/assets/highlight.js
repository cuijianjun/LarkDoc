/* =============================================================
   极简 JS 高亮：给 <textarea> 做一层背后的着色。
   不是完整的语法分析器，只处理注释 / 字符串 / 关键字 / 数字 /
   函数名 / 标点六类；目的是让示例代码可读，不是做编辑器。
   ============================================================= */
(function () {
  'use strict'

  var RE = new RegExp([
    '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)',                                    // 1 注释
    '(`(?:\\\\[\\s\\S]|[^`\\\\])*`|\'(?:\\\\[\\s\\S]|[^\'\\\\\\n])*\'|"(?:\\\\[\\s\\S]|[^"\\\\\\n])*")', // 2 字符串
    '\\b(const|let|var|function|return|new|if|else|for|while|do|switch|case|break|continue|' +
      'of|in|true|false|null|undefined|typeof|instanceof|class|extends|delete|void|' +
      'try|catch|finally|throw|await|async|this|yield)\\b',                      // 3 关键字
    '\\b(\\d+(?:\\.\\d+)?)\\b',                                                  // 4 数字
    '([A-Za-z_$][\\w$]*)(?=\\s*\\()',                                            // 5 函数调用
    '([{}()\\[\\];,.:?=+\\-*/%<>!&|~^]+)',                                       // 6 标点
  ].join('|'), 'g')

  var MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }

  function esc(text) {
    return String(text).replace(/[&<>]/g, function (c) { return MAP[c] })
  }

  function tokenize(source) {
    var out = ''
    var last = 0
    var m
    RE.lastIndex = 0
    while ((m = RE.exec(source))) {
      if (!m[0]) { RE.lastIndex += 1; continue }
      if (m.index > last) out += esc(source.slice(last, m.index))
      var cls = m[1] ? 'tk-com'
        : m[2] ? 'tk-str'
          : m[3] ? 'tk-kw'
            : m[4] ? 'tk-num'
              : m[5] ? 'tk-fn'
                : 'tk-pun'
      out += '<span class="' + cls + '">' + esc(m[0]) + '</span>'
      last = m.index + m[0].length
    }
    out += esc(source.slice(last))
    return out
  }

  window.__larkDocHighlight = tokenize
  window.__larkDocEscape = esc
})()
