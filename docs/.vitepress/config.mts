import { defineConfig } from 'vitepress'

// 版式对齐 AiEditor Docs：
// 上：全局导航 + 搜索框；左：功能点清单（每个功能一页）；
// 中：概述 → 配置内容 → 配置说明；右：本页目录（outline）。
export default defineConfig({
  base: '/LarkDoc/',
  lang: 'zh-CN',
  title: 'lark-doc',
  description: 'LarkDoc 风格 Tiptap 文档编辑器 · 开发文档',
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/LarkDoc/logo.svg' }]],

  themeConfig: {
    siteTitle: 'lark-doc Docs',
    logo: '/logo.svg',

    nav: [
      { text: '首页', link: '/' },
      { text: '指南', link: '/guide/getting-started' },
      { text: '功能配置', link: '/blocks/heading' },
      { text: '实例与事件', link: '/guide/instance' },
      { text: '关于', link: '/guide/about' },
    ],

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
      '/guide/': [
        {
          text: '指南',
          items: [
            { text: '快速开始', link: '/guide/getting-started' },
            { text: '各环境引入对照', link: '/guide/environments' },
            { text: '配置总览', link: '/guide/configuration' },
            { text: '实例与事件', link: '/guide/instance' },
            { text: '工具栏配置', link: '/guide/toolbar' },
            { text: 'View 层接入', link: '/guide/view-integration' },
            { text: '协同与权限', link: '/guide/collaboration' },
            { text: '协同服务端契约', link: '/guide/collab-server' },
            { text: '旧数据导入（Vditor）', link: '/guide/vditor-import' },
            { text: 'Web Component（跨框架）', link: '/guide/web-component' },
            { text: '背景与免责声明', link: '/guide/about' },
            { text: '打包产物与按需加载', link: '/guide/build-artifacts' },
            { text: '离线与资源本地化', link: '/guide/offline' },
          ],
        },
      ],
      '/blocks/': [
        {
          text: '内容块',
          items: [
            { text: '标题', link: '/blocks/heading' },
            { text: '文字格式', link: '/blocks/marks' },
            { text: '文字样式', link: '/blocks/text-style' },
            { text: '段落样式', link: '/blocks/paragraph' },
            { text: '列表', link: '/blocks/lists' },
            { text: '引用', link: '/blocks/quote' },
            { text: '链接', link: '/blocks/link' },
            { text: '表情', link: '/blocks/emoji' },
            { text: '代码块', link: '/blocks/code-block' },
            { text: '高亮块', link: '/blocks/callout' },
            { text: '分栏', link: '/blocks/columns' },
          ],
        },
        {
          text: '媒体与数据',
          items: [
            { text: '表格', link: '/blocks/table' },
            { text: '图片', link: '/blocks/image' },
            { text: '数学公式', link: '/blocks/math' },
            { text: '导入导出', link: '/blocks/import-export' },
          ],
        },
        {
          text: '文档能力',
          items: [
            { text: '折叠块', link: '/blocks/folding' },
            { text: '目录', link: '/blocks/outline' },
            { text: '查找替换', link: '/blocks/search' },
            { text: '块句柄与拖拽', link: '/blocks/block-handle' },
            { text: '视图模式', link: '/blocks/view-modes' },
            { text: '模板', link: '/blocks/templates' },
          ],
        },
        {
          text: '扩展与集成',
          items: [
            { text: 'AI 组件', link: '/blocks/ai' },
            { text: '上传器', link: '/blocks/uploader' },
            { text: '网络策略', link: '/blocks/network' },
          ],
        },
      ],
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
