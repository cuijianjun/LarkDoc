/**
 * 动作 → 指令。AI 面板的 11 个内置动作在这里集中定义，保证
 * 「同一个动作在不同接入方式下发出的指令一致」。
 *
 * 约定：所有指令都要求模型只输出正文，不加解释、不加代码块包裹，
 * 这样 onChunk 累积出的文本可以直接进预览并落正文。
 */

const LANGUAGE_NAMES = Object.freeze({
  zh: '简体中文', 'zh-cn': '简体中文', 'zh-tw': '繁体中文', en: '英文', 'en-us': '英文',
  ja: '日文', ko: '韩文', fr: '法文', de: '德文', es: '西班牙文', ru: '俄文', pt: '葡萄牙文',
})

export const ACTION_PROMPTS = Object.freeze({
  continue: '你是写作助手。请接着下面给出的内容自然续写，保持同样的语气、人称与格式。只输出续写出来的正文，不要重复原文，不要加任何解释。',
  rewrite: '你是写作助手。请在不改变原意的前提下重写下面的内容，让表达更清晰、更顺畅。只输出重写后的正文，不要加任何解释。',
  expand: '你是写作助手。请把下面的内容扩写得更充实，补充必要的细节与论据，保持原意。只输出扩写后的正文，不要加任何解释。',
  shorten: '你是写作助手。请精简下面的内容，保留关键信息与结论，去掉冗余表达。只输出精简后的正文，不要加任何解释。',
  summarize: '你是写作助手。请用要点形式总结下面的内容，只保留最关键的信息。只输出总结正文，不要加任何解释。',
  translate: '你是翻译助手。请把下面的内容翻译成目标语言，保留原有格式与专有名词。只输出译文，不要加任何解释。',
  proofread: '你是校对助手。请检查下面内容里的错别字、标点、语法和事实性表述问题，直接给出修正后的完整正文。只输出修正后的正文，不要加任何解释。',
  formal: '你是写作助手。请把下面的内容改写为正式、专业的书面语气。只输出改写后的正文，不要加任何解释。',
  friendly: '你是写作助手。请把下面的内容改写为亲切、口语化的语气。只输出改写后的正文，不要加任何解释。',
  title: '你是标题助手。请为下面的内容生成一个简洁准确的标题，不超过 20 个字。只输出标题本身，不要加引号、不要加标点、不要加任何解释。',
  outline: '你是大纲助手。请为下面的内容生成层级大纲，用 markdown 无序列表表达，最多三级。只输出大纲，不要加任何解释。',
  chat: '你是写作助手。请回答用户的问题，回答尽量简洁，可直接使用 markdown。',
  custom: '你是写作助手。请按用户要求处理下面的内容，只输出结果，不要加任何解释。',
})

const DEFAULT_PROMPT = '你是写作助手。请按指令处理下面的内容，只输出结果，不要加任何解释。'

function languageName(language) {
  if (!language) return ''
  return LANGUAGE_NAMES[String(language).toLowerCase()] || String(language)
}

/**
 * 生成系统指令。translate 会把目标语言拼进指令，其余动作原样返回。
 */
export function resolveSystemPrompt(action, language) {
  const base = ACTION_PROMPTS[action] || DEFAULT_PROMPT
  if (action !== 'translate') return base
  const name = languageName(language)
  return name ? `你是翻译助手。请把下面的内容翻译成${name}，保留原有格式与专有名词。只输出译文，不要加任何解释。` : base
}

/**
 * 拼出用户侧的问题正文。action !== 'chat' 时把待处理文本一起附上；
 * chat 时 text 只是上下文，prompt 才是真正的问题。
 */
export function buildUserPrompt(action, text, prompt) {
  const body = typeof text === 'string' ? text : ''
  const ask = typeof prompt === 'string' ? prompt.trim() : ''
  if (action === 'chat') {
    if (!body) return ask
    return `以下是文档上下文，供你参考：\n\n${body}\n\n用户的问题：${ask || '请概括上面的内容'}`
  }
  if (!body) return ask
  if (action === 'custom' && ask) return `要求：${ask}\n\n内容：\n${body}`
  return body
}

/**
 * OpenAI / 兼容协议用：system + user 两条消息。
 * baseURL 直连时宿主更希望自己控制 messages，可以用 `messages` 钩子覆盖。
 */
export function buildMessages(action, text, prompt, language) {
  const messages = [{ role: 'system', content: resolveSystemPrompt(action, language) }]
  const user = buildUserPrompt(action, text, prompt)
  if (user) messages.push({ role: 'user', content: user })
  return messages
}
