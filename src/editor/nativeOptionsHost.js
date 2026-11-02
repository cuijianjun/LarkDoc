/** 纯 JavaScript 行为对象的原生宿主；不加载 Vue，也不解析 SFC。 */
export function createNativeOptionsHost({ options, state: initialState = {}, props = {}, refs = {}, slots = {}, aliases = {}, emit, onChange }) {
  const layers = []
  const visit = option => {
    (option.mixins || []).forEach(visit)
    layers.push(option)
  }
  visit(options)
  const methods = Object.assign({}, ...layers.map(layer => layer.methods))
  const computed = Object.assign({}, ...layers.map(layer => layer.computed))
  const dependencies = new Map()
  const pending = new Set()
  const computedEffects = new Map()
  const watchers = []
  let currentEffect = null
  let scheduled = false
  let flushing = false
  let ready = false
  let destroying = false
  let destroyed = false
  let host
  const raw = { ...initialState }
  let sessionProviders = []

  const track = key => {
    if (!currentEffect) return
    if (!dependencies.has(key)) dependencies.set(key, new Set())
    dependencies.get(key).add(currentEffect)
    currentEffect.dependencies.add(key)
  }
  const evaluate = (effect, callback) => {
    effect.dependencies.forEach(key => dependencies.get(key)?.delete(effect))
    effect.dependencies.clear()
    const previous = currentEffect
    currentEffect = effect
    try { return callback() } finally { currentEffect = previous }
  }
  const invalidate = key => {
    [...(dependencies.get(key) || [])].forEach(effect => {
      if (effect.computed) {
        if (!effect.dirty) {
          effect.dirty = true
          invalidate(`computed:${effect.key}`)
        }
      } else pending.add(effect)
    })
  }
  const syncSessionProviders = () => {
    // Session 保持原始身份，只在 Provider 真正替换时使其依赖失效。
    const next = Object.entries(raw.sessionInstance?.providers || {})
    if (next.length === sessionProviders.length && next.every(([key, value], index) => key === sessionProviders[index][0] && value === sessionProviders[index][1])) return
    sessionProviders = next
    invalidate('data:sessionInstance')
  }
  const flush = () => {
    if (flushing || !ready || destroying || destroyed) return
    syncSessionProviders()
    flushing = true
    try {
      while (pending.size) {
        const batch = [...pending]
        pending.clear()
        batch.forEach(watcher => {
          const previous = watcher.value
          const value = evaluate(watcher, watcher.read)
          watcher.value = value
          if (watcher.deep || (value && typeof value === 'object') || !Object.is(value, previous)) watcher.handler.call(host, value, previous)
        })
      }
    } finally { flushing = false }
  }
  const notify = key => {
    invalidate(key)
    if (!ready || destroying || destroyed) return
    if (!scheduled) {
      scheduled = true
      Promise.resolve().then(() => { scheduled = false; flush() })
    }
    onChange?.()
  }
  // 只代理数据容器。Editor、Session、DOM、PM Node、定时器等均保持原始身份。
  const caches = new Map()
  const wrap = (value, root) => {
    if (!value || typeof value !== 'object' || root === 'editor' || root === 'editorController' || root === 'sessionInstance') return value
    const prototype = Object.getPrototypeOf(value)
    if ((!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) || !Object.isExtensible(value)) return value
    if (!caches.has(root)) caches.set(root, new WeakMap())
    const cache = caches.get(root)
    if (cache.has(value)) return cache.get(value)
    const proxy = new Proxy(value, {
      get(target, key, receiver) { track(`data:${root}`); return wrap(Reflect.get(target, key, receiver), root) },
      set(target, key, next) {
        if (destroyed) return true
        const changed = !Object.is(target[key], next)
        const result = Reflect.set(target, key, next)
        if (changed) notify(`data:${root}`)
        return result
      },
      deleteProperty(target, key) {
        if (destroyed) return true
        const existed = Object.prototype.hasOwnProperty.call(target, key)
        const result = Reflect.deleteProperty(target, key)
        if (existed) notify(`data:${root}`)
        return result
      },
    })
    cache.set(value, proxy)
    cache.set(proxy, proxy)
    return proxy
  }
  const state = new Proxy(raw, {
    get(target, key) { track(`data:${String(key)}`); return wrap(target[key], key) },
    set(target, key, value) {
      if (destroyed) return true
      const changed = !Object.is(target[key], value)
      target[key] = value
      if (changed) notify(`data:${String(key)}`)
      return true
    },
  })
  const target = {
    $refs: refs,
    $slots: slots,
    $data: state,
    $emit: (...args) => { if (!destroying && !destroyed) emit?.(...args) },
    $set: (object, key, value) => { if (!destroying && !destroyed) object[key] = value },
    $nextTick: callback => Promise.resolve().then(() => {
      if (destroying || destroyed) return undefined
      flush()
      return callback ? callback.call(host) : undefined
    }),
    $forceUpdate: () => {
      Object.keys(props).forEach(key => invalidate(`prop:${key}`))
      notify('data:sessionInstance')
    },
  }
  // Alias getter 可直接读取输入 props，仍须参与同一依赖图，否则 props 更新后
  // alias 下游的 computed/watch 会复用旧值。
  const trackedProps = new Proxy(props, {
    get(object, key) { track(`prop:${String(key)}`); return Reflect.get(object, key) },
  })
  host = new Proxy(target, {
    get(object, key) {
      if (key === '_isBeingDestroyed') return destroying
      if (key === '_isDestroyed') return destroyed
      if (Object.prototype.hasOwnProperty.call(object, key)) return object[key]
      if (aliases[key]) { track(`prop:${String(key)}`); return aliases[key].get(host, state, trackedProps) }
      if (computedEffects.has(key)) {
        syncSessionProviders()
        track(`computed:${key}`)
        const effect = computedEffects.get(key)
        if (effect.dirty) {
          effect.value = evaluate(effect, () => effect.get.call(host))
          effect.dirty = false
        }
        return effect.value
      }
      if (Object.prototype.hasOwnProperty.call(raw, key)) return state[key]
      track(`prop:${String(key)}`)
      return props[key]
    },
    set(object, key, value) {
      if (destroyed) return true
      if (aliases[key]?.set) aliases[key].set(value, host, state, props)
      else if (computedEffects.get(key)?.set) computedEffects.get(key).set.call(host, value)
      else if (Object.prototype.hasOwnProperty.call(object, key) || (typeof key === 'string' && (key.startsWith('_') || key.startsWith('$')))) object[key] = value
      else state[key] = value
      return true
    },
  })
  Object.entries(methods).forEach(([key, method]) => {
    target[key] = (...args) => destroyed ? undefined : method.apply(host, args)
  })
  Object.entries(computed).forEach(([key, definition]) => {
    computedEffects.set(key, { key, computed: true, dirty: true, dependencies: new Set(), get: typeof definition === 'function' ? definition : definition && definition.get, set: definition && definition.set })
  })
  const seeded = new Set(Object.keys(raw))
  layers.forEach(layer => {
    const data = layer.data?.call(host) || {}
    Object.entries(data).forEach(([key, value]) => { if (!seeded.has(key)) raw[key] = value })
  })
  layers.forEach(layer => {
    Object.entries(layer.watch || {}).forEach(([key, definitions]) => {
      (Array.isArray(definitions) ? definitions : [definitions]).forEach(definition => {
        const descriptor = typeof definition === 'function' || typeof definition === 'string' ? { handler: definition } : definition
        const watcher = {
          dependencies: new Set(),
          deep: Boolean(descriptor.deep),
          handler: typeof descriptor.handler === 'string' ? host[descriptor.handler] : descriptor.handler,
          read: () => key.split('.').reduce((value, name) => value?.[name], host),
        }
        watcher.value = evaluate(watcher, watcher.read)
        watchers.push(watcher)
        if (descriptor.immediate) watcher.handler.call(host, watcher.value, undefined)
      })
    })
  })
  ready = true
  layers.forEach(layer => layer.created?.call(host))
  return {
    host,
    state,
    flush,
    mount() { layers.forEach(layer => layer.mounted?.call(host)); flush() },
    updateProps() { Object.keys(props).forEach(key => notify(`prop:${key}`)) },
    invalidateEditor() { notify('data:editor') },
    destroy() {
      if (destroying || destroyed) return
      destroying = true
      try { layers.forEach(layer => layer.beforeDestroy?.call(host)) } finally {
        destroyed = true
        pending.clear()
        dependencies.clear()
        computedEffects.clear()
        watchers.length = 0
      }
    },
  }
}
