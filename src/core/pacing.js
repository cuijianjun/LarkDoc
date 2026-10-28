/**
 * 帧级合并与尾随去抖（P7-04）—— 高频 UI 更新的两条「排队」原语。
 *
 * 为什么单独成模块：`onSelectionUpdate` 每按一次方向键就整轮定位，`updateSearch`
 * 每敲一个字符就全量扫一遍 2,000 块正文。这两条路径都不是「算得慢」，而是
 * **同一帧里被叫了太多次**。合并/去抖是纯排队逻辑，与编辑器、DOM 都无关，
 * 所以放在 core 里做纯函数，三端适配层与单测都能直接吃。
 *
 * 两条纪律：
 *   1. **纯排队，不执行副作用**。模块只管「什么时候调用谁」，调用方给的是闭包；
 *      它不读 editor state、不碰 DOM，因此在 node 环境下可测。
 *   2. **时钟可注入**。默认用全局 `requestAnimationFrame` / `setTimeout`，
 *      但允许从 `options.frame` / `options.timers` 换一套假时钟 —— 单测靠它
 *      断言「200 次调用只排 1 帧」，浏览器里则永远走真时钟。
 */

/** 无 rAF 环境（node 单测 / SSR）的退化间隔：只求「延后一次」，不追求 60Hz。 */
const FRAME_FALLBACK_MS = 16

/** 查找与「开着搜索面板时每次编辑重搜」的默认去抖窗口。120ms 落在「连续输入不重搜、
 *  但停顿后立刻有结果」的区间里；飞书实测约 100~150ms，取中值偏上留余量。 */
export const SEARCH_DEBOUNCE_MS = 120

function defaultFrameApi() {
  if (typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function') {
    return {
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (handle) => cancelAnimationFrame(handle),
    }
  }
  // node：没有 rAF 用 16ms 定时器顶上。语义仍是「下一帧」，只是没有帧对齐。
  return {
    requestFrame: (callback) => setTimeout(() => callback(Date.now()), FRAME_FALLBACK_MS),
    cancelFrame: (handle) => clearTimeout(handle),
  }
}

/**
 * 一帧只 flush 一次的批量调度器。
 *
 * - **同 key 合并**：`schedule('selection', a)` 后再 `schedule('selection', b)`，
 *   这一帧只执行 `b`。高频路径上「后一次覆盖前一次」正是想要的效果（定位用的是
 *   最新选区，前一次的位置已经过期）。
 * - **保序**：不同 key 按**首次入队**顺序执行。Map 的 `set` 覆盖已有键不改变插入
 *   位置，所以「A 先排、B 后排、A 又被更新」执行顺序仍是 A → B，不会因为 A 后到
 *   就跑到 B 后面（折叠/高亮/几何测量之间有先后依赖）。
 * - **不重入**：flush 前先快照再清空队列，任务里再次 `schedule` 的落到下一帧。
 *   否则「定位失败 → 重试」这类逻辑会在同一帧里自激成死循环。
 * - **销毁即取消**：`dispose()` 之后排队的、已排队未执行的、以及后续 schedule
 *   全部无效 —— 组件卸载后不该再有回调摸 editor。
 *
 * @param {{ frame?: { requestFrame: Function, cancelFrame: Function }, onError?: (error: Error) => void }} [options]
 * @returns {{ schedule: Function, pending: Function, flush: Function, dispose: Function, disposed: boolean }}
 */
export function createFrameBatcher(options = {}) {
  const frame = options.frame && typeof options.frame.requestFrame === 'function' && typeof options.frame.cancelFrame === 'function'
    ? options.frame
    : defaultFrameApi()
  const onError = typeof options.onError === 'function' ? options.onError : null
  // key → task。Map 同时承担「去重」与「保序」两件事，别换成普通对象
  // （普通对象的整数键会被引擎重排，顺序就丢了）。
  const queue = new Map()
  let handle = null
  let disposed = false

  const reportError = (error) => {
    if (onError) { onError(error); return }
    // 没有兜底就吞掉并打印：一个定位任务的异常不该让同一帧后面的任务全部不执行。
    console.error('[lark-doc] frame task failed:', error)
  }

  function run() {
    handle = null
    if (disposed || !queue.size) return 0
    const tasks = Array.from(queue.values())
    queue.clear()
    let ran = 0
    for (const task of tasks) {
      try { task() } catch (error) { reportError(error) }
      ran += 1
    }
    return ran
  }

  return {
    /**
     * 排队一次。返回 `true` 表示这次调用**新开了**一帧（首次入队），
     * `false` 表示合并进了已有的一帧（调用方据此判断「有没有多花一帧」）。
     */
    schedule(key, task) {
      if (disposed || typeof task !== 'function') return false
      const queued = queue.has(key)
      queue.set(key, task)
      if (queued) return false
      if (handle === null) handle = frame.requestFrame(run)
      return true
    },
    /** 还没执行的条数（同 key 只算一条）。 */
    pending() { return queue.size },
    /** 立即执行本帧队列（测试 / 需要同步结果的调用点用），返回执行条数。 */
    flush() {
      if (handle !== null) { frame.cancelFrame(handle); handle = null }
      return run()
    },
    /** 销毁即取消：之后排队的、已排队未执行的、以及后续 schedule 全部无效。 */
    dispose() {
      disposed = true
      queue.clear()
      if (handle !== null) { frame.cancelFrame(handle); handle = null }
    },
    get disposed() { return disposed },
  }
}

/**
 * 尾随去抖：连续调用只在「安静 delay 毫秒后」执行最后一次。
 *
 * 与 `createFrameBatcher` 的分工：一帧（16ms）能把「同一帧里的多次调用」收成一次，
 * 但打字是跨帧连续的 —— 每 80ms 敲一个字符，rAF 合并后仍是每字符一次全量扫描。
 * 搜索必须用时间去抖，不能只靠帧合并。
 *
 * @param {{ delay?: number, timers?: { setTimeout: Function, clearTimeout: Function } }} [options]
 */
export function createTrailingDebounce(options = {}) {
  const delay = Number.isFinite(options.delay) && options.delay > 0 ? options.delay : SEARCH_DEBOUNCE_MS
  const timers = options.timers || {}
  const setTimer = typeof timers.setTimeout === 'function' ? timers.setTimeout : (callback, ms) => setTimeout(callback, ms)
  const clearTimer = typeof timers.clearTimeout === 'function' ? timers.clearTimeout : (handle) => clearTimeout(handle)
  let handle = null
  let task = null
  let disposed = false

  const clear = () => { if (handle !== null) { clearTimer(handle); handle = null } }

  function run() {
    handle = null
    const pending = task
    task = null
    if (disposed || !pending) return
    pending()
  }

  return {
    /** 每次调用都重置窗口；只记最后一次的闭包。 */
    schedule(next) {
      if (disposed || typeof next !== 'function') return false
      task = next
      clear()
      handle = setTimer(run, delay)
      return true
    },
    /** 立刻执行待办（跳过剩余等待），返回是否真的执行了。 */
    flush() {
      const pending = task
      clear()
      task = null
      if (disposed || !pending) return false
      pending()
      return true
    },
    cancel() { clear(); task = null },
    dispose() { disposed = true; clear(); task = null },
  }
}
