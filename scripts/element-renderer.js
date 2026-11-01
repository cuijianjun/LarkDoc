/** Element 构建专用接缝：公共入口同步导出，编辑器实现按需加载。 */
let rendererPromise

function loadRenderer() {
  if (!rendererPromise) {
    rendererPromise = import(/* webpackChunkName: "editor" */ '../src/mount/domRenderer.js')
      .then(module => module.createDomRenderer)
      .catch(error => { rendererPromise = null; throw error })
  }
  return rendererPromise
}

export function createDomRenderer() {
  return {
    name: 'dom-migration',
    mount({ element, props = {}, on = {} }) {
      const handle = { element, props: { ...props }, renderer: null, mounted: null, destroyed: false }
      loadRenderer().then(createRenderer => {
        if (handle.destroyed) return
        const renderer = createRenderer()
        handle.renderer = renderer
        handle.mounted = renderer.mount({
          element,
          props: handle.props,
          on: {
            ...on,
            // 同步 ready 必须等真实句柄落定，命令式宿主才能读取实例与应用主题。
            ready: payload => Promise.resolve().then(() => {
              if (!handle.destroyed && handle.mounted && typeof on.ready === 'function') on.ready(payload)
            }).catch(error => {
              if (!handle.destroyed && typeof on.error === 'function') on.error(error)
            }),
          },
        })
      }).catch(error => {
        if (!handle.destroyed && typeof on.error === 'function') on.error(error)
      })
      return handle
    },
    update(handle, props = {}) {
      if (!handle || handle.destroyed) return
      Object.assign(handle.props, props)
      if (handle.mounted) handle.renderer.update(handle.mounted, props)
    },
    destroy(handle) {
      if (!handle || handle.destroyed) return
      handle.destroyed = true
      if (handle.mounted) handle.renderer.destroy(handle.mounted)
    },
    getInstance(handle) {
      return handle && !handle.destroyed && handle.mounted ? handle.renderer.getInstance(handle.mounted) : null
    },
    getRoot(handle) {
      return handle && !handle.destroyed && handle.mounted ? handle.renderer.getRoot(handle.mounted) : null
    },
  }
}

export default createDomRenderer
