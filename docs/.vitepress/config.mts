import { defineConfig } from 'vitepress'
import { featureGroups } from '../examples/feature-demos.js'

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

const featureSidebar = [
  { text: '按需配置功能', link: '/blocks/' },
  ...featureGroups.map(group => ({
    text: group.text,
    items: group.items.map(demo => ({
      text: demo.title,
      link: demo.route || `/blocks/${demo.id}`,
    })),
  })),
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
    siteTitle: 'LarkDoc 开发文档',
    logo: '/logo.svg',

    nav: [
      { text: '快速开始', link: '/guide/getting-started' },
      { text: '接入示例', items: examples, activeMatch: '/examples/' },
      {
        text: '参考资料', items: [
          { text: '配置与接口', items: [
            { text: '常用配置', link: '/guide/configuration' },
            { text: '实例与事件', link: '/guide/instance' },
            { text: '全量与按需加载', link: '/guide/build-artifacts' },
            { text: 'View 层与 Provider', link: '/guide/view-integration' },
            { text: '协同服务端契约', link: '/guide/collab-server' },
            { text: 'Vditor 数据导入', link: '/guide/vditor-import' },
            { text: 'Web Component', link: '/guide/web-component' },
          ] },
          { text: '安装和部署', items: [
            { text: '安装与离线', link: '/guide/install' },
            { text: '兼容速查', link: '/guide/compatibility' },
            { text: '接入与排错', link: '/guide/environments' },
            { text: '资源本地化', link: '/guide/offline' },
            { text: '内网迁移', link: '/guide/intranet-migration' },
            { text: '内网部署', link: '/guide/deployment-intranet' },
            { text: '背景与免责声明', link: '/guide/about' },
          ] },
        ],
      },
      { text: '在线试用', link: '/demo/', target: '_blank' },
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

    sidebar: featureSidebar,

    docFooter: { prev: '上一页', next: '下一页' },
    lastUpdated: { text: '最后更新' },
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',
  },
})
