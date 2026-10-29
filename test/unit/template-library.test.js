// @vitest-environment jsdom

/**
 * P5-07 文档模板库（02 §28）。
 *
 * 这里守的是**规格数字**与**三条语义约束**，不是像素外观：
 *
 *   1. 几何：modal `calc(100% - 284px) × calc(100% - 84px)`、左栏 196、
 *      卡片 226×256（40+182+34）、4 列、间距 24、hover 两段同步 `0.15s linear`。
 *   2. 分类：23 个稳定项 + 8 个运营位 = 31；运营位**按锚点插进稳定项之间**，
 *      不是按 group 重排（02 §28.4 给的是逐项 DOM 顺序）。
 *   3. 语义：模板库**不进编辑器**、**「使用」= 让宿主去复制文档**。
 *      所以组件只 `emit('use')`，源码里不许出现 `insertContent`。
 *
 * 组件本身是 .vue，vitest 的 forbidVueImports 插件拒载，所以这里只测
 * `core/templates/library.js` + 用源码文本守卫组件语义（同 no-dead-code 的做法）。
 */

import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'
import {
  TEMPLATE_CATEGORY_TOTAL, TEMPLATE_GRID, TEMPLATE_HEADER, TEMPLATE_MODAL, TEMPLATE_PROMO_DEFAULTS,
  TEMPLATE_SIDEBAR, TEMPLATE_STABLE_CATEGORIES, TEMPLATE_TEXT,
  buildCategoryList, normalizeTemplate, searchTemplates, templatesOf,
} from '../../src/core/templates/library.js'
import { createTemplateLibrary, templateLibraryRootStyle } from '../../src/ui/templateLibrary.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

describe('P5-07 弹窗几何（02 §28.2 / §28.3）', () => {
  it('modal 是「视口减固定内缩」，不是固定宽高', () => {
    expect(TEMPLATE_MODAL.widthInset).toBe(284)
    expect(TEMPLATE_MODAL.heightInset).toBe(84)
    expect(TEMPLATE_MODAL.radius).toBe(8)
  })

  it('遮罩是 55% 黑，body 是灰底（白卡浮在灰上）', () => {
    expect(TEMPLATE_MODAL.mask).toBe('rgba(0, 0, 0, 0.55)')
    expect(TEMPLATE_MODAL.bodyBg).toBe('rgb(248, 249, 250)')
  })

  it('header 62 高、搜索框 340×30、关闭键 32', () => {
    expect(TEMPLATE_HEADER.height).toBe(62)
    expect(TEMPLATE_HEADER.searchWidth).toBe(340)
    expect(TEMPLATE_HEADER.searchHeight).toBe(30)
    expect(TEMPLATE_HEADER.searchRadius).toBe(6)
    expect(TEMPLATE_HEADER.closeSize).toBe(32)
  })

  it('搜索框在视口正中：586 + 340/2 恰好等于 1512/2', () => {
    // 02 §28.3 实测左边界 586，若改成右对齐这个等式立刻不成立。
    expect(586 + TEMPLATE_HEADER.searchWidth / 2).toBe(1512 / 2)
  })

  it('左栏 196 固定宽、item 36 高、激活态是蓝底蓝字', () => {
    expect(TEMPLATE_SIDEBAR.width).toBe(196)
    expect(TEMPLATE_SIDEBAR.itemHeight).toBe(36)
    expect(TEMPLATE_SIDEBAR.itemRadius).toBe(6)
    expect(TEMPLATE_SIDEBAR.activeBg).toBe('rgba(20, 86, 240, 0.1)')
    expect(TEMPLATE_SIDEBAR.activeColor).toBe('rgb(51, 109, 244)')
  })
})

describe('P5-07 卡片网格（02 §28.5 / §28.6）', () => {
  it('卡片 226×256，三段 40 + 182 + 34 刚好等于卡高', () => {
    expect(TEMPLATE_GRID.cardWidth).toBe(226)
    expect(TEMPLATE_GRID.cardHeight).toBe(256)
    expect(TEMPLATE_GRID.titleHeight + TEMPLATE_GRID.thumbHeight + TEMPLATE_GRID.bottomHeight)
      .toBe(TEMPLATE_GRID.cardHeight)
  })

  it('4 列 × 24 间距 + 左右各 24 留白 = 1024，塞得进 1512 视口减去左栏的 1032', () => {
    const used = TEMPLATE_GRID.columns * TEMPLATE_GRID.cardWidth
      + (TEMPLATE_GRID.columns - 1) * TEMPLATE_GRID.gap
      + 2 * TEMPLATE_GRID.padding
    expect(used).toBe(1024)
    const available = 1512 - TEMPLATE_MODAL.widthInset - TEMPLATE_SIDEBAR.width
    expect(available).toBe(1032)
    expect(used).toBeLessThanOrEqual(available)
  })

  it('底栏两枚 97 按钮 + 8 间距 = 卡内 202 宽，正好铺满', () => {
    expect(TEMPLATE_GRID.actionButtonWidth).toBe(97)
    expect(TEMPLATE_GRID.actionButtonGap).toBe(8)
    expect(TEMPLATE_GRID.actionButtonWidth * 2 + TEMPLATE_GRID.actionButtonGap)
      .toBe(TEMPLATE_GRID.cardWidth - 24)
  })

  it('hover 两段同步：都是 0.15s linear，不是 ease', () => {
    expect(TEMPLATE_GRID.transition).toBe('box-shadow 0.15s linear, transform 0.15s linear')
    expect(TEMPLATE_GRID.transition).not.toMatch(/ease/)
    expect(TEMPLATE_GRID.transition.match(/0\.15s linear/g)).toHaveLength(2)
  })

  it('卡上浮 8px、操作条从 +10px 滑到 0', () => {
    expect(TEMPLATE_GRID.hoverLift).toBe(-8)
    expect(TEMPLATE_GRID.actionSlide).toBe(10)
  })

  it('静态与 hover 都是三叠阴影，hover 更重', () => {
    expect(TEMPLATE_GRID.shadow.match(/rgba\(/g)).toHaveLength(3)
    expect(TEMPLATE_GRID.shadowHover.match(/rgba\(/g)).toHaveLength(3)
    expect(TEMPLATE_GRID.shadowHover).not.toBe(TEMPLATE_GRID.shadow)
  })

  it('标题 15/500 深灰，meta 12/400 浅灰', () => {
    expect(TEMPLATE_TEXT.name).toEqual({ size: 15, weight: 500, color: 'rgb(31, 35, 41)' })
    expect(TEMPLATE_TEXT.meta).toEqual({ size: 12, weight: 400, color: 'rgb(100, 106, 115)' })
  })

  it('几何常量全部冻结，运行期改不动', () => {
    expect(Object.isFrozen(TEMPLATE_MODAL)).toBe(true)
    expect(Object.isFrozen(TEMPLATE_GRID)).toBe(true)
    expect(Object.isFrozen(TEMPLATE_STABLE_CATEGORIES)).toBe(true)
    expect(Object.isFrozen(TEMPLATE_PROMO_DEFAULTS)).toBe(true)
  })
})

describe('P5-07 分类左栏（02 §28.4）', () => {
  it('23 稳定 + 8 运营位 = 31 项', () => {
    expect(TEMPLATE_STABLE_CATEGORIES).toHaveLength(23)
    expect(TEMPLATE_PROMO_DEFAULTS).toHaveLength(8)
    expect(TEMPLATE_CATEGORY_TOTAL).toBe(31)
  })

  it('稳定项按「我的 2 / 推荐 1 / 专区 3 / 场景 17」分段', () => {
    const count = (group) => TEMPLATE_STABLE_CATEGORIES.filter((item) => item.group === group).length
    expect(count('我的')).toBe(2)
    expect(count('推荐')).toBe(1)
    expect(count('专区')).toBe(3)
    expect(count('场景')).toBe(17)
  })

  it('id 全局唯一', () => {
    const ids = buildCategoryList().map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('运营位按 anchorAfter 插进稳定项之间，不按 group 重排', () => {
    // 02 §28.4 的表是逐项 DOM 顺序：推荐 → AI 页面 → AI 工作流 → 最新 → AI 模板 → 仪表盘。
    const labels = buildCategoryList().map((item) => item.id)
    const head = labels.slice(labels.indexOf('recommend'), labels.indexOf('recommend') + 6)
    expect(head).toEqual([
      'recommend', 'promo-ai-page', 'promo-ai-flow', 'promo-latest', 'promo-ai-template', 'dashboard',
    ])
  })

  it('锚在稳定项之后的运营位紧跟其后（仪表盘 → 查询页面 → 热门）', () => {
    const labels = buildCategoryList().map((item) => item.id)
    expect(labels.slice(labels.indexOf('dashboard'), labels.indexOf('dashboard') + 4))
      .toEqual(['dashboard', 'promo-query', 'hot', 'promo-survey'])
  })

  it('连锚在运营位上的也按插入顺序落位（小程序 → 解决方案 → 先进团队 → 电商）', () => {
    const labels = buildCategoryList().map((item) => item.id)
    expect(labels.slice(labels.indexOf('miniApp'), labels.indexOf('miniApp') + 4))
      .toEqual(['miniApp', 'promo-solution', 'promo-elite', 'ecommerce'])
  })

  it('稳定项 promo=false，运营位 promo=true', () => {
    const list = buildCategoryList()
    expect(list.filter((item) => item.promo)).toHaveLength(8)
    expect(list.filter((item) => !item.promo)).toHaveLength(23)
  })

  it('传 promoCategories 是整组替换，不是叠加', () => {
    const custom = [{ id: 'promo-x', group: '推荐', label: '活动专区', anchorAfter: 'recommend' }]
    const list = buildCategoryList(custom)
    expect(list).toHaveLength(24)
    expect(list.some((item) => item.id === 'promo-latest')).toBe(false)
  })

  it('传空数组只有 23 项（宿主关掉运营位）', () => {
    expect(buildCategoryList([])).toHaveLength(23)
  })

  it('锚点不存在时排到末尾，不丢项', () => {
    const list = buildCategoryList([{ id: 'promo-z', label: '孤儿', anchorAfter: 'nope' }])
    expect(list[list.length - 1].id).toBe('promo-z')
    expect(list).toHaveLength(24)
  })

  it('脏输入跳过：null / 无 id', () => {
    const list = buildCategoryList([null, {}, { id: 'ok', label: 'OK', anchorAfter: 'recommend' }])
    expect(list).toHaveLength(24)
    expect(list.some((item) => item.id === 'ok')).toBe(true)
  })

  it('非数组的 promo 当作没有，回到缺省？——不，当作空组', () => {
    // 组件传的是 `this.promoCategories || undefined`，所以 null 走缺省值；
    // 直接传字符串属于调用方错误，按「没有运营位」处理，不抛异常。
    expect(buildCategoryList('nope')).toHaveLength(23)
  })

  it('不修改冻结源表', () => {
    buildCategoryList()
    buildCategoryList([])
    expect(TEMPLATE_STABLE_CATEGORIES).toHaveLength(23)
  })

  it('运营位带 emoji 前缀（规格原话：带 emoji 的那 8 项是运营位）', () => {
    const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u
    TEMPLATE_PROMO_DEFAULTS.forEach((item) => expect(item.label).toMatch(emoji))
  })
})

describe('P5-07 卡片数据归一（normalizeTemplate）', () => {
  it('只留四个字段，categories 这类筛选字段不外泄到渲染层', () => {
    const card = normalizeTemplate({ id: 'a', name: '周报', thumb: 'x.png', meta: '3 人使用', categories: ['weekly'], extra: 1 })
    expect(card).toEqual({ id: 'a', name: '周报', thumb: 'x.png', meta: '3 人使用' })
  })

  it('id 与 name 都 trim', () => {
    expect(normalizeTemplate({ id: '  a  ', name: '  周报  ' })).toEqual({ id: 'a', name: '周报', thumb: '', meta: '' })
  })

  it('缺 id / 缺 name / 纯空格 → null', () => {
    expect(normalizeTemplate({ name: '周报' })).toBeNull()
    expect(normalizeTemplate({ id: 'a' })).toBeNull()
    expect(normalizeTemplate({ id: '   ', name: '周报' })).toBeNull()
    expect(normalizeTemplate({ id: 'a', name: '   ' })).toBeNull()
  })

  it('非对象与数字 id 一律 null', () => {
    expect(normalizeTemplate(null)).toBeNull()
    expect(normalizeTemplate('a')).toBeNull()
    expect(normalizeTemplate([])).toBeNull()
    expect(normalizeTemplate({ id: 1, name: 'x' })).toBeNull()
  })

  it('thumb / meta 非字符串时降级为空串，不把 undefined 带进模板', () => {
    expect(normalizeTemplate({ id: 'a', name: 'x', thumb: 12, meta: null }))
      .toEqual({ id: 'a', name: 'x', thumb: '', meta: '' })
  })
})

describe('P5-07 筛选（templatesOf / searchTemplates）', () => {
  const data = [
    { id: 'a', name: '周报', meta: '每周一填', categories: ['weekly', 'office'] },
    { id: 'b', name: '会议纪要', meta: 'Weekly Sync', categories: ['meeting'] },
    { id: 'c', name: '通用笔记' },
    { id: 'd', name: '   ', categories: ['weekly'] },
  ]

  it('不传分类 = 全部（脏数据被归一丢掉）', () => {
    expect(templatesOf(data).map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('按 categories 过滤', () => {
    expect(templatesOf(data, 'weekly').map((item) => item.id)).toEqual(['a', 'c'])
    expect(templatesOf(data, 'meeting').map((item) => item.id)).toEqual(['b', 'c'])
  })

  it('没打标签的卡在每个分类里都露出来（与组件语义一致）', () => {
    expect(templatesOf(data, 'nothing').map((item) => item.id)).toEqual(['c'])
  })

  it('分类匹配是严格相等，不做前缀/模糊', () => {
    expect(templatesOf(data, 'week')).toEqual([{ id: 'c', name: '通用笔记', thumb: '', meta: '' }])
  })

  it('非数组输入不抛异常', () => {
    expect(templatesOf(null, 'weekly')).toEqual([])
    expect(templatesOf('x', 'weekly')).toEqual([])
  })

  it('空关键词返回原数组（引用不变，便于 memo）', () => {
    expect(searchTemplates(data, '')).toBe(data)
    expect(searchTemplates(data, '   ')).toBe(data)
    expect(searchTemplates(null, '')).toEqual([])
  })

  it('名称命中、meta 命中、大小写不敏感', () => {
    expect(searchTemplates(data, '周报').map((item) => item.id)).toEqual(['a'])
    expect(searchTemplates(data, 'weekly').map((item) => item.id)).toEqual(['b'])
    expect(searchTemplates(data, 'WEEKLY sync').map((item) => item.id)).toEqual(['b'])
  })

  it('搜不到就是空，不回落成全部', () => {
    expect(searchTemplates(data, 'zzz')).toEqual([])
  })

  it('null 项跳过，不抛异常', () => {
    expect(searchTemplates([null, { id: 'a', name: 'x' }], 'x').map((item) => item.id)).toEqual(['a'])
  })

  it('不修改输入', () => {
    const copy = JSON.parse(JSON.stringify(data))
    templatesOf(data, 'weekly')
    searchTemplates(data, '周报')
    expect(data).toEqual(copy)
  })

  it('两步串起来 = 组件 visible 的行为', () => {
    expect(searchTemplates(templatesOf(data, 'weekly'), '周报').map((item) => item.id)).toEqual(['a'])
    expect(searchTemplates(templatesOf(data, 'meeting'), '周报')).toEqual([])
  })
})

describe('P5-07 原生 renderer 宿主契约', () => {
  const templates = [
    { id: 'weekly', name: '团队周报', meta: '每周填写', thumb: 'weekly.png', categories: ['recommend', 'office'] },
    { id: 'meeting', name: '会议纪要', meta: 'Weekly Sync', categories: ['meeting'] },
    { id: 'plain', name: '通用笔记', meta: '' },
  ]

  it('与 Vue 组件共享完整 CSS 变量映射', () => {
    const style = templateLibraryRootStyle()
    expect(style['--tpl-width-inset']).toBe('284px')
    expect(style['--tpl-sidebar-width']).toBe('196px')
    expect(style['--tpl-card-width']).toBe('226px')
    expect(style['--tpl-transition']).toBe(TEMPLATE_GRID.transition)
  })

  it('支持 open/close、分类、搜索，并保持真 v-if 节点语义', () => {
    const host = document.createElement('div')
    const library = createTemplateLibrary({ host })
    library.update({ open: true, target: '我的文档库 / 产品', templates })
    expect(host.querySelector('.lark-doc-template-library')).not.toBeNull()
    expect(host.querySelectorAll('[role="tab"]').length).toBe(31)
    expect(host.querySelector('[data-category-id="recommend"]').getAttribute('aria-selected')).toBe('true')
    expect(host.querySelectorAll('.lark-doc-template-card')).toHaveLength(2)
    expect(host.querySelector('.lark-doc-template-target strong').textContent).toBe('我的文档库 / 产品')

    host.querySelector('[data-category-id="meeting"]').click()
    expect(host.querySelectorAll('.lark-doc-template-card')).toHaveLength(2)
    expect(host.querySelector('[data-category-id="meeting"]').classList.contains('is-active')).toBe(true)

    const input = host.querySelector('.lark-doc-template-search input')
    input.value = 'Weekly'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(host.querySelectorAll('.lark-doc-template-card')).toHaveLength(1)
    expect(host.querySelector('[data-template-id="meeting"]')).not.toBeNull()
    expect(host.querySelector('.lark-doc-template-grid')).not.toBeNull()

    library.close()
    expect(host.querySelector('.lark-doc-template-library')).toBeNull()
    library.open()
    expect(host.querySelector('.lark-doc-template-library')).not.toBeNull()
    library.destroy()
  })

  it('preview/use/close 事件返回归一化模板，并不自行执行复制', () => {
    const host = document.createElement('div')
    const events = []
    const library = createTemplateLibrary({
      host,
      handlers: {
        onPreview: (template) => events.push(['preview', template]),
        onUse: (template) => events.push(['use', template]),
        onClose: () => events.push(['close']),
      },
    })
    library.update({ open: true, templates })
    const card = host.querySelector('[data-template-id="weekly"]')
    card.querySelector('.lark-doc-template-preview').click()
    card.querySelector('.lark-doc-template-use').click()
    host.querySelector('.lark-doc-template-library-mask').click()
    expect(events).toEqual([
      ['preview', { id: 'weekly', name: '团队周报', thumb: 'weekly.png', meta: '每周填写' }],
      ['use', { id: 'weekly', name: '团队周报', thumb: 'weekly.png', meta: '每周填写' }],
      ['close'],
    ])
    expect(host.querySelector('.lark-doc-template-library')).not.toBeNull()
  })
})

describe('P5-07 语义守卫：模板库在宿主侧、使用=复制文档', () => {
  const sfc = read('src/components/lark-doc/TemplateLibrary.vue')
  // 样式单独立一个文件：lark-doc.css 里每条规则都挂 `.lark-doc`，这一段故意不挂。
  const css = read('src/components/lark-doc/template-library.css')
  // 注释里会提到 `.ProseMirror` / `--tpl-*`（说明为什么这么写），断言只看真样式。
  const block = css.replace(/\/\*[\s\S]*?\*\//g, '')

  it('组件与原生 renderer 都只通知宿主，不在内部灌内容', () => {
    const renderer = read('src/ui/templateLibrary.js')
    expect(sfc).toContain("$emit('use'")
    expect(sfc).toContain("$emit('preview'")
    expect(renderer).toContain("'onUse'")
    expect(renderer).toContain("'onPreview'")
    // 注释里写的是「不允许出现 insertContent」这类说明，断言只看真代码。
    expect(sfc.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/insertContent|create_node/)
    expect(renderer.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/insertContent|create_node/)
  })

  it('组件不被 LarkDocEditor 引用（编辑器页内零模板入口）', () => {
    expect(read('src/components/lark-doc/LarkDocEditor.vue')).not.toContain('TemplateLibrary')
  })

  it('模板库从入口单独导出，宿主自己挂', () => {
    expect(read('src/index.js')).toContain('LarkDocTemplateLibrary')
    expect(read('src/index.js')).toContain('createTemplateLibrary')
  })

  it('样式单独立文件并由 style.css @import 进来（与其他四份同一条构建链）', () => {
    expect(read('style.css')).toContain("@import './src/components/lark-doc/template-library.css';")
    expect(read('src/components/lark-doc/lark-doc.css')).not.toContain('.lark-doc-template-library {')
  })

  it('选择器不挂 `.lark-doc` 也不挂 `.ProseMirror`（它不是编辑器内浮层）', () => {
    expect(block).toContain('.lark-doc-template-library {')
    expect(block).not.toMatch(/^\.lark-doc [^{]*\{/m)
    expect(block).not.toMatch(/\.ProseMirror[^{}]*\.lark-doc-template-/)
  })

  it('样式只用 rgb/rgba，不写裸 hex（模板库固定飞书云盘外观，不跟主题）', () => {
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(block).not.toMatch(/:\s*white\b/)
  })

  it('几何只在 library.js 写一次：样式表全部读 --tpl-* 变量', () => {
    expect(block).toContain('var(--tpl-card-width)')
    expect(block).toContain('var(--tpl-sidebar-width)')
    expect(block).not.toContain('226px')
    expect(block).not.toContain('196px')
  })
})

