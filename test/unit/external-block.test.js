/**
 * 17 §17.5「11 个缺失块类型」—— 外部服务块目录 + `externalBlock` 占位卡。
 *
 * 这批块（chat_card / mindnote / task / okr* / jira_issue / agenda* / board /
 * whiteboard / view / diagram / synced）本地没有实现，CRUD 一栏是 `provider` 或
 * `unsupported`。这里守三条契约，任何一条破了「全量登记」就是空的：
 *
 *  1. 目录与 §17.5 对齐：11 块族 / 22 kind，每类 CRUD 四栏齐全；
 *  2. 能力判定是唯一出口 —— provider 档给 `ERR_PROVIDER_REQUIRED`，unsupported 档给
 *     `ERR_UNSUPPORTED_OPERATION`，delete 恒放行（§17.5 表头：Delete 统一走
 *     `BlockModuleAPI.remove`）；
 *  3. 保真 —— 载入降级成占位卡、导出侧还原，往返逐字节一致（与 unknownBlock 同通道，
 *     §17.5 表下说明要求「不能在导入/保存时丢字段」）。
 */
// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { DOMSerializer } from '@tiptap/pm/model'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { BLOCK_ID_TYPES, restoreUnknownBlocks, validateDocument } from '../../src/core/documentOperations'
import {
  ERR_PROVIDER_REQUIRED, ERR_UNSUPPORTED_OPERATION, EXTERNAL_BLOCK_FAMILIES,
  EXTERNAL_BLOCK_GENERIC, EXTERNAL_BLOCK_KINDS, EXTERNAL_STATUSES,
  externalBlockCapabilities, externalBlockCapability, externalBlockMeta,
  externalBlockPreview, isExternalBlockType, isExternalKind, normalizeExternalBlock,
} from '../../src/registry/blocks'

let schema
beforeAll(() => {
  schema = getSchema(createLarkDocExtensions())
})

const kinds = Object.keys(EXTERNAL_BLOCK_KINDS)
const ACTIONS = ['create', 'read', 'update', 'delete']

describe('外部块目录（17 §17.5 全量登记）', () => {
  it('11 个块族 / 22 个 kind，族名与 kind 一一对应', () => {
    expect(EXTERNAL_BLOCK_FAMILIES).toHaveLength(11)
    expect(kinds).toHaveLength(22)
    const families = new Set(EXTERNAL_BLOCK_FAMILIES.map((item) => item.family))
    expect(families.size).toBe(11)
    for (const kind of kinds) {
      const meta = EXTERNAL_BLOCK_KINDS[kind]
      expect(families, kind).toContain(meta.family)
      expect(meta.label, kind).toBeTruthy()
      expect(meta.provider, kind).toBeTruthy()
    }
    // 11 个族必须各有至少一个 kind —— 否则「11 个块类型」是凑数。
    const used = new Set(kinds.map((kind) => EXTERNAL_BLOCK_KINDS[kind].family))
    expect(used.size).toBe(11)
  })

  it('每个 kind 的 CRUD 四栏齐全且都落在已知档位集合内', () => {
    const known = new Set([
      'provider', 'bridge', 'editor', 'web.slash', 'unsupported',
      'block.insert', 'block.get', 'block.update', 'block-delete', 'operation',
      'replace_image', 'table operation', 'transaction', 'id-only',
    ])
    for (const kind of kinds) {
      const crud = EXTERNAL_BLOCK_KINDS[kind].crud
      for (const key of ['C', 'R', 'U', 'D']) {
        expect(known, `${kind}.${key}`).toContain(crud[key])
      }
    }
  })

  it('capability 五档齐全：provider / bridge / editor / web.slash / unsupported 都有真实 kind 落到', () => {
    const modes = new Set()
    for (const kind of kinds) {
      for (const action of ACTIONS) modes.add(externalBlockCapability(kind, action).mode)
    }
    for (const mode of ['provider', 'bridge', 'editor', 'web.slash', 'unsupported']) {
      expect(modes, mode).toContain(mode)
    }
  })


  it('moduleId 唯一（宿主按 moduleId 挂 provider，重名会串台）', () => {
    const ids = kinds.map((kind) => EXTERNAL_BLOCK_KINDS[kind].moduleId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('认得出的 kind 给表项，认不出的给兜底且不返回 null', () => {
    expect(isExternalKind('jira_issue')).toBe(true)
    expect(isExternalBlockType('chat_card')).toBe(true)
    expect(externalBlockMeta('jira_issue').code).toBe('jira_issue')
    // 宿主没给 kind / 老数据：兜底「外部内容块」，调用点不用判空。
    for (const value of ['', undefined, null, 'nope', 42]) {
      expect(isExternalKind(value)).toBe(false)
      expect(externalBlockMeta(value)).toEqual(EXTERNAL_BLOCK_GENERIC)
    }
  })

  it('preview 浅摘标题与源地址：Jira 拼 issueKey，取不到给空串', () => {
    expect(externalBlockPreview({ attrs: { issueKey: 'DOC-1', summary: '修导入' } })).toEqual({ title: 'DOC-1 修导入', sourceUrl: '' })
    expect(externalBlockPreview({ attrs: { name: 'Q3 目标', url: 'https://host/o/1' } })).toEqual({ title: 'Q3 目标', sourceUrl: 'https://host/o/1' })
    expect(externalBlockPreview({})).toEqual({ title: '', sourceUrl: '' })
    expect(externalBlockPreview(undefined)).toEqual({ title: '', sourceUrl: '' })
  })
})

describe('能力判定（§17.5 CRUD 四栏是唯一出处）', () => {
  it('delete 对全部 22 类恒放行 —— 表头：Delete 统一走 BlockModuleAPI.remove', () => {
    for (const kind of kinds) {
      for (const action of ['delete']) {
        const cap = externalBlockCapability(kind, action)
        expect(cap.supported, `${kind}.${action}`).toBe(true)
        expect(cap.errorCode, `${kind}.${action}`).toBeNull()
      }
    }
    // 兜底 kind（宿主没给 kind）同样能删，否则用户删不掉这张卡。
    expect(externalBlockCapability('', 'delete').supported).toBe(true)
  })

  it('provider 档 → ERR_PROVIDER_REQUIRED（可解释：去接入，不是做不了）', () => {
    // chat_card 四栏除 delete 外全是 provider
    for (const action of ['create', 'read', 'update']) {
      const cap = externalBlockCapability('chat_card', action)
      expect(cap.supported).toBe(false)
      expect(cap.errorCode).toBe(ERR_PROVIDER_REQUIRED)
      expect(cap.reason).toContain('飞书会话')
    }
    expect(externalBlockCapability('jira_issue', 'update').errorCode).toBe(ERR_PROVIDER_REQUIRED)
    expect(externalBlockCapability('okr', 'create').errorCode).toBe(ERR_PROVIDER_REQUIRED)
  })

  it('unsupported 档 → ERR_UNSUPPORTED_OPERATION（§17.5 原文）', () => {
    // task 的 C/R/U 三栏全是 unsupported
    for (const action of ['create', 'read', 'update']) {
      const cap = externalBlockCapability('task', action)
      expect(cap.supported).toBe(false)
      expect(cap.errorCode).toBe(ERR_UNSUPPORTED_OPERATION)
    }
    expect(externalBlockCapability('diagram', 'create').errorCode).toBe(ERR_UNSUPPORTED_OPERATION)
    expect(externalBlockCapability('mindnote', 'create').errorCode).toBe(ERR_UNSUPPORTED_OPERATION)
  })

  it('本地档（block.get / operation / block.insert）不需要服务即可用', () => {
    expect(externalBlockCapability('view', 'read')).toMatchObject({ supported: true, mode: 'block.get', errorCode: null })
    expect(externalBlockCapability('agenda', 'read')).toMatchObject({ supported: true, mode: 'block.get' })
    expect(externalBlockCapability('agenda_item', 'create')).toMatchObject({ supported: true, mode: 'operation' })
    expect(externalBlockCapability('wiki_catalog', 'create')).toMatchObject({ supported: true, mode: 'block.insert' })
    expect(externalBlockCapability('board', 'create')).toMatchObject({ supported: true, mode: 'block.insert' })
  })

  it('全部 kind × 4 动作：结果自洽（支持的无 errorCode，不支持的必带 errorCode）', () => {
    for (const kind of kinds) {
      const caps = externalBlockCapabilities(kind)
      expect(Object.keys(caps).sort()).toEqual([...ACTIONS].sort())
      for (const action of ACTIONS) {
        const cap = caps[action]
        if (cap.supported) {
          expect(cap.errorCode, `${kind}.${action}`).toBeNull()
        } else {
          expect([ERR_PROVIDER_REQUIRED, ERR_UNSUPPORTED_OPERATION], `${kind}.${action}`).toContain(cap.errorCode)
          expect(cap.reason, `${kind}.${action}`).toBeTruthy()
        }
      }
    }
  })

  it('未知动作不静默放行', () => {
    const cap = externalBlockCapability('jira_issue', 'teleport')
    expect(cap.supported).toBe(false)
    expect(cap.errorCode).toBe(ERR_UNSUPPORTED_OPERATION)
  })
})

describe('externalBlock 载入降级与保真（P1-03 同通道）', () => {
  // 刻意用非字母序 key，守「JSON.stringify 保序 → 还原逐字节一致」。
  const rawJira = { type: 'jira_issue', attrs: { issueKey: 'DOC-7', summary: '导入丢字段', url: 'https://jira/DOC-7' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '块内说明' }] }] }

  it('登记过的官方块降级为 externalBlock，附可解释的卡片信息', () => {
    const json = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: '前文' }] },
      rawJira,
      { type: 'paragraph', content: [{ type: 'text', text: '后文' }] },
    ] }
    const out = validateDocument(json, schema)
    const card = out.content[1]
    expect(card.type).toBe('externalBlock')
    expect(card.attrs.kind).toBe('jira_issue')
    expect(card.attrs.provider).toBe('jira')
    expect(card.attrs.status).toBe('unavailable')
    expect(card.attrs.title).toBe('DOC-7 导入丢字段')
    expect(card.attrs.sourceUrl).toBe('https://jira/DOC-7')
    expect(card.attrs.payload).toBe(JSON.stringify(rawJira))
    // 前后块原样保留
    expect(out.content[0].type).toBe('paragraph')
    expect(out.content[2].type).toBe('paragraph')
  })

  it('降级 → 还原往返逐字节一致，且幂等', () => {
    const json = { type: 'doc', content: [rawJira] }
    const first = restoreUnknownBlocks(validateDocument(json, schema))
    expect(JSON.stringify(first.content[0])).toBe(JSON.stringify(rawJira))
    const second = restoreUnknownBlocks(validateDocument(first, schema))
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it('未登记的块仍走 unknownBlock（两类占位卡不串味）', () => {
    const out = validateDocument({ type: 'doc', content: [{ type: 'someFutureBlock' }] }, schema)
    expect(out.content[0].type).toBe('unknownBlock')
  })

  it('attrs 越界被拒（status 枚举 / kind 只认目录内 / sourceUrl 过 URL 闸门）', () => {
    expect(() => validateDocument({ type: 'doc', content: [{ type: 'externalBlock', attrs: { status: 'maybe' } }] }, schema)).toThrow()
    expect(() => validateDocument({ type: 'doc', content: [{ type: 'externalBlock', attrs: { kind: 'nope' } }] }, schema)).toThrow()
    expect(() => validateDocument({ type: 'doc', content: [{ type: 'externalBlock', attrs: { sourceUrl: 'javascript:alert(1)' } }] }, schema)).toThrow()
    expect(() => validateDocument({ type: 'doc', content: [{ type: 'externalBlock', attrs: { title: 'a\u0000b' } }] }, schema)).toThrow()
    // 合法值放行
    expect(validateDocument({ type: 'doc', content: [{ type: 'externalBlock', attrs: { kind: 'okr', status: 'readonly' } }] }, schema).content[0].attrs.status).toBe('readonly')
  })

  it('在 BLOCK_ID_TYPES 内 —— 必须可读、可删、可保真，得有 blockId 落点', () => {
    expect(BLOCK_ID_TYPES.has('externalBlock')).toBe(true)
  })

  it('normalizeExternalBlock 越界裁剪、非法归零，不抛错', () => {
    expect(normalizeExternalBlock({ kind: 'jira_issue', title: 'ok', status: 'nope', payload: 1, provider: 'BAD PROVIDER' })).toEqual({
      kind: 'jira_issue', payload: '', title: 'ok', sourceUrl: '', provider: 'jira', status: 'unavailable', reason: '',
    })
    expect(normalizeExternalBlock(undefined).kind).toBe('')
    expect(normalizeExternalBlock(null).status).toBe('unavailable')
    // 全部三档状态都在枚举内（UI 角标与卡片文案共用）
    expect(EXTERNAL_STATUSES).toEqual(['unavailable', 'readonly', 'ready'])
  })
})

/**
 * 回归守卫：atom 节点的 renderHTML 子 spec 必须**展平**。
 *
 * 嵌套写法（`['div', attrs, [child, child]]`）编辑器里看不出来，只在序列化时炸
 * `RangeError: Invalid array passed to renderSpec` —— 而 getHTML / 导出全走这条路。
 */
describe('externalBlock 序列化（导出侧回归）', () => {
  it('serializeNode 不抛错，卡片结构可查且带状态角标', () => {
    const node = schema.nodes.externalBlock.create({ kind: 'jira_issue', title: 'DOC-7 导入丢字段', provider: 'jira' })
    const el = DOMSerializer.fromSchema(schema).serializeNode(node)
    expect(el.getAttribute('data-type')).toBe('external-block')
    expect(el.getAttribute('data-external-family')).toBe('jira_issue')
    expect(el.getAttribute('data-external-status')).toBe('unavailable')
    expect(el.querySelector('.lark-doc-external-card-title').textContent).toBe('DOC-7 导入丢字段')
    expect(el.querySelector('.lark-doc-external-card-sub').textContent).toContain('Jira')

    // 角标：短标给眼睛，整句进 title / aria-label（窄卡片塞不下 provider 名）
    const badge = el.querySelector('.lark-doc-external-card-badge')
    expect(badge.textContent).toBe('未接入 · 去接入')
    expect(badge.getAttribute('data-external-badge')).toBe('unavailable')
    expect(badge.getAttribute('title')).toContain('Jira')
    expect(badge.getAttribute('title')).toContain('未接入')
    expect(badge.getAttribute('aria-label')).toBe(badge.getAttribute('title'))
  })

  it('fallback 语义：未接入态不可选中、不可编辑（只读态见 provider-registry 渲染用例）', () => {
    const el = DOMSerializer.fromSchema(schema).serializeNode(schema.nodes.externalBlock.create({ kind: 'jira_issue', title: 't' }))
    // contenteditable 显式写出来才会跟着 getHTML / 复制 / 导出走（PM 只给 ViewDesc 补）
    expect(el.getAttribute('contenteditable')).toBe('false')
    expect(el.getAttribute('data-external-locked')).toBe('unavailable')
    // 不可选中 + aria-disabled，避免读屏把它当成可操作内容
    expect(el.getAttribute('aria-disabled')).toBe('true')
  })

  it('节点上的 status attr 不决定视觉（本机没注册 provider 就得诚实显示未接入）', () => {
    const node = schema.nodes.externalBlock.create({ kind: 'jira_issue', title: 't', status: 'ready' })
    const el = DOMSerializer.fromSchema(schema).serializeNode(node)
    expect(el.getAttribute('data-external-status')).toBe('unavailable')
    expect(el.querySelector('.lark-doc-external-card-badge').textContent).toBe('未接入 · 去接入')
  })

  it('超长 payload 不落 DOM（保真走 JSON，属性挂 1M 会拖死渲染）', () => {
    const node = schema.nodes.externalBlock.create({ kind: 'board', payload: 'x'.repeat(9000) })
    const el = DOMSerializer.fromSchema(schema).serializeNode(node)
    expect(el.getAttribute('data-external-payload')).toBeNull()
    const small = schema.nodes.externalBlock.create({ kind: 'board', payload: '{"type":"board"}' })
    expect(DOMSerializer.fromSchema(schema).serializeNode(small).getAttribute('data-external-payload')).toBe('{"type":"board"}')
  })
})
