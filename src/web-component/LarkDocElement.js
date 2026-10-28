/**
 * web-component/LarkDocElement — 框架无关的自定义元素外壳。
 *
 * 目标（对齐 AiEditor 的跨框架思路，但保留我们的门面语义）：
 * 外层无论是 Vue 2 / Vue 3 / React / Svelte / 纯 HTML，都只需要写一个标签：
 *
 *   <lark-doc readonly theme="light" toolbar-keys="headings,marks"></lark-doc>
 *   document.querySelector('lark-doc').getJSON()
 *
 * 三条硬约束：
 * 1. 本文件不 import 任何 UI 框架，只依赖 mount/ 渲染适配层与 LarkDoc 门面；
 * 2. 样式采用 Light DOM（不建 Shadow Root）：编辑器需要与宿主共享字体、焦点管理与滚动容器，
 *    且现有 CSS 全部以 `.lark-doc` 前缀收口，隔离性由选择器而非 Shadow DOM 保证；
 * 3. 任何异常都收敛成本元素的 `lark-doc-error` 事件 + console.error，绝不把宿主页面打挂。
 *
 * 生命周期健壮性要点（都是踩过的坑）：
 * - connectedCallback 延到微任务执行：宿主常在 appendChild 之后才设置 property；
 * - disconnectedCallback 延到宏任务并复查 isConnected：React 18 StrictMode、
 *   框架做 DOM 移动/复用时会先 disconnect 再 reconnect，立即 destroy 会让编辑器消失；
 * - 重复 connect / 重复 disconnect 都幂等；destroy 后再次插入可以重建。
 */

import { LarkDoc } from '../LarkDoc'
import { OBSERVED_ATTRIBUTES, readOptionsFromElement, applyAttributeChange } from './attributes'
import { EVENT_MAP } from './events'

/**
 * 对外事件名单维护在 ./events（零依赖模块，P0-06 抽出）：
 * adapters/{vue3,react} 只引名单、不引元素类——元素类依赖链会拉进
 * Vue 2 渲染层，React / Vue 3 宿主没有 Vue 2 插件，引了就编译失败。
 * 这里 re-export 保持原导入路径（`from './LarkDocElement'`）可用。
 */
export { EVENT_MAP } from './events'

/** 需要从宿主实例转发到元素上的快捷方法（只读 + 幂等命令，写操作走 getInstance()）。 */
const PROXIED_METHODS = Object.freeze([
  'getHTML', 'getJSON', 'getText', 'getTitle', 'setTitle', 'getConfig', 'getSession', 'can',
  'setTheme', 'getTheme',
  'setReadonly', 'isReadonly', 'focus', 'undo', 'redo', 'setContent', 'importVditor', 'insert',
  'insertText', 'getImportReport', 'save', 'connectCollaboration', 'disconnectCollaboration',
])

export class LarkDocElement extends HTMLElement {
  constructor() {
    super()
    /** @type {LarkDoc|null} 门面实例；宿主可用 el.document 直接操作。 */
    this.document = null
    this.ready = false
    this._rendererProps = {}
    this._options = {}
    this._connectTask = null
    this._disconnectTask = null
    this._eventNameMap = EVENT_MAP
    this._bindEvents = this._bindEvents.bind(this)
    /** 读 title 属性后主动摘除时的闸门，避免摘除触发的回调把标题清空。 */
    this._titleAttrMuted = false
    /** 最后一次由 title 属性给出的标题（属性会被摘掉，重建实例时用它还原）。 */
    this._titleAttrValue = null
    // 宿主尚未设置 property 前不允许挂载：标记为待定，等微任务。
    this._pending = false
  }

  /* ------------------------------ 生命周期 ------------------------------ */

  static get observedAttributes() { return OBSERVED_ATTRIBUTES }

  connectedCallback() {
    // 微任务延迟：让宿主在同一 tick 内设置的 property（如 provider 对象）先生效。
    if (this._connectTask) clearTimeout(this._connectTask)
    this._disconnectTask = null
    this._connectTask = setTimeout(() => {
      this._connectTask = null
      this._mount()
    }, 0)
  }

  disconnectedCallback() {
    if (this._connectTask) { clearTimeout(this._connectTask); this._connectTask = null }
    if (this._disconnectTask) clearTimeout(this._disconnectTask)
    // 宏任务复查：DOM 移动/框架重挂载会触发 disconnect→connect，此时不能真销毁。
    this._disconnectTask = setTimeout(() => {
      this._disconnectTask = null
      if (this.isConnected) return
      this._unmount()
    }, 0)
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return
    // 读过的 title 会被摘掉（见 _stripTitleAttribute），摘除引起的回调不能把标题清空。
    if (this._titleAttrMuted) return
    if (!this.document) return // 尚未挂载：等首次 mount 统一读取全部属性
    // title 热更：渲染层 prop 是 initialTitle（仅创建期消费），patchProps 不生效，
    // 必须走门面 setTitle() 命令；值已写入后再摘除原生 tooltip 属性。
    if (name === 'title') {
      if (newValue != null) {
        this._titleAttrValue = String(newValue)
        try { this.document.setTitle(String(newValue)) } catch (error) { this._fail('title', error) }
      }
      this._stripTitleAttribute()
      return
    }
    const result = applyAttributeChange(name, newValue)
    if (result.rebuild) { this._scheduleRebuild(); return }
    if (result.props && Object.keys(result.props).length) this._safePatch(result.props)
    // options 目标的 live 属性（user/theme 等）：同步写回门面 options，
    // 宿主重建实例或读取 options 时拿到的才是新值。
    if (result.options && Object.keys(result.options).length && this.document && this.document.options) {
      Object.assign(this.document.options, result.options)
    }
    if (name === 'theme' || name === 'content-theme') this._applyTheme()
  }

  /**
   * 把 `title` 属性从宿主标签上摘掉。
   *
   * 本元素是 Light DOM 且铺满整块编辑器（1440×1160），`title` 是 HTML 原生 tooltip，
   * 留着它鼠标划过正文任意处都会弹出一个灰色「文档标题」气泡 —— 看起来像编辑器的假 tips。
   * 值已经读进 props.title，摘属性不影响标题显示；摘除会再触发一次
   * attributeChangedCallback（newValue=null），用 _titleAttrMuted 闸门吞掉这一次。
   */
  _stripTitleAttribute() {
    const value = this.getAttribute('title')
    if (value === null) return
    // 记住最后一次由属性给出的标题：摘掉属性后若因其他属性重建实例（theme / content-format），
    // 标题不能跟着丢。
    this._titleAttrValue = value
    this._titleAttrMuted = true
    this.removeAttribute('title')
    this._titleAttrMuted = false
  }

  /* ------------------------------ 挂载 / 卸载 ------------------------------ */

  _mount() {
    if (this.document || !this.isConnected) return
    const { options, props } = readOptionsFromElement(this)
    this._rendererProps = props
    // 标题值已经落到 props.title，标签上的 title 属性立刻摘掉（否则浏览器会画原生 tooltip）。
    this._stripTitleAttribute()
    // 属性摘掉后重建实例时，用记住的值把标题补回来（宿主仍可用 property 覆盖）。
    if (props.title == null && typeof this._titleAttrValue === 'string') {
      props.title = this._titleAttrValue
      options.title = this._titleAttrValue
    }
    // property 优先于 attribute：宿主通过 el options= 传的对象整体覆盖/合并。
    this._options = { ...options, ...(this.__options || {}) }
    // 标签内的 HTML 兜底作为初始内容：长正文写进 attribute 既难转义也不可读，
    // 这是 Web Component 的通用惯例；content 属性存在时以属性为准。
    const slotHTML = this._consumeSlotHTML()
    if (slotHTML && this._options.content == null && props.initialContent == null) {
      this._options.content = slotHTML
      props.initialContent = slotHTML
    }
    this._options.element = this
    try {
      this.document = new LarkDoc(this._options)
      this._bindEvents()
      this.ready = true
      this._applyTheme()
      this.setAttribute('data-mounted', 'true')
      // ready 由门面事件统一派发，这里只补发一次 DOM 层面的 mounted 信号。
      this.dispatchEvent(new CustomEvent('lark-doc-mounted', {
        bubbles: true, composed: true, detail: { element: this },
      }))
    } catch (error) {
      this._fail('mount', error)
    }
  }

  _unmount() {
    if (!this.document) return
    const instance = this.document
    this.document = null
    this.ready = false
    this.removeAttribute('data-mounted')
    try {
      instance.destroy()
    } catch (error) {
      this._fail('destroy', error)
    }
  }

  /** 非 live 属性变更：重建实例（保持 DOM 位置不变，子 DOM 由渲染层自行替换）。 */
  _scheduleRebuild() {
    if (this._rebuildTask) clearTimeout(this._rebuildTask)
    this._rebuildTask = setTimeout(() => {
      this._rebuildTask = null
      if (!this.isConnected) return
      this._unmount()
      this._mount()
    }, 30)
  }

  /* ------------------------------ 事件桥接 ------------------------------ */

  /**
   * 把门面回调转成 CustomEvent。detail 统一为：
   * { document, editor?, payload?, type } —— document/editor 是命令式句柄，
   * 其余字段是纯数据（html / json / text / save 结果等）。
   */
  _bindEvents() {
    const instance = this.document
    if (!instance) return
    Object.keys(EVENT_MAP).forEach((name) => {
      instance.on(name, (payload) => {
        const detail = {
          type: name,
          document: instance,
          editor: typeof instance.getEditor === 'function' ? instance.getEditor() : null,
          payload: payload === undefined ? null : this._sanitizeDetail(payload),
        }
        this.dispatchEvent(new CustomEvent(EVENT_MAP[name], { bubbles: true, composed: true, detail }))
      })
    })
  }

  /**
   * detail 必须可结构化克隆：跨 Shadow/iframe 与部分框架的 clone 策略下，
   * 不可克隆对象（Vue 实例、ProseMirror Node）会直接抛错。这里做一次保守过滤。
   */
  _sanitizeDetail(payload) {
    if (payload == null || typeof payload !== 'object') return payload
    try {
      if (typeof structuredClone === 'function') { structuredClone(payload); return payload }
    } catch (_) {
      // 不可克隆：走降级，保证返回值一定可克隆。
    }
    // 降级 1：JSON 往返——产物必然可结构化克隆（Date 变 ISO 字符串、
    // undefined/函数被丢弃），比原样放行 object 安全。
    try { return JSON.parse(JSON.stringify(payload)) } catch (_) {
      // 循环引用等连 JSON 都序列化不了：走逐字段兜底。
    }
    const plain = {}
    Object.keys(payload).forEach((key) => {
      const value = payload[key]
      if (value == null) { plain[key] = value; return }
      const type = typeof value
      if (type === 'function' || type === 'symbol') return
      try { JSON.stringify(value); plain[key] = value } catch (_) { /* 丢弃不可序列化字段 */ }
    })
    return plain
  }

  /* ------------------------------ 对外 API ------------------------------ */

  /** 命令式门面实例（推荐宿主从这里拿全量 API）。 */
  getInstance() { return this.document }

  /** 内部 Tiptap 编辑器实例；未就绪时为 null。 */
  getEditor() { return this.document ? this.document.getEditor() : null }

  getWorkspace() { return this.document ? this.document.getWorkspace() : null }

  destroy() { this._unmount() }

  /**
   * 整体替换 options（对象型能力：providers / persistence / uploader / ai 等）。
   * 已挂载时按“先销毁再重建”处理，因为这些能力在 Workspace 初始化时就固化了。
   */
  set options(value) {
    this.__options = value && typeof value === 'object' ? value : {}
    if (this.document) this._scheduleRebuild()
  }

  get options() { return this.__options || {} }

  /* ------------------------------ 辅助 ------------------------------ */

  /**
   * 取宿主写在标签内的 HTML（`<lark-doc><h1>标题</h1></lark-doc>`）。
   * 只在首次挂载时读取并立即清空——渲染层是 append 而非 replace，
   * 不清空会让初始内容 DOM 与编辑器 DOM 并存。
   * 读取结果缓存在实例上：非 live 属性变更会触发重建，重建后要能恢复初始内容。
   */
  _consumeSlotHTML() {
    if (this._slotHTML != null) return this._slotHTML
    if (this._slotConsumed) return null
    this._slotConsumed = true
    if (!this.innerHTML) return null
    const html = String(this.innerHTML).trim()
    if (!html) return null
    this.innerHTML = ''
    this._slotHTML = html
    return html
  }

  /**
   * 主题应用统一入口（0.12 四态化）：读标签上的 theme / content-theme 属性后
   * 走门面 setTheme —— 校验、system/host 解析、data-theme-source 标记与
   * themeChange 事件都在 controller 一处收口。
   * 两个属性都缺省时不臆造值：交回门面按 options（默认 light/auto）解析。
   */
  _applyTheme() {
    if (!this.document) return
    const theme = this.getAttribute('theme')
    const contentTheme = this.getAttribute('content-theme')
    if (theme != null || contentTheme != null) {
      this.document.setTheme(theme == null ? undefined : theme, contentTheme == null ? undefined : contentTheme)
    } else if (typeof this.document._applyHostAttributes === 'function') {
      this.document._applyHostAttributes()
    }
  }

  _safePatch(props) {
    try {
      if (this.document && !this.document.patchProps(props)) this._scheduleRebuild()
    } catch (error) {
      this._fail('patch', error)
    }
  }

  /** 统一失败出口：日志 + 事件，不向上抛（宿主 CSR 包一个元素不至于整页崩）。 */
  _fail(phase, error) {
    if (typeof console !== 'undefined') console.error(`[lark-doc] ${phase} 失败`, error)
    this.removeAttribute('data-mounted')
    this.dispatchEvent(new CustomEvent('lark-doc-error', {
      bubbles: true,
      composed: true,
      detail: { type: 'error', document: this.document, phase, message: error && error.message ? error.message : String(error) },
    }))
  }
}

/**
 * 把门面常用方法代理到元素上：宿主不必先 getInstance()。
 * 用 defineProperty 而不是逐个手写，保证与门面方法表同步演进。
 */
PROXIED_METHODS.forEach((method) => {
  if (method in LarkDocElement.prototype) return
  Object.defineProperty(LarkDocElement.prototype, method, {
    configurable: true,
    enumerable: false,
    writable: true,
    value: function proxied(...args) {
      const instance = this.document
      if (!instance) {
        if (typeof console !== 'undefined') console.warn(`[lark-doc] 尚未就绪，${method}() 被忽略`)
        return null
      }
      if (typeof instance[method] !== 'function') return null
      return instance[method](...args)
    },
  })
})

export default LarkDocElement
