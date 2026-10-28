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

export default defineConfig({
  base: BASE,
  lang: 'zh-CN',
  title: 'lark-doc',
  description: 'LarkDoc 风格 Tiptap 文档编辑器 · 开发文档',
  // head 里是裸 HTML，不会自动套 base，必须手动拼 BASE。
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: BASE + 'logo.svg' }]],

  // VitePress 会把 srcDir 下所有 .md 都编译成页面。docs/superpowers/ 放的是内部
  // 实施计划与设计规格（不是对外文档），不排除就会被打进产物、并混进本地搜索索引。
  // 注意：srcExclude 一旦显式设置会覆盖默认值，所以默认的三条要一并写回。
  srcExclude: ['superpowers/**', '**/README.md', '**/CHANGELOG.md', '**/CONTRIBUTING.md'],

  themeConfig: {
    siteTitle: 'lark-doc Docs',
    logo: '/logo.svg',

    // 顶部导航按「读者此刻想干什么」分，不按页面目录分：
    // 上手 → 功能 → 部署（外网/内网）→ 关于。侧栏再做一次更细的分组。
    nav: [
      { text: '首页', link: '/' },
      {
        text: '开始上手',
        activeMatch: '/guide/(getting-started|install|environments|instance)',
        items: [
          { text: '快速开始', link: '/guide/getting-started' },
          { text: '安装与引用总表（内外网）', link: '/guide/install' },
          { text: '各环境引入对照', link: '/guide/environments' },
          { text: '实例与事件', link: '/guide/instance' },
        ],
      },
      {
        text: '功能配置',
        activeMatch: '/guide/(configuration|toolbar|view-integration|collaboration|collab-server|vditor-import|web-component)',
        items: [
          { text: '配置总览', link: '/guide/configuration' },
          { text: '工具栏配置', link: '/guide/toolbar' },
          { text: '内容块（标题 / 列表 / 表格 …）', link: '/blocks/heading' },
          { text: 'View 层接入', link: '/guide/view-integration' },
          { text: '协同与权限', link: '/guide/collaboration' },
          { text: 'Web Component（跨框架）', link: '/guide/web-component' },
        ],
      },
      {
        text: '内网与部署',
        activeMatch: '/guide/(intranet-migration|deployment-intranet|deployment-docs-site|offline|build-artifacts)',
        items: [
          { text: '安装与引用总表（内外网）', link: '/guide/install' },
          { text: '内网迁移实战（Vue2 / Vue3）', link: '/guide/intranet-migration' },
          { text: '内网服务器部署（nginx）', link: '/guide/deployment-intranet' },
          { text: '文档站内网部署', link: '/guide/deployment-docs-site' },
          { text: '离线与资源本地化', link: '/guide/offline' },
          { text: '打包产物与按需加载', link: '/guide/build-artifacts' },
        ],
      },
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
      // 侧栏分四组，按「读文档的顺序」排，不按页面创建顺序排：
      // 上手（我要装/要跑起来） → 功能（我要配某个能力） → 部署（我要上线/进内网） → 参考。
      // 新增页面时先想清楚它属于哪一组，别继续往第一组里塞。
      '/guide/': [
        {
          text: '开始上手',
          items: [
            { text: '快速开始', link: '/guide/getting-started' },
            { text: '安装与引用总表（内外网）', link: '/guide/install' },
            { text: '各环境引入对照', link: '/guide/environments' },
            { text: '实例与事件', link: '/guide/instance' },
          ],
        },
        {
          text: '功能与配置',
          items: [
            { text: '配置总览', link: '/guide/configuration' },
            { text: '工具栏配置', link: '/guide/toolbar' },
            { text: 'View 层接入', link: '/guide/view-integration' },
            { text: '协同与权限', link: '/guide/collaboration' },
            { text: '协同服务端契约', link: '/guide/collab-server' },
            { text: '旧数据导入（Vditor）', link: '/guide/vditor-import' },
            { text: 'Web Component（跨框架）', link: '/guide/web-component' },
          ],
        },
        {
          text: '打包与内网部署',
          items: [
            { text: '打包产物与按需加载', link: '/guide/build-artifacts' },
            { text: '离线与资源本地化', link: '/guide/offline' },
            { text: '内网迁移实战（Vue2 / Vue3）', link: '/guide/intranet-migration' },
            { text: '内网服务器部署（nginx）', link: '/guide/deployment-intranet' },
            { text: '文档站内网部署', link: '/guide/deployment-docs-site' },
          ],
        },
        {
          text: '参考',
          items: [
            { text: '性能基线与收口', link: '/guide/performance' },
            { text: '背景与免责声明', link: '/guide/about' },
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
