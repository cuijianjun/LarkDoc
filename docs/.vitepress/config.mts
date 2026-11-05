import { defineConfig } from 'vitepress'

// 版式对齐 AiEditor Docs：
// 上：全局导航 + 搜索框；左：功能点清单（每个功能一页）；
// 中：正文（每页小标题按内容命名，不再套「概述 / 配置内容 / 配置说明」）；右：本页目录（outline）。
// 部署路径可注入：
//   GitHub Pages 项目页 → 默认 '/LarkDoc/'（cuijianjun.github.io/LarkDoc/）
//   内网根路径          → DOCS_BASE=/ npm run docs:build
//   内网子路径          → DOCS_BASE=/lark-doc/ npm run docs:build
// base 必须写首尾斜杠，且会渗透进资源 URL、路由与本地搜索索引，构建后不可 sed 替换。
const BASE = (() => {
  const raw = process.env.DOCS_BASE || '/LarkDoc/'
  const withLead = raw.startsWith('/') ? raw : '/' + raw
  return withLead.endsWith('/') ? withLead : withLead + '/'
})()


const examples = [
  { text: '选择环境', link: '/examples/' },
  { text: 'Vue2 + Webpack5', link: '/examples/vue2-webpack5' },
  { text: 'Vue2 + Webpack4', link: '/examples/vue2-webpack4' },
  { text: 'Vue3 + Vite', link: '/examples/vue3-vite' },
  { text: 'React + Vite', link: '/examples/react-vite' },
  { text: '原生 HTML / CDN', link: '/examples/html-cdn' },
  { text: 'Web Component', link: '/examples/web-component' },
]

// 调用者先跑通接入，再按需求展开参考；guide 和 blocks 使用同一份导航。
const callerSidebar = [
  { text: '开始使用', items: [
    { text: '1. 选环境，运行最小 demo', link: '/examples/' },
    { text: '2. 常用配置', link: '/guide/configuration' },
    { text: '3. 读取内容与事件', link: '/guide/instance' },
    { text: '4. 服务器上传与回调', link: '/blocks/uploader' },
  ] },
  { text: '按需配置功能', collapsed: true, items: [
    { text: '工具栏配置', link: '/guide/toolbar' },
    { text: '标题', link: '/blocks/heading' },
    { text: '文字格式', link: '/blocks/marks' },
    { text: '文字样式', link: '/blocks/text-style' },
    { text: '段落样式', link: '/blocks/paragraph' },
    { text: '列表', link: '/blocks/lists' },
    { text: '引用', link: '/blocks/quote' },
    { text: '链接', link: '/blocks/link' },
    { text: '表情', link: '/blocks/emoji' },
    { text: '代码块与图表', link: '/blocks/code-block' },
    { text: '高亮块', link: '/blocks/callout' },
    { text: '分栏', link: '/blocks/columns' },
    { text: '表格', link: '/blocks/table' },
    { text: '图片', link: '/blocks/image' },
    { text: '数学公式', link: '/blocks/math' },
    { text: '导入导出', link: '/blocks/import-export' },
    { text: '折叠块', link: '/blocks/folding' },
    { text: '目录', link: '/blocks/outline' },
    { text: '查找替换', link: '/blocks/search' },
    { text: '块句柄与拖拽', link: '/blocks/block-handle' },
    { text: '视图模式', link: '/blocks/view-modes' },
    { text: '模板', link: '/blocks/templates' },
    { text: 'AI 组件', link: '/blocks/ai' },
    { text: '网络策略', link: '/blocks/network' },
  ] },
  { text: '进阶接入与参考', collapsed: true, items: [
    { text: '全量与按需加载', link: '/guide/build-artifacts' },
    { text: 'View 层与 Provider 接入', link: '/guide/view-integration' },
    { text: '协同与权限', link: '/guide/collaboration' },
    { text: '协同服务端契约', link: '/guide/collab-server' },
    { text: '旧数据导入（Vditor）', link: '/guide/vditor-import' },
    { text: 'Web Component 参考', link: '/guide/web-component' },
    { text: '环境兼容速查', link: '/guide/compatibility' },
    { text: '背景与免责声明', link: '/guide/about' },
  ] },
  { text: '安装、离线与排错', collapsed: true, items: [
    { text: '安装与离线', link: '/guide/install' },
    { text: '补充接入与排错', link: '/guide/environments' },
    { text: '资源本地化', link: '/guide/offline' },
    { text: '内网迁移（Vue2 / Vue3）', link: '/guide/intranet-migration' },
    { text: '业务应用内网部署', link: '/guide/deployment-intranet' },
  ] },
]

export default defineConfig({
  base: BASE,
  lang: 'zh-CN',
  title: 'lark-doc',
  description: 'LarkDoc 编辑器 · 安装、配置与 API 调用指南',
  // head 里是裸 HTML，不会自动套 base，必须手动拼 BASE。
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: BASE + 'logo.svg' }]],

  // 维护者文档继续保留在仓库；不生成线上页面或本地搜索记录。
  // 显式设置 srcExclude 会覆盖默认值，因此保留默认的三条。
  srcExclude: [
    'superpowers/**', 'examples/apps/**',
    'guide/development.md', 'guide/performance.md', 'guide/deployment-docs-site.md',
    '**/README.md', '**/CHANGELOG.md', '**/CONTRIBUTING.md',
  ],

  themeConfig: {
    siteTitle: 'lark-doc Docs',
    logo: '/logo.svg',

    nav: [
      { text: '示例中心', link: '/examples/', activeMatch: '/examples/' },
      { text: '配置与 API', link: '/guide/configuration', activeMatch: '/(guide|blocks)/' },
      { text: '在线改代码', link: '/demo/', target: '_blank' },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/cuijianjun/LarkDoc' }],

    outline: { level: [2, 3], label: '本页目录' },

    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: {
            noResultsText: '没有找到结果',
            resetButtonTitle: '清空条件',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
          },
        },
      },
    },

    sidebar: {
      '/examples/': [
        { text: '完整接入示例', items: examples },
        { text: '进一步配置', collapsed: true, items: [
          { text: '常用配置', link: '/guide/configuration' },
          { text: '读取内容与事件', link: '/guide/instance' },
          { text: '服务器上传与回调', link: '/blocks/uploader' },
        ] },
      ],
      '/guide/': callerSidebar,
      '/blocks/': callerSidebar,
    },

    docFooter: { prev: '上一页', next: '下一页' },
    lastUpdated: { text: '最后更新' },
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',
  },
})
