self.addEventListener('install', event => event.waitUntil(self.skipWaiting()))
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

const scope = new URL(self.registration.scope)
const fixture = name => new URL('__fixtures/' + name, scope).href

async function imageResponse(request) {
  const form = await request.formData()
  const image = form.get('file')
  if (!image || !/^image\/(png|jpeg|webp|gif)$/.test(image.type) || image.size > 20 * 1024 * 1024) {
    return Response.json({ code: 1, message: '请选择 20 MiB 以内的 PNG、JPEG、WebP 或 GIF' })
  }
  const bytes = new Uint8Array(await image.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  const url = 'data:' + image.type + ';base64,' + btoa(binary)
  return Response.json({ code: 0, data: { url, id: 'demo-image' } })
}

async function videoResponse(request, url) {
  const cache = await caches.open('larkdoc-feature-video:' + scope.pathname)
  if (request.method === 'POST') {
    const file = (await request.formData()).get('file')
    if (!file?.size || file.size > 20 * 1024 * 1024 || !/^video\/(mp4|webm)$/.test(file.type)) {
      return Response.json({ message: '请选择 20 MiB 以内的 MP4 或 WebM' }, { status: 400 })
    }
    url.searchParams.set('id', crypto.randomUUID())
    await cache.put(url.href, new Response(file, { headers: { 'Content-Type': file.type } }))
    return Response.json({ url: url.href, name: file.name, size: file.size, mimeType: file.type })
  }
  const response = await cache.match(url.href)
  if (!response) return new Response(null, { status: 404 })
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('Range') || '')
  if (!range) return response
  const video = await response.blob()
  const start = Number(range[1])
  const end = range[2] ? Math.min(Number(range[2]), video.size - 1) : video.size - 1
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + video.size } })
  return new Response(video.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': video.type,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${video.size}`,
      'Accept-Ranges': 'bytes',
    },
  })
}

async function aiResponse(request, compatible) {
  const input = await request.json()
  if (compatible && (request.headers.get('Authorization') !== 'Bearer larkdoc-demo-token' || !input.model || !Array.isArray(input.messages))) {
    return Response.json({ error: { message: '示例服务需要模型、消息和演示令牌' } }, { status: 400 })
  }
  const encoder = new TextEncoder()
  const text = compatible ? 'OpenAI 兼容示例：已收到模型与消息配置。' : '后端网关示例：已收到改写请求。'
  const body = new ReadableStream({
    async start(controller) {
      for (const delta of [text.slice(0, 8), text.slice(8)]) {
        const data = compatible ? { choices: [{ delta: { content: delta } }] } : { delta }
        controller.enqueue(encoder.encode('data: ' + JSON.stringify(data) + '\n\n'))
        await new Promise(resolve => setTimeout(resolve, 120))
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
}

async function draftResponse(request) {
  const cache = await caches.open('larkdoc-feature-draft:' + scope.pathname)
  const key = fixture('draft')
  if (request.method === 'GET') return (await cache.match(key)) || Response.json(null)
  await cache.put(key, Response.json(await request.json()))
  return new Response(null, { status: 204 })
}

self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method === 'POST' && request.url === fixture('videos') ||
      request.method === 'GET' && url.origin + url.pathname === fixture('videos') &&
      /^[a-f0-9-]{36}$/.test(url.searchParams.get('id') || '')) {
    event.respondWith(videoResponse(request, url))
    return
  }
  if (request.url === fixture('draft')) {
    if (request.method === 'GET' || request.method === 'POST') event.respondWith(draftResponse(request))
    return
  }
  if (request.method !== 'POST') return
  if (request.url === fixture('images')) event.respondWith(imageResponse(request))
  if (request.url === fixture('ai')) event.respondWith(aiResponse(request, false))
  if (request.url === fixture('openai/v1/chat/completions')) event.respondWith(aiResponse(request, true))
})
