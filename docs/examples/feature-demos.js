export const featureGroups = [
  {
    text: '基础编辑',
    items: [
      {
        id: 'heading', title: '标题',
        steps: ['点「改成二级标题」，观察第一段变成标题。', '也可以把光标放在一段文字里，从工具栏选择标题级别。'],
        content: '<p>项目进度</p><p>本周完成了编辑器接入。</p>',
        config: { features: { headings: true }, toolbarKeys: ['headings', 'history'] },
        button: '改成二级标题', action: 'return doc.getEditor().chain().focus("start").toggleHeading({ level: 2 }).run()',
      },
      {
        id: 'paragraph', title: '段落样式',
        steps: ['点「段落居中」，查看首段的对齐方式。', '把光标放在另一段，用工具栏调整对齐或缩进。'],
        content: '<p>这段文字用于演示对齐。</p><p>另一段保持原样。</p>',
        config: { features: { blockStyle: true }, toolbarKeys: ['blockStyle'] },
        button: '段落居中', action: 'return doc.getEditor().chain().focus("start").setTextAlign("center").run()',
      },
      {
        id: 'marks', title: '文字格式',
        steps: ['点「加粗开头」，查看首段前四个字。', '选中别的文字，再从工具栏试用斜体或下划线。'],
        content: '<p>重要内容可以加粗，其余文字保持普通样式。</p>',
        config: { features: { marks: true }, toolbarKeys: ['marks'] },
        button: '加粗开头', action: 'return doc.getEditor().chain().focus().setTextSelection({ from: 1, to: 5 }).toggleBold().run()',
      },
      {
        id: 'text-style', title: '文字样式',
        steps: ['点「改文字颜色」，查看首段前四个字。', '自己选中文字后，也可以在工具栏调整颜色或字号。'],
        content: '<p>重点文字可以用颜色标出来。</p>',
        config: { features: { textStyle: true }, toolbarKeys: ['textStyle'] },
        button: '改文字颜色', action: 'return doc.getEditor().chain().focus().setTextSelection({ from: 1, to: 5 }).setColor("#135b51").run()',
      },
      {
        id: 'lists', title: '列表',
        steps: ['点「转为项目列表」，查看第一段前的项目符号。', '按 Enter 新建一项，再输入列表内容。'],
        content: '<p>准备编辑器示例</p><p>核对接入步骤</p>',
        config: { toolbarKeys: ['insert', 'history'] },
        button: '转为项目列表', action: 'return doc.getEditor().chain().focus("start").toggleBulletList().run()',
      },
      {
        id: 'quote', title: '引用',
        steps: ['点「设为引用」，查看第一段的引用样式。', '再次点击，可以还原成普通段落。'],
        content: '<p>先跑通最小示例，再逐步加入业务功能。</p>',
        config: { toolbarKeys: ['insert'] },
        button: '设为引用', action: 'return doc.getEditor().chain().focus("start").toggleBlockquote().run()',
      },
      {
        id: 'link', title: '链接',
        steps: ['点「添加链接」，把第一行开头四个字设成链接。', '在编辑器中点击这段文字，可以查看或修改地址。'],
        content: '<p>项目文档包含安装与配置说明。</p>',
        config: { toolbarKeys: ['textStyle'] },
        button: '添加链接', action: 'return doc.getEditor().chain().focus().setTextSelection({ from: 1, to: 5 }).setLink({ href: "https://example.com/" }).run()',
      },
      {
        id: 'emoji', title: '表情',
        steps: ['点「插入表情」，在正文结尾添加一个表情。', '也可以用工具栏的插入菜单选择表情。'],
        content: '<p>今天完成了一个小目标 </p>',
        config: { features: { emoji: true }, toolbarKeys: ['insert'] },
        button: '插入表情', action: 'return doc.getEditor().chain().focus("end").setEmoji("smile").run()',
      },
    ],
  },
  {
    text: '内容块',
    items: [
      {
        id: 'table', title: '表格',
        steps: ['点「插入 2 × 3 表格」。', '点击单元格输入内容，或用表格工具条增删行列。'],
        content: '<p>在这里整理项目清单。</p>',
        config: { features: { tables: true }, toolbarKeys: ['insert', 'tables', 'history'] },
        button: '插入 2 × 3 表格', action: 'return doc.getEditor().chain().focus("end").insertTable({ rows: 2, cols: 3, withHeaderRow: true }).run()',
      },
      {
        id: 'image', title: '图片',
        steps: ['点「插入示例图片」。', '点击图片查看尺寸、裁剪等工具。'],
        content: '<p>在正文插入一张项目配图。</p>',
        config: { features: { images: true }, toolbarKeys: ['insert'] },
        button: '插入示例图片',
        action: `const canvas = document.createElement("canvas")
canvas.width = 320
canvas.height = 120
const context = canvas.getContext("2d")
context.fillStyle = "#e4f2ee"
context.fillRect(0, 0, 320, 120)
context.fillStyle = "#135b51"
context.font = "24px system-ui"
context.fillText("LarkDoc", 24, 70)
return doc.getEditor().chain().focus("end").setImage({
  src: canvas.toDataURL(), alt: "LarkDoc 示例图片",
}).run()`,
      },
      {
        id: 'code-block', title: '代码块与图表',
        steps: ['修改第一段代码，观察语法高亮。', '第二段用 Mermaid 语法描述流程。用代码块的预览按钮查看图表。'],
        content: '<pre><code class="language-javascript">const title = "项目进度"</code></pre><pre><code class="language-mermaid">flowchart LR\n  A[开始] --> B[完成]</code></pre>',
        config: { features: { codeBlocks: true, diagram: true }, toolbarKeys: ['insert'] },
        tall: true,
      },
      {
        id: 'math', title: '数学公式',
        steps: ['查看行内公式和独立公式的排版。', '点一条公式，修改 LaTeX 后确认。'],
        content: '<p>行内公式 <span data-type="inline-math" data-latex="E=mc^2"></span></p><div data-type="block-math" data-latex="a^2+b^2=c^2"></div>',
        config: { features: { math: true }, toolbarKeys: ['insert'] },
      },
      {
        id: 'callout', title: '高亮块',
        steps: ['查看带图标的提示块。', '点击块左侧图标更换图标，或直接编辑提示文字。'],
        content: '<div data-type="callout" data-emoji="warning"><p>发布前请检查链接和示例。</p></div><p>这里是普通正文。</p>',
        config: { features: { callouts: true }, toolbarKeys: ['insert'] },
      },
      {
        id: 'columns', title: '分栏',
        steps: ['点「插入两列」。', '分别编辑左右两栏。桌面上可拖动栏间分隔线调整宽度。'],
        content: '<p>对照展示两个方案。</p><p></p>',
        config: { features: { columns: true }, toolbarKeys: ['insert'] },
        button: '插入两列', action: 'return doc.getEditor().chain().focus("end").insertColumns(2).run()',
      },
    ],
  },
  {
    text: '文档工具',
    items: [
      {
        id: 'toolbar', title: '工具栏配置', route: '/guide/toolbar',
        steps: ['查看只包含撤销、标题和插入的工具栏。', '修改正文后点「撤销」，确认编辑已恢复。'],
        content: '<p>这份示例只开启三组工具。</p>',
        config: { toolbarKeys: ['history', 'headings', 'insert'] },
      },
      {
        id: 'folding', title: '折叠块',
        steps: ['把光标放在「第一节」，点击标题旁的折叠箭头。', '再次点击箭头，恢复显示缩进的正文。'],
        content: '<h2>第一节</h2><p data-indent="1">这一段跟随第一节折叠。</p><h2>第二节</h2><p data-indent="1">这部分保持独立。</p>',
        config: { features: { folding: true, headings: true }, toolbarKeys: ['headings'] },
      },
      {
        id: 'outline', title: '目录',
        steps: ['点编辑器工具栏的「目录」。', '选择「检查结果」，跳到正文里的同名标题。'],
        content: '<h1>项目复盘</h1><h2>准备工作</h2><p>整理修改点。</p><h2>检查结果</h2><p>确认主流程通过。</p>',
        config: { features: { outline: true, headings: true }, toolbarKeys: ['outline'] },
      },
      {
        id: 'search', title: '查找替换',
        steps: ['点编辑器工具栏的「查找」。', '查找「示例」，输入替换词，再选择替换一处或全部。'],
        content: '<p>这个示例用于练习查找。</p><p>这里也有一个示例。</p>',
        config: { features: { search: true }, toolbarKeys: ['search'] },
      },
      {
        id: 'block-handle', title: '块句柄与拖拽',
        steps: ['在桌面将鼠标移入段落，点左侧六点按钮查看块菜单。', '拖动六点按钮改变段落顺序，也可用工具栏撤销。'],
        content: '<p>第一段：确定任务。</p><p>第二段：完成任务。</p><p>第三段：验收结果。</p>',
        config: { features: { blockHandle: true, blockDrag: true }, toolbarKeys: ['history'] },
      },
      {
        id: 'view-modes', title: '视图模式',
        steps: ['点工具栏的「阅读模式」，再试着输入文字。', '点「退出阅读」后继续修改正文。'],
        content: '<p>阅读时可以选中文字。切回编辑即可修改。</p>',
        config: { features: { viewModes: true }, toolbarKeys: ['viewModes'] },
      },
      {
        id: 'templates', title: '模板',
        steps: ['在空段输入 /，打开命令菜单。', '选择「模板」里的「会议记录」，将内容插入正文。'],
        content: '<p></p>',
        config: {
          features: { templates: true },
          toolbarKeys: ['insert'],
          templates: [{ id: 'meeting', label: '会议记录', title: '会议记录', html: '<h2>会议记录</h2><p>待办事项：</p>' }],
        },
      },
      {
        id: 'import-export', title: '导入导出',
        steps: ['编辑正文后点「读取正文 JSON」。', '在下方查看数据。可通过文档菜单试用内置导入和导出。'],
        content: '<h2>交接清单</h2><p>编辑这段正文，然后读取 JSON。</p>',
        config: { features: { importExport: true }, toolbarKeys: ['history'] },
        button: '读取正文 JSON', action: 'output.textContent = JSON.stringify(doc.getJSON(), null, 2)',
      },
    ],
  },
  {
    text: '应用接入',
    items: [
      {
        id: 'uploader', title: '图片与附件上传',
        steps: ['把本地 PNG 或 JPG 拖到正文，或用「插入」菜单选择图片。', '查看图片插入结果和回调信息。本例在浏览器内读取文件。'],
        content: '<p>把本地图片拖到这份文档。</p>',
        config: { features: { images: true }, toolbarKeys: ['insert'] },
        options: `uploader: {
  onSettled(event) {
    output.textContent = "图片：" + event.status + "（" + event.mode + "）"
  },
},`,
      },
      {
        id: 'comment', title: '评论',
        steps: ['把鼠标移到段落，点左侧六点按钮，再选择「评论」。', '输入内容并发送。示例评论保存在本次演示内。'],
        content: '<p>请复核这份项目方案。</p>',
        config: { documentId: 'docs-comment-demo', user: { id: 'reader', name: '示例用户' }, toolbarKeys: ['history'] },
        options: `comments: (() => {
  const threads = []
  let sequence = 0
  const nextId = () => String(++sequence)
  const makeReply = ({ author, content }) => ({ id: nextId(), author, content, createdAt: Date.now() })
  const findThread = id => {
    const thread = threads.find(item => item.id === id)
    if (!thread) throw new Error("评论不存在")
    return thread
  }
  return {
    async list() { return threads },
    async createThread(data) {
      const thread = { ...data, id: nextId(), resolved: false, createdAt: Date.now(), replies: [makeReply(data)] }
      threads.push(thread)
      return thread
    },
    async reply(data) {
      const reply = makeReply(data)
      findThread(data.threadId).replies.push(reply)
      return reply
    },
    async resolve(id) { const thread = findThread(id); thread.resolved = true; return thread },
    async reopen(id) { const thread = findThread(id); thread.resolved = false; return thread },
  }
})(),`,
        tall: true,
      },
      {
        id: 'collaboration', title: '协同与权限', route: '/guide/collaboration',
        steps: ['尝试修改正文。示例 Provider 只授予查看权限。', '点「读取会话权限」查看授权结果。多人实时同步使用宿主的 Yjs 服务。'],
        content: '<p>这个文档可以查看，应用服务控制是否可编辑。</p>',
        config: { documentId: 'docs-permission-demo', user: { id: 'viewer', name: '示例读者' } },
        options: `authorization: {
  async getCapabilities() {
    return { canView: true, canEdit: false, canComment: false }
  },
},`,
        button: '读取会话权限',
        action: 'output.textContent = JSON.stringify({ canView: doc.can("canView"), canEdit: doc.can("canEdit"), canComment: doc.can("canComment") }, null, 2)',
      },
      {
        id: 'ai', title: 'AI 组件',
        steps: ['选中正文，点工具栏的「AI 助手」开始改写。', '查看生成结果，再选择接受或拒绝。本例使用本地固定回答。'],
        content: '<p>今天完成了编辑器接入，并检查了主要功能。</p>',
        config: { features: { ai: true }, toolbarKeys: ['ai'] },
        options: `ai: {
  stream({ onStart, onChunk, onDone, onCancelled }) {
    const timer = setTimeout(() => {
      onStart()
      onChunk("编辑器已接入，主要功能通过验证。")
      onDone()
    }, 150)
    return { cancel() { clearTimeout(timer); onCancelled() } }
  },
},`,
        tall: true,
      },
      {
        id: 'network', title: '网络策略',
        steps: ['初始内容含一个外链图片。离线模式下查看占位状态。', '点「读取图片数据」，查看保留的原地址。'],
        content: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: '离线文档中的外链图片：' }] },
            { type: 'image', attrs: { src: 'https://example.com/photo.png', alt: '外链样图' } },
          ],
        },
        config: { network: { mode: 'offline' }, features: { images: true } },
        button: '读取图片数据',
        action: 'output.textContent = JSON.stringify(doc.getJSON().content.find(node => node.type === "image") || doc.getJSON(), null, 2)',
      },
    ],
  },
]

export const featureDemos = Object.fromEntries(
  featureGroups.flatMap(group => group.items.map(demo => [demo.id, demo])),
)

export const publishedLoader = 'https://unpkg.com/lark-doc@0.14.10/dist/lark-doc-element.umd.min.js'

export function demoMarkup(demo, loader) {
  const config = { storage: 'none', title: demo.title, content: demo.content, ...demo.config }
  config.features = { ai: false, ...config.features }
  const options = Object.entries(config).map(([key, value]) => `      ${key}: ${JSON.stringify(value)},`)
  if (demo.options) options.push(demo.options.split('\n').map(line => `      ${line}`).join('\n'))
  const button = demo.button ? `<button id="run" type="button" disabled>${demo.button}</button>` : ''
  const action = demo.action ? `
    button.onclick = async () => {
      try {
        const apply = () => {
${demo.action.split('\n').map(line => `          ${line}`).join('\n')}
        }
        status.textContent = ''
        if (await apply() === false) status.textContent = '请把光标放在正文后再试。'
      } catch (error) {
        status.textContent = error.message
      }
    }` : ''

  return `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${demo.title}演示</title>
<style>
  body { margin: 0; font: 14px system-ui, sans-serif; background: #fff; }
  #controls { padding: 8px 12px; border-bottom: 1px solid #e6e8eb; }
  button { min-height: 44px; padding: 0 12px; border: 1px solid #b9c8c5; border-radius: 6px; background: #f3f8f7; color: #135b51; cursor: pointer; }
  #status { margin: 8px 12px; color: #3b4b54; }
  #output { margin: 8px 12px; max-height: 140px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
  #status:empty, #output:empty { margin: 0; }
</style>
<body>
  ${button ? `<div id="controls">${button}</div>` : ''}
  <p id="status" role="status">正在加载编辑器…</p>
  <pre id="output" aria-live="polite"></pre>
  <div id="editor"></div>
  <script src="${loader}"></script>
  <script>
  const button = document.querySelector('#run')
  const status = document.querySelector('#status')
  const output = document.querySelector('#output')

  Promise.resolve().then(() => window.LarkDoc.runtimeReady).then(({ LarkDoc }) => {
    const doc = new LarkDoc({
      element: '#editor',
${options.join('\n')}
      onReady() {
        document.body.dataset.demoReady = 'true'
        status.textContent = ''
        if (button) button.disabled = false
      },
    })
${action}
    window.addEventListener('pagehide', event => {
      if (!event.persisted) doc.destroy()
    })
  }).catch(error => {
    status.textContent = '编辑器加载失败，请刷新重试。' + error.message
  })
  </script>
</body>
</html>`
}
