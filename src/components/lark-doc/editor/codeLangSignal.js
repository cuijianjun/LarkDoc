/**
 * 代码语言选择器的**触发信号**（04 §2.2）。
 *
 * 为什么要有这一条线：codeBlock 的 NodeView（Vue 2 适配层提供）拿不到 LarkDocEditor 实例；
 * 而浮层必须挂在 `LarkDocOverlays.vue`。两端不在同一棵组件树上，所以走模块级订阅，
 * 与 `themeSignal.js` 同一套「无实例引用的通道」写法。
 *
 * 为什么**不用** EventBus 式的全局单例：本库允许同页挂多个编辑器实例，广播会让所有
 * 实例一起弹浮层。所以 `requestCodeLangPicker` 的载荷里带 `editor`，订阅方自行比对
 * 身份（见 `codeLangMixin.onCodeLangRequest`）。
 *
 * ⚠️ 订阅者**全量保留**（不是单槽覆盖）：多实例场景每个都要收到，各自按 editor 过滤。
 */

const listeners = []

/**
 * 订阅「打开语言选择器」请求。
 * @param {(payload: {editor:object, pos:number, language:string, diagramEnabled:boolean, rect:DOMRect}) => void} handler
 * @returns {() => void} 退订函数
 */
export function subscribeCodeLangPicker(handler) {
  if (typeof handler !== 'function') return () => {}
  listeners.push(handler)
  return () => {
    const index = listeners.indexOf(handler)
    if (index !== -1) listeners.splice(index, 1)
  }
}

/** NodeView 侧调用：请求宿主打开选择器。 */
export function requestCodeLangPicker(payload) {
  listeners.slice().forEach((handler) => {
    try {
      handler(payload)
    } catch (error) {
      // 一个实例的渲染异常不能拖垮其它实例；浮层请求失败等同于「没点开」。
      if (typeof console !== 'undefined' && console.warn) console.warn('[lark-doc] codeLangPicker 请求处理失败', error)
    }
  })
}
