'use strict'
const assert = require('assert')
let images = {}
try { images = require('../src/components/feishu/ecsImages') } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error }
assert.strictEqual(typeof images.createEcsImageApi, 'function', 'Existing ECS upload and preview APIs must be reusable')
const { createEcsImageApi, createEcsImageUpload } = images
async function check() {
  const configs = []
  const api = createEcsImageApi(config => { configs.push(config); return Promise.resolve({}) })
  await api.uploadImages('multipart')
  await api.filePreviews({ attchId: 'a/b' })
  assert.deepStrictEqual(configs, [
    { url: '/system/bulletin-board/upload', method: 'post', headers: { 'Content-Type': 'multipart/form-data' }, data: 'multipart' },
    { url: '/system/bulletin-board/getFileByte/a%2Fb', method: 'get', responseType: 'blob' },
  ])
  // Node 14 无浏览器 FormData；只替换 multipart 容器，实际适配器与函数继续执行。
  const previous = global.FormData
  global.FormData = class { constructor() { this.fields = new Map() } append(key, value) { this.fields.set(key, value) } get(key) { return this.fields.get(key) } }
  try {
    let uploaded
    let previewId
    const file = { name: 'image.jpeg', type: 'image/jpeg', size: 20 * 1024 * 1024 }
    const upload = createEcsImageUpload({
      uploadImages: async data => { uploaded = data; return { data: { attchId: 42, url: '/system/bulletin-board/getFileByte/42' } } },
      filePreviews: async data => { previewId = data.attchId; return {} },
    }, 'https://ecs.example/api/')
    assert.deepStrictEqual(await upload(file), { url: 'https://ecs.example/system/bulletin-board/getFileByte/42', attchId: '42' })
    assert.strictEqual(uploaded.get('file'), file)
    assert.strictEqual(uploaded.get('json'), '{"suffix":"jpeg"}')
    assert.strictEqual(previewId, 42)
    uploaded = null
    await assert.rejects(() => upload({ ...file, size: file.size + 1 }), /20/)
    assert.strictEqual(uploaded, null, 'Oversize must be rejected before calling ECS API')
    await assert.rejects(() => upload({ ...file, type: 'image/svg+xml' }), /图片/)
    for (const response of [{}, { data: { attchId: 'a', url: 'javascript:alert(1)' } }, { data: { url: 'https://example.com/a.png' } }]) {
      await assert.rejects(() => createEcsImageUpload({ uploadImages: async () => response, filePreviews: async () => ({}) }, 'https://ecs.example')(file), /附件|地址/)
    }
    await assert.rejects(() => createEcsImageUpload({ uploadImages: async () => { throw new Error('upload failed') } }, 'https://ecs.example')(file), /upload failed/)
    await assert.rejects(() => createEcsImageUpload({ uploadImages: async () => ({ data: { attchId: 'a', url: 'https://ecs.example/a.png' } }), filePreviews: async () => { throw new Error('preview failed') } }, 'https://ecs.example')(file), /preview failed/)
  } finally { global.FormData = previous }
  console.log('PASS ECS upload/preview contracts, multipart suffix, URL resolution, attachment identity, 20MB guard and errors')
}
check().catch(error => { console.error(error); process.exitCode = 1 })
