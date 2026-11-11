/**
 * theme — 主题机制层（0.12，spec：requirements/11 §3.1–3.9 / §5.8 / §6）。
 *
 * 双轨模型：四态 `theme`（light/dark/system/host）× 三值 `contentTheme`（auto/light/dark）。
 * - `system` 跟随 `prefers-color-scheme`；`host` 跟随宿主主题属性（读属性 + 映射，pcvue 路线）；
 * - `contentTheme` 不接受 `system`：`auto` = 跟随 `theme` 的解析结果（11 §3.2）；
 * - DOM 契约（11 §3.3）：根容器写 `data-theme` / `data-content-theme`（均为**已解析**值，
 *   system/host 不出现）+ `data-theme-source`（explicit/system/host）+ 保留 `.lark-doc-dark`；
 * - `color-scheme` 跟随解析后的 UI 主题（T1-05）。
 *
 * 三个监听器全部按需挂载、destroy 全断：
 * - system → matchMedia('change')；host → MutationObserver（attributeFilter，R1）；
 * - themeStorage === 'local' → localStorage 持久化 + storage 事件多标签同步。
 *
 * SSR / 无 DOM 环境：getRoot() 返回 null 时 applyToRoot 是安全空操作，不抛错。
 */

import { runThemeTransition, cancelThemeTransition } from './themeTransition'

export const THEME_STATES = Object.freeze(['light', 'dark', 'system', 'host'])
export const CONTENT_THEME_STATES = Object.freeze(['auto', 'light', 'dark'])
const PRESETS = ['default', 'feishu', 'pcvue']

export const THEME_STORAGE_KEY = 'lark-doc:theme'
export const CONTENT_THEME_STORAGE_KEY = 'lark-doc:content-theme'
const PRESET_STORAGE_KEY = 'lark-doc:theme-preset'

/** host 皮肤探测默认值（11 §3.9）：attr/target 可被宿主 hostSkin 覆盖，map 默认空。 */
const DEFAULT_HOST_SKIN = Object.freeze({
  attr: 'data-skin',
  target: () => (typeof document !== 'undefined' ? document.documentElement : null),
  map: Object.freeze({}),
  fallback: 'light',
})


// 读写共享隐私/SSR保护：捕获无window、localStorage属性getter及存储操作抛错。
function storage(key, value) {
  try {
    return value === undefined ? window.localStorage.getItem(key) : window.localStorage.setItem(key, value)
  } catch (error) { return null }
}

/**
 * 解析 UI 主题（light/dark 二值，绝不返回 system/host）。
 * - host：读 `hostSkin.target().getAttribute(hostSkin.attr)` 查 `map`，未命中走 `fallback`（R2/R4）；
 * - system：读 `prefers-color-scheme`；无 matchMedia（SSR/老环境）时按 light。
 */
export function resolveUiTheme(theme, hostSkin) {
  if (theme === 'system') {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light'
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    return query && query.matches ? 'dark' : 'light'
  }
  if (theme === 'host') {
    const skin = hostSkin || DEFAULT_HOST_SKIN
    const attr = skin.attr || DEFAULT_HOST_SKIN.attr
    const target = typeof skin.target === 'function' ? skin.target() : null
    const raw = target && typeof target.getAttribute === 'function' ? target.getAttribute(attr) : null
    const map = skin.map || {}
    if (raw != null && (map[raw] === 'dark' || map[raw] === 'light')) return map[raw]
    return skin.fallback === 'dark' ? 'dark' : 'light'
  }
  return theme === 'dark' ? 'dark' : 'light'
}

/**
 * 创建主题控制器。
 *
 * @param {object} options
 * @param {string}   [options.theme='light']        四态初值；非法值回落 'light'（D6 零破坏）。
 * @param {string}   [options.contentTheme='auto']  三值初值；非法值回落 'auto'。
 * @param {object}   [options.hostSkin]             host 态皮肤探测配置（11 §3.9）。
 * @param {string}   [options.themePreset]         default/feishu/pcvue；缺省保留宿主预设。
 * @param {string}   [options.themeStorage='none']  'local' 才读写 localStorage。
 * @param {function} [options.getRoot]              返回根容器（.lark-doc）；返回 null 时只算不写。
 *   写 DOM 时自动走 src/themeTransition（T4-02 / T4-03）：支持 View Transitions
 *   就做整页快照过渡，不支持就短窗口挂 .ld-theme-transition 补 200ms 缓动。
 * @param {function} [options.onChange]             任一来源的变更回调，入参为 getTheme() 快照。
 * @returns {{ setTheme, getTheme, applyToRoot, destroy }}
 */
export function createThemeController(options = {}) {
  const state = {
    theme: THEME_STATES.includes(options.theme) ? options.theme : 'light',
    contentTheme: CONTENT_THEME_STATES.includes(options.contentTheme) ? options.contentTheme : 'auto',
    preset: PRESETS.includes(options.themePreset) ? options.themePreset : null,
  }
  const local = options.themeStorage === 'local'
  const hostSkin = options.hostSkin && typeof options.hostSkin === 'object' ? options.hostSkin : DEFAULT_HOST_SKIN
  const getRoot = typeof options.getRoot === 'function' ? options.getRoot : function () { return null }
  const onChange = typeof options.onChange === 'function' ? options.onChange : null

  let media = null
  let observer = null

  const storageFields = [['theme', THEME_STORAGE_KEY, THEME_STATES], ['contentTheme', CONTENT_THEME_STORAGE_KEY, CONTENT_THEME_STATES], ['preset', PRESET_STORAGE_KEY, PRESETS]]
  function restoreStorage() {
    storageFields.forEach(field => { const value = storage(field[1]); if (field[2].includes(value)) state[field[0]] = value })
  }
  if (local) restoreStorage()
  let boundRoot = null

  function preset() {
    const root = getRoot()
    const value = state.preset || (root && typeof root.getAttribute === 'function' && root.getAttribute('data-theme-preset'))
    return PRESETS.includes(value) ? value : 'default'
  }

  function resolvedContentTheme(uiTheme) {
    return state.contentTheme === 'auto' ? uiTheme : state.contentTheme
  }

  function sourceTag() { return state.theme === 'system' || state.theme === 'host' ? state.theme : 'explicit' }

  function getTheme() {
    const uiTheme = resolveUiTheme(state.theme, hostSkin)
    return {
      theme: state.theme,
      contentTheme: state.contentTheme,
      preset: preset(),
      resolved: { theme: uiTheme, contentTheme: resolvedContentTheme(uiTheme) },
      source: sourceTag(),
    }
  }

  /** DOM 契约落盘：四属性 + 类 + color-scheme。根容器不存在时安全空操作。 */
  function applyToRoot() {
    const root = getRoot()
    if (!root || typeof root.setAttribute !== 'function') return
    if (boundRoot !== root) bindRoot(root)
    const uiTheme = resolveUiTheme(state.theme, hostSkin)
    root.setAttribute('data-theme-preset', preset())
    root.setAttribute('data-theme', uiTheme)
    root.setAttribute('data-content-theme', resolvedContentTheme(uiTheme))
    root.setAttribute('data-theme-source', sourceTag())
    if (root.classList && typeof root.classList.toggle === 'function') {
      root.classList.toggle('lark-doc-dark', uiTheme === 'dark')
    }
    if (root.style) {
      try { root.style.colorScheme = uiTheme } catch (error) { /* 老 CSSOM 不识别 color-scheme 时忽略 */ }
    }
  }

  function persist() {
    if (!local) return
    storageFields.forEach(field => storage(field[1], field[0] === 'preset' ? preset() : state[field[0]]))
  }

  /** 变更统一出口：落 DOM + 回调（回调由 setTheme 判定 changed 后触发，这里不重复判）。 */
  function emit() {
    // 写 DOM 这一步交给动效编排：支持 View Transitions 时属性变更发生在快照回调里
    // （浏览器自动拍 old/new 两帧做圆形 bloom），不支持就补一段 class 缓动。
    runThemeTransition(getRoot(), applyToRoot)
    if (onChange) onChange(getTheme())
  }

  function stopListeners() {
    if (media) {
      if (typeof media.removeEventListener === 'function') media.removeEventListener('change', emit)
      else if (typeof media.removeListener === 'function') media.removeListener(emit)
    }
    if (observer) { observer.disconnect(); observer = null }
    if (local && typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
    media = null
  }

  function onStorage(event) {
    if (!event || !storageFields.some(field => field[1] === event.key)) return
    restoreStorage()
    emit()
  }

  /** 按当前形态挂监听（R1：仅对应态挂对应监听；重建态时先 stop 再 start）。 */
  function startListeners() {
    if (state.theme === 'system' && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      media = window.matchMedia('(prefers-color-scheme: dark)')
      if (typeof media.addEventListener === 'function') media.addEventListener('change', emit)
      else if (typeof media.addListener === 'function') media.addListener(emit)
    }
    if (state.theme === 'host' && typeof MutationObserver === 'function') {
      const target = typeof hostSkin.target === 'function' ? hostSkin.target() : null
      if (target && typeof target.getAttribute === 'function') {
        observer = new MutationObserver(emit)
        observer.observe(target, { attributes: true, attributeFilter: [hostSkin.attr || DEFAULT_HOST_SKIN.attr] })
      }
    }
    if (local && typeof window !== 'undefined') {
      window.addEventListener('storage', onStorage)
    }
  }

  startListeners()

  /**
   * 设置主题。theme/contentTheme 传 null/undefined 视为「保持现值」；
   * 非法值 warn 后原样返回当前快照（绝不静默改写成别的合法值）。
   */
  function setTheme(theme, contentTheme, themePreset) {
    // 三字段先一起校验，任何非法值都不能造成半套主题状态。
    const values = [theme, contentTheme, themePreset]
    const invalid = storageFields.find((field, index) => values[index] != null && !field[2].includes(values[index]))
    if (invalid) {
      if (typeof console !== 'undefined') console.warn(`[lark-doc] setTheme: invalid ${invalid[0]}`)
      return getTheme()
    }
    let changed = false
    storageFields.forEach((field, index) => {
      const key = field[0], value = values[index], current = key === 'preset' ? preset() : state[key]
      if (value != null && value !== current) { state[key] = value; changed = true }
    })
    // 形态可能变化（如 explicit → system），监听器按新形态重建。
    stopListeners()
    startListeners()
    persist()
    // 只有真的换档才走动效；同值重复 set 是一次幂等写，不该闪一下。
    if (changed) emit()
    else applyToRoot()
    return getTheme()
  }

  function bindRoot(root) {
    if (boundRoot && boundRoot._larkDocTheme === api) delete boundRoot._larkDocTheme
    boundRoot = root
    if (root) root._larkDocTheme = api
  }

  function destroy() {
    stopListeners()
    cancelThemeTransition()
    bindRoot(null)
  }

  const api = { setTheme, getTheme, applyToRoot, destroy }
  return api
}
