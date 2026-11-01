// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { EditorController } from '../../src/editor/EditorController'
import { createNativeOptionsHost } from '../../src/editor/nativeOptionsHost'
import { DocumentSession } from '../../src/session/DocumentSession'

const runtimes = []
const editors = []

function createRuntime(input) {
  const runtime = createNativeOptionsHost(input)
  runtimes.push(runtime)
  return runtime
}

afterEach(() => {
  runtimes.splice(0).reverse().forEach(runtime => runtime.destroy())
  editors.splice(0).forEach(editor => editor.destroy())
  vi.restoreAllMocks()
})

describe('nativeOptionsHost 深层响应', () => {
  it('嵌套对象改动使 computed 失效，并按微任务合并路径 watch', async () => {
    const onChange = vi.fn()
    const changed = vi.fn()
    const getter = vi.fn(function () { return this.config.layout.title })
    const { host } = createRuntime({
      options: {
        data: () => ({ config: { layout: { title: '初始' } } }),
        computed: { title: getter },
        watch: { 'config.layout.title': changed },
      },
      onChange,
    })

    expect(host.title).toBe('初始')
    expect(host.title).toBe('初始')
    expect(getter).toHaveBeenCalledTimes(1)
    const config = host.config
    host.config.layout.title = '中间'
    host.config.layout.title = '最终'
    expect(host.config).toBe(config)
    expect(host.title).toBe('最终')
    expect(getter).toHaveBeenCalledTimes(2)
    expect(changed).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledTimes(2)
    await Promise.resolve()
    expect(changed).toHaveBeenCalledExactlyOnceWith('最终', '初始')
  })

  it('数组 push、splice、元素深层更新和删除均通知 deep watch', async () => {
    const changed = vi.fn()
    const { host } = createRuntime({
      options: {
        data: () => ({ rows: [{ title: '甲' }] }),
        computed: { titles() { return this.rows.map(row => row.title).join('/') } },
        watch: { rows: { deep: true, handler: changed } },
      },
    })
    const rows = host.rows
    expect(host.titles).toBe('甲')
    rows.push({ title: '乙' })
    rows[0].title = '修改'
    rows.splice(1, 1, { title: '丙' })
    expect(host.titles).toBe('修改/丙')
    await Promise.resolve()
    expect(changed).toHaveBeenCalledExactlyOnceWith(rows, rows)

    changed.mockClear()
    delete rows[0].title
    expect(host.titles).toBe('/丙')
    await Promise.resolve()
    expect(changed).toHaveBeenCalledExactlyOnceWith(rows, rows)
  })

  it('$set 新键与删除已有键响应，重复赋值和删除不存在的键不通知', async () => {
    const onChange = vi.fn()
    const changed = vi.fn()
    const { host } = createRuntime({
      options: {
        data: () => ({ settings: {} }),
        watch: { 'settings.enabled': changed },
      },
      onChange,
    })
    host.$set(host.settings, 'enabled', true)
    await Promise.resolve()
    expect(changed).toHaveBeenCalledExactlyOnceWith(true, undefined)
    host.settings.enabled = true
    delete host.settings.missing
    await Promise.resolve()
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(changed).toHaveBeenCalledTimes(1)

    delete host.settings.enabled
    await Promise.resolve()
    expect(changed).toHaveBeenLastCalledWith(undefined, true)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('computed 链保持缓存并清理条件分支的旧依赖', () => {
    const getter = vi.fn(function () { return this.useLeft ? this.left.value : this.right.value })
    const { host } = createRuntime({
      options: {
        data: () => ({ useLeft: true, left: { value: 1 }, right: { value: 10 } }),
        computed: { chosen: getter, doubled() { return this.chosen * 2 } },
      },
    })
    expect(host.doubled).toBe(2)
    expect(host.doubled).toBe(2)
    expect(getter).toHaveBeenCalledTimes(1)
    host.useLeft = false
    expect(host.doubled).toBe(20)
    expect(getter).toHaveBeenCalledTimes(2)
    host.left.value = 2
    expect(host.doubled).toBe(20)
    expect(getter).toHaveBeenCalledTimes(2)
    host.right.value = 11
    expect(host.doubled).toBe(22)
    expect(getter).toHaveBeenCalledTimes(3)
  })

  it('updateProps 使 prop 的 computed/watch 一起失效', async () => {
    const changed = vi.fn()
    const props = { title: '初始' }
    const { host, updateProps } = createRuntime({
      props,
      options: {
        computed: { caption() { return this.title } },
        watch: { title: changed },
      },
    })
    expect(host.caption).toBe('初始')
    props.title = '更新'
    updateProps()
    expect(host.caption).toBe('更新')
    await Promise.resolve()
    expect(changed).toHaveBeenCalledExactlyOnceWith('更新', '初始')
  })

  it('updateProps 同步失效读取其他 prop 的 alias computed/watch', async () => {
    const aliasChanged = vi.fn()
    const props = { title: '初始' }
    const { host, updateProps } = createRuntime({
      props,
      aliases: { label: { get: (_host, _state, input) => input.title } },
      options: {
        computed: { caption() { return this.label } },
        watch: { label: aliasChanged },
      },
    })
    expect(host.caption).toBe('初始')
    props.title = '更新'
    updateProps()
    expect.soft(host.caption).toBe('更新')
    await Promise.resolve()
    expect(aliasChanged).toHaveBeenCalledExactlyOnceWith('更新', '初始')
  })

  it('invalidateEditor 与 $forceUpdate 支持保持身份的外部状态刷新', async () => {
    const editor = { value: 1 }
    const sessionInstance = { allowed: true }
    const changed = vi.fn()
    const { host, invalidateEditor } = createRuntime({
      state: { editor, sessionInstance },
      options: {
        computed: { status() { return `${this.editor.value}/${this.sessionInstance.allowed}` } },
        watch: { status: changed },
      },
    })
    expect(host.status).toBe('1/true')
    editor.value = 2
    invalidateEditor()
    await Promise.resolve()
    expect(changed).toHaveBeenCalledExactlyOnceWith('2/true', '1/true')
    sessionInstance.allowed = false
    host.$forceUpdate()
    await Promise.resolve()
    expect(changed).toHaveBeenLastCalledWith('2/false', '2/true')
  })
})

describe('nativeOptionsHost 第三方对象身份', () => {
  it('真实 Editor、PM doc/selection、EditorController、Session 与 DOM 均不被代理', () => {
    const editor = new Editor({ extensions: [StarterKit], content: '<p>正文</p>' })
    editors.push(editor)
    const session = new DocumentSession()
    const controller = new EditorController({ editor, session })
    const element = document.createElement('div')
    const doc = editor.state.doc
    const selection = editor.state.selection
    const objects = { editor, controller, session, element, doc, selection }
    const { host, state } = createRuntime({
      options: {},
      state: { editor, editorController: controller, sessionInstance: session, objects },
    })

    expect(host.editor).toBe(editor)
    expect(state.editor).toBe(editor)
    expect(host.editorController).toBe(controller)
    expect(host.sessionInstance).toBe(session)
    Object.entries(objects).forEach(([key, value]) => expect(host.objects[key]).toBe(value))
    expect(host.editor.state.doc.resolve(1).parent).toBe(doc.firstChild)
    expect(host.objects.selection.$from.doc).toBe(doc)
    host.sessionInstance.attachEditor(host.editor)
    expect(session.getEditor()).toBe(editor)
  })

  it('特殊根字段中的普通第三方对象也保持原始身份', () => {
    const editor = { storage: {} }
    const editorController = { editor }
    const sessionInstance = { providers: {} }
    const { host } = createRuntime({ options: {}, state: { editor, editorController, sessionInstance } })
    expect(host.editor).toBe(editor)
    expect(host.editor.storage).toBe(editor.storage)
    expect(host.editorController).toBe(editorController)
    expect(host.sessionInstance).toBe(sessionInstance)
    const next = { storage: {} }
    host.editor = next
    expect(host.editor).toBe(next)
  })

  it('Map、Set、Date、冻结对象及自定义类保持身份和可调用性', () => {
    class Provider { value() { return this } }
    const map = new Map([['key', 'value']])
    const set = new Set(['value'])
    const date = new Date(0)
    const frozen = Object.freeze({ nested: {} })
    const sealed = Object.seal({ value: 1 })
    const provider = new Provider()
    const { host } = createRuntime({ options: {}, state: { objects: { map, set, date, frozen, sealed, provider } } })
    Object.entries({ map, set, date, frozen, sealed, provider }).forEach(([key, value]) => {
      expect(host.objects[key]).toBe(value)
    })
    expect(host.objects.map.get('key')).toBe('value')
    expect(host.objects.set.has('value')).toBe(true)
    expect(host.objects.date.getTime()).toBe(0)
    expect(host.objects.provider.value()).toBe(provider)
    expect(host.objects.frozen.nested).toBe(frozen.nested)
  })
})

describe('nativeOptionsHost watch 与生命周期', () => {
  it('嵌套 mixin 按顺序合并 data/methods，显式 state 优先并保持方法绑定', () => {
    const { host, state } = createRuntime({
      state: { seeded: '外部' },
      props: { suffix: '后缀' },
      options: {
        mixins: [{
          mixins: [{ data: () => ({ inherited: true, value: '内层' }) }],
          data: () => ({ seeded: 'mixin', value: '中层' }),
          methods: { describe() { return '旧方法' } },
        }],
        data: () => ({ seeded: '组件', value: '最外层' }),
        methods: { describe() { return `${this.seeded}/${this.value}/${this.suffix}` } },
      },
    })
    const describeHost = host.describe
    expect(host.$data).toBe(state)
    expect(host.inherited).toBe(true)
    expect(host.seeded).toBe('外部')
    expect(describeHost()).toBe('外部/最外层/后缀')
  })

  it('computed setter 与 alias setter 回写响应式 state', async () => {
    const changed = vi.fn()
    const refs = { input: document.createElement('input') }
    const slots = { actions: true }
    const { host } = createRuntime({
      refs, slots,
      aliases: { localTitle: { get: (_host, state) => state.title, set: (value, _host, state) => { state.title = value } } },
      options: {
        data: () => ({ title: '初始' }),
        computed: { caption: { get() { return this.title }, set(value) { this.title = value } } },
        watch: { title: changed },
      },
    })
    expect(host.$refs).toBe(refs)
    expect(host.$slots).toBe(slots)
    host.caption = 'computed'
    expect(host.localTitle).toBe('computed')
    host.localTitle = 'alias'
    expect(host.caption).toBe('alias')
    await Promise.resolve()
    expect(changed).toHaveBeenCalledExactlyOnceWith('alias', '初始')
  })

  it('watch 支持数组、方法名、immediate，且保留 mixin 同名 watcher', async () => {
    const calls = []
    const mixinHandler = vi.fn(function (value, old) { calls.push(['mixin', value, old, this.value]) })
    const ownHandler = vi.fn(function (value, old) { calls.push(['own', value, old, this.value]) })
    const { host } = createRuntime({
      options: {
        mixins: [{ data: () => ({ value: 0 }), watch: { value: mixinHandler } }],
        methods: { record(value, old) { calls.push(['method', value, old, this.value]) } },
        watch: { value: [{ immediate: true, handler: 'record' }, ownHandler] },
      },
    })
    expect(calls).toEqual([['method', 0, undefined, 0]])
    host.value = 1
    host.value = 2
    await Promise.resolve()
    expect(calls).toEqual([
      ['method', 0, undefined, 0],
      ['mixin', 2, 0, 2],
      ['method', 2, 0, 2],
      ['own', 2, 0, 2],
    ])
  })

  it('标量 watch 的最终值未变时不回调，deep watch 仍接收同一对象', async () => {
    const scalar = vi.fn()
    const deep = vi.fn()
    const { host } = createRuntime({
      options: {
        data: () => ({ value: 0, nested: { value: 0 } }),
        watch: { value: scalar, nested: { deep: true, handler: deep } },
      },
    })
    host.value = 1
    host.value = 0
    host.nested.value = 1
    await Promise.resolve()
    expect(scalar).not.toHaveBeenCalled()
    expect(deep).toHaveBeenCalledExactlyOnceWith(host.nested, host.nested)
  })

  it('flush 执行 watcher 新增的待办，$nextTick 在回调前完成 watch 且绑定 host', async () => {
    const calls = []
    const { host } = createRuntime({
      options: {
        data: () => ({ first: 0, second: 0 }),
        watch: {
          first(value) { calls.push(['first', value]); this.second = value + 1 },
          second(value) { calls.push(['second', value]) },
        },
      },
    })
    host.first = 2
    const result = await host.$nextTick(function () {
      expect(this).toBe(host)
      calls.push(['tick', this.second])
      return '完成'
    })
    expect(result).toBe('完成')
    expect(calls).toEqual([['first', 2], ['second', 3], ['tick', 3]])
    await expect(host.$nextTick()).resolves.toBeUndefined()
  })

  it('immediate、created、mounted、beforeDestroy 按嵌套 mixin 顺序且 destroy 幂等', () => {
    const calls = []
    const layer = name => ({
      created() { calls.push([name, 'created', this._isDestroyed]) },
      mounted() { calls.push([name, 'mounted', this.value]) },
      beforeDestroy() { calls.push([name, 'beforeDestroy', this._isBeingDestroyed, this._isDestroyed]) },
    })
    const runtime = createRuntime({
      options: {
        ...layer('组件'),
        mixins: [{ ...layer('mixin'), mixins: [layer('内层')] }],
        data: () => ({ value: 1 }),
        watch: { value: { immediate: true, handler(value) { calls.push(['immediate', value]) } } },
      },
    })
    expect(calls).toEqual([
      ['immediate', 1], ['内层', 'created', false], ['mixin', 'created', false], ['组件', 'created', false],
    ])
    runtime.mount()
    runtime.destroy()
    runtime.destroy()
    expect(calls.slice(4)).toEqual([
      ['内层', 'mounted', 1], ['mixin', 'mounted', 1], ['组件', 'mounted', 1],
      ['内层', 'beforeDestroy', true, false], ['mixin', 'beforeDestroy', true, false], ['组件', 'beforeDestroy', true, false],
    ])
    expect(runtime.host._isDestroyed).toBe(true)
  })

  it('destroy 清除已排队的 watch、$nextTick 与后续事件/方法/状态写入', async () => {
    const changed = vi.fn()
    const callback = vi.fn()
    const emit = vi.fn()
    const onChange = vi.fn()
    const method = vi.fn()
    const runtime = createRuntime({
      emit, onChange,
      options: {
        data: () => ({ value: 0, nested: { value: 0 } }),
        methods: { run: method },
        watch: { value: changed, nested: { deep: true, handler: changed } },
        beforeDestroy() {
          this.$emit('destroying')
          this.$nextTick(callback)
        },
      },
    })
    const { host } = runtime
    const nested = host.nested
    host.value = 1
    nested.value = 1
    const tick = host.$nextTick(callback)
    const notifications = onChange.mock.calls.length
    runtime.destroy()
    host.value = 2
    nested.value = 2
    host.$set(nested, 'extra', true)
    delete nested.value
    host.$emit('late')
    host.run()
    runtime.updateProps()
    runtime.invalidateEditor()
    runtime.flush()
    await expect(tick).resolves.toBeUndefined()
    await Promise.resolve()

    expect(changed).not.toHaveBeenCalled()
    expect(callback).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
    expect(method).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledTimes(notifications)
    expect(host.value).toBe(1)
    expect(nested.value).toBe(1)
    expect(nested.extra).toBeUndefined()
  })
})
