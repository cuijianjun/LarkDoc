/**
 * 内存评论 Provider —— 09 §5.8（P6b-01）、契约见 `src/providers/comments.js`。
 *
 * 只实现 COMMENT_METHODS 的五件事；线程/回复的构造、校验、排序全部复用 core 层，
 * 这样单测覆盖到的是与真实 Provider 同一条写路径，而不是另写一套容易走样的逻辑。
 *
 * 读写都做防御性拷贝：面板拿到数组后会排序、就地改局部状态，若直接交出内部引用，
 * 一次 UI 操作就会悄悄改写「持久层」——内存实现也要有这条边界，否则测试会假绿。
 *
 * 方法声明成 async 是照 05 §5.5 的 Promise 签名（`list` 返回 `Promise<Thread[]>`），
 * 调用方既可以用 await，也可以 .then。
 *
 * 待定：05 §5.5 的 Thread 还有 `documentId`，任务单模型没有该字段，因此 `list(ctx)` 不按
 * 文档过滤；多文档演示由宿主为每个文档各建一个 Provider（或按 documentId 前缀造 id）。
 */

import { createCommentsProvider } from '../../providers/comments'
import { buildReply, buildThread, normalizeThread } from './thread'
import { reopenThread, resolveThread, sortThreads } from './state'

/** 默认 id：进程内自增，跨 Provider 也不重号；需要固定序列时用 options.nextId 覆盖。 */
let sequence = 0

function defaultId(prefix) {
  sequence += 1
  return `${prefix}-${sequence.toString(36)}`
}

function cloneReply(reply) {
  return { ...reply, author: { ...reply.author } }
}

function cloneThread(thread) {
  return {
    ...thread,
    anchor: { ...thread.anchor },
    author: { ...thread.author },
    replies: thread.replies.map(cloneReply),
  }
}

/** 所有「按 id 找线程」的操作共用一句可定位的报错。 */
function requireThread(store, threadId) {
  const id = typeof threadId === 'string' ? threadId : ''
  const thread = store.get(id)
  if (!thread) throw new Error(`评论线程不存在：${id || '(空)'}`)
  return thread
}

/**
 * @param {object} [options]
 * @param {() => number} [options.now] 时钟，测试用它固定 createdAt。
 * @param {(prefix: string) => string} [options.nextId] id 工厂，prefix 为 'c' / 'r'。
 * @param {object[]} [options.threads] 预置线程（会被 normalizeThread 归一化，无效项丢弃）。
 */
export function createMemoryCommentsProvider(options) {
  const config = options || {}
  const clock = typeof config.now === 'function' ? config.now : Date.now
  const nextId = typeof config.nextId === 'function' ? config.nextId : defaultId
  const store = new Map()

  const seed = config.threads || []
  seed.forEach((raw) => {
    const thread = normalizeThread(raw)
    if (thread && thread.id) store.set(thread.id, thread)
  })

  const provider = {
    async list() {
      return sortThreads(Array.from(store.values())).map(cloneThread)
    },

    async createThread(input) {
      const thread = buildThread(input, { id: nextId('c'), replyId: nextId('r'), now: clock() })
      if (store.has(thread.id)) throw new Error(`评论线程 id 重复：${thread.id}`)
      store.set(thread.id, thread)
      return cloneThread(thread)
    },

    async reply(input) {
      const source = input || {}
      const thread = requireThread(store, source.threadId)
      const reply = buildReply(source, { id: nextId('r'), now: clock() })
      thread.replies = thread.replies.concat([reply])
      return cloneReply(reply)
    },

    /** 05 §5.5.1：同一 id 重放要幂等，所以这里直接复用 resolveThread 的判定。 */
    async resolve(threadId) {
      const thread = requireThread(store, threadId)
      const next = resolveThread(thread)
      store.set(next.id, next)
      return cloneThread(next)
    },

    async reopen(threadId) {
      const thread = requireThread(store, threadId)
      const next = reopenThread(thread)
      store.set(next.id, next)
      return cloneThread(next)
    },
  }

  // 五方法缺一个就在创建时报错（providers/comments 是唯一真源，不在这里重抄方法名）。
  return createCommentsProvider(provider)
}
