/**
 * 顶栏「通知」popover（requirements/04 §4.6.4，batch106 空态全采）。
 *
 * 尺寸：外壳 **402×555**、z **999**（比「更多/新建」的 1030 低一档，`04 §0.3`），
 * 外壳透明底 + padding `3px 0 0`，白底在内层 content。
 *
 * 头部四件套（都在一行，402 − 2×12 padding = 378 可用宽）：
 *   标题「当前文档通知」**14px/700 `#1F2329`**（84×17）+ 铃铛 **14×14** +
 *   「关闭通知」**56×22 14px/400** + 「全部已读」**56×17 14px/400 `#BBBFC4`**（禁用态）。
 *
 * 空态是三件套（`04 §4.6.4` 🔑）：
 *   插图 **120×120** + 主文案 64×24 **16px/500** + 副文案 **250×66 14px `#646A73`**。
 *
 * 🔴 DOM 链比别的浮层多包两层 loading 容器（`ud__loading-nested-loading` →
 * `ud__loading__container`），后者必须 `position: relative`。复刻保留这两层 ——
 * 宿主以后要塞骨架屏/加载指示器时，改 `notifyLoading` 即可，不用动结构。
 *
 * 数据来源：本 mixin 只持有列表与本地态，不联网。宿主要喂数据用 `setNotifications(list)`
 * （`{ id, title, body, createdAt, readAt }`）；`notifyOpen` 变 true 时 emit `notify-open`，
 * 宿主可以在这时拉接口。没有数据就渲染空态 —— 空态本身就是被实测过的完整形态。
 */
import { anchorPopoverStyle } from './popoverPosition'

/** 外壳尺寸（实测 402×555）。 */
export const NOTIFY_SIZE = Object.freeze({ width: 402, height: 555 })

export const NOTIFY_TITLE = '当前文档通知'

export default {
  data() {
    return {
      notifyOpen: false,
      notifyAnchor: null,
      notifyStyle: { left: 0, top: 0 },
      /** 宿主注入的通知列表（按 createdAt 倒序由宿主保证，这里不排序）。 */
      notifyItems: [],
      /** 是否处于「已关闭通知」态（文案随之变「开启通知」）。 */
      notifyMuted: false,
      /** 加载中：保留双层 loading 容器，骨架屏由宿主决定要不要用。 */
      notifyLoading: false,
    }
  },
  computed: {
    notifyUnreadCount() {
      const list = this.notifyItems || []
      let count = 0
      for (let i = 0; i < list.length; i += 1) if (!list[i].readAt) count += 1
      return count
    },
    /** 「全部已读」的禁用态：0 条未读即 `#BBBFC4`（`04 §4.6.4` 的 `disable-text`）。 */
    notifyAllReadDisabled() {
      return this.notifyUnreadCount === 0
    },
    /** 头部右侧按钮文案（关闭 ⇄ 开启）。 */
    notifyMuteLabel() {
      return this.notifyMuted ? '开启通知' : '关闭通知'
    },
    notifyEmpty() {
      return !this.notifyLoading && (!this.notifyItems || this.notifyItems.length === 0)
    },
  },
  methods: {
    toggleNotify(event) {
      if (this.notifyOpen) {
        this.closeNotify()
        return
      }
      const el = event && event.currentTarget
      const rect = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null
      if (!rect) return
      this.notifyAnchor = rect
      this.notifyOpen = true
      this.notifyStyle = anchorPopoverStyle(rect, NOTIFY_SIZE, {
        width: window.innerWidth,
        height: window.innerHeight,
      }, { align: 'right' })
      this.$emit('notify-open')
      this.$nextTick(this.measureNotify)
    },
    closeNotify() {
      this.notifyOpen = false
      this.notifyAnchor = null
    },
    measureNotify() {
      const el = this.$refs && this.$refs.notifyPopover
      if (!el || !this.notifyAnchor) return
      this.notifyStyle = anchorPopoverStyle(this.notifyAnchor, el.getBoundingClientRect(), {
        width: window.innerWidth,
        height: window.innerHeight,
      }, { align: 'right' })
    },
    /** 宿主喂数据（不动开关，可在打开前后任意时刻调）。 */
    setNotifications(list) {
      this.notifyItems = Array.isArray(list) ? list : []
    },
    /** 「全部已读」：只改本地 readAt，不关面板（与飞书一致，用户还要继续看列表）。 */
    markAllNotifyRead() {
      if (this.notifyAllReadDisabled) return
      const now = Date.now()
      this.notifyItems = this.notifyItems.map((item) => (item.readAt ? item : { ...item, readAt: now }))
      this.$emit('notify-read', { all: true })
    },
    toggleNotifyMute() {
      this.notifyMuted = !this.notifyMuted
      this.$emit('notify-mute', { muted: this.notifyMuted })
    },
    notifyContains(node) {
      if (!node || !node.closest) return false
      return Boolean(node.closest('.lark-doc-notify-popover, .lark-doc-notify-btn'))
    },
  },
}
