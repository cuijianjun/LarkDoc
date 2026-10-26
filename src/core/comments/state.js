/**
 * 线程状态迁移、排序、未读 —— requirements/04 §3.1⑤、05 §5.5。
 *
 * resolve / reopen 做成**幂等**，两条依据：
 *   1. 05 §5.5.1 写的是「更新/删除请求沿用 comment_id + reply_id，实现必须保留幂等失败态」
 *      ——服务端本身按同一 id 重放，重复点不该变成两种结果。
 *   2. 04 §3.1⑤ 里 resolve 点一次面板立即关闭、正文高亮转灰，④ 也没有为重复操作定义任何
 *      错误文案；抛错只会产生一个无处展示的异常。
 * 只有 open ⇄ resolved 两态，不存在第三态，所以本层不做错误码，只做「已是目标态就原样返回」。
 *
 * 排序：未解决在前，组内 createdAt 升序。
 *   - 未解决在前：04 §3.1⑤ 说解决后面板关闭、高亮转灰态——已解决线程是归档，不该压住待办；
 *     04 ② 的「跳到首条评论」也只有在未解决线程排前面时才符合直觉。
 *   - createdAt 升序：回复区是自上而下追加的（04 §3.1④「每多 1 条 +61」），线程沿用同一方向；
 *     「首条」按时间解释，不需要额外游标。
 *   - 同毫秒再按 id 码元序兜底：内存 Provider 的 list() 要求确定性，JS 的 sort 虽稳定，
 *     但调用方传进来的数组顺序不该影响同一时刻创建的两条线程。
 *
 * 待定：04 / 05 都没有写线程列表排序与未读口径。未读没有「已读游标」定义，本层只接受宿主
 * 传入的已读 id 集合做差集，并跳过已解决线程（04 §3.1⑤ 已关闭、不再提醒）。
 */

function toTime(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function compareId(left, right) {
  const a = String(left)
  const b = String(right)
  if (a === b) return 0
  return a < b ? -1 : 1
}

/** 返回新数组，不动入参：调用方常常直接把 Provider 返回值丢进来。 */
export function sortThreads(threads) {
  const list = threads || []
  return list.filter((thread) => thread != null).slice().sort((left, right) => {
    const leftResolved = left.resolved ? 1 : 0
    const rightResolved = right.resolved ? 1 : 0
    if (leftResolved !== rightResolved) return leftResolved - rightResolved
    const delta = toTime(left.createdAt) - toTime(right.createdAt)
    if (delta) return delta
    return compareId(left.id, right.id)
  })
}

/** 已是 resolved 时返回同一引用，方便调用方用 `===` 判断「没有变化」。 */
export function resolveThread(thread) {
  if (!thread || thread.resolved) return thread
  return { ...thread, resolved: true }
}

export function reopenThread(thread) {
  if (!thread || !thread.resolved) return thread
  return { ...thread, resolved: false }
}

/**
 * 未读数：未解决且不在已读集合里的线程条数。
 * `readIds` 可以是数组或 Set（宿主从 localStorage / 服务端拿到的形状不定）。
 */
export function unreadCount(threads, readIds) {
  const read = readIds instanceof Set ? readIds : new Set(readIds || [])
  const list = threads || []
  return list.reduce((count, thread) => {
    if (!thread || thread.resolved) return count
    return read.has(thread.id) ? count : count + 1
  }, 0)
}
