const video = 'https://cuijianjun.github.io/LarkDoc/demo-clip.mp4'
const videoNode = { type: 'fileBlock', attrs: { src: video, name: 'LarkDoc 演示视频', mimeType: 'video/mp4', viewType: 'Preview' } }
const blank = '<p></p>'
const documentText = '<p>编辑这一段内容来试用文档能力。</p>'

const localUpload = `async uploadFile(file) {
  const mimeType = file.type || 'application/octet-stream'
  const previewType = /^(video\\/(mp4|webm|ogg)|application\\/pdf)$/.test(mimeType)
    ? mimeType : 'application/octet-stream'
  const url = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file.slice(0, file.size, previewType))
  })
  return { url, name: file.name, size: file.size, mimeType }
},`

const videoUpload = {
  example: 'upload', label: '通过接口上传视频', fixture: 'videos',
  content: blank,
  config: { limits: { maxFileSize: 20 * 1024 * 1024 } },
  options: `async uploadFile(file, { signal }) {
  const form = new FormData()
  form.append('file', file)
  const response = await fetch('/api/larkdoc/videos', {
    method: 'POST', body: form, signal,
  })
  if (!response.ok) throw new Error('视频上传失败')
  return response.json()
},`,
  note: '文档站在当前浏览器模拟上传接口，返回实际所选文件的播放地址。生产应用可以返回对象存储地址，或通过 token 换取地址。',
  steps: ['从「视频或文件」选择一个 20 MiB 以内的 MP4 或 WebM。', '打开播放器，试用进度条和倍速。'],
}

export const addedFeatures = [
  {
    text: '更多内容块',
    items: [
      {
        id: 'video', title: '视频', media: true, basicLabel: '播放已有视频', tall: true,
        content: { type: 'doc', content: [videoNode] },
        config: { features: { files: true }, toolbarKeys: ['insert'] },
        steps: ['点播放，拖动进度条。', '从控制区试用倍速、音量或全屏。'],
        cases: [
          videoUpload,
          {
            example: 'resolve', label: '通过 token 获取视频地址',
            content: { type: 'doc', content: [{ ...videoNode, attrs: { ...videoNode.attrs, src: '', token: 'demo-video' } }] },
            options: `async resolveFileUrl(token) {
  if (token !== 'demo-video') return ''
  return "${video}"
},`,
            steps: ['播放带 token 的视频。', '展开代码查看如何从 token 换取播放地址。'],
          },
        ],
      },
      {
        id: 'file', title: '文件与附件', tall: true, basicLabel: '上传并下载附件',
        content: blank, options: localUpload,
        config: { features: { files: true }, toolbarKeys: ['insert'], limits: { maxFileSize: 20 * 1024 * 1024 } },
        note: '本例在浏览器读取文件，限制设为 20 MiB。生产接入时由 uploadFile 返回持久化地址或 token。',
        steps: ['从「视频或文件」选文件。', '打开附件菜单，试用下载或切换显示方式。'],
        cases: [{
          example: 'inline', label: '行内文件样式', media: true,
          content: { type: 'doc', content: [{ ...videoNode, attrs: { ...videoNode.attrs, viewType: 'Inline' } }] },
          steps: ['观察已有文件的行内视图。', '展开代码比较 Inline、Card 和 Preview 的配置。'],
        }],
      },
      {
        id: 'embed', title: '内嵌网页与卡片',
        content: blank, config: { features: { embed: true }, toolbarKeys: ['insert'] },
        steps: ['输入 /，搜索「网页」并打开插入面板。', '粘贴应用允许的地址，查看内嵌或链接。'],
        cases: [{
          example: 'off', label: '限制内嵌入口', config: { features: { embed: false }, embedProviders: [] },
          steps: ['再次搜索「网页」，确认内嵌入口已收起。', '正文仍可使用普通链接。'],
        }],
      },
      {
        id: 'interactive-blocks', title: '文档小组件', basicLabel: '分割线与目录导航', tall: true,
        content: '<h1>准备工作</h1><h2>验证结果</h2><p></p>',
        config: { commands: { allow: ['divider', 'catalogue'] } },
        steps: ['在空段输入 /，插入分割线或目录导航。', '点击目录项可定位到正文标题。'],
        cases: [
          {
            example: 'mentions', label: '人员、群名片和云文档',
            content: blank,
            config: { commands: { allow: ['mentionUser', 'mentionChat', 'mentionPage'] }, mentionSource: [
              { id: 'u1', name: '示例成员', kind: 'user' },
              { id: 'g1', name: '项目小组', kind: 'chat' },
              { id: 'd1', name: '项目手册', kind: 'page' },
            ] },
            steps: ['输入 @ 并选择候选。', '可从 / 菜单按人员、群名片、云文档打开候选面板。'],
          },
          {
            example: 'meeting', label: '投票、日期提醒、日程和会议议程',
            content: blank,
            config: {
              commands: { allow: ['poll', 'reminder', 'calendar_event', 'agenda'] },
              calendarSource: [{ id: 'review', summary: '项目评审', startTime: '2030-01-10T09:00:00+08:00', endTime: '2030-01-10T10:00:00+08:00' }],
            },
            steps: ['在空段输入 /，选择投票、日期提醒或会议议程。', '打开「日程」候选面板，选择 calendarSource 中的示例。'],
          },
          {
            example: 'buttons', label: '文档按钮与回调',
            content: blank,
            config: { commands: { allow: ['open_link', 'duplicate_page', 'follow_page'] } },
            options: `onIsvButtonAction(event) {
  output.value = JSON.stringify(event, null, 2)
  return true
},`,
            steps: ['用 / 插入「创建副本」或「关注文档更新」。', '按界面提示完成配置，点击正文里的按钮查看宿主回调。'],
          },
        ],
      },
    ],
  },
  {
    text: '文档与应用',
    items: [
      {
        id: 'persistence', title: '保存与恢复', basicLabel: '手动保存',
        content: documentText,
        config: { storage: 'local', documentId: 'larkdoc-docs-save-demo', autosave: { enabled: false } },
        note: '文档使用独立的示例 ID 保存到当前浏览器。刷新后可检查之前保存的文本。',
        button: '手动保存', action: 'await doc.save()',
        options: `onSave(event) {
  output.value = event.status === 'saved' ? '保存成功' : event.message
},`,
        steps: ['修改正文并点击手动保存。', '刷新独立演示，确认上次保存的内容。'],
        cases: [{
          example: 'auto', label: '启用自动保存',
          config: { documentId: 'larkdoc-docs-autosave-demo', autosave: { enabled: true, delay: 650 } },
          button: '读取自动保存设置', action: 'output.value = JSON.stringify(doc.getAutoSave(), null, 2)',
          steps: ['输入新内容后停顿，观察保存状态。', '读取配置，查看自动保存开关和延迟。'],
        }, {
          example: 'host', label: '接到宿主接口', fixture: 'draft',
          config: { storage: 'none', documentId: 'larkdoc-docs-host-draft' },
          prepare: `import { createLocalPersistence } from 'lark-doc/providers'

const snapshotStorage = {
  getItem: key => sessionStorage.getItem('larkdoc-docs-host:' + key),
  setItem: (key, value) => sessionStorage.setItem('larkdoc-docs-host:' + key, value),
}
const { snapshots, snapshot, restore } = createLocalPersistence(snapshotStorage)`,
          options: `persistence: {
  snapshots, snapshot, restore,
  async load() {
    const response = await fetch('/api/larkdoc/draft')
    if (!response.ok) throw new Error('读取草稿失败')
    return response.json()
  },
  async save(record) {
    const response = await fetch('/api/larkdoc/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    })
    if (!response.ok) throw new Error('保存草稿失败')
  },
},
onSave(event) {
  output.value = event.status === 'saved' ? '接口已确认保存' : event.message
},`,
          note: '文档站在当前浏览器模拟草稿接口，快照使用会话存储。正式服务应校验文档权限与版本。',
          steps: ['修改正文，点击手动保存。', '重新载入示例，观察接口返回的草稿。'],
        }],
      },
      {
        id: 'history', title: '撤销与版本历史', basicLabel: '本次编辑的撤销与重做',
        content: documentText, config: { toolbarKeys: ['history'] },
        steps: ['编辑正文后点击撤销，再点击重做。'],
        cases: [{
          example: 'versions', label: '开启已保存版本',
          config: { features: { versionHistory: true }, documentId: 'larkdoc-docs-version-demo', user: { id: 'docs', name: '示例作者' } },
          prepare: "import { createMemoryVersioningProvider } from 'lark-doc/versioning'",
          options: 'versioning: createMemoryVersioningProvider(),',
          button: '创建版本',
          action: `const version = await doc.getSession().createVersion({ name: '示例版本' })
output.value = '已创建版本：' + version.id`,
          steps: ['修改正文并点击「创建版本」。', '打开顶栏「更多」里的「历史记录」查看版本。'],
          note: '版本示例使用内存 Provider。实际应用应在授权的服务端保存和管理版本。',
        }],
      },
      {
        id: 'share', title: '分享入口',
        content: '<p>选中这句话，查看选区工具里的分享入口。</p>',
        config: {
          features: { share: true },
          mentionSource: [{ id: 'share-demo-user', name: '示例同事', kind: 'user' }],
        },
        options: `onSelectionShare(event) {
  output.value = JSON.stringify({ selection: event.selection, recipients: event.recipients }, null, 2)
},`,
        steps: ['选中正文，再点分享入口。', '选择「示例同事」并发送，查看宿主回调参数。'],
        cases: [{ example: 'hidden', label: '关闭分享', config: { features: { share: false } }, steps: ['划选同一段文字，查看分享入口已收起。'] }],
      },
      {
        id: 'shortcuts', title: '快捷键与帮助',
        content: documentText,
        config: { features: { shortcuts: true }, toolbarKeys: ['shortcuts', 'history'] },
        steps: ['点击快捷键入口，查看快捷键列表。', '在正文试用撤销或加粗。'],
        cases: [{ example: 'hide', label: '关闭快捷键帮助入口', config: { features: { shortcuts: false } }, steps: ['确认工具栏不显示快捷键帮助。'] }],
      },
    ],
  },
]

export const largeDocumentDemo = {
  id: 'large-documents', title: '大文档导出与渲染', route: '/guide/large-documents',
  content: '<p>点击按钮生成 4,200 个段落。</p>',
  load: [],
  config: { performance: { changeDebounce: 150 }, toolbarKeys: ['search', 'outline'] },
  button: '分批导入 4,200 段',
  action: `const content = {
  type: 'doc',
  content: Array.from({ length: 4200 }, (_, index) => ({
    type: 'paragraph',
    content: [{ type: 'text', text: '段落 ' + (index + 1) }],
  })),
}
await doc.setContentAsync(content, { format: 'json', pagedView: true })
const data = doc.getJSON()
output.value = '已导入 ' + data.content.length + ' 段；最后一段：' + data.content.at(-1).content[0].text`,
  steps: ['导入示例长文档后滚动，或查找「段落 4200」。', '结果区域读取末段，检查离屏段落也在完整正文里。'],
  cases: [{
    example: 'export', label: '导出包含离屏段落的 HTML',
    button: '生成并下载完整 HTML',
    action: `const content = {
  type: 'doc',
  content: Array.from({ length: 4200 }, (_, index) => ({
    type: 'paragraph',
    content: [{ type: 'text', text: '段落 ' + (index + 1) }],
  })),
}
await doc.setContentAsync(content, { format: 'json', pagedView: true })
const url = URL.createObjectURL(new Blob([
  '<!doctype html><meta charset="utf-8">',
  doc.getHTML(),
], { type: 'text/html;charset=utf-8' }))
const link = document.createElement('a')
link.href = url
link.download = 'larkdoc-long-document.html'
link.click()
setTimeout(() => URL.revokeObjectURL(url), 1000)`,
    steps: ['生成并下载示例 HTML。', '打开下载文件，核对第 1 段至第 4200 段。'],
  }],
}
