const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40, silent: 100 })
const configuredLevel = String(process.env.VUE_APP_LOG_LEVEL || 'info').toLowerCase()
const threshold = LEVELS[configuredLevel] || LEVELS.info
const { sanitizeMetadata } = require('./safety')

function write(level, category, event, metadata) {
  if (LEVELS[level] < threshold) return

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    category,
    event,
    metadata: sanitizeMetadata(metadata),
  }

  const output = level === 'debug' ? 'debug' : level === 'info' ? 'info' : level
  console[output]('[tiptap-demo]', entry)
}

// 日志只允许写运行元数据；字段名命中敏感词时会被统一脱敏，避免误打印正文和密钥。
export const logger = {
  debug: (category, event, metadata) => write('debug', category, event, metadata),
  info: (category, event, metadata) => write('info', category, event, metadata),
  warn: (category, event, metadata) => write('warn', category, event, metadata),
  error: (category, event, metadata) => write('error', category, event, metadata),
}
