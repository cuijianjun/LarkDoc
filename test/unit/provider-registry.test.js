// @vitest-environment jsdom
/**
 * `core/embed/provider-registry.js` —— 17 §17.5 的「接入半边」。
 *
 * 这层只有一件事要证明：**静态档位 + 运行时注册 → 一个能解释的判定**。
 * 所以每条用例都在追同一个问题：注册前后，`status / label / state / error` 四个出口
 * 是不是同时变、且互相不打架。任何一处漂了，UI 角标说「已接入」而 blockApi 抛
 * `ERR_PROVIDER_REQUIRED` 的情况就会重新出现（那正是 §17.13 禁止的「伪造本地成功」）。
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { DOMSerializer } from '@tiptap/pm/model'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { ERR_PROVIDER_REQUIRED, ERR_UNSUPPORTED_OPERATION, EXTERNAL_STATUS } from '../../src/registry/blocks'
import {
  assertExternalOperation, externalBlockStatus, externalBlockStatusHint, externalBlockStatusLabel,
  externalOperationError, externalOperationState, externalProviderNames, externalProviderStatus,
  externalProviderSupports, registerExternalProvider, resetExternalProviders, resolveExternalProvider,
  unregisterExternalProvider,
} from '../../src/core/embed/provider-registry'

let schema
beforeAll(() => {
  schema = getSchema(createLarkDocExtensions())
})

// provider 是**进程内单例**（跨编辑器共享），用例之间必须清干净，否则「未注册」的断言会假绿。
afterEach(() => { resetExternalProviders() })

describe('注册 / 保留 / 注销', () => {
  it('注册后可解析，名字按注册顺序列出', () => {
    expect(registerExternalProvider({ name: 'chat' })).toBe(true)
    expect(registerExternalProvider({ name: 'jira', label: '自建 Jira' })).toBe(true)
    expect(externalProviderNames()).toEqual(['chat', 'jira'])
    expect(resolveExternalProvider('chat')).toMatchObject({ name: 'chat', readonly: false })
    // label 缺省取目录里的中文名（外部 provider 名不许在 UI 里散着拼中文）
    expect(resolveExternalProvider('chat').label).toBe('飞书会话')
    expect(resolveExternalProvider('jira').label).toBe('自建 Jira')
    expect(resolveExternalProvider('nope')).toBeNull()
  })

  it('同名重复注册是**替换**（热更新 / 换鉴权后重注册），不报错、不重复出现', () => {
    registerExternalProvider({ name: 'chat', readonly: true })
    registerExternalProvider({ name: 'chat' })
    expect(externalProviderNames()).toEqual(['chat'])
    expect(externalProviderStatus('chat')).toBe(EXTERNAL_STATUS.READY)
  })

  it('注销返回「之前是否真的注册过」', () => {
    registerExternalProvider({ name: 'chat' })
    expect(unregisterExternalProvider('chat')).toBe(true)
    expect(unregisterExternalProvider('chat')).toBe(false)
    expect(externalProviderStatus('chat')).toBe(EXTERNAL_STATUS.UNAVAILABLE)
  })

  it('非法 provider 名一律拒绝（返回 false，不抛错、不落表）', () => {
    for (const bad of ['', ' ', 'Chat', '1chat', 'chat service', 'chat/../x', null, undefined, 42, {}, []]) {
      expect(registerExternalProvider(bad && typeof bad === 'object' && !Array.isArray(bad) ? bad : { name: bad }), String(bad)).toBe(false)
    }
    expect(externalProviderNames()).toEqual([])
  })
})

describe('supports：kinds 白名单', () => {
  it('不写 kinds = 该 provider 名下 kind 全支持', () => {
    registerExternalProvider({ name: 'chat' })
    expect(externalProviderSupports('chat', 'chat_card')).toBe(true)
  })

  it('写了 kinds 就只认列出来的那些', () => {
    registerExternalProvider({ name: 'chat', kinds: ['okr'] })
    expect(externalProviderSupports('chat', 'okr')).toBe(true)
    expect(externalProviderSupports('chat', 'chat_card')).toBe(false)
    // kind 级状态跟着掉 —— 「注册了但不支持这个 kind」不能给「已接入」角标
    expect(externalBlockStatus('chat_card')).toBe(EXTERNAL_STATUS.UNAVAILABLE)
    expect(externalBlockStatusLabel('chat_card')).toBe('未接入 · 去接入')
  })

  it('没注册的 provider 一律不支持', () => {
    expect(externalProviderSupports('jira', 'jira_issue')).toBe(false)
  })
})

describe('status 三档 + 角标文案（17 §17.5「可解释的 disabled」）', () => {
  it('未接入：unavailable + 「未接入 · 去接入」', () => {
    expect(externalBlockStatus('chat_card')).toBe(EXTERNAL_STATUS.UNAVAILABLE)
    expect(externalBlockStatusLabel('chat_card')).toBe('未接入 · 去接入')
    expect(externalBlockStatusHint('chat_card')).toContain('未接入')
  })

  it('只读：readonly + 「只读」，hint 说清「只读、不可编辑」', () => {
    registerExternalProvider({ name: 'chat', readonly: true })
    expect(externalBlockStatus('chat_card')).toBe(EXTERNAL_STATUS.READONLY)
    expect(externalBlockStatusLabel('chat_card')).toBe('只读')
    expect(externalBlockStatusHint('chat_card')).toContain('只读')
  })

  it('已接入：ready + 空角标（服务正常就不占那一格），hint 仍给完整句子', () => {
    registerExternalProvider({ name: 'chat' })
    expect(externalBlockStatus('chat_card')).toBe(EXTERNAL_STATUS.READY)
    expect(externalBlockStatusLabel('chat_card')).toBe('')
    expect(externalBlockStatusHint('chat_card')).toContain('飞书会话')
  })

  it('kind 不在目录里 / 没有 provider：退成 unavailable，不抛错', () => {
    expect(externalBlockStatus('nope')).toBe(EXTERNAL_STATUS.UNAVAILABLE)
    expect(externalBlockStatus('')).toBe(EXTERNAL_STATUS.UNAVAILABLE)
    expect(externalBlockStatusLabel('')).toBe('未接入 · 去接入')
  })
})

describe('state：静态档位 + 运行时注册合成一次判定', () => {
  it('本地档不需要服务就能用（view.create = operation / wiki_catalog.create = block.insert）', () => {
    expect(externalOperationState('view', 'create')).toMatchObject({ allowed: true, code: null })
    expect(externalOperationState('wiki_catalog', 'create')).toMatchObject({ allowed: true, code: null })
  })

  it('provider 档：未注册 → ERR_PROVIDER_REQUIRED；注册 → 放行（本文件存在的全部理由）', () => {
    expect(externalOperationState('chat_card', 'create')).toMatchObject({ allowed: false, code: ERR_PROVIDER_REQUIRED })
    registerExternalProvider({ name: 'chat' })
    expect(externalOperationState('chat_card', 'create')).toMatchObject({ allowed: true, code: null, mode: 'provider' })
  })

  it('只读时错误码仍是 PROVIDER_REQUIRED，但 reason 说的是「只读」不是「未接入」', () => {
    registerExternalProvider({ name: 'chat', readonly: true })
    const state = externalOperationState('chat_card', 'create')
    expect(state).toMatchObject({ allowed: false, code: ERR_PROVIDER_REQUIRED })
    expect(state.reason).toContain('只读')
    expect(state.reason).not.toContain('未接入')
  })

  it('unsupported 档恒定 ERR_UNSUPPORTED_OPERATION（注册什么服务都救不回来）', () => {
    registerExternalProvider({ name: 'task' })
    expect(externalOperationState('task', 'create')).toMatchObject({ allowed: false, code: ERR_UNSUPPORTED_OPERATION })
    expect(externalOperationState('view', 'update')).toMatchObject({ allowed: false, code: ERR_UNSUPPORTED_OPERATION })
  })

  it('delete 恒放行（§17.5 表头：统一走 BlockModuleAPI.remove），未接入也一样', () => {
    expect(externalOperationState('chat_card', 'delete')).toMatchObject({ allowed: true, code: null })
    expect(externalOperationState('task', 'delete')).toMatchObject({ allowed: true, code: null })
  })

  it('五档判定齐全：本地 / provider 已接入 / provider 未接入 / provider 只读 / unsupported', () => {
    const verdicts = [
      externalOperationState('view', 'create'), // 本地
      externalOperationState('task', 'create'), // unsupported
      externalOperationState('chat_card', 'create'), // provider 未接入
    ]
    registerExternalProvider({ name: 'chat' })
    verdicts.push(externalOperationState('chat_card', 'create')) // provider 已接入
    registerExternalProvider({ name: 'chat', readonly: true })
    verdicts.push(externalOperationState('chat_card', 'create')) // provider 只读
    expect(verdicts.map((item) => item.allowed)).toEqual([true, false, false, true, false])
    expect(verdicts.map((item) => item.code)).toEqual([null, ERR_UNSUPPORTED_OPERATION, ERR_PROVIDER_REQUIRED, null, ERR_PROVIDER_REQUIRED])
  })
})

describe('assert：不允许才抛，抛出的错带 kind / action / status', () => {
  it('允许时不抛，原样返回 state', () => {
    expect(assertExternalOperation('view', 'create')).toMatchObject({ allowed: true })
    expect(() => assertExternalOperation('chat_card', 'delete')).not.toThrow()
  })

  it('provider 档未接入：code=ERR_PROVIDER_REQUIRED，三字段齐全', () => {
    let error = null
    try { assertExternalOperation('chat_card', 'create') } catch (caught) { error = caught }
    expect(error).toBeTruthy()
    expect(error.code).toBe(ERR_PROVIDER_REQUIRED)
    expect(error.kind).toBe('chat_card')
    expect(error.action).toBe('create')
    expect(error.status).toBe(EXTERNAL_STATUS.UNAVAILABLE)
    expect(error.reason).toBeTruthy()
  })

  it('unsupported 档：code=ERR_UNSUPPORTED_OPERATION，三字段齐全', () => {
    let error = null
    try { assertExternalOperation('task', 'read') } catch (caught) { error = caught }
    expect(error.code).toBe(ERR_UNSUPPORTED_OPERATION)
    expect(error).toMatchObject({ kind: 'task', action: 'read', status: EXTERNAL_STATUS.UNAVAILABLE })
  })

  it('已接入后不再抛（同一个 kind，注册前后行为必须变）', () => {
    expect(() => assertExternalOperation('chat_card', 'create')).toThrow()
    registerExternalProvider({ name: 'chat' })
    expect(() => assertExternalOperation('chat_card', 'create')).not.toThrow()
  })

  it('externalOperationError 的三字段恒存在（缺省给空串 / unavailable，方便宿主上报）', () => {
    const error = externalOperationError(ERR_UNSUPPORTED_OPERATION, '不支持')
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({
      code: ERR_UNSUPPORTED_OPERATION, reason: '不支持', kind: '', action: '', status: EXTERNAL_STATUS.UNAVAILABLE,
    })
  })
})

describe('渲染侧：角标 / fallback 属性都由 registry 出（17 §17.5）', () => {
  const render = (attrs) => DOMSerializer.fromSchema(schema).serializeNode(schema.nodes.externalBlock.create(attrs))

  it('未接入：角标「未接入 · 去接入」+ title/aria-label，卡片不可编辑', () => {
    const el = render({ kind: 'chat_card', title: '会话卡片示例' })
    const badge = el.querySelector('.lark-doc-external-card-badge')
    expect(badge.textContent).toBe('未接入 · 去接入')
    expect(badge.getAttribute('title')).toContain('未接入')
    expect(badge.getAttribute('aria-label')).toBe(badge.getAttribute('title'))
    expect(el.getAttribute('data-external-status')).toBe(EXTERNAL_STATUS.UNAVAILABLE)
    expect(el.getAttribute('contenteditable')).toBe('false')
    expect(el.getAttribute('data-external-locked')).toBe('unavailable')
    expect(el.getAttribute('aria-disabled')).toBe('true')
  })

  it('只读：角标「只读」，仍不可编辑，但不挂 aria-disabled（可选中可复制）', () => {
    registerExternalProvider({ name: 'chat', readonly: true })
    const el = render({ kind: 'chat_card' })
    expect(el.querySelector('.lark-doc-external-card-badge').textContent).toBe('只读')
    expect(el.getAttribute('data-external-locked')).toBe('readonly')
    expect(el.getAttribute('contenteditable')).toBe('false')
    expect(el.getAttribute('aria-disabled')).toBeNull()
  })

  it('已接入：不渲染角标，也不挂任何 fallback 属性（描边转实线）', () => {
    registerExternalProvider({ name: 'chat' })
    const el = render({ kind: 'chat_card' })
    expect(el.querySelector('.lark-doc-external-card-badge')).toBeNull()
    expect(el.getAttribute('data-external-status')).toBe(EXTERNAL_STATUS.READY)
    expect(el.getAttribute('data-external-locked')).toBeNull()
    expect(el.getAttribute('contenteditable')).toBeNull()
  })

  it('节点上的 status attr 不决定视觉：registry 说未接入就是未接入（attr 只作保真）', () => {
    const el = render({ kind: 'chat_card', status: EXTERNAL_STATUS.READY })
    expect(el.getAttribute('data-external-status')).toBe(EXTERNAL_STATUS.UNAVAILABLE)
    expect(el.querySelector('.lark-doc-external-card-badge').textContent).toBe('未接入 · 去接入')
  })
})
