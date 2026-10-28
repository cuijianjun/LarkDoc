/**
 * P5-06 企业授权类 9 个 `cardEmbed` 变体。
 *
 * 验收项原文（09 §5.6 P5-06）：**9 个变体渲染成同一种置灰卡；payload 原样保留**。
 * 所以断言分三层，一层不测就会有「卡长得不一样」「payload 被吃掉」「菜单点了没反应」：
 *
 * 1. `core/embed/enterprise.js` —— 9 项真值表与三条映射（纯数据，零 DOM）；
 * 2. `core/blocks/card-embed.js` —— 渲染成**同一种**置灰卡，payload 一个字段不少，
 *    动作按钮被清空，卡面有「需要企业版接入」；
 * 3. 命令表 —— 8 条（`okr` 无菜单入口）都是 `tier: 'skip'`，且连续成段、位置对。
 *
 * 🔴 一条守护用例：**不认识的 providerId 仍走「不支持的卡片来源」**，不能被
 * `data-enterprise` 这条新分支顺手吞掉 —— 那会把「我们认识但没接」与「完全不认识」
 * 混成一件事，宿主再也分不清该不该提示升级。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { COMMANDS, filterCommands } from '../../src/core/commands'
import { encodeCard, readCard } from '../../src/core/embed/card'
import {
  ENTERPRISE_MENU_ITEMS, ENTERPRISE_PROVIDERS, ENTERPRISE_TOOLTIP, enterpriseCommandOf,
  enterpriseItemByMenu, enterpriseItemOf, enterpriseLabelOf, isEnterpriseProvider,
} from '../../src/core/embed/enterprise'

const mounted = []
afterEach(() => {
  while (mounted.length) mounted.pop().cleanup()
})

function mountCard(card) {
  const editor = new Editor({
    extensions: createLarkDocExtensions(),
    content: { type: 'doc', content: [{ type: 'cardEmbed', attrs: { card: encodeCard(card) } }] },
  })
  mounted.push({ cleanup: () => editor.destroy() })
  document.body.appendChild(editor.view.dom)
  return editor
}

const cardDom = (editor) => editor.view.dom.querySelector('[data-type="card-embed"]')

/** 一张「外部服务同步下来」的企业卡：标题 / 描述 / 字段 / 一个动作都齐全。 */
const externalCard = (providerId) => ({
  providerId,
  resourceId: 'ext_1',
  payload: {
    title: 'PROJ-128 首页加载慢',
    desc: '状态：进行中，剩余 3 天',
    fields: [
      { label: '负责人', value: '张明' },
      { label: '优先级', value: 'P1' },
    ],
    cover: null,
  },
  actions: [{ id: 'open', label: '打开', kind: 'open', href: 'https://example.com/x' }],
})

describe('真值表：9 项、逐项来自 17 §17.4.2', () => {
  it('恰好 9 项，providerId 逐字取配置档名', () => {
    expect(ENTERPRISE_PROVIDERS).toHaveLength(9)
    expect(ENTERPRISE_PROVIDERS.map((item) => item.id)).toEqual([
      'folder_manager', 'wiki_recent_update',
      'jira_issue', 'jira_filter', 'meego_view', 'meego_detail',
      'agenda', 'subscription_article', 'okr',
    ])
  })

  it('8 项有菜单入口，`okr` 没有（03 §3.4 的 72 项里没有它）', () => {
    expect(ENTERPRISE_MENU_ITEMS).toHaveLength(8)
    expect(ENTERPRISE_MENU_ITEMS.map((item) => item.menuId)).not.toContain(null)
    const okr = ENTERPRISE_PROVIDERS.find((item) => item.id === 'okr')
    expect(okr.menuId).toBe(null)
    expect(enterpriseItemByMenu('okr')).toBe(null)
  })

  it('分类照 03 §3.4：文档管理 2 / 项目管理 4 / 团队协作 1 / 进阶 1', () => {
    const count = (category) => ENTERPRISE_PROVIDERS.filter((item) => item.category === category).length
    expect(count('文档管理')).toBe(2)
    // 项目管理 4（有菜单的）+ OKR（无菜单）= 5
    expect(count('项目管理')).toBe(5)
    expect(count('团队协作')).toBe(1)
    expect(count('进阶')).toBe(1)
  })

  it('三条映射与 null / 空串兜底', () => {
    for (const item of ENTERPRISE_PROVIDERS) {
      expect(isEnterpriseProvider(item.id)).toBe(true)
      expect(enterpriseItemOf(item.id)).toBe(item)
      expect(enterpriseLabelOf(item.id)).toBe(item.label)
    }
    for (const value of [null, undefined, '', 'jira', 'JIRA_ISSUE', 'cardEmbed', 7]) {
      expect(isEnterpriseProvider(value)).toBe(false)
      expect(enterpriseItemOf(value)).toBe(null)
      expect(enterpriseLabelOf(value)).toBe('')
    }
  })

  it('派生的 CommandDef 全部 tier skip / plus false / group 正确', () => {
    for (const item of ENTERPRISE_MENU_ITEMS) {
      const command = enterpriseCommandOf(item.menuId, 'pim')
      expect(command.id).toBe(item.menuId)
      expect(command.label).toBe(item.label)
      expect(command.category).toBe(item.category)
      expect(command.tier).toBe('skip')
      expect(command.plus).toBe(false)
      expect(command.group).toBe('pim')
    }
  })
})

describe('渲染：9 个变体是同一种置灰卡，payload 一个字段都不少', () => {
  it('🔴 9 项渲染结构完全一致（同 class、同 data-enterprise、同一条提示）', () => {
    const shapes = ENTERPRISE_PROVIDERS.map((item) => {
      const editor = mountCard(externalCard(item.id))
      const dom = cardDom(editor)
      expect(dom.getAttribute('data-enterprise')).toBe('true')
      expect(dom.getAttribute('data-enterprise-provider')).toBe(item.id)
      expect(dom.querySelector('.lark-doc-card-note').textContent).toBe(ENTERPRISE_TOOLTIP)
      return {
        cls: dom.className,
        note: dom.querySelector('.lark-doc-card-note').textContent,
        hasTitle: Boolean(dom.querySelector('.lark-doc-card-title')),
      }
    })
    // 同一种卡：class 与提示文案逐项相同
    expect(new Set(shapes.map((shape) => shape.cls)).size).toBe(1)
    expect(new Set(shapes.map((shape) => shape.note)).size).toBe(1)
    expect(shapes.every((shape) => shape.hasTitle)).toBe(true)
  })

  it('payload 原样：title / desc / 两个字段都在 DOM 里', () => {
    const editor = mountCard(externalCard('jira_issue'))
    const dom = cardDom(editor)
    expect(dom.querySelector('.lark-doc-card-title').textContent).toBe('PROJ-128 首页加载慢')
    expect(dom.querySelector('.lark-doc-card-desc').textContent).toBe('状态：进行中，剩余 3 天')
    const labels = Array.prototype.map.call(
      dom.querySelectorAll('.lark-doc-card-field-label'), (el) => el.textContent,
    )
    expect(labels).toEqual(['负责人', '优先级'])
    expect(dom.querySelector('.lark-doc-card-fields').textContent).toContain('张明')
  })

  it('🔴 payload 不失真：`data-card` 整串读回，字段与动作一个不丢', () => {
    const source = externalCard('meego_detail')
    const editor = mountCard(source)
    const round = readCard(cardDom(editor).getAttribute('data-card'))
    expect(round.providerId).toBe('meego_detail')
    expect(round.resourceId).toBe('ext_1')
    expect(round.payload).toEqual(source.payload)
    // 动作在**数据层**保留（宿主还要靠它做后续同步），只是不画按钮
    expect(round.actions).toEqual(source.actions)
  })

  it('动作按钮一律不画：置灰 = 点不动，而不是「画了再禁用」', () => {
    for (const item of ENTERPRISE_PROVIDERS) {
      const editor = mountCard(externalCard(item.id))
      const dom = cardDom(editor)
      expect(dom.querySelectorAll('[data-card-action]')).toHaveLength(0)
      expect(dom.querySelector('.lark-doc-card-actions')).toBe(null)
    }
  })

  it('payload.title 为空时用真值表的中文名兜底，不落到「未命名卡片」', () => {
    // 不走 encodeCard：我们的**写**路径不允许空 title（`normalizeCard` 会抛）。
    // 这条模拟的是「别人写的、比我们宽松」的数据 —— 读路径宽容，渲染层要能兜住。
    const raw = JSON.stringify({
      providerId: 'wiki_recent_update',
      resourceId: 'wiki_1',
      payload: { title: '', desc: '', fields: [], cover: null },
      actions: [],
    })
    const editor = new Editor({
      extensions: createLarkDocExtensions(),
      content: { type: 'doc', content: [{ type: 'cardEmbed', attrs: { card: raw } }] },
    })
    mounted.push({ cleanup: () => editor.destroy() })
    document.body.appendChild(editor.view.dom)
    expect(cardDom(editor).querySelector('.lark-doc-card-title').textContent).toBe('知识库动态')
  })

  it('🔴 不认识的 providerId 仍走「不支持的卡片来源」，不被企业分支吞掉', () => {
    const editor = new Editor({
      extensions: createLarkDocExtensions({ embedProviders: ['my_business_card'] }),
      content: {
        type: 'doc',
        content: [{ type: 'cardEmbed', attrs: { card: encodeCard({ providerId: 'unknown_vendor', payload: { title: 'X' } }) } }],
      },
    })
    mounted.push({ cleanup: () => editor.destroy() })
    document.body.appendChild(editor.view.dom)
    const dom = cardDom(editor)
    expect(dom.getAttribute('data-enterprise')).toBe(null)
    expect(dom.textContent).toContain('不支持的卡片来源')
  })

  it('宿主声明 providers 也不影响企业卡：它们是我们明确认识的 9 项', () => {
    const editor = new Editor({
      extensions: createLarkDocExtensions({ embedProviders: ['my_business_card'] }),
      content: {
        type: 'doc',
        content: [{ type: 'cardEmbed', attrs: { card: encodeCard(externalCard('agenda')) } }],
      },
    })
    mounted.push({ cleanup: () => editor.destroy() })
    document.body.appendChild(editor.view.dom)
    const dom = cardDom(editor)
    expect(dom.getAttribute('data-enterprise')).toBe('true')
    expect(dom.textContent).not.toContain('不支持的卡片来源')
  })
})

describe('命令表接线：菜单可见、但不可执行', () => {
  const at = (id) => COMMANDS.findIndex((item) => item.id === id)

  it('8 条都在表里，tier 全是 skip', () => {
    for (const item of ENTERPRISE_MENU_ITEMS) {
      const command = COMMANDS[at(item.menuId)]
      expect(command).toBeTruthy()
      expect(command.tier).toBe('skip')
      expect(command.label).toBe(item.label)
      expect(command.category).toBe(item.category)
    }
  })

  it('🔴 连续成段：文档管理 2 → 项目管理 4 → 订阅号文章 → 目录导航', () => {
    const start = at('folderManager')
    expect(at('wikiRecent')).toBe(start + 1)
    expect(at('jiraIssue')).toBe(start + 2)
    expect(at('jiraFilter')).toBe(start + 3)
    expect(at('meegoView')).toBe(start + 4)
    expect(at('meegoDetail')).toBe(start + 5)
    expect(at('subscribeArticle')).toBe(start + 6)
    // 目录导航（文档小组件 2316）必须晚于进阶（2136）——P5-06 把它从日程之后挪过来的
    expect(at('catalogue')).toBe(start + 7)
    // 与团队协作组的分界：`agenda` 紧跟在 `calendar_event` 之后
    expect(at('agenda')).toBe(at('calendar_event') + 1)
    expect(start).toBe(at('agenda') + 1)
  })

  it('菜单不过滤 skip 项（09 §245：没做要可见）', () => {
    const slashIds = filterCommands('', 'slash').map((item) => item.id)
    for (const item of ENTERPRISE_MENU_ITEMS) expect(slashIds).toContain(item.menuId)
    // 「+」菜单里没有它们（真飞书这几项只在斜杠菜单的分类里）
    const plusIds = filterCommands('', 'plus').map((item) => item.id)
    for (const item of ENTERPRISE_MENU_ITEMS) expect(plusIds).not.toContain(item.menuId)
  })

  it('按拼音 / 英文名能搜到（jira / meego / 知识库）', () => {
    expect(filterCommands('jira', 'slash').map((item) => item.id)).toEqual(['jiraIssue', 'jiraFilter'])
    expect(filterCommands('meego', 'slash').map((item) => item.id)).toEqual(['meegoView', 'meegoDetail'])
    expect(filterCommands('知识库', 'slash').map((item) => item.id)).toEqual(['wikiRecent'])
    expect(filterCommands('订阅号', 'slash').map((item) => item.id)).toEqual(['subscribeArticle'])
  })
})
