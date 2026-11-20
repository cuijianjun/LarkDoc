const imageSteps = ['把一张 PNG 或 JPEG 拖进正文，或者从「插入」菜单选择图片。', '观察图像、失败提示和上传回调。']
const uploadFeedback = `onSettled(event) {
    output.value = '图片：' + event.status + '（' + event.mode + '）'
  }`

export const localImage = {
  example: 'local',
  label: '本地预览',
  button: null,
  action: null,
  steps: imageSteps,
  note: '浏览器读取文件并生成 data URL。可以用于试用或离线编辑。',
  options: `uploader: { ${uploadFeedback} },`,
}

export const httpImage = {
  example: 'http',
  label: '后端接口',
  fixture: 'images',
  button: null,
  action: null,
  steps: imageSteps,
  note: '文档站模拟接口回包。接入时将 action 换成自己的接口，服务端返回可访问的图片地址。',
  options: `uploader: {
  action: '/api/larkdoc/images',
  method: 'POST',
  fieldName: 'file',
  timeout: 30000,
  response: { success: { path: 'code', equals: 0 }, url: 'data.url', attchId: 'data.id', message: 'message' },
  ${uploadFeedback},
},`,
}

const customImage = {
  ...httpImage,
  example: 'custom',
  label: '自定义上传',
  note: '自定义 upload 可以附加认证、签名或重试，成功后返回 { url, attchId }。',
  options: `uploader: {
  async upload(file, { signal }) {
    const form = new FormData()
    form.append('file', file)
    const response = await fetch('/api/larkdoc/images', { method: 'POST', body: form, signal })
    if (!response.ok) throw new Error('图片上传失败')
    const { code, data, message } = await response.json()
    if (code !== 0 || !data?.url) throw new Error(message || '服务未返回图片地址')
    return { url: data.url, attchId: data.id }
  },
  ${uploadFeedback},
},`,
}

export const featureConfigurations = {
  heading: [{
    example: 'levels', label: '多级标题与大纲',
    content: '<h1>手册</h1><h2>准备工作</h2><h3>第一步</h3><p>输入菜单可以更改层级。</p>',
    config: { toolbarKeys: ['headings', 'outline'] },
    button: null, action: null,
    steps: ['把光标放在「第一步」，用标题菜单选择层级。', '打开「目录」，检查标题的层级关系。'],
  }],
  paragraph: [{
    example: 'align', label: '对齐和缩进控制',
    config: { limits: { maxIndent: 1 } },
    button: '两端对齐',
    action: 'return doc.getEditor().chain().focus("start").setTextAlign("justify").run()',
    steps: ['点击按钮设置首段为两端对齐。', '也可以使用工具栏改变对齐或调整缩进。'],
  }],
  marks: [{
    example: 'allow', label: '只显示粗体和斜体',
    config: { toolbarKeys: ['bold', 'italic'] },
    steps: ['选中文字，观察格式工具栏保留的两个格式按钮。'],
  }],
  'text-style': [{
    example: 'font', label: '字号与颜色',
    button: '设置 24px 字号',
    action: 'return doc.getEditor().chain().focus().setTextSelection({ from: 1, to: 5 }).setFontSize("24px").run()',
    steps: ['点击按钮调整开头文字的字号，也可从工具栏修改颜色。'],
  }],
  lists: [{
    example: 'tasks', label: '可勾选任务列表',
    content: '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>验证上线</p></li><li data-type="taskItem" data-checked="true"><p>完成构建</p></li></ul>',
    button: '读取任务数据',
    action: 'output.value = JSON.stringify(doc.getJSON(), null, 2)',
    steps: ['点击复选框切换任务状态。', '读取 JSON，查看 checked 的变化。'],
  }],
  quote: [{
    example: 'allow', label: '裁剪插入菜单到引用',
    config: { commands: { allow: ['blockquote'] } },
    steps: ['在空白段落输入 /，观察插入菜单只保留引用选项。'],
  }],
  link: [{
    example: 'prefill', label: '初始化已有链接',
    content: '<p>使用 <a href="https://example.com/">项目手册</a> 查找详情。</p>',
    button: null, action: null,
    steps: ['点击已有链接，查看地址。', '从链接工具条修改链接，观察显示文字和跳转地址。'],
  }],
  emoji: [{
    example: 'off', label: '隐藏表情入口',
    config: { features: { emoji: false } },
    button: null, action: null,
    steps: ['在空段落输入 /，确认菜单没有表情入口。'],
  }],
  table: [{
    example: 'limits', label: '限制行列数量',
    config: { limits: { maxTableRows: 3, maxTableColumns: 4 } },
    steps: ['用按钮插入样例表格，再试顶部表格菜单。', '确认选择器最多显示 3 行、4 列。'],
  }],
  image: [localImage, httpImage, customImage],
  uploader: [httpImage, customImage],
  'code-block': [{
    example: 'highlight', label: '代码高亮',
    load: ['highlight'],
    config: { features: { diagram: false } },
    content: '<pre><code class="language-javascript">const title = "项目进度"</code></pre>',
    steps: ['在语言选择器中切换语种，比较代码高亮。'],
  }, {
    example: 'mermaid', label: 'Mermaid 图表',
    load: ['highlight', 'mermaid'],
    content: '<pre><code class="language-mermaid">flowchart LR\n  A[开始] --> B[完成]</code></pre>',
    steps: ['用代码块的预览按钮查看流程图，再返回源码编辑。'],
  }],
  math: [{
    example: 'inline', label: '只放行公式命令',
    config: { commands: { allow: ['inlineMath', 'blockMath'] } },
    steps: ['点现有公式编辑 LaTeX。', '在空段输入 / 检查公式入口。'],
  }],
  callout: [{
    example: 'types', label: '初始化不同提示块',
    content: '<div data-type="callout" data-emoji="warning"><p>发布前确认接口联通。</p></div><div data-type="callout" data-emoji="bulb"><p>用提示块保留操作步骤。</p></div>',
    steps: ['点提示块图标切换表情，再编辑块内文字。'],
  }],
  columns: [{
    example: 'three', label: '插入三栏',
    button: '插入三列', action: 'return doc.getEditor().chain().focus("end").insertColumns(3).run()',
    steps: ['插入三栏后分别输入内容。', '桌面端可拖动两道分隔线调整栏宽。'],
  }],
  toolbar: [{
    example: 'context', label: '仅保留上下文工具',
    config: { layout: { toolbarVisible: false } },
    steps: ['观察格式工具栏已收起。', '选中文字，从浮动工具条使用行内格式。'],
  }, {
    example: 'fixed', label: '固定顶部工具栏',
    config: { layout: { toolbarVisible: true, toolbarFixed: true, titleBarFixed: true } },
    steps: ['滚动编辑区，查看标题栏和格式工具栏。'],
  }],
  folding: [{
    example: 'off', label: '关闭折叠',
    config: { features: { folding: false } },
    steps: ['两节缩进正文均保持显示。', '选中第一节，查看不带折叠操作的块入口。'],
  }],
  outline: [{
    example: 'hidden', label: '关闭侧栏目录',
    config: { features: { outline: false } },
    steps: ['保留正文标题结构。', '工具栏与侧栏不提供目录面板。'],
  }],
  search: [{
    example: 'read', label: '只读查找',
    config: { readonly: true },
    steps: ['打开「查找」，输入「示例」，检查匹配。', '阅读页允许搜索，正文无法修改。'],
  }],
  'block-handle': [{
    example: 'no-drag', label: '保留菜单，关闭拖拽',
    config: { features: { blockDrag: false }, blockMenu: { disabled: ['comment'] } },
    steps: ['桌面上点段落左侧六点，查看块操作。', '拖动块时，正文顺序保持原样。'],
  }],
  'view-modes': [{
    example: 'read', label: '直接进入预览',
    config: { modes: { default: 'read', allow: ['edit', 'read'], persist: false, labels: { read: '预览' } } },
    steps: ['页面初始为预览。', '打开模式菜单检查可选的「编辑」与「预览」。'],
  }, {
    example: 'theme', label: '深色界面与浅色正文',
    config: { theme: 'dark', contentTheme: 'light', themeStorage: 'none' },
    button: '切换到跟随系统',
    action: 'doc.setTheme("system", "auto")',
    steps: ['观察工具栏与正文各自的主题。', '切换后，界面跟随系统，正文跟随界面。'],
  }],
  templates: [{
    example: 'empty', label: '显式空模板库',
    config: { templates: [] },
    steps: ['在正文输入 /，搜索模板或打开「更多模板」。', '空数组会保留空模板集合。'],
  }],
  'import-export': [{
    example: 'export-only', label: '只开放 Markdown 和 HTML 导出',
    config: { importExport: { importEnabled: false, exportFormats: ['md', 'html'] } },
    load: ['markdown'],
    steps: ['打开文档操作里的导出菜单。', '可选 Markdown 与 HTML，导入按钮隐藏。'],
  }],
  comment: [{
    example: 'permissions', label: '可阅读，禁止新建评论',
    config: { capabilities: { canView: true, canEdit: false, canComment: false } },
    steps: ['尝试选中正文或打开块菜单。', '查看评论入口受会话权限控制。'],
  }],
  collaboration: [{
    example: 'edit', label: '允许编辑',
    options: `authorization: {
  async getCapabilities() { return { canView: true, canEdit: true, canComment: true } },
},`,
    steps: ['点「读取会话权限」核对三个开关。', '在正文输入文字，验证授权生效。'],
  }],
  ai: [{
    example: 'gateway', label: '后端网关',
    fixture: 'gateway',
    options: "ai: '/api/larkdoc/ai',",
    note: '应用后端负责鉴权和发起模型请求。文档站模拟 SSE 返回，可以选中文字试用改写。',
    steps: ['选中正文并点「AI 助手」。', '查看网关流式返回的内容，再选择是否应用。'],
  }, {
    example: 'openai', label: 'OpenAI 兼容接口',
    fixture: 'openai',
    options: `ai: {
  protocol: 'openai',
  baseurl: '/api/larkdoc/openai/v1',
  api_key: () => 'YOUR_SHORT_LIVED_TOKEN',
  model: 'your-model',
},`,
    note: 'baseurl 后会拼接 /chat/completions。文档站使用测试令牌和模拟响应。应用可由后端注入短期令牌。',
    steps: ['选中正文并点「AI 助手」。', '查看兼容接口返回，源码展示 baseurl、api_key 和 model。'],
  }],
  network: [{
    example: 'allowlist', label: '按主机白名单放行',
    config: { network: { mode: 'allowlist', allowlist: ['cdn.example.com'] } },
    steps: ['初始内容引用 example.com，当前白名单只允许 cdn.example.com。', '观察拦截占位，再读取数据确认原地址仍保留。'],
  }],
}
