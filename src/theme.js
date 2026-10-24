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

export const THEME_STATES = Object.freeze(['light', 'dark', 'system', 'host'])
export const CONTENT_THEME_STATES = Object.freeze(['auto', 'light', 'dark'])

export const THEME_STORAGE_KEY = 'lark-doc:theme'
export const CONTENT_THEME_STORAGE_KEY = 'lark-doc:content-theme'

/** host 皮肤探测默认值（11 §3.9）：attr/target 可被宿主 hostSkin 覆盖，map 默认空。 */
const DEFAULT_HOST_SKIN = Object.freeze({
  attr: 'data-skin',
  target: () => (typeof document !== 'undefined' ? document.documentElement : null),
  map: Object.freeze({}),
  fallback: 'light',
})

function isThemeState(value) { return THEME_STATES.indexOf(value) !== -1 }
function isContentThemeState(value) { return CONTENT_THEME_STATES.indexOf(value) !== -1 }

function readStorage(key) {
  if (typeof window === 'undefined' || !window.localStorage) return null
  try { return window.localStorage.getItem(key) } catch (error) { return null }
}

function writeStorage(key, value) {
  if (typeof window === 'undefined' || !window.localStorage) return
  try { window.localStorage.setItem(key, value) } catch (error) { /* 隐私模式写失败：静默降级为会话内生效 */ }
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
 * @param {string}   [options.themeStorage='none']  'local' 才读写 localStorage。
 * @param {function} [options.getRoot]              返回根容器（.lark-doc）；返回 null 时只算不写。
 * @param {function} [options.onChange]             任一来源的变更回调，入参为 getTheme() 快照。
 * @returns {{ setTheme, getTheme, applyToRoot, destroy }}
 */
export function createThemeController(options = {}) {
  const state = {
    theme: isThemeState(options.theme) ? options.theme : 'light',
    contentTheme: isContentThemeState(options.contentTheme) ? options.contentTheme : 'auto',
    themeStorage: options.themeStorage === 'local' ? 'local' : 'none',
  }
  const hostSkin = options.hostSkin && typeof options.hostSkin === 'object' ? options.hostSkin : DEFAULT_HOST_SKIN
  const getRoot = typeof options.getRoot === 'function' ? options.getRoot : function () { return null }
  const onChange = typeof options.onChange === 'function' ? options.onChange : null

  let media = null
  let onMediaChange = null
  let observer = null
  let onStorage = null

  // themeStorage === 'local'：初值以 localStorage 恢复（合法值才采用，6 §6）。
  if (state.themeStorage === 'local') {
    const storedTheme = readStorage(THEME_STORAGE_KEY)
    const storedContent = readStorage(CONTENT_THEME_STORAGE_KEY)
    if (isThemeState(storedTheme)) state.theme = storedTheme
    if (isContentThemeState(storedContent)) state.contentTheme = storedContent
  }

  function resolvedContentTheme(uiTheme) {
    if (state.contentTheme === 'dark') return 'dark'
    if (state.contentTheme === 'light') return 'light'
    return uiTheme // auto：跟随 theme 解析结果
  }

  function sourceTag() {
    if (state.theme === 'system') return 'system'
    if (state.theme === 'host') return 'host'
    return 'explicit'
  }

  function getTheme() {
    const uiTheme = resolveUiTheme(state.theme, hostSkin)
    return {
      theme: state.theme,
      contentTheme: state.contentTheme,
      resolved: { theme: uiTheme, contentTheme: resolvedContentTheme(uiTheme) },
      source: sourceTag(),
    }
  }

  /** DOM 契约落盘：四属性 + 类 + color-scheme。根容器不存在时安全空操作。 */
  function applyToRoot() {
    const root = getRoot()
    if (!root || typeof root.setAttribute !== 'function') return
    const uiTheme = resolveUiTheme(state.theme, hostSkin)
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
    if (state.themeStorage !== 'local') return
    writeStorage(THEME_STORAGE_KEY, state.theme)
    writeStorage(CONTENT_THEME_STORAGE_KEY, state.contentTheme)
  }

  /** 变更统一出口：落 DOM + 回调（回调由 setTheme 判定 changed 后触发，这里不重复判）。 */
  function emit() {
    applyToRoot()
    if (onChange) onChange(getTheme())
  }

  function stopListeners() {
    if (media && onMediaChange) {
      if (typeof media.removeEventListener === 'function') media.removeEventListener('change', onMediaChange)
      else if (typeof media.removeListener === 'function') media.removeListener(onMediaChange)
    }
    if (observer) { observer.disconnect(); observer = null }
    if (onStorage) {
      if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
      onStorage = null
    }
    media = null
    onMediaChange = null
  }

  /** 按当前形态挂监听（R1：仅对应态挂对应监听；重建态时先 stop 再 start）。 */
  function startListeners() {
    if (state.theme === 'system' && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      media = window.matchMedia('(prefers-color-scheme: dark)')
      onMediaChange = () => emit()
      if (typeof media.addEventListener === 'function') media.addEventListener('change', onMediaChange)
      else if (typeof media.addListener === 'function') media.addListener(onMediaChange)
    }
    if (state.theme === 'host' && typeof MutationObserver === 'function') {
      const target = typeof hostSkin.target === 'function' ? hostSkin.target() : null
      if (target && typeof target.getAttribute === 'function') {
        observer = new MutationObserver(() => emit())
        observer.observe(target, { attributes: true, attributeFilter: [hostSkin.attr || DEFAULT_HOST_SKIN.attr] })
      }
    }
    if (state.themeStorage === 'local' && typeof window !== 'undefined') {
      onStorage = (event) => {
        if (!event || (event.key !== THEME_STORAGE_KEY && event.key !== CONTENT_THEME_STORAGE_KEY)) return
        // 另一标签写入了合法新值才采用；写 null（被移除）视为维持现状。
        const storedTheme = readStorage(THEME_STORAGE_KEY)
        const storedContent = readStorage(CONTENT_THEME_STORAGE_KEY)
        if (isThemeState(storedTheme) && storedTheme !== state.theme) state.theme = storedTheme
        if (isContentThemeState(storedContent) && storedContent !== state.contentTheme) state.contentTheme = storedContent
        emit()
      }
      window.addEventListener('storage', onStorage)
    }
  }

  startListeners()

  /**
   * 设置主题。theme/contentTheme 传 null/undefined 视为「保持现值」；
   * 非法值 warn 后原样返回当前快照（绝不静默改写成别的合法值）。
   */
  function setTheme(theme, contentTheme) {
    // 先全量校验再落状态：避免 contentTheme 非法时 theme 已被改写的「半套状态」。
    if (theme != null && !isThemeState(theme)) {
      if (typeof console !== 'undefined') console.warn(`[lark-doc] setTheme: 非法 theme「${theme}」，忽略（合法值：${THEME_STATES.join('/')}）`)
      return getTheme()
    }
    if (contentTheme != null && !isContentThemeState(contentTheme)) {
      if (typeof console !== 'undefined') console.warn(`[lark-doc] setTheme: 非法 contentTheme「${contentTheme}」，忽略（合法值：${CONTENT_THEME_STATES.join('/')}）`)
      return getTheme()
    }
    let changed = false
    if (theme != null && theme !== state.theme) { state.theme = theme; changed = true }
    if (contentTheme != null && contentTheme !== state.contentTheme) { state.contentTheme = contentTheme; changed = true }
    // 形态可能变化（如 explicit → system），监听器按新形态重建。
    stopListeners()
    startListeners()
    persist()
    applyToRoot()
    const snapshot = getTheme()
    if (changed && onChange) onChange(snapshot)
    return snapshot
  }

  function destroy() {
    stopListeners()
  }

  return { setTheme, getTheme, applyToRoot, destroy }
}
