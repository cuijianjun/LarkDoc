/**
 * 保留策略：快照会无限增长，`pruneSnapshots` 是唯一的淘汰入口（09 §5.8 P6b-02）。
 *
 * 三条规则，按优先级：
 *   1. **永久保留**：`pinned`、手动命名（`kind: 'manual'`）、恢复点（`kind: 'restore'`）
 *      一律不动。恢复点被淘汰就再也回不去 —— 这是唯一不可接受的数据损失。
 *   2. **同作者连续自动快照合并**（可开关）：只留最新那份。中间夹了手动/pinned/别人的
 *      快照就算「断开」，不再合并。默认**关**：合并同样是在删东西，演示与文档场景下
 *      默认不动手更安全（待定：规格未定缺省值）。
 *   3. **最近 N 份自动快照**：超出的淘汰，N 由 `policy.keepAuto` 给。
 *
 * 纯函数：不改输入数组、不改数组里的对象、返回的 `kept / dropped` 都是新数组但**复用原对象**
 * （调用方可能还要拿 `dropped` 去做「已被淘汰」的墓碑记录）。`kept` 顺序稳定：新的在前，
 * 同一毫秒按输入顺序（输入约定也是新的在前）。
 *
 * 待定：`keepAuto` 缺省 20 —— 两份规格都没给数字（§5.7.5 B23 提到的「历史 20 份」是
 *       **要修掉的反面例子**，不是本策略的规格）。这里取 20 只为让演示有界，调用方应当显式传。
 * 待定：未知/缺失 `kind` 的条目**不淘汰**（当 permanent），与 `normalizeSnapshot` 同口径。
 */
import { E_POLICY_KEEP_AUTO, SNAPSHOT_KIND, versioningError } from './types'

export const DEFAULT_POLICY = Object.freeze({
  keepAuto: 20,
  mergeConsecutiveAuto: false,
})

/** 只有「未钉住的自动快照」可以被淘汰；其余一切（含脏数据）都当永久。 */
function isEvictable(snapshot) {
  return Boolean(snapshot) && snapshot.kind === SNAPSHOT_KIND.AUTO && !snapshot.pinned
}

function timestampOf(snapshot) {
  return snapshot && Number.isFinite(snapshot.createdAt) ? snapshot.createdAt : 0
}

/** `kept` 的顺序口径：新的在前；同毫秒保持输入顺序（不靠引擎 sort 稳定性，显式带下标）。 */
function newestFirst(list) {
  return list
    .map((snapshot, index) => ({ snapshot, index }))
    .sort((a, b) => {
      const delta = timestampOf(b.snapshot) - timestampOf(a.snapshot)
      return delta !== 0 ? delta : a.index - b.index
    })
    .map((entry) => entry.snapshot)
}

/**
 * @param {Array} list 某一份文档的快照列表（不要求已排序）
 * @param {{ keepAuto?: number, mergeConsecutiveAuto?: boolean }} policy
 * @returns {{ kept: Array, dropped: Array }}
 */
export function pruneSnapshots(list, policy) {
  const options = policy && typeof policy === 'object' ? policy : {}
  const keepAuto = options.keepAuto === undefined ? DEFAULT_POLICY.keepAuto : options.keepAuto
  // 0 会让「自动快照」这个概念失效，负数没有意义；两类都是配置事故，直接报错而不是猜意图。
  if (!Number.isInteger(keepAuto) || keepAuto < 1) {
    throw versioningError(E_POLICY_KEEP_AUTO, `keepAuto 必须是 ≥1 的整数，收到 ${String(keepAuto)}`)
  }
  const merge = options.mergeConsecutiveAuto === true

  const ordered = newestFirst(Array.isArray(list) ? list.filter((item) => item && typeof item === 'object') : [])

  const kept = []
  const dropped = []
  let previous = null
  let autoKept = 0

  for (const snapshot of ordered) {
    if (!isEvictable(snapshot)) {
      kept.push(snapshot)
      previous = snapshot
      continue
    }
    // 合并只看时间线上相邻的两条：`previous` 是上一条仍留在时间线上的快照。
    // 只有「明确是同一个人」才合并；作者缺失（老数据）不算同一人，避免把陌生人的快照并掉。
    const sameAuthor = Boolean(previous) && isEvictable(previous)
      && typeof previous.author === 'string' && previous.author !== ''
      && previous.author === snapshot.author
    if (merge && sameAuthor) {
      dropped.push(snapshot)
      continue
    }
    // 配额只数「可淘汰的自动快照」，pinned 的自动快照不占名额。
    if (autoKept >= keepAuto) {
      dropped.push(snapshot)
      previous = snapshot
      continue
    }
    kept.push(snapshot)
    autoKept += 1
    previous = snapshot
  }

  return { kept, dropped }
}
