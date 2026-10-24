/**
 * adapters/react — React 端适配入口（P0-06）。
 *
 * 形态：`createReactLarkDoc(React)` 工厂——lark-doc 源码**零 react 依赖**，
 * React 实例由宿主传入（对齐 08 §4.1：适配层不写业务；08 §3 架构树
 * 「adapters/react → <LarkDoc ref>，useEffect 挂载，onChange 等事件」）。
 *
 * 职责边界（硬规则 5，三件事）：
 * 1. props → attributes：按 web-component/attributes 的 ATTRIBUTE_SCHEMA
 *    白名单序列化成 HTML 属性；
 * 2. 事件转发：onChange/onReady/onSave/onError → 元素上的
 *    lark-doc-change / lark-doc-ready / lark-doc-save / lark-doc-error；
 * 3. 方法代理：ref 暴露 getJSON / setContent / focus 等快捷方法
 *    （透传元素自身已代理的同名方法）。
 *
 * 用法（React 宿主）：
 *   import 'lark-doc/element'
 *   import { createReactLarkDoc } from 'lark-doc/adapters/react'
 *   const LarkDoc = createReactLarkDoc(React)
 *   <LarkDoc content={html} contentFormat="html" onChange={...} ref={docRef} />
 *
 * 注意：lark-doc/element 是构建产物（dist/lark-doc-element.umd.min.js），
 * 源码内含 Vue 2 SFC，React 宿主不能直接引 lark-doc 源码入口。
 */
import { ATTRIBUTE_SCHEMA } from '../../web-component/attributes'
// 只引零依赖的 events 名单，不引 LarkDocElement（其依赖链含 Vue 2 SFC，
// React 宿主构建器没有 Vue 2 插件，引了就编译失败——P0-06 踩坑修正）。
import { EVENT_MAP } from '../../web-component/events'

/** 元素上可直接透传的快捷方法（与 web-component PROXIED_METHODS 的宿主常用子集保持一致）。 */
const PROXY_METHODS = Object.freeze([
  'getHTML', 'getJSON', 'getText', 'getTitle', 'setTitle', 'getConfig', 'getSession',
  'setReadonly', 'isReadonly', 'focus', 'undo', 'redo', 'setContent', 'insert',
  'insertText', 'save',
])

/** React 事件 props（camelCase）→ 元素 CustomEvent 名。未列出的门面事件用 on + 事件名即可扩展。 */
const PROP_EVENTS = Object.freeze({
  onReady: EVENT_MAP.ready,
  onUpdate: EVENT_MAP.update,
  onChange: EVENT_MAP.change,
  onSave: EVENT_MAP.save,
  onError: EVENT_MAP.error,
})

export function createReactLarkDoc(React) {
  if (!React || typeof React.createElement !== 'function') {
    throw new Error('createReactLarkDoc(React) 需要传入 React 实例')
  }
  const { createElement, forwardRef, useEffect, useImperativeHandle, useRef } = React

  const LarkDoc = forwardRef(function LarkDoc(props, ref) {
    const elRef = useRef(null)
    const handlersRef = useRef({})
    handlersRef.current = props

    useEffect(() => {
      const el = elRef.current
      if (!el) return undefined
      const unbinders = Object.entries(PROP_EVENTS).map(([prop, domEvent]) => {
        const handler = (event) => {
          const callback = handlersRef.current[prop]
          if (typeof callback === 'function') callback(event.detail, event)
        }
        el.addEventListener(domEvent, handler)
        return () => el.removeEventListener(domEvent, handler)
      })
      return () => unbinders.forEach((unbind) => unbind())
    }, [])

    useImperativeHandle(ref, () => {
      // 方法体在调用时现取 elRef.current：不依赖挂载时序（DOM ref 先于父 ref 被赋值）。
      const proxy = {}
      PROXY_METHODS.forEach((method) => {
        proxy[method] = (...args) => {
          const el = elRef.current
          if (!el || typeof el[method] !== 'function') return undefined
          return el[method](...args)
        }
      })
      // 写操作（命令级）走 getEditor()：proxy.getEditor().commands.insertTable(...)
      proxy.getEditor = () => {
        const el = elRef.current
        return el && typeof el.getEditor === 'function' ? el.getEditor() : null
      }
      proxy.getInstance = () => {
        const el = elRef.current
        return el && typeof el.getInstance === 'function' ? el.getInstance() : null
      }
      Object.defineProperty(proxy, 'element', { get: () => elRef.current })
      return proxy
    }, [])

    // props → attributes：按 ATTRIBUTE_SCHEMA 白名单序列化；事件 props 不进 attributes。
    const attrs = { ref: elRef }
    const eventProps = new Set(Object.keys(PROP_EVENTS))
    for (const [key, value] of Object.entries(props)) {
      if (eventProps.has(key) || value == null) continue
      const attr = key.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)
      const entry = ATTRIBUTE_SCHEMA.find((item) => item.attr === attr)
      if (!entry) {
        if (typeof console !== 'undefined') {
          console.warn(`[lark-doc adapters/react] 未登记的属性 "${key}" 已忽略（对象型配置请走 element.options property）`)
        }
        continue
      }
      attrs[attr] = entry.type === 'string'
        ? String(value)
        : entry.type === 'object' || (entry.type === 'json' && typeof value === 'object')
          ? JSON.stringify(value)
          : String(value)
    }
    return createElement('lark-doc', attrs)
  })

  LarkDoc.displayName = 'LarkDoc'
  return LarkDoc
}

export { EVENT_MAP as LARK_DOC_EVENTS }
