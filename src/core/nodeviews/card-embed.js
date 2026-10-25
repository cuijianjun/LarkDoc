/**
 * 卡片块 NodeView（P3-04）—— 纯 DOM，core 零 UI 框架依赖。
 *
 * 三条设计要点：
 *
 *   1. **DOM 直接来自 `renderHTML`**，不另写一份。用 `DOMSerializer.fromSchema()` 序列化
 *      当前节点，拿到的元素就是导出产物（`getHTML()` / PDF / DOCX）那一份。两套 DOM 一定
 *      会漂移，而卡片恰恰是「导出必须带内容」的块 —— 漂移的代价是导出一片空白。
 *   2. **点击不自己跳转**：`data-card-action` 上的 click / Enter / Space 一律转成
 *      `onAction({ providerId, resourceId, actionId, payload, action })` 冒泡给宿主。
 *      `kind: 'open'` 的 href 也交给宿主决定要不要开 —— 编辑器不持 token、不发请求。
 *   3. **只读态**（`isFutureCard`）：卡片由更高版本创建，内容照画，但动作不绑事件、
 *      摘掉 `tabindex`、加 `aria-disabled` —— 让它「看得见、点不了」，而不是藏起来。
 *      这也是 §3.5「只读 + 原样保留」在 DOM 上的唯一落点。
 *
 * 为什么 `update()` 在卡片内容变了时返回 false（让 PM 重造 NodeView）：卡片更新是低频
 * 操作（一次 attrs 变化 = 一次重建），而增量同步 DOM（换子节点 + 重挂监听）要维护
 * 「哪些节点带监听」这份影子状态，一旦漏掉就是「按钮点了没反应」。重造没有这类残影。
 */
import { DOMSerializer } from '@tiptap/pm/model'
import { isFutureCard, readCard } from '../embed/card'

/** 动作按钮的定位选择器（由 `renderHTML` 写入，导出产物里也在，不影响静态快照）。 */
const ACTION_SELECTOR = '[data-card-action]'

export function createCardEmbedNodeView(props) {
  const { node, extension } = props
  const options = (extension && extension.options) || {}

  let currentNode = node
  let serializer = null
  let destroyed = false

  /** 序列化器只建一次：schema 在同一个 editor 生命周期里不变。 */
  function getSerializer() {
    if (!serializer) serializer = DOMSerializer.fromSchema(currentNode.type.schema)
    return serializer
  }

  /** 用节点自己的 `toDOM`（即 `renderHTML`）造元素 —— 与导出走的是同一条路。 */
  function renderElement() {
    const rendered = getSerializer().serializeNode(currentNode)
    return rendered && rendered.nodeType === 1 ? rendered : null
  }

  const card = () => readCard((currentNode.attrs || {}).card)

  /** 只读：没有卡片数据（占位卡）或版本比我们新。两种情况都不该有可点的动作。 */
  const readOnly = () => {
    const current = card()
    return !current || isFutureCard(current)
  }

  /* ---------- 动作冒泡 ---------- */

  function emit(actionId) {
    const current = card()
    if (!current || !actionId || typeof options.onAction !== 'function') return
    const list = Array.isArray(current.actions) ? current.actions : []
    const action = list.filter((item) => item && item.id === actionId)[0] || null
    if (!action) return
    try {
      options.onAction({
        providerId: current.providerId,
        resourceId: current.resourceId || null,
        actionId,
        payload: current.payload || null,
        action,
      })
    } catch (_) {
      // 宿主回调抛错不该把编辑器带崩：卡片是外来内容，宿主是它唯一的执行方。
    }
  }

  function actionIdOf(element) {
    return element && typeof element.getAttribute === 'function'
      ? element.getAttribute('data-card-action') || ''
      : ''
  }

  function onActivate(event) {
    if (destroyed) return
    emit(actionIdOf(event && event.currentTarget))
  }

  function onKeyDown(event) {
    const key = event && event.key
    // 'Spacebar' 是老浏览器 / IE 口径，一并认掉。
    if (key !== 'Enter' && key !== ' ' && key !== 'Spacebar') return
    if (typeof event.preventDefault === 'function') event.preventDefault()
    onActivate(event)
  }

  function bindActions() {
    if (!dom || typeof dom.querySelectorAll !== 'function') return
    const readonly = readOnly()
    Array.prototype.forEach.call(dom.querySelectorAll(ACTION_SELECTOR), (element) => {
      if (readonly) {
        element.removeAttribute('tabindex')
        element.setAttribute('aria-disabled', 'true')
        return
      }
      element.addEventListener('click', onActivate)
      element.addEventListener('keydown', onKeyDown)
    })
  }

  function syncState() {
    if (!dom || typeof dom.setAttribute !== 'function') return
    dom.setAttribute('data-card-state', readOnly() ? 'readonly' : 'active')
  }

  const dom = renderElement() || document.createElement('div')
  bindActions()
  syncState()

  return {
    dom,

    update(nextNode) {
      if (destroyed) return false
      if (!nextNode || !nextNode.type || nextNode.type.name !== 'cardEmbed') return false
      const previous = currentNode.attrs || {}
      const next = nextNode.attrs || {}
      // 只有 card 与 blockId 参与渲染，两者都没动就不必碰 DOM（属性对象可能是新的）。
      const unchanged = (previous.card || null) === (next.card || null)
        && (previous.blockId || null) === (next.blockId || null)
      currentNode = nextNode
      return unchanged
    },

    /**
     * 动作按钮上的事件停在这里，不进 ProseMirror。
     *
     * 只拦动作、不拦整张卡：`mousedown` 若被 PM 接管会 `preventDefault()` 掉，
     * 后续 `click` 可能不再派发到按钮上（点了没反应）；而卡片空白处仍应能点选。
     */
    stopEvent(event) {
      if (readOnly()) return false
      const target = event && event.target
      return Boolean(target && typeof target.closest === 'function' && target.closest(ACTION_SELECTOR))
    },

    ignoreMutation() { return true },

    destroy() { destroyed = true },

    /* ---------- 测试与宿主联调通道 ---------- */
    card,
    readonly: readOnly,
    /** 当前可点的动作 id 列表（只读态为空 —— 测试据此判「点不了」）。 */
    actionIds() {
      if (!dom || typeof dom.querySelectorAll !== 'function') return []
      return Array.prototype.map.call(
        dom.querySelectorAll(ACTION_SELECTOR),
        (element) => actionIdOf(element),
      )
    },
  }
}

export default createCardEmbedNodeView
