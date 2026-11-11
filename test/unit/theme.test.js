/**
 * 主题机制层单测（Node 环境，无 DOM）：
 * controller 的 DOM 依赖全部走注入（getRoot / hostSkin.target），用假 root 直测。
 * 浏览器端的真实挂载行为由 scripts/verify-browser-*.js 断言负责。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createThemeController, resolveUiTheme } from '../../src/theme'

function createRoot() {
  return {
    attributes: {},
    dark: false,
    style: {},
    setAttribute(key, value) { this.attributes[key] = value },
    getAttribute(key) { return this.attributes[key] || null },
    classList: {
      toggle(name, force) { this._on = force },
    },
  }
}

afterEach(() => {
  delete global.window
  delete global.MutationObserver
  vi.restoreAllMocks()
})

describe('createThemeController — DOM 契约（11 §3.3）', () => {
  it('默认 light：四属性 + 无 dark 类 + color-scheme', () => {
    const root = createRoot()
    const controller = createThemeController({ getRoot: () => root })
    controller.applyToRoot()
    expect(root.attributes['data-theme']).toBe('light')
    expect(root.attributes['data-content-theme']).toBe('light')
    expect(root.attributes['data-theme-source']).toBe('explicit')
    expect(root.style.colorScheme).toBe('light')
  })

  it('setTheme(dark)：UI 深正文随 auto 变深，dark 类写上', () => {
    const root = createRoot()
    const controller = createThemeController({ getRoot: () => root })
    controller.setTheme('dark')
    expect(root.attributes['data-theme']).toBe('dark')
    expect(root.attributes['data-content-theme']).toBe('dark')
    expect(root.style.colorScheme).toBe('dark')
  })

  it('dark + contentTheme=light：飞书「UI 深正文浅」组合', () => {
    const root = createRoot()
    const controller = createThemeController({ theme: 'dark', contentTheme: 'light', getRoot: () => root })
    controller.applyToRoot()
    expect(root.attributes['data-theme']).toBe('dark')
    expect(root.attributes['data-content-theme']).toBe('light')
  })

  it('getRoot 缺席（SSR/未挂载）：安全空操作不抛错', () => {
    const controller = createThemeController({ getRoot: () => null })
    expect(() => controller.applyToRoot()).not.toThrow()
    expect(controller.getTheme().resolved.theme).toBe('light')
  })
})

describe('createThemeController — source 与解析', () => {
  it('system 态 source=system；无 matchMedia 时解析为 light', () => {
    const controller = createThemeController({ theme: 'system', getRoot: () => null })
    const snapshot = controller.getTheme()
    expect(snapshot.theme).toBe('system')
    expect(snapshot.source).toBe('system')
    expect(snapshot.resolved.theme).toBe('light') // node 环境无 matchMedia → light 兜底
  })

  it('host 态：map 命中 → 解析值；未命中 → fallback；source=host（R2/R3）', () => {
    const target = { attrs: { 'data-skin': 'dark' }, getAttribute(key) { return this.attrs[key] } }
    const controller = createThemeController({
      theme: 'host',
      hostSkin: { attr: 'data-skin', target: () => target, map: { default: 'light', dark: 'dark' }, fallback: 'light' },
      getRoot: () => null,
    })
    expect(controller.getTheme().resolved.theme).toBe('dark')
    expect(controller.getTheme().source).toBe('host')
    target.attrs['data-skin'] = 'unknown-skin'
    expect(controller.getTheme().resolved.theme).toBe('light') // R2：未命中走 fallback
    delete target.attrs['data-skin']
    expect(controller.getTheme().resolved.theme).toBe('light') // 未设属性同样走 fallback
  })

  it('resolveUiTheme：非 system/host 的字面值直接返回', () => {
    expect(resolveUiTheme('dark', null)).toBe('dark')
    expect(resolveUiTheme('light', null)).toBe('light')
  })
})

describe('createThemeController — setTheme 行为', () => {
  it('变更触发 onChange；未变更不触发', () => {
    const onChange = vi.fn()
    const controller = createThemeController({ getRoot: () => null, onChange })
    controller.setTheme('dark')
    expect(onChange).toHaveBeenCalledTimes(1)
    controller.setTheme('dark') // 同值重设不算变更
    expect(onChange).toHaveBeenCalledTimes(1)
    controller.setTheme('light')
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange.mock.calls[1][0].resolved.theme).toBe('light')
  })

  it('省略 contentTheme 参数 = 保持现值', () => {
    const controller = createThemeController({ theme: 'dark', contentTheme: 'light', getRoot: () => null })
    controller.setTheme('light')
    expect(controller.getTheme().contentTheme).toBe('light')
  })

  it('非法值：warn + 原样返回快照，不静默改写', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const controller = createThemeController({ getRoot: () => null })
    const snapshot = controller.setTheme('blue')
    expect(snapshot.theme).toBe('light')
    expect(warn).toHaveBeenCalledTimes(1)
    const snapshot2 = controller.setTheme('dark', 'system') // contentTheme 不接受 system
    expect(snapshot2.theme).toBe('light') // theme 没被写入（先校验 contentTheme 失败即返回）
    expect(warn).toHaveBeenCalledTimes(2)
  })
})

describe('createThemeController — themeStorage: local（§5.8/§6）', () => {
  function createWindowStorage() {
    const store = new Map()
    return {
      localStorage: {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => { store.set(key, String(value)) },
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
      _store: store,
    }
  }

  it('初值从 localStorage 恢复；setTheme 回写', () => {
    const win = createWindowStorage()
    win._store.set('lark-doc:theme', 'dark')
    win._store.set('lark-doc:content-theme', 'light')
    global.window = win
    const controller = createThemeController({ themeStorage: 'local', getRoot: () => null })
    expect(controller.getTheme().theme).toBe('dark')
    expect(controller.getTheme().contentTheme).toBe('light')
    controller.setTheme('light')
    expect(win._store.get('lark-doc:theme')).toBe('light')
    expect(win._store.get('lark-doc:content-theme')).toBe('light') // contentTheme 省略 = 保持现值并落库
  })

  it('storage 事件（另一标签写入）触发状态更新 + onChange', () => {
    const win = createWindowStorage()
    global.window = win
    const onChange = vi.fn()
    const controller = createThemeController({ themeStorage: 'local', getRoot: () => null, onChange })
    expect(win.addEventListener).toHaveBeenCalledWith('storage', expect.any(Function))
    const handler = win.addEventListener.mock.calls.find((call) => call[0] === 'storage')[1]
    win._store.set('lark-doc:theme', 'dark')
    handler({ key: 'lark-doc:theme' })
    expect(controller.getTheme().theme).toBe('dark')
    expect(onChange).toHaveBeenCalledTimes(1)
    handler({ key: 'unrelated-key' }) // 无关键字：忽略
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('themeStorage 非 local：不读不写不监听', () => {
    const win = createWindowStorage()
    win._store.set('lark-doc:theme', 'dark')
    global.window = win
    const controller = createThemeController({ getRoot: () => null })
    expect(controller.getTheme().theme).toBe('light') // 恢复了也不会被采用
    controller.setTheme('dark')
    expect(win._store.get('lark-doc:theme')).toBe('dark') // 仍是种子值：运行时没写过
    expect(win._store.has('lark-doc:content-theme')).toBe(false) // contentTheme 未落库
    expect(win.addEventListener).not.toHaveBeenCalled()
  })
})

describe('createThemeController — destroy', () => {
  it('destroy 后 system 监听解除', () => {
    const removeEventListener = vi.fn()
    global.window = {
      matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener }),
    }
    const controller = createThemeController({ theme: 'system', getRoot: () => null })
    controller.destroy()
    expect(removeEventListener).toHaveBeenCalled()
  })
})


describe('三种可见主题使用同一控制器', () => {
  it('绿色→飞书浅色→飞书暗色→绿色，预设与模式一次生效', () => {
    const root = createRoot(), onChange = vi.fn()
    const c = createThemeController({ getRoot: () => root, onChange })
    c.applyToRoot()
    expect(root._larkDocTheme).toBe(c)
    c.setTheme('light', 'auto', 'feishu')
    expect(root.attributes['data-theme-preset']).toBe('feishu')
    expect(c.getTheme().preset).toBe('feishu')
    c.setTheme('dark', 'auto', 'feishu')
    expect(root.attributes['data-content-theme']).toBe('dark')
    c.setTheme('light', 'auto', 'default')
    expect(root.attributes['data-theme-preset']).toBe('default')
    expect(root.attributes['data-theme']).toBe('light')
    expect(onChange).toHaveBeenCalledTimes(3)
    c.setTheme('light', 'auto', 'default')
    expect(onChange).toHaveBeenCalledTimes(3)
    c.destroy()
    expect(root._larkDocTheme).toBeUndefined()
  })

  it('非法预设不部分切换；保留已有宿主手动pcvue预设', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const root = createRoot()
    root.setAttribute('data-theme-preset', 'pcvue')
    const c = createThemeController({ getRoot: () => root })
    c.applyToRoot()
    expect(c.getTheme().preset).toBe('pcvue')
    c.setTheme('dark', 'auto', 'unknown')
    expect(c.getTheme().theme).toBe('light')
    expect(root.attributes['data-theme-preset']).toBe('pcvue')
  })

  it('local模式恢复预设并随模式一起存储；storage同步三者', () => {
    const store = new Map([['lark-doc:theme-preset', 'feishu'], ['lark-doc:theme', 'dark']])
    let onStorage
    global.window = {
      localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
      addEventListener: (name, handler) => { if (name === 'storage') onStorage = handler },
      removeEventListener() {},
    }
    const root = createRoot(), c = createThemeController({ themeStorage: 'local', getRoot: () => root })
    c.applyToRoot()
    expect(root.attributes['data-theme-preset']).toBe('feishu')
    expect(root.attributes['data-theme']).toBe('dark')
    c.setTheme('light', 'auto', 'default')
    expect(store.get('lark-doc:theme-preset')).toBe('default')
    store.set('lark-doc:theme-preset', 'feishu')
    onStorage({ key: 'lark-doc:theme-preset' })
    expect(c.getTheme().preset).toBe('feishu')
    c.destroy()
  })
})


it('localStorage getter被宿主隐私策略拒绝时，主题仍可切换', () => {
  const root = createRoot()
  global.window = { addEventListener() {}, removeEventListener() {} }
  Object.defineProperty(global.window, 'localStorage', { get() { throw new Error('blocked') } })
  const c = createThemeController({ themeStorage: 'local', getRoot: () => root })
  expect(() => c.setTheme('dark', 'auto', 'feishu')).not.toThrow()
  expect(root.attributes['data-theme']).toBe('dark')
  expect(root.attributes['data-theme-preset']).toBe('feishu')
  c.destroy()
})
