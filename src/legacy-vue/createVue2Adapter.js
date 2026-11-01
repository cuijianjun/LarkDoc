import { createDomRenderer } from '../mount/domRenderer'

const methods = [
  'getEditor', 'getHTML', 'getJSON', 'getText', 'getTitle', 'setTitle', 'setContent', 'focus',
  'setReadonly', 'isReadonly', 'getSession', 'getImportReport', 'insertContent', 'insertText',
  'undo', 'redo', 'save', 'getWorkspace', 'record', 'saveNow', 'createSnapshot', 'restoreSnapshot',
  'toggleHistory', 'importDocument', 'exportDocument', 'startAI', 'stopAI', 'closeAI',
  'executeCommand', 'setMode', 'toggleSlides', 'isSlides', 'openVersionPanel', 'closeVersionPanel',
  'openSaveVersionDialog', 'toggleSharePopover', 'openPermissionDialog', 'openExportDialog',
  'createCommentFromSelection',
]

/** 只借宿主的 Vue2 生命周期、h 和 $emit；编辑器与 UI 均由同一个 DOM renderer 持有。 */
export function createVue2Adapter({ name, props, mapProps, editor = false }) {
  return {
    name,
    props,
    computed: {
      html: {
        cache: false,
        get() { return this._nativeRenderer?.getInstance(this._nativeHandle)?.getHTML() ?? this._pendingHTML ?? this.value ?? '' },
        set(value) {
          if (this._nativeHandle) this.setContent(value)
          else this._pendingHTML = value
        },
      },
      editor: { cache: false, get() { return this.getEditor() } },
    },
    watch: Object.fromEntries(Object.keys(props).map(key => [key, {
      deep: key === 'config',
      handler(value) {
        if (!this._nativeHandle) return
        const mapped = mapProps(this)
        const patch = Object.fromEntries(Object.entries(mapped).filter(([name, next]) =>
          !Object.is(next, this._nativeProps[name]) || (key === 'config' && name === 'config')))
        if (key !== 'config' && key !== 'maxLength' && key !== 'imageMaxSize') delete patch.config
        this._nativeProps = mapped
        this._nativeRenderer.update(this._nativeHandle, patch)
        if ((editor && key === 'value') || (!editor && key === 'initialContent')) {
          if (value !== this.getHTML()) this.setContent(value)
        }
      },
    }])),
    mounted() {
      this._nativeRenderer = createDomRenderer()
      const on = Object.fromEntries(['ready', 'update', 'change', 'save', 'error', 'import-report', 'mode-change', 'ai-request', 'update:title'].map(event => [event, payload => {
        if (event === 'ready' && !this._nativeHandle) {
          this.$nextTick(() => { if (this._nativeHandle) on.ready(payload) })
          return
        }
        if (event === 'change' && editor) this.$emit('input', payload.html)
        if (event === 'ai-request' && !editor) this.startAI(payload)
        if (event === 'update:title') this._lastNativeTitle = payload
        if (event === 'update') {
          const title = this.getTitle()
          if (title !== this._lastNativeTitle) {
            this._lastNativeTitle = title
            this.$emit('update:title', title)
          }
        }
        this.$emit(event, event === 'ready' && editor ? payload.editor : payload)
      }]))
      this._nativeProps = mapProps(this)
      this._nativeHandle = this._nativeRenderer.mount({ element: this.$refs.nativeHost, props: { ...this._nativeProps }, on })
      delete this._pendingHTML
      this._lastNativeTitle = this.getTitle()
      const refs = this._nativeHandle.nativeHost.host.$refs
      refs.actionsHost.appendChild(this.$refs.headerActions)
      refs.externalPanel.appendChild(this.$refs.sidePanel)
      if (editor) this._nativeHandle.workspaceUi.el.style.display = 'none'
    },
    beforeDestroy() {
      // 插槽节点归宿主 Vue 所有，先停泊回来，再销毁原生 DOM 子树。
      if (this.$refs.headerActions) this.$refs.slotPark.appendChild(this.$refs.headerActions)
      if (this.$refs.sidePanel) this.$refs.slotPark.appendChild(this.$refs.sidePanel)
      this._nativeRenderer?.destroy(this._nativeHandle)
      this._nativeHandle = null
      this._nativeRenderer = null
    },
    methods: Object.fromEntries(methods.map(method => [method, function (...args) {
      return this._nativeRenderer?.getInstance(this._nativeHandle)?.[method]?.(...args)
    }])),
    render(h) {
      return h('div', { class: 'lark-doc-vue2-adapter' }, [
        h('div', { ref: 'nativeHost' }),
        h('div', { ref: 'slotPark', style: { display: 'none' } }, [
          h('div', { ref: 'headerActions' }, this.$slots['header-actions']),
          h('div', { ref: 'sidePanel' }, this.$slots['side-panel']),
        ]),
      ])
    },
  }
}
