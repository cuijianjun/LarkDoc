/**
 * web-component/FeishuDocumentElement — 框架无关的自定义元素外壳。
 *
 * 目标（对齐 AiEditor 的跨框架思路，但保留我们的门面语义）：
 * 外层无论是 Vue 2 / Vue 3 / React / Svelte / 纯 HTML，都只需要写一个标签：
 *
 *   <feishu-document readonly theme="light" toolbar-keys="headings,marks"></feishu-document>
 *   document.querySelector('feishu-document').getJSON()
 *
 * 三条硬约束：
 * 1. 本文件不 import 任何 UI 框架，只依赖 mount/ 渲染适配层与 FeishuDocument 门面；
 * 2. 样式采用 Light DOM（不建 Shadow Root）：编辑器需要与宿主共享字体、焦点管理与滚动容器，
 *    且现有 CSS 全部以 `.feishu-document` 前缀收口，隔离性由选择器而非 Shadow DOM 保证；
 * 3. 任何异常都收敛成本元素的 `feishu-error` 事件 + console.error，绝不把宿主页面打挂。
 *
 * 生命周期健壮性要点（都是踩过的坑）：
 * - connectedCallback 延到微任务执行：宿主常在 appendChild 之后才设置 property；
 * - disconnectedCallback 延到宏任务并复查 isConnected：React 18 StrictMode、
 *   框架做 DOM 移动/复用时会先 disconnect 再 reconnect，立即 destroy 会让编辑器消失；
 * - 重复 connect / 重复 disconnect 都幂等；destroy 后再次插入可以重建。
 */

import { FeishuDocument } from '../FeishuDocument'
import { OBSERVED_ATTRIBUTES, readOptionsFromElement, applyAttributeChange } from './attributes'

/**
 * 对外事件名（全部冒泡 + composed，方便宿主在任意祖先节点委托监听）。
 * payload 一律是纯数据（不含 Vue 实例 / ProseMirror 对象），避免跨框架时
 * Proxy 包装导致的结构化克隆失败。
 */
const EVENT_MAP = Object.freeze({
  ready: 'feishu-ready',
  update: 'feishu-update',
  change: 'feishu-change',
  save: 'feishu-save',
  error: 'feishu-error',
  destroy: 'feishu-destroy',
  'import-report': 'feishu-import-report',
  'title-change': 'feishu-title-change',
})

/** 需要从宿主实例转发到元素上的快捷方法（只读 + 幂等命令，写操作走 getInstance()）。 */
const PROXIED_METHODS = Object.freeze([
  'getHTML', 'getJSON', 'getText', 'getTitle', 'setTitle', 'getConfig', 'getSession', 'can',
  'setReadonly', 'isReadonly', 'focus', 'undo', 'redo', 'setContent', 'importVditor', 'insert',
  'insertText', 'getImportReport', 'save', 'connectCollaboration', 'disconnectCollaboration',
])

export class FeishuDocumentElement extends HTMLElement {
  constructor() {
    super()
    /** @type {FeishuDocument|null} 门面实例；宿主可用 el.document 直接操作。 */
    this.document = null
    this.ready = false
    this._rendererProps = {}
    this._options = {}
    this._connectTask = null
    this._disconnectTask = null
    this._eventNameMap = EVENT_MAP
    this._bindEvents = this._bindEvents.bind(this)
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
    if (!this.document) return // 尚未挂载：等首次 mount 统一读取全部属性
    const result = applyAttributeChange(name, newValue)
    if (result.rebuild) { this._scheduleRebuild(); return }
    if (result.props && Object.keys(result.props).length) this._safePatch(result.props)
    if (name === 'theme') this._applyTheme()
  }

  /* ------------------------------ 挂载 / 卸载 ------------------------------ */

  _mount() {
    if (this.document || !this.isConnected) return
    const { options, props } = readOptionsFromElement(this)
    this._rendererProps = props
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
      this.document = new FeishuDocument(this._options)
      this._bindEvents()
      this.ready = true
      this._applyTheme()
      this.setAttribute('data-mounted', 'true')
      // ready 由门面事件统一派发，这里只补发一次 DOM 层面的 mounted 信号。
      this.dispatchEvent(new CustomEvent('feishu-mounted', {
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
      // 不可克隆：降级为浅拷贝可序列化字段
    }
    const plain = {}
    Object.keys(payload).forEach((key) => {
      const value = payload[key]
      const type = typeof value
      if (value == null || ['string', 'number', 'boolean', 'object'].includes(type)) plain[key] = value
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
   * 取宿主写在标签内的 HTML（`<feishu-document><h1>标题</h1></feishu-document>`）。
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

  _applyTheme() {
    const theme = this.getAttribute('theme') === 'dark' ? 'dark' : 'light'
    if (this.document && this.document.options) this.document.options.theme = theme
    if (typeof this.document?._applyHostAttributes === 'function') this.document._applyHostAttributes()
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
    if (typeof console !== 'undefined') console.error(`[feishu-document] ${phase} 失败`, error)
    this.removeAttribute('data-mounted')
    this.dispatchEvent(new CustomEvent('feishu-error', {
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
  if (method in FeishuDocumentElement.prototype) return
  Object.defineProperty(FeishuDocumentElement.prototype, method, {
    configurable: true,
    enumerable: false,
    writable: true,
    value: function proxied(...args) {
      const instance = this.document
      if (!instance) {
        if (typeof console !== 'undefined') console.warn(`[feishu-document] 尚未就绪，${method}() 被忽略`)
        return null
      }
      if (typeof instance[method] !== 'function') return null
      return instance[method](...args)
    },
  })
})

export default FeishuDocumentElement
