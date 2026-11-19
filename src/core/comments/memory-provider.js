/**
 * 内存评论 Provider —— 09 §5.8（P6b-01）、契约见 `src/providers/comments.js`。
 *
 * 实现 COMMENT_METHODS 五方法及可选 deleteReply；线程/回复的构造、校验、排序复用 core 层，
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
import { buildReply, buildThread, normalizeAuthor, normalizeThread } from './thread'
import { reopenThread, resolveThread, sortThreads } from './state'
import { normalizeEmojiGlyph } from '../emoji/identity'

/** 默认 id：进程内自增，跨 Provider 也不重号；需要固定序列时用 options.nextId 覆盖。 */
let sequence = 0

function defaultId(prefix) {
  sequence += 1
  return `${prefix}-${sequence.toString(36)}`
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]))
  }
  return value
}

function cloneReply(reply) {
  return cloneValue(reply)
}

function cloneThread(thread) {
  return cloneValue(thread)
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
  // Keep retired ids reserved within their original thread/reply namespace.
  const threadIds = new Set(), replyIds = new Map()
  const idFactory = typeof config.nextId === 'function' ? config.nextId : null
  const nextId = (prefix, reserved) => {
    if (idFactory) return idFactory(prefix)
    let id
    do { id = defaultId(prefix) } while (reserved?.has(id))
    return id
  }
  const store = new Map()

  const seed = config.threads || []
  seed.forEach((raw) => {
    const thread = normalizeThread(raw)
    if (thread && thread.id) {
      store.set(thread.id, cloneThread(thread))
      threadIds.add(thread.id)
      replyIds.set(thread.id, new Set(thread.replies.map(reply => reply.id)))
    }
  })

  const provider = {
    supportsAttachments: true,

    async list() {
      return sortThreads(Array.from(store.values())).map(cloneThread)
    },

    async createThread(input) {
      const thread = buildThread(input, { id: nextId('c', threadIds), replyId: nextId('r'), now: clock() })
      if (threadIds.has(thread.id)) throw new Error(`评论线程 id 重复：${thread.id}`)
      store.set(thread.id, thread)
      threadIds.add(thread.id)
      replyIds.set(thread.id, new Set(thread.replies.map(reply => reply.id)))
      return cloneThread(thread)
    },

    async reply(input) {
      const source = input || {}
      const thread = requireThread(store, source.threadId)
      const reserved = replyIds.get(thread.id)
      const reply = buildReply(source, { id: nextId('r', reserved), now: clock() })
      if (reserved.has(reply.id)) throw new Error(`评论回复 id 重复：${reply.id}`)
      thread.replies = thread.replies.concat([reply])
      reserved.add(reply.id)
      return cloneReply(reply)
    },

    /** 回复编辑只允许原作者，保留原 id/创建时间并记录编辑时间。 */
    async editReply(input) {
      const source = input || {}
      const thread = requireThread(store, source.threadId)
      const replyId = source.commentId || source.replyId
      const index = thread.replies.findIndex(reply => reply.id === replyId)
      if (index === -1) throw new Error(`评论回复不存在：${replyId || '(空)'}`)
      const current = thread.replies[index]
      const author = normalizeAuthor(source.author)
      if (!author.id || author.id !== current.author.id) throw new Error('只能编辑自己的评论')
      const content = source.content != null ? source.content : source.body
      // 编辑允许「只剩图片」的正文：附件未随本次提交时沿用原回复的图片再校验。
      const validated = buildReply({ author, content, attachments: source.attachments !== undefined ? source.attachments : current.attachments }, { id: current.id, now: current.createdAt })
      const next = { ...current, content: validated.content, editedAt: clock() }
      if (!Object.prototype.hasOwnProperty.call(source, 'richContent')) delete next.richContent
      ;['richContent', 'mentions', 'references', 'attachments'].forEach(key => {
        if (Object.prototype.hasOwnProperty.call(source, key)) next[key] = cloneValue(source[key])
      })
      thread.replies = thread.replies.map((reply, itemIndex) => itemIndex === index ? next : reply)
      return cloneReply(next)
    },

    /** 本地演示用 reaction 状态：同一作者重复切换即可加入/移除。 */
    async toggleReaction(input) {
      const source = input || {}
      const thread = requireThread(store, source.threadId)
      const replyId = source.commentId || source.replyId
      const index = thread.replies.findIndex(reply => reply.id === replyId)
      if (index === -1) throw new Error(`评论回复不存在：${replyId || '(空)'}`)
      const current = thread.replies[index]
      const author = normalizeAuthor(source.author)
      if (!author.id) throw new Error('reaction 缺少作者 id')
      // 目录里的 id（`applaud_v2` 这类）与原生 emoji 字形走同一条路：只挡空串、
      // 超长与控制字符，不要求它一定能在 emoji 表里查到。
      const raw = typeof source.emoji === 'string' ? source.emoji.trim() : ''
      if (!raw || Array.from(raw).length > 64 || /[\r\n]/.test(raw) || raw.includes('\u0000')) throw new Error('reaction 表情无效')
      const emoji = normalizeEmojiGlyph(raw)
      const reactions = Array.isArray(current.reactions) ? cloneValue(current.reactions) : []
      const reactionIndex = reactions.findIndex(reaction => normalizeEmojiGlyph(reaction && reaction.emoji) === emoji)
      const reaction = reactionIndex === -1 ? { emoji, users: [] } : reactions[reactionIndex]
      reaction.users = Array.isArray(reaction.users) ? reaction.users.filter(userId => typeof userId === 'string') : []
      const userIndex = reaction.users.indexOf(author.id)
      if (userIndex === -1) reaction.users.push(author.id)
      else reaction.users.splice(userIndex, 1)
      if (!reaction.users.length) {
        if (reactionIndex !== -1) reactions.splice(reactionIndex, 1)
      } else if (reactionIndex === -1) {
        reactions.push(reaction)
      } else {
        reactions[reactionIndex] = reaction
      }
      const next = { ...current, reactions }
      thread.replies = thread.replies.map((reply, itemIndex) => itemIndex === index ? next : reply)
      return cloneReply(next)
    },

    /** 与远端 Provider 的显式 active 接口对齐；未传 active 时按 toggle 处理。 */
    async react(input) {
      const source = input || {}
      if (typeof source.active !== 'boolean') return provider.toggleReaction(source)
      const thread = store.get(source.threadId)
      const reply = thread && thread.replies.find(item => item.id === (source.commentId || source.replyId))
      const author = normalizeAuthor(source.author)
      const emoji = normalizeEmojiGlyph(source.emoji)
      const active = !!(reply && Array.isArray(reply.reactions) && reply.reactions.some(item => normalizeEmojiGlyph(item.emoji) === emoji && Array.isArray(item.users) && item.users.includes(author.id)))
      if (active !== source.active) return provider.toggleReaction(source)
      return reply ? cloneReply(reply) : undefined
    },

    /** 显式本地演示：删除写入当前 Provider 的内存存储，不代表跨刷新持久化。 */
    async deleteReply(input) {
      const source = input || {}
      const thread = requireThread(store, source.threadId)
      const replies = thread.replies.filter((reply) => reply.id !== source.commentId)
      if (replies.length === thread.replies.length) return
      if (replies.length) store.set(thread.id, { ...thread, replies })
      else store.delete(thread.id)
    },

    /** 删除整条线程：与 `deleteReply` 同属本地演示路径，只删内存存储。 */
    async deleteThread(input) {
      const source = input || {}
      const id = source.threadId || source.id
      if (!id || !store.has(id)) return false
      store.delete(id)
      return true
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
