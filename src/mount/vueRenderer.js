/**
 * mount/vueRenderer — Vue 2 渲染适配器。
 *
 * 用运行时 render 函数挂载 FeishuDocumentWorkspace（不用模板编译器），
 * 这是包体积与兼容性之间的既有取舍。对外只暴露 mount/update/destroy/getInstance
 * 四个动作，所有 Vue 细节（$refs、$mount、$destroy）都关在这一个文件里，
 * 门面与 Web Component 外壳不需要知道底层是 Vue。
 */
import Vue from 'vue'
import FeishuDocumentWorkspace from '../components/feishu/FeishuDocumentWorkspace.vue'

/**
 * @typedef {Object} MountRequest
 * @property {Element} element  挂载父节点
 * @property {Object} props     Workspace props
 * @property {Object} on        事件回调表 { ready, update, change, save, error, 'import-report' }
 */

/** 把 props / on 转成 Vue render 函数的第二个参数（attrs 无slot 场景足够）。 */
function dataSplat(props, on) {
  return { ref: 'workspace', props, on }
}

export function createVue2Renderer() {
  return {
    name: 'vue2',

    /**
     * 挂载并返回句柄。handle.el 是插入的根节点，destroy 时按它移除；
     * 门面通过 getInstance() 拿到 Workspace 组件实例转发方法。
     */
    mount({ element, props, on }) {
      const vm = new Vue({
        name: 'FeishuDocumentHost',
        render: (h) => h(FeishuDocumentWorkspace, dataSplat(props, on)),
      })
      vm.$mount()
      if (vm.$el && element && typeof element.appendChild === 'function') element.appendChild(vm.$el)
      return { vm }
    },

    /**
     * 增量更新：Vue 2 的 props 是响应式的，直接整体覆盖即可，
     * 未变化的键 Vue 会自行 diff，不需要上层做浅比较。
     */
    update(handle, props) {
      if (!handle || !handle.vm || !handle.vm.$refs.workspace) return
      const component = handle.vm.$refs.workspace
      Object.keys(props).forEach((key) => {
        // 只有 Workspace 显式声明过的 prop 才允许写入，避免把渲染器内部字段塞进去。
        if (key in component.$options.props) component.$props[key] = props[key]
      })
      if (props && typeof props._forceUpdate === 'boolean' && props._forceUpdate) component.$forceUpdate()
    },

    destroy(handle) {
      if (!handle || !handle.vm) return
      const vm = handle.vm
      const el = vm.$el
      handle.vm = null
      try {
        vm.$destroy()
      } catch (error) {
        if (typeof console !== 'undefined') console.error('[mount/vue2] 卸载异常', error)
      }
      if (el && el.parentNode) el.parentNode.removeChild(el)
    },

    getInstance(handle) {
      if (!handle || !handle.vm) return null
      return handle.vm.$refs.workspace || null
    },

    /** 渲染出的根节点（供宿主设置主题 data 属性等）。 */
    getRoot(handle) {
      if (!handle || !handle.vm) return null
      return handle.vm.$el || null
    },
  }
}

export default createVue2Renderer
