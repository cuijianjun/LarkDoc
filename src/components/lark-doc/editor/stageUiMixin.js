/** Full-document presentation wiring. Closed presentations never scan or clone the document. */
import { createSlideStage } from '../../../ui/stage'

export default {
  watch: {
    slides() { this.refreshStage() },
    localTitle() { if (this.slides) this.refreshStage() },
    editor(value, previous) { if (value !== previous && this.slides) this.exitSlides(true, false) },
    session(value, previous) { if (value !== previous && this.slides) this.exitSlides(true, false) },
    'session.documentId'() { if (this.slides) this.exitSlides(true, false) },
    documentId() { if (this.slides) this.exitSlides(true, false) },
    larkDocConfig: { deep: true, handler() { if (this.slides) this.refreshStage() } },
  },
  methods: {
    mountStage() {
      if (this._stageUi || !this.$refs.stageHost) return
      this._stageUi = createSlideStage({
        host: this.$refs.stageHost,
        handlers: {
          onExit: () => this.exitSlides(),
          onImageComment: typeof this.openImageComments === 'function' ? (...args) => this.openImageComments(...args) : undefined,
        },
      })
      this.refreshStage()
    },
    destroyStage() {
      this.exitSlides(true, false)
      this._stageUi?.destroy()
      this._stageUi = null
    },
    buildStageState() {
      if (!this.slides) return { open: false }
      if (!this.presentationCurrent()) { this.exitSlides(true, false); return { open: false } }
      const images = []
      this.editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'image') images.push({ ...node.attrs, pos })
      })
      return { open: true, title: this.localTitle || '文档', source: this.editor.view.dom, images,
        // Read live policy even before the framework's configuration watcher runs.
        getNetwork: () => this.larkDocConfig?.network,
        isCurrent: () => this.presentationCurrent(),
      }
    },
    refreshStage() { this._stageUi?.update(this.buildStageState()) },
  },
}
