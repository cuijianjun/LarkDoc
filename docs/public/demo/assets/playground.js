/* =============================================================
   lark-doc Playground
   -------------------------------------------------------------
   设计要点（和接入者直接相关，代码里都做了注释）：
   1. 代码区的代码是被「真的执行」的，不是解析出来的配置对象：
      用一个同名假构造器接住 `new LarkDoc({...})` 的入参，然后把
      真实实例挂上去。这样写错语法会拿到引擎给的原始报错。
   2. 重建不丢正文：销毁前先把当前正文 getJSON() 取出来，再塞回
      新实例。上传配置也可用 doc.setUploader() 原位更新；这里为展示
      任意初始化配置，统一重建。主动切换示例会重置正文。
   3. GitHub Pages 没有上传后端。服务器示例必须由使用者填写自己的接口，
      本地示例则用 base64。两种方式都走真实图片管线与回调。
   ============================================================= */
(function () {
  'use strict'

  /* --------------------------------------------------------- 依赖 */

  // Rollup UMD 暴露命名空间 window.LarkDoc，其中 LarkDoc 是编辑器构造器。
  var NS = window.LarkDoc || {}
  var LarkDocCtor = NS.LarkDoc || null
  var SAMPLE = window.__LARK_DOC_SAMPLE__ || { type: 'doc', content: [{ type: 'paragraph' }] }
  var tokenize = window.__larkDocHighlight || function (s) { return s.replace(/[&<>]/g, '') }
  var esc = window.__larkDocEscape || function (s) { return String(s) }

  var HOST_SELECTOR = '#pgHost'
  var DEBOUNCE = 400
  var MOD = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl+'
  var STORE = {
    code: 'lark-doc-playground:code-v0144',
    open: 'lark-doc-playground:open',
    height: 'lark-doc-playground:height',
  }

  // 无后端 Demo：这些入参一律剔除（不是 lark-doc 不认，是这个页面没有对应服务）。
  var OFFLINE_BLOCKED = [
    'session', 'providers', 'collaboration', 'authorization', 'versioning',
    'comments', 'documentId', 'user', 'capabilities', 'mode',
    'persistence',
  ]

  var DEFAULT_CODE = [
    '// 上面跑的是真实编辑器，这里是它的初始化代码。',
    '// 改完 400 毫秒自动重建 —— 重建前会先把当前正文取出来，再塞进新实例。',
    '',
    'const doc = new LarkDoc({',
    "  element: '#editor',                // 本页面实际的挂载点是 " + HOST_SELECTOR,
    '  content: sampleDoc,                // 示例正文来自 assets/sample.js',
    '  layout: { headerVisible: true },     // 改成 false：顶部标题栏整行收起',
    '  features: { ai: true },              // 改成 false：工具栏 AI 入口消失',
    "  // toolbarKeys: ['history', 'headings', 'marks', 'insert'],",
    '  // limits: { maxLength: 500 },',
    '})',
    '',
    '// 实例方法：doc.getJSON() / getHTML() / setReadonly(true) / patchProps({}) / undo()',
  ].join('\n')

  // 下面的回调函数属于传给 SDK 的真实配置；不是上传完成后的模拟事件。
  function uploadCode(server) {
    return [
      server ? '// 先把 uploadUrl 改成你的接口，再选择图片。' : '// 不配置 action / upload：图片读成 base64，不会请求服务器。',
      server ? "const uploadUrl = ''" : '',
      server ? '// 接口接收 multipart/form-data 的 file，返回：' : '',
      server ? '// { "code": 0, "data": { "url": "https://你的图片域名/a.png", "id": "a1" } }' : '',
      server ? '// GitHub Pages 不提供接口。你的 HTTPS 接口需允许本页来源的 CORS。' : '',
      '',
      '// 应用可把 console.log 换成状态提示；本页将日志摘要显示在“回调记录”。',
      'function report(name, event) { console.log(name, event) }',
      '',
      'const doc = new LarkDoc({',
      "  element: '#editor',",
      "  content: '<p>在这里粘贴、拖入图片，或点击上方“选择图片”。</p>',",
      "  storage: 'none',",
      '  uploader: {',
      server ? '    action: uploadUrl,             // 图片上传接口 URL' : '    // 没有 action，所以使用本地 base64；不是上传失败后的回退。',
      server ? "    method: 'POST', fieldName: 'file'," : '',
      server ? "    data: { documentId: 'demo-document' }," : '',
      server ? '    timeout: 30000, withCredentials: false,' : '',
      server ? "    response: { success: { path: 'code', equals: 0 }, url: 'data.url', attchId: 'data.id' }," : '',
      server ? '    // headers 可传对象或 async (file, ctx) => ({ Authorization: ... })；勿手动设 Content-Type。' : '',
      server ? '    // 默认只发送一次；只有接口允许安全重试时再配置 retry。' : '',
      '    beforeUpload(file, ctx) {',
      "      report('beforeUpload', ctx)",
      server ? "      if (!uploadUrl.trim()) { report('请先填写 uploadUrl；本次取消', ctx); return false }" : '      // 返回 false 可取消；支持异步检查。类型/大小校验更早失败时不会进入这里。',
      '      return true',
      '    },',
      "    onStart(e)    { report('onStart', e) },",
      "    onProgress(e) { report('onProgress', e) },",
      "    onRetry(e)    { report('onRetry', e) },",
      "    onSuccess(e)  { report('onSuccess', e) }, // e.result.url 为服务器 URL 或 base64",
      "    onError(e)    { report('onError', e) },",
      "    onCancel(e)   { report('onCancel', e) },",
      "    onReject(e)   { report('onReject', e) }, // 例如文件类型、大小不符",
      "    onSettled(e)  { report('onSettled', e) }, // 每个任务只有一个终态",
      "    onCallbackError(error) { report('onCallbackError', { error }) }, // 业务回调自身抛错",
      '  },',
      '})',
      "doc.on('change', () => report('change：正文已变化，应用还需自行保存', {}))",
      '',
      '// onSuccess 表示拿到了合法结果，正文插入由 SDK 继续完成；保存到业务后端由应用负责。',
      '// select / paste / drop / replace / crop 共用上述回调；source 字段区分来源。',
      '// 同一张图先选中，再在图片工具栏“替换 / 裁剪”，可观察对应来源。',
      '// doc.setUploader(新配置) 可更新上传配置；组件卸载时调用 doc.destroy()。',
    ].filter(function (line) { return line !== '' }).join('\n')
  }

  var DIAGRAM_CODE = [
    '// Mermaid 图表按需加载同目录的 feature 文件；公式使用包内 KaTeX 字体。',
    'const doc = new LarkDoc({',
    "  element: '#editor', storage: 'none',",
    "  title: '图表与公式示例',",
    "  content: { type: 'doc', content: [",
    "    { type: 'paragraph', content: [{ type: 'text', text: '下方应显示 SVG 流程图与公式。图表代码可在编辑器里继续修改。' }] },",
    "    { type: 'codeBlock', attrs: { language: 'mermaid' }, content: [{ type: 'text', text: 'graph TD\\n  A[选择图片] --> B[上传服务器]\\n  B --> C[返回 URL]\\n  C --> D[编辑器渲染]' }] },",
    "    { type: 'blockMath', attrs: { latex: 'E = mc^2' } },",
    "    { type: 'paragraph' },",
    '  ] },',
    '})',
  ].join('\n')

  var EXAMPLES = {
    playground: { code: DEFAULT_CODE, help: '直接编辑完整示例。修改下方代码会保留正文；切换示例会重置正文。' },
    base64: { code: uploadCode(false), help: '无需服务器。选择、粘贴、拖入图片，观察 base64 结果与回调；图片选中后可替换、裁剪。' },
    server: { code: uploadCode(true), help: '先在下方代码填写 uploadUrl，再选择图片。接口成功返回 URL 后由 SDK 自动插入；失败会明确报错。' },
    diagram: { code: DIAGRAM_CODE, help: '下方渲染真实 Mermaid SVG 和公式。资源从本站加载，不依赖外部图表服务。' },
  }

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
  var previewTab = document.getElementById('pgTabPreview')
  var codeTab = document.getElementById('pgTabCode')
  var foldBtn = document.getElementById('pgFold')
  var codeBar = codePane.querySelector('.pg-bar-code')
  var resetBtn = document.getElementById('pgReset')
  var verEl = document.getElementById('pgVer')
  var exampleEl = document.getElementById('pgExample')
  var helpEl = document.getElementById('pgExampleHelp')
  var eventsEl = document.getElementById('pgUploadEvents')
  var logEl = document.getElementById('pgUploadLog')
  var countEl = document.getElementById('pgEventCount')
  var imageBtn = document.getElementById('pgImage')
  var cancelBtn = document.getElementById('pgCancelUpload')

  /* --------------------------------------------------------- 状态 */

  var instance = null      // 真实 LarkDoc 实例
  var keep = null          // { json, title } 上一次成功取到的正文
  var timer = 0
  var renderTimer = 0
  var currentExample = 'playground'
  var eventLines = []
  var latestTask = null

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

  function logEvent(name, event) {
    var e = event && typeof event === 'object' ? event : {}
    var summary = {}
    // 不展示文件内容、headers、服务端完整响应或 URL 查询参数。
    ;['taskId', 'source', 'mode', 'status', 'percent', 'attempt', 'nextAttempt'].forEach(function (key) {
      if (e[key] !== undefined) summary[key] = String(e[key]).slice(0, 80)
    })
    if (e.result && e.result.url) summary.url = /^data:/.test(e.result.url) ? 'data:image/…;base64,…' : '服务器图片 URL（已省略）'
    if (e.error) summary.error = e.error.code || 'UPLOAD_FAILED'
    if (name === 'onStart' && typeof e.cancel === 'function') latestTask = e
    if (name === 'onSettled' && latestTask && e.taskId === latestTask.taskId) latestTask = null
    cancelBtn.disabled = !latestTask
    eventLines.push(String(name).slice(0, 100) + ' ' + JSON.stringify(summary))
    eventLines = eventLines.slice(-30)
    countEl.textContent = String(eventLines.length)
    logEl.textContent = eventLines.join('\n')
    logEl.parentElement.scrollTop = logEl.parentElement.scrollHeight
  }

  function selectExample(name) {
    currentExample = EXAMPLES[name] ? name : 'playground'
    exampleEl.value = currentExample
    helpEl.textContent = EXAMPLES[currentExample].help
    teardown()
    keep = null // 主动切换例子，使用该例子声明的正文。
    eventLines = []
    latestTask = null
    cancelBtn.disabled = true
    countEl.textContent = '0'
    logEl.textContent = '选择图片后，这里会显示上传回调。正文变化后仍需应用自行保存。'
    eventsEl.open = currentExample === 'base64' || currentExample === 'server'
    ta.value = EXAMPLES[currentExample].code
    var url = new URL(window.location.href)
    url.searchParams.set('example', currentExample)
    window.history.replaceState(null, '', url)
    run('manual')
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

    var demoConsole = Object.create(window.console)
    demoConsole.log = logEvent
    var factory = new Function('LarkDoc', 'sampleDoc', 'console', code)
    factory(LarkDoc, SAMPLE, demoConsole)

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
      'undo', 'redo', 'save', 'setContent', 'setTitle', 'setUploader', 'importVditor',
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

  /** 剔掉离线场景下没有意义的入参，并固定 storage。 */
  function sanitize(options) {
    var out = {}
    var dropped = []
    Object.keys(options).forEach(function (key) {
      if (OFFLINE_BLOCKED.indexOf(key) >= 0) { dropped.push(key); return }
      out[key] = options[key]
    })
    out.storage = 'none' // 本 Demo 不写本地草稿，保证「改代码 = 干净重建」
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
    opts.storage = 'none'

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
      showError('<b>vendor 没有加载成功</b>\n本页需要 vendor/lark-doc-element.umd.min.js 与同目录按需资源，请用 http(s) 打开；file:// 下浏览器会拦掉部分加载。')
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
  }

  function schedule() {
    window.clearTimeout(timer)
    setStatus('编辑中…', 'busy')
    window.clearTimeout(renderTimer)
    renderTimer = window.setTimeout(renderHighlight, 40) // 高亮跟着输入走，但别每键重排
    timer = window.setTimeout(function () { run('auto') }, DEBOUNCE)
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
    var narrow = window.innerWidth < 880
    pg.classList.toggle('is-collapsed', !open)
    pg.classList.toggle('is-code-tab', narrow && open)
    toggleBtn.setAttribute('aria-expanded', String(open))
    toggleBtn.hidden = narrow
    previewTab.setAttribute('aria-selected', String(!open))
    codeTab.setAttribute('aria-selected', String(open))
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
      setOpen(pg.classList.contains('is-code-tab') || (window.innerWidth >= 880 && !pg.classList.contains('is-collapsed')))
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
      if ((e.metaKey || e.ctrlKey) && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault()
        setOpen(!isOpen())
      }
    })

    toggleBtn.addEventListener('click', function () { setOpen(!isOpen()) })
    previewTab.addEventListener('click', function () { setOpen(false) })
    codeTab.addEventListener('click', function () { setOpen(true) })

    // 代码块自身的折叠入口：箭头按钮 + 折叠态的整条代码顶栏都能展开。
    foldBtn.addEventListener('click', function () { setOpen(!isOpen()) })
    codeBar.addEventListener('click', function (e) {
      if (e.target === foldBtn || foldBtn.contains(e.target)) return // 箭头按钮已单独处理
      if (!isOpen()) setOpen(true) // 折叠态下点整条代码栏 = 展开
    })

    resetBtn.addEventListener('click', function () {
      selectExample(currentExample)
      ta.focus()
    })
    exampleEl.addEventListener('change', function () { selectExample(exampleEl.value) })
    imageBtn.addEventListener('click', function () {
      var workspace = instance && instance.getWorkspace()
      if (workspace) workspace.executeCommand('image')
    })
    cancelBtn.addEventListener('click', function () {
      if (latestTask) latestTask.cancel('demo-button')
    })
    window.addEventListener('pagehide', teardown)
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
    var requested = new URLSearchParams(window.location.search).get('example')
    currentExample = EXAMPLES[requested] ? requested : 'playground'
    exampleEl.value = currentExample
    helpEl.textContent = EXAMPLES[currentExample].help
    eventsEl.open = currentExample === 'base64' || currentExample === 'server'
    var saved = readStore(STORE.code)
    ta.value = !requested && saved && saved.trim() ? saved : EXAMPLES[currentExample].code
    if (!LarkDocCtor) {
      ta.value = EXAMPLES[currentExample].code
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
