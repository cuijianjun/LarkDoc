/**
 * `lark-embed/1` 桥 —— 宿主与 iframe 之间唯一的信道（requirements/09 §3.4.2，P3-02）。
 *
 * 帧格式恒定五字段：`{ ns: 'lark-embed', v: 1, type, reqId?, payload }`。
 *
 *   iframe → host ：init-ack / ready / resize / setTitle / save / error / fullscreen
 *   host → iframe ：init / theme / command / saveResult / destroy
 *
 * 五条必须落地的规则（缺一条就是安全洞或可用性洞，改的时候别放宽）：
 *
 * 1. **5 条必备能力**（`ready` / `resize` / `setTitle` / `error` / `save`）：少任何一条，
 *    要么高度塌陷、要么标题永不同步；`save` 必须有应答，否则宿主超时后把块标成"未保存"。
 * 2. **origin 严格校验**：发消息只发到 `new URL(src).origin`，**永不使用 `'*'`**；
 *    收消息时 `event.origin` 必须与之**逐字符相等**，且**不许**用 `event.source` 反推信任
 *    （`event.source` 可以被任意持有句柄的页面伪造）。origin 推导不出来时桥整体失效，
 *    宁可不工作，也不给编辑器开后门。
 * 3. **3s 超时降级**：`init` 发出后 3s 收不到 `ready` → 交回宿主降级。
 *    老站点不实现桥也必须能用，这是「骨架 23 项」能覆盖长尾的前提。
 * 4. **版本取低**：宿主发 `bridgeVersion: 1`，iframe 在 `ready` 里回自己的版本，
 *    双方取 `min`。以后出 `/2` 时老 iframe 不会炸。
 * 5. **resize 节流**：变化 ≤ 4px 直接丢，变化再大也 60ms 一次。
 *    Luckysheet 这类每次重算都会狂发 resize，不节流会把编辑器拖卡。
 *
 * 本文件零 DOM、零框架依赖：Node 14 直接可测。iframe 元素、`window.addEventListener`
 * 都留在 NodeView 里，桥只吃「一个能 postMessage 的 target」和「一条 MessageEvent」。
 */

export const BRIDGE_NAMESPACE = 'lark-embed'

/** 本仓库实现的桥版本。升级时只加版本号，不改帧结构。 */
export const BRIDGE_VERSION = 1

/** 5 条必备能力（iframe 少报一条也允许握手，但宿主会记在 state 里）。 */
export const BRIDGE_REQUIRED = Object.freeze(['ready', 'resize', 'setTitle', 'error', 'save'])

/** `init` 发出后等 `ready` 的上限。 */
export const BRIDGE_TIMEOUT_MS = 3000

/** resize 上抛阈值（绝对像素）。 */
export const RESIZE_MIN_DELTA = 4

/** resize 上抛节流窗口。 */
export const RESIZE_THROTTLE_MS = 60

export const HOST_TO_FRAME = Object.freeze(['init', 'theme', 'command', 'saveResult', 'destroy'])
export const FRAME_TO_HOST = Object.freeze(['init-ack', 'ready', 'resize', 'setTitle', 'save', 'error', 'fullscreen'])

/**
 * 从 `src` 推导桥的目标 origin。
 *
 * 只认 `https:`；`http://localhost` / `127.0.0.1` / `[::1]` 作为本地开发例外放行
 * （§3.4.2 安全基线：`src` 必须 https，localhost 仅 dev 例外）。带用户名密码的地址
 * 一律拒——那种地址的 origin 语义有歧义，不该进信任链。
 *
 * @returns {string|null} 形如 `https://figma.com`；不可用时为 null（桥随即失效）。
 */
export function resolveBridgeOrigin(src) {
  if (typeof src !== 'string' || !src) return null
  let url
  try { url = new URL(src) } catch (_) { return null }
  if (url.username || url.password) return null
  const devHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol === 'https:') return url.origin
  if (devHost && url.protocol === 'http:') return url.origin
  return null
}

/**
 * 校验一帧是不是合法的 `lark-embed` 消息。
 *
 * 只做「形状」判定（ns / v / type）；**方向与 origin 由调用方把关**——
 * 混在一起会让 `handleMessage` 里的信任判断被一处形状检查悄悄绕过。
 */
export function parseBridgeFrame(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  if (data.ns !== BRIDGE_NAMESPACE) return null
  if (!Number.isInteger(data.v) || data.v < 1) return null
  if (typeof data.type !== 'string' || !data.type) return null
  return data
}

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/**
 * 造一台桥。
 *
 * @param {Object} options
 * @param {string} options.src            嵌入内容的地址（决定目标 origin）
 * @param {{postMessage: Function}} [options.target] iframe.contentWindow（可后补）
 * @param {number} [options.timeout]      握手超时，默认 3000
 * @param {Function} [options.onReady]    `{ origin, version, capabilities }`
 * @param {Function} [options.onResize]   高度（已节流、已过阈值）
 * @param {Function} [options.onSetTitle] 标题栏文案
 * @param {Function} [options.onError]    `{ message }`
 * @param {Function} [options.onSave]     `{ payload }`（应答由桥自动发，宿主只管业务）
 * @param {Function} [options.onFullscreen] iframe 请求全屏
 * @param {Function} [options.onTimeout]  3s 未握手
 * @param {Function} [options.now]        时钟注入（测试用）
 */
export function createEmbedBridge(options = {}) {
  const source = isPlainObject(options) ? options : {}
  const timeout = Number.isFinite(source.timeout) ? Number(source.timeout) : BRIDGE_TIMEOUT_MS
  const now = typeof source.now === 'function' ? source.now : () => Date.now()
  const origin = resolveBridgeOrigin(source.src)

  let target = source.target || null
  let ready = false
  let timedOut = false
  let version = 0
  let capabilities = []
  let timer = null
  let destroyed = false
  let sentCount = 0
  let receivedCount = 0

  // resize 的「已生效高度」与节流窗口：比较基准是**上一次真的上抛的值**，
  // 否则连续几次 3px 的抖动会被逐次丢掉、累计 30px 却一次都不上报。
  let resizeHeight = null
  let lastResizeAt = 0
  let resizeTimer = null
  let pendingHeight = null

  const call = (fn, payload) => { if (typeof fn === 'function') fn(payload) }

  function clearTimer() {
    if (timer !== null) { clearTimeout(timer); timer = null }
  }

  function clearResizeTimer() {
    if (resizeTimer !== null) { clearTimeout(resizeTimer); resizeTimer = null }
  }

  /** 唯一的发帧出口：目标 origin 写死，**永远不传 `'*'`**。 */
  function post(type, payload, reqId) {
    if (destroyed || !origin) return false
    if (!target || typeof target.postMessage !== 'function') return false
    const frame = { ns: BRIDGE_NAMESPACE, v: BRIDGE_VERSION, type }
    if (reqId) frame.reqId = String(reqId)
    if (payload !== undefined) frame.payload = payload
    try {
      target.postMessage(frame, origin)
    } catch (_) {
      return false
    }
    sentCount += 1
    return true
  }

  function flushResize() {
    if (pendingHeight === null) return
    const height = pendingHeight
    pendingHeight = null
    resizeHeight = height
    lastResizeAt = now()
    call(source.onResize, height)
  }

  /**
   * resize 入队：先过 4px 阈值，再进 60ms 窗口。
   * 窗口内的值只留最后一个（trailing），不做排队——拖拽时中间那些高度没有意义。
   */
  function pushResize(height) {
    if (!Number.isFinite(height) || height < 0) return
    const rounded = Math.round(height)
    const base = resizeHeight === null ? null : resizeHeight
    if (base !== null && Math.abs(rounded - base) <= RESIZE_MIN_DELTA) return
    const wait = RESIZE_THROTTLE_MS - (now() - lastResizeAt)
    pendingHeight = rounded
    if (base === null || wait <= 0) { clearResizeTimer(); flushResize(); return }
    if (resizeTimer === null) {
      resizeTimer = setTimeout(() => { resizeTimer = null; flushResize() }, wait)
    }
  }

  function armTimeout() {
    if (timer !== null || timeout <= 0 || ready) return
    timer = setTimeout(() => {
      timer = null
      if (ready || destroyed) return
      timedOut = true
      call(source.onTimeout, { origin })
    }, timeout)
  }

  function handleMessage(event) {
    if (destroyed || !origin) return false
    if (!event || typeof event !== 'object') return false
    // ① origin 必须严格相等。`event.source` 不参与判定：任何拿到窗口句柄的页面都能伪造它。
    if (event.origin !== origin) return false
    const frame = parseBridgeFrame(event.data)
    if (!frame) return false
    // ② 方向校验：host→iframe 的帧从 iframe 发回来，一律当伪造。
    if (FRAME_TO_HOST.indexOf(frame.type) < 0) return false

    receivedCount += 1

    if (frame.type === 'ready') {
      const payload = isPlainObject(frame.payload) ? frame.payload : {}
      const remote = Number(payload.bridgeVersion)
      // 版本取低：非法版本号按宿主版本处理（老 iframe 可能压根不回这个字段）。
      version = Math.max(1, Math.min(BRIDGE_VERSION, Number.isFinite(remote) && remote >= 1 ? Math.floor(remote) : BRIDGE_VERSION))
      capabilities = Array.isArray(payload.capabilities)
        ? payload.capabilities.filter((item) => typeof item === 'string' && item)
        : []
      ready = true
      timedOut = false
      clearTimer()
      call(source.onReady, { origin, version, capabilities: capabilities.slice() })
      return true
    }

    if (frame.type === 'init-ack') return true

    if (frame.type === 'resize') {
      const payload = isPlainObject(frame.payload) ? frame.payload : {}
      pushResize(Number(payload.height))
      return true
    }

    if (frame.type === 'setTitle') {
      const payload = isPlainObject(frame.payload) ? frame.payload : {}
      const title = typeof payload.title === 'string' ? payload.title.trim() : ''
      if (!title || title.length > 512) return false
      call(source.onSetTitle, title)
      return true
    }

    if (frame.type === 'save') {
      // `save` 必须有应答：不回，宿主侧就永远等不到保存结果。
      post('saveResult', { ok: true }, frame.reqId)
      call(source.onSave, { payload: frame.payload })
      return true
    }

    if (frame.type === 'error') {
      const payload = isPlainObject(frame.payload) ? frame.payload : {}
      call(source.onError, { message: typeof payload.message === 'string' ? payload.message : '' })
      return true
    }

    if (frame.type === 'fullscreen') {
      call(source.onFullscreen, null)
      return true
    }

    return false
  }

  return {
    origin,
    /** iframe 换实例（重挂载）时把 target 换掉，别整个桥重建。 */
    setTarget(next) {
      target = next || null
      return target
    },
    /** 发 `init` 并开始计时。iframe `load` 之后调——早发会被丢在空白文档里。 */
    start() {
      if (destroyed || ready) return false
      const ok = post('init', { bridgeVersion: BRIDGE_VERSION, capabilities: BRIDGE_REQUIRED.slice() })
      if (ok) armTimeout()
      return ok
    },
    /** 宿主切主题：`{ mode: 'light'|'dark', preset? }`，iframe 自己决定跟不跟。 */
    setTheme(theme) {
      return post('theme', isPlainObject(theme) ? theme : {})
    },
    /** 通用命令通道（卡片动作 / 跳转等由具体嵌入内容解释）。 */
    command(id, payload) {
      if (typeof id !== 'string' || !id) return false
      return post('command', payload === undefined ? { id } : { id, payload })
    },
    handleMessage,
    destroy() {
      if (destroyed) return
      post('destroy')
      destroyed = true
      clearTimer()
      clearResizeTimer()
      ready = false
      target = null
    },
    /** 测试与宿主联调通道。 */
    state() {
      return {
        origin, ready, version, timedOut, destroyed,
        capabilities: capabilities.slice(),
        resizeHeight, sentCount, receivedCount,
      }
    },
  }
}

export default createEmbedBridge
