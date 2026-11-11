/**
 * Vditor 图片流接口 demo 的本地后端（零依赖，Node 18+）。
 *
 * 模拟的后端契约：
 *   POST /api/upload              → 只返回 { code:0, data:{ attchId } }，没有静态 url
 *   GET  /api/file/:id/stream     → 图片二进制流，必须带 Authorization（<img> 裸 GET 会 401）
 *   GET  /api/file/:id/raw        → 同一张图的代理直链，改用同源 cookie 鉴权（<img> 能自动带上）
 *
 * 运行：node server.mjs   然后打开 http://127.0.0.1:4173
 */
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 4173)
const TOKEN = 'demo-token'
const store = new Map()
let seq = 0

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** 只取 multipart 的第一个文件块；demo 不需要完整解析器。 */
function parseFirstFile(body, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType || '')
  if (!match) throw new Error('multipart 缺少 boundary')
  const marker = Buffer.from(`--${match[1] || match[2]}`)
  const start = body.indexOf(marker)
  const headerEnd = body.indexOf('\r\n\r\n', start)
  if (start < 0 || headerEnd < 0) throw new Error('multipart 格式错误')
  const header = body.subarray(start, headerEnd).toString('utf8')
  const dataStart = headerEnd + 4
  const next = body.indexOf(marker, dataStart)
  const dataEnd = next < 0 ? body.length : next - 2 // 去掉结尾的 \r\n
  return {
    buffer: Buffer.from(body.subarray(dataStart, Math.max(dataStart, dataEnd))),
    mime: (/Content-Type:\s*([^\r\n]+)/i.exec(header) || [])[1] || 'image/png',
  }
}

function sendImage(res, entry) {
  res.writeHead(200, {
    'Content-Type': entry.mime,
    'Content-Length': entry.buffer.length,
    'Cache-Control': 'private, max-age=300',
    ETag: `"${entry.id}"`,
  })
  res.end(entry.buffer)
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://127.0.0.1')
  console.log(req.method, pathname)

  try {
    if (pathname === '/api/login' && req.method === 'POST') {
      res.setHeader('Set-Cookie', 'demo_auth=1; Path=/; SameSite=Lax')
      return json(res, 200, { code: 0 })
    }

    if (pathname === '/api/upload' && req.method === 'POST') {
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(res, 401, { msg: '缺少 Authorization' })
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const { buffer, mime } = parseFirstFile(Buffer.concat(chunks), req.headers['content-type'])
      if (!buffer.length) return json(res, 400, { msg: '空文件' })
      const id = `att-${++seq}`
      store.set(id, { id, buffer, mime })
      // 关键：这里刻意不返回 url，模拟「上传后只给一个取流用的接口标识」。
      return json(res, 200, { code: 0, msg: '', data: { attchId: id } })
    }

    const match = /^\/api\/file\/([^/]+)\/(stream|raw)$/.exec(pathname)
    if (match) {
      const entry = store.get(match[1])
      if (!entry) return json(res, 404, { msg: '附件不存在' })
      if (match[2] === 'stream') {
        if (req.headers.authorization !== `Bearer ${TOKEN}`) {
          console.log('   ↳ 401：浏览器 <img> 的裸 GET 带不上 Authorization')
          return json(res, 401, { msg: '流接口需要 Authorization；img 裸 GET 带不上' })
        }
      } else if (!/(?:^|;\s*)demo_auth=1/.test(req.headers.cookie || '')) {
        return json(res, 401, { msg: '代理直链需要同源 cookie' })
      }
      return sendImage(res, entry)
    }

    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '')
    const file = path.resolve(ROOT, rel)
    if (!file.startsWith(ROOT + path.sep)) return json(res, 403, { msg: 'forbidden' })
    const data = await fs.readFile(file)
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
    return res.end(data)
  } catch (error) {
    return json(res, 500, { msg: String((error && error.message) || error) })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Vditor 图片接口渲染 demo: http://127.0.0.1:${PORT}`)
})
