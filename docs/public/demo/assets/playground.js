/* =============================================================
   lark-doc Playground
   -------------------------------------------------------------
   设计要点（和接入者直接相关，代码里都做了注释）：
   1. 代码区的代码是被「真的执行」的，不是解析出来的配置对象：
      用一个同名假构造器接住 `new LarkDoc({...})` 的入参，然后把
      真实实例挂上去。这样写错语法会拿到引擎给的原始报错。
   2. 重建不丢正文：销毁前先把当前正文 getJSON() 取出来，再塞回
      新实例。lark-doc 没有 setConfig / updateConfig，改配置只能重建。
   3. 这个 Demo 没有后端，会话 / 上传 / 持久化一类的入参会被剔掉，
      避免让人误以为示例里藏着服务端能力。
   ============================================================= */
(function () {
  'use strict'

  /* --------------------------------------------------------- 依赖 */

  // UMD 的全局变量名是带连字符的 `lark-doc`，同时挂了 default 和具名导出。
  var NS = window['lark-doc'] || window.larkDoc || {}
  var LarkDocCtor = NS.LarkDoc || NS.default || null
  var SAMPLE = window.__LARK_DOC_SAMPLE__ || { type: 'doc', content: [{ type: 'paragraph' }] }
  var tokenize = window.__larkDocHighlight || function (s) { return s.replace(/[&<>]/g, '') }
  var esc = window.__larkDocEscape || function (s) { return String(s) }

  var HOST_SELECTOR = '#pgHost'
  var DEBOUNCE = 400
  var MOD = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl+'
  var STORE = {
    code: 'lark-doc-playground:code',
    open: 'lark-doc-playground:open',
    height: 'lark-doc-playground:height',
  }

  // 无后端 Demo：这些入参一律剔除（不是 lark-doc 不认，是这个页面没有对应服务）。
  // persistence 不在列表里 —— 它是纯本地能力（IndexedDB / localStorage），
  // 这个页面本身用 storage: 'none' 关掉，但用户代码里写它应该照原样被接受。
  var OFFLINE_BLOCKED = [
    'session', 'providers', 'collaboration', 'authorization', 'versioning',
    'comments', 'documentId', 'user', 'capabilities', 'mode',
    'uploader', 'uploadImage',
  ]

  var DEFAULT_CODE = [
    '// 上面跑的是真实编辑器，这里是它的初始化代码。',
    '// 改完 400 毫秒自动重建 —— 重建前会先把当前正文取出来，再塞进新实例。',
    '',
    'const doc = new LarkDoc({',
    "  element: '#editor',                // 本页面实际的挂载点是 " + HOST_SELECTOR,
    '  content: sampleDoc,                // 示例正文来自 assets/sample.js',
    "  storage: 'local',                  // 'none' = 关掉本地草稿；'local' = 草稿落盘，刷新还在",
    '  config: {',
    '    layout: { headerVisible: true },     // 改成 false：顶部标题栏整行收起',
    '    features: { ai: true },              // 改成 false：工具栏 AI 入口消失',
    '',
    '    // 自动保存：默认就是开的，delay 单位毫秒（0 = 每次改动立刻存）',
    '    autosave: { enabled: true, delay: 650 },',
    '',
    '    // 导入 / 导出各自独立开关，格式也是逐项配置的',
    '    importExport: {',
    "      importEnabled: true,               // false：顶部「导入」按钮整颗消失",
    "      exportEnabled: true,               // false：顶部「导出」下拉整颗消失",
    "      importFormats: ['html', 'json', 'md', 'docx'],",
    "      exportFormats: ['html', 'json', 'md', 'txt', 'docx', 'print'],",
    '    },',
    '',
    '    // 媒体在 HTML 里的写法：inline 原样内嵌；link 只留地址',
    "    // 改完点右上角「HTML 输出」按钮，能直接看到两种写法的差别",
    "    media: { htmlMode: 'inline', linkText: '', newTab: true },",
    '',
    "    // toolbar: { marksAllow: ['bold', 'italic'] },",
    '    // limits: { maxLength: 500 },',
    '  },',
    '})',
    '',
    '// 实例方法：doc.getJSON() / getHTML() / setReadonly(true) / patchProps({}) / undo()',
    "// 顶栏「本地保存」显示自动保存的落盘时间；想从空白开始就点右上角「重置」。",
  ].join('\n')

  /* --------------------------------------------------------- DOM */

  var pg = document.getElementById('pg')
  var host = document.getElementById('pgHost')
  var codePane = document.getElementById('pgCodePane')
  var split = document.getElementById('pgSplit')
  var ta = document.getElementById('pgTa')
  var hl = document.getElementById('pgHl')
  var hlCode = document.getElementById('pgHlCode')
  var statusEl = document.getElementById('pgStatus')
  var errorEl = document.getElementById('pgError')
  var toggleBtn = document.getElementById('pgToggle')
  var foldBtn = document.getElementById('pgFold')
  var codeBar = codePane.querySelector('.pg-bar-code')
  var resetBtn = document.getElementById('pgReset')
  var verEl = document.getElementById('pgVer')
  var htmlBtn = document.getElementById('pgHtml')
  var modal = document.getElementById('pgModal')
  var modalCode = document.getElementById('pgHtmlCode')
  var modalTip = document.getElementById('pgHtmlTip')
  var modalCloseBtn = document.getElementById('pgModalClose')
  var copyBtn = document.getElementById('pgCopy')
  var modeGroup = document.getElementById('pgHtmlMode')

  /* --------------------------------------------------------- 状态 */

  var instance = null      // 真实 LarkDoc 实例
  var keep = null          // { json, title } 上一次成功取到的正文

  // 本地草稿的两个落点，与 lark-doc 的持久化实现保持一致：
  //   localStorage 腿 = 前缀 + 'draft' / 'snapshots'；IndexedDB 腿 = 同名库。
  // 「重置」要真正回到示例正文，就得把两边都清掉 —— 只清一边，另一边的草稿还会被读回来。
  var DRAFT_PREFIX = 'tiptap-vue2:lark-doc:'
  var DRAFT_DB = 'tiptap-vue2:lark-doc'
  function clearLocalDraft() {
    try {
      var keys = []
      for (var i = 0; i < window.localStorage.length; i++) {
        var key = window.localStorage.key(i)
        if (key && key.indexOf(DRAFT_PREFIX) === 0) keys.push(key)
      }
      keys.forEach(function (key) { window.localStorage.removeItem(key) })
    } catch (e) { /* 隐私模式拿不到 localStorage：跳过，不影响页面上继续编辑 */ }
    // 必须在实例销毁之后调，否则删库会被那条打开的连接挂住。
    try { if (window.indexedDB) window.indexedDB.deleteDatabase(DRAFT_DB) } catch (e) { /* 同上 */ }
  }
  var timer = 0
  var renderTimer = 0
  var htmlMode = 'inline'  // HTML 输出面板当前档位
  var htmlCache = ''       // 最近一次 getHTML() 的全文，供「复制」用

  /* --------------------------------------------------------- 小工具 */

  function readStore(key) {
    try { return window.localStorage.getItem(key) } catch (e) { return null }
  }

  function writeStore(key, value) {
    try { window.localStorage.setItem(key, value) } catch (e) { /* 隐私模式下忽略 */ }
  }

  function setStatus(text, kind, tooltip) {
    statusEl.textContent = text
    statusEl.className = 'pg-status' + (kind ? ' is-' + kind : '')
    statusEl.title = tooltip || ''
  }

  function showError(html) {
    errorEl.hidden = false
    errorEl.innerHTML = html
  }

  function clearError() {
    errorEl.hidden = true
    errorEl.textContent = ''
  }

  function renderHighlight() {
    // 末尾补一个换行，保证最后一行的高度和 textarea 一致。
    hlCode.innerHTML = tokenize(ta.value) + '\n'
  }

  function syncScroll() {
    hl.scrollTop = ta.scrollTop
    hl.scrollLeft = ta.scrollLeft
  }

  /* ------------------------------------------------- 取代码里的入参 */

  /**
   * 用一个同名假构造器执行用户代码，只截 options。
   * 返回 { options, calls, dropped }；语法错误会原样抛出。
   */
  function capture(code) {
    var state = { options: null, calls: [] }
    var stub = createStub(state)

    function LarkDoc(options) {
      if (!options || typeof options !== 'object') {
        throw new TypeError('new LarkDoc(options) 需要一个对象参数')
      }
      state.options = options
      return stub // 构造器返回对象时，new 表达式的结果就是这个对象
    }

    var factory = new Function('LarkDoc', 'sampleDoc', code)
    factory(LarkDoc, SAMPLE)

    if (!state.options) {
      throw new Error('代码里没有执行 new LarkDoc({ ... })，预览没有可用的初始化参数')
    }
    var cleaned = sanitize(state.options)
    return { options: cleaned.options, calls: state.calls, dropped: cleaned.dropped }
  }

  /** 链式假实例：记录方法调用，真实实例建好后按序补放。 */
  function createStub(state) {
    var stub = {}
    var methods = [
      'on', 'off', 'setReadonly', 'patchProps', 'insert', 'insertText', 'focus',
      'undo', 'redo', 'save', 'setContent', 'setTitle', 'importVditor',
      'connectCollaboration', 'disconnectCollaboration',
    ]
    methods.forEach(function (name) {
      stub[name] = function () {
        state.calls.push({ name: name, args: Array.prototype.slice.call(arguments) })
        return stub
      }
    })
    var getters = ['getJSON', 'getHTML', 'getText', 'getTitle', 'getConfig', 'getEditor', 'getWorkspace', 'can', 'getSession', 'getImportReport']
    getters.forEach(function (name) { stub[name] = function () { return null } })
    stub.destroy = function () { /* 由页面管理生命周期，忽略用户代码里的销毁 */ }
    stub.isReadonly = function () { return false }
    return stub
  }

  /**
   * 剔掉离线场景下没有意义的入参。
   * `storage` 照用户的写法来（默认代码里是 'local'，自动保存会真的落盘）。
   * 改代码重建时正文由 `keep` 带过去，不会被旧草稿顶掉；`重置` 才会清草稿。
   */
  function sanitize(options) {
    var out = {}
    var dropped = []
    Object.keys(options).forEach(function (key) {
      if (OFFLINE_BLOCKED.indexOf(key) >= 0) { dropped.push(key); return }
      out[key] = options[key]
    })
    return { options: out, dropped: dropped }
  }

  /* ------------------------------------------------- 真实实例生命周期 */

  function isLive(inst) {
    if (!inst) return false
    try { return !!inst.getWorkspace() } catch (e) { return false }
  }

  function teardown() {
    if (!instance) return
    if (isLive(instance)) {
      try {
        var json = instance.getJSON()
        var title = instance.getTitle()
        if (json && json.content) keep = { json: json, title: title }
      } catch (e) { /* 取不到就沿用上一份 */ }
    }
    try { instance.destroy() } catch (e) { /* 已在销毁流程中 */ }
    instance = null
    host.textContent = '' // destroy 只摘自己插入的根节点，这里再兜一层
  }

  function mount(options) {
    var opts = {}
    Object.keys(options || {}).forEach(function (key) { opts[key] = options[key] })
    opts.element = HOST_SELECTOR // 用户代码里写什么挂载点都落到预览区
    if (opts.storage == null) opts.storage = 'local' // 用户没写才兜底，写了就照他的来

    if (keep && keep.json) {
      opts.content = keep.json // 重建：用编辑后的正文覆盖代码里的 content
      if (keep.title) opts.title = keep.title
    } else if (!opts.content) {
      opts.content = SAMPLE
    }

    var inst = new LarkDocCtor(opts)
    inst.on('error', function (payload) {
      var msg = payload && payload.message ? payload.message : String(payload || '')
      if (msg) setStatus('运行时报错', 'err', msg)
    })
    return inst
  }

  /** 把用户代码里 `doc.xxx(...)` 的调用补放到真实实例上。 */
  function replay(inst, calls) {
    var missed = []
    calls.forEach(function (call) {
      if (typeof inst[call.name] !== 'function') { missed.push(call.name); return }
      try { inst[call.name].apply(inst, call.args) } catch (e) { missed.push(call.name) }
    })
    return missed
  }

  /* --------------------------------------------------------- 报错定位 */

  /**
   * new Function 的 SyntaxError 不带行号，这里用「逐行前缀能不能编译」
   * 反推第一处真正的错误行；截断导致的 Unexpected end of input 跳过，
   * 否则一行 `const x = {` 会被误判成第 1 行有问题。
   */
  function locateSyntaxError(code) {
    var lines = code.split('\n')
    for (var i = 1; i <= lines.length; i++) {
      var head = lines.slice(0, i).join('\n')
      if (!head.trim()) continue
      try {
        new Function('LarkDoc', 'sampleDoc', head) // eslint-disable-line no-new-func
      } catch (e) {
        if (/end of input|Unterminated|Invalid or unexpected token/i.test(e.message)) continue
        return { line: i, message: e.message }
      }
    }
    return null
  }

  function formatSyntaxError(err, code) {
    var found = locateSyntaxError(code)
    var message = found ? found.message : (err && err.message) || String(err)
    var head = '<b>语法错误</b>  ' + esc(message)
    if (!found) return head

    var lines = code.split('\n')
    var from = Math.max(0, found.line - 3)
    var to = Math.min(lines.length, found.line + 2)
    var frame = ''
    if (from > 0) frame += '  …\n'
    for (var i = from; i < to; i++) {
      var no = i + 1
      frame += (no === found.line ? '> ' : '  ') + (no < 10 ? ' ' : '') + no + ' │ ' + esc(lines[i]) + '\n'
    }
    if (to < lines.length) frame += '  …\n'
    return head + '\n' + frame.replace(/\n$/, '')
  }

  /* --------------------------------------------------------- 执行 */

  function run(reason) {
    window.clearTimeout(timer)
    writeStore(STORE.code, ta.value)
    renderHighlight()

    if (!LarkDocCtor) {
      setStatus('没加载到 lark-doc', 'err')
      showError('<b>vendor 没有加载成功</b>\n本页需要 vendor/vue.min.js 与 vendor/lark-doc.umd.min.js，并且要用 http(s) 打开；file:// 下浏览器会拦掉部分加载。')
      return
    }

    var started = (window.performance && performance.now()) || Date.now()
    var captured
    try {
      captured = capture(ta.value)
    } catch (err) {
      if (err instanceof SyntaxError) {
        showError(formatSyntaxError(err, ta.value))
      } else {
        showError('<b>代码执行失败</b>  ' + esc((err && err.message) || String(err)))
      }
      setStatus(err instanceof SyntaxError ? '语法错误' : '代码报错', 'err')
      return
    }

    clearError()
    teardown()

    var missed = []
    try {
      instance = mount(captured.options)
      missed = replay(instance, captured.calls)
    } catch (err) {
      var detail = '<b>初始化失败</b>  ' + esc((err && err.message) || String(err))
      if (missed.length) detail += '\n未执行的调用：' + esc(missed.join(', '))
      showError(detail)
      setStatus('初始化失败', 'err')
      // 别把预览留成白屏：用默认配置 + 已保存的正文兜一个底。
      try { instance = mount({ content: keep && keep.json }) } catch (e) { instance = null }
      return
    }

    var ms = Math.round(((window.performance && performance.now()) || Date.now()) - started)
    var tip = ''
    if (captured.dropped.length) {
      tip = '本 Demo 没有后端，已忽略：' + captured.dropped.join(', ')
      if (typeof console !== 'undefined') console.info('[playground] ' + tip)
    }
    setStatus((reason === 'manual' ? '已运行 · ' : '已生效 · ') + ms + 'ms', 'ok', tip)

    // 面板开着的时候重建了实例：输出要跟着刷新，否则看到的是上一份正文。
    if (!modal.hidden) renderHtmlOutput()
  }

  function schedule() {
    window.clearTimeout(timer)
    setStatus('编辑中…', 'busy')
    window.clearTimeout(renderTimer)
    renderTimer = window.setTimeout(renderHighlight, 40) // 高亮跟着输入走，但别每键重排
    timer = window.setTimeout(function () { run('auto') }, DEBOUNCE)
  }

  /* --------------------------------------------- HTML 输出（media.htmlMode） */

  // 这个面板只做一件事：把「同一份正文、两种媒体写法」摆在一起看。
  // inline = 图片本体嵌在 HTML 里；link = 图片只剩一条地址链接。
  var MODE_HINT = {
    inline: '媒体本体直接嵌在 HTML 里（<figure><img>），正文能直接渲染出图。默认档。',
    link: '媒体只留一条地址链接，正文里不出现媒体本体。JSON 不受影响，换回来还是图片。',
  }

  function renderHtmlOutput() {
    if (!instance || typeof instance.getHTML !== 'function') {
      htmlCache = ''
      modalCode.textContent = '还没有可用的编辑器实例。先把下方代码跑通；改坏了就点「重置代码」。'
      modalTip.textContent = ''
      return
    }

    var html = ''
    try {
      // 单次覆盖：只影响这一次取值，页面配置不动。
      html = instance.getHTML({ media: { mode: htmlMode } }) || ''
    } catch (err) {
      htmlCache = ''
      modalCode.textContent = 'getHTML() 报错：' + ((err && err.message) || String(err))
      return
    }

    htmlCache = html
    var limit = 20000
    var shown = html.length > limit
      ? html.slice(0, limit) + '\n\n…（后面还有 ' + (html.length - limit) + ' 个字符，点「复制」取全文）'
      : html
    modalCode.textContent = shown || '（空正文）'

    var hasImg = html.indexOf('<img') >= 0
    var hasLink = html.indexOf('lark-doc-media-link') >= 0
    modalTip.innerHTML = '<b>' + htmlMode + '</b> · ' + esc(MODE_HINT[htmlMode]) +
      '　实际输出：<code>' + (hasImg ? '含 &lt;img&gt;' : '无 &lt;img&gt;') + '</code> ' +
      '<code>' + (hasLink ? '含媒体链接' : '无媒体链接') + '</code>'
  }

  function openHtml() {
    if (!modal.hidden) return
    modal.hidden = false
    renderHtmlOutput()
    copyBtn.focus()
  }

  function closeHtml() {
    if (modal.hidden) return
    modal.hidden = true
    htmlBtn.focus()
  }

  function copyHtml() {
    if (!htmlCache) return
    var flash = function (ok) {
      copyBtn.textContent = ok ? '已复制' : '请手动选中'
      window.setTimeout(function () { copyBtn.textContent = '复制' }, 1200)
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(htmlCache).then(
        function () { flash(true) },
        function () { flash(false) },
      )
      return
    }
    try {
      var sel = window.getSelection()
      var range = document.createRange()
      range.selectNodeContents(modalCode)
      sel.removeAllRanges()
      sel.addRange(range)
      flash(document.execCommand('copy'))
    } catch (e) { flash(false) }
  }

  /* --------------------------------------------------------- 布局 */

  function applyHeight(px) {
    var max = Math.max(120, window.innerHeight - 180)
    var next = Math.max(88, Math.min(max, px))
    pg.style.setProperty('--code-h', Math.round(next) + 'px')
    return next
  }

  function saveHeight() {
    var h = codePane.getBoundingClientRect().height
    if (h > 0) writeStore(STORE.height, String(Math.round(h)))
  }

  function setOpen(open) {
    pg.classList.toggle('is-collapsed', !open)
    toggleBtn.setAttribute('aria-expanded', String(open))
    toggleBtn.innerHTML = (open ? '收起代码' : '展开代码') + ' <kbd>' + MOD + '</kbd><kbd>J</kbd>'
    foldBtn.setAttribute('aria-expanded', String(open))
    writeStore(STORE.open, open ? '1' : '0')
    if (open) renderHighlight()
  }

  function isOpen() {
    return !pg.classList.contains('is-collapsed')
  }

  function initLayout() {
    var savedH = parseInt(readStore(STORE.height), 10)
    if (savedH > 0) applyHeight(savedH)
    setOpen(readStore(STORE.open) !== '0')

    var dragging = false
    var startY = 0
    var startH = 0

    split.addEventListener('pointerdown', function (e) {
      if (!isOpen()) return
      dragging = true
      startY = e.clientY
      startH = codePane.getBoundingClientRect().height
      pg.classList.add('is-dragging')
      try { split.setPointerCapture(e.pointerId) } catch (err) { /* 忽略 */ }
      e.preventDefault()
    })

    split.addEventListener('pointermove', function (e) {
      if (!dragging) return
      applyHeight(startH - (e.clientY - startY))
    })

    function endDrag() {
      if (!dragging) return
      dragging = false
      pg.classList.remove('is-dragging')
      saveHeight()
    }
    split.addEventListener('pointerup', endDrag)
    split.addEventListener('pointercancel', endDrag)

    split.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      if (!isOpen()) return
      var step = e.shiftKey ? 48 : 16
      applyHeight(codePane.getBoundingClientRect().height + (e.key === 'ArrowUp' ? step : -step))
      saveHeight()
      e.preventDefault()
    })

    window.addEventListener('resize', function () {
      applyHeight(codePane.getBoundingClientRect().height || 0)
    })
  }

  /* --------------------------------------------------------- 事件 */

  function initEvents() {
    ta.addEventListener('input', schedule)
    ta.addEventListener('scroll', syncScroll)

    ta.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        run('manual')
        return
      }
      if (e.key === 'Tab') { // 代码框里 Tab 应该缩进，而不是跳走
        e.preventDefault()
        var start = ta.selectionStart
        var end = ta.selectionEnd
        ta.value = ta.value.slice(0, start) + '  ' + ta.value.slice(end)
        ta.selectionStart = ta.selectionEnd = start + 2
        schedule()
      }
    })

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.hidden) {
        closeHtml()
        return
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault()
        setOpen(!isOpen())
      }
    })

    htmlBtn.addEventListener('click', openHtml)
    modalCloseBtn.addEventListener('click', closeHtml)
    copyBtn.addEventListener('click', copyHtml)
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeHtml() // 点遮罩关闭
    })
    modeGroup.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('button[data-mode]') : null
      if (!btn) return
      var mode = btn.getAttribute('data-mode')
      if (mode === htmlMode) return
      htmlMode = mode
      Array.prototype.forEach.call(modeGroup.querySelectorAll('button'), function (b) {
        b.setAttribute('aria-pressed', String(b === btn))
      })
      renderHtmlOutput()
    })

    toggleBtn.addEventListener('click', function () { setOpen(!isOpen()) })

    // 代码块自身的折叠入口：箭头按钮 + 折叠态的整条代码顶栏都能展开。
    foldBtn.addEventListener('click', function () { setOpen(!isOpen()) })
    codeBar.addEventListener('click', function (e) {
      if (e.target === foldBtn || foldBtn.contains(e.target)) return // 箭头按钮已单独处理
      if (!isOpen()) setOpen(true) // 折叠态下点整条代码栏 = 展开
    })

    resetBtn.addEventListener('click', function () {
      ta.value = DEFAULT_CODE
      renderHighlight()
      teardown()        // 先断开旧实例，IndexedDB 才删得掉
      keep = null       // 别把编辑过的正文带进新实例，否则「重置」等于没重置
      clearLocalDraft() // 清掉自动保存落下的草稿，示例正文才会真的回来
      schedule()
      ta.focus()
    })
  }

  /* --------------------------------------------------------- 启动 */

  function loadVersion() {
    if (typeof fetch !== 'function') return
    fetch('./vendor/VERSION', { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.text() : '' })
      .then(function (text) {
        var v = String(text || '').trim()
        if (v) verEl.textContent = 'v' + v
      })
      .catch(function () { /* file:// 下取不到就保持原样 */ })
  }

  function boot() {
    var saved = readStore(STORE.code)
    ta.value = saved && saved.trim() ? saved : DEFAULT_CODE
    if (!LarkDocCtor) {
      ta.value = DEFAULT_CODE
    }

    renderHighlight()
    initLayout()
    initEvents()
    loadVersion()
    run('boot')

    // 存下来的代码可能已经不能用（比如上次写坏了），回落到默认代码重跑一次。
    if (!instance && saved) {
      ta.value = DEFAULT_CODE
      renderHighlight()
      run('boot')
    }
  }

  boot()
})()
