// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { openHostFormDialog } from '../../examples/host-dialog.js'

/** 宿主侧飞书表单弹窗：只验交互契约，不锁像素（像素由 Chrome 实测守）。 */
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const dialog = () => document.querySelector('dialog.larkdoc-host-dialog')
const trigger = () => dialog().querySelector('.larkdoc-host-select-trigger')

function open(extra = {}) {
  return openHostFormDialog({
    title: '添加快捷方式',
    description: 'Docker 本地协作文档',
    fields: [
      { type: 'select', name: 'folderId', label: '目标目录', required: true,
        options: [{ value: '', label: '请选择' }, { value: 'f1', label: '我的云文档' }, { value: 'f2', label: '联调文档' }] },
    ],
    ...extra,
  })
}

afterEach(() => { document.querySelectorAll('dialog').forEach(node => node.remove()) })

describe('宿主弹窗（飞书 UD Modal 版式）', () => {
  it('标题 / 说明 / 字段 / 底部按钮齐全，遮罩与会话不抢焦点', () => {
    const { close } = open()
    expect(dialog().querySelector('.larkdoc-host-title').textContent).toBe('添加快捷方式')
    expect(dialog().querySelector('.larkdoc-host-desc').textContent).toBe('Docker 本地协作文档')
    expect(dialog().querySelector('.larkdoc-host-field-label').textContent).toBe('目标目录')
    expect([...dialog().querySelectorAll('.larkdoc-host-btn')].map(node => node.textContent)).toEqual(['取消', '确定'])
    expect(dialog().querySelector('.larkdoc-host-close').getAttribute('aria-label')).toBe('关闭')
    close(null)
  })

  it('下拉只渲染真实选项，点选后写真身 select 并回显文案', async () => {
    const { result } = open()
    expect(dialog().querySelectorAll('.larkdoc-host-option')).toHaveLength(2)
    expect([...dialog().querySelectorAll('.larkdoc-host-option')].map(node => node.textContent)).toEqual(['我的云文档', '联调文档'])
    expect(trigger().getAttribute('aria-expanded')).toBe('false')

    trigger().click()
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(dialog().querySelector('.larkdoc-host-menu').hidden).toBe(false)

    dialog().querySelectorAll('.larkdoc-host-option')[1].click()
    const select = dialog().querySelector('select[name="folderId"]')
    expect(select.value).toBe('f2')
    expect(dialog().querySelector('.larkdoc-host-select-value').textContent).toBe('联调文档')
    expect(dialog().querySelector('.larkdoc-host-select').classList.contains('is-placeholder')).toBe(false)
    expect(trigger().getAttribute('aria-expanded')).toBe('false')

    dialog().querySelector('.larkdoc-host-btn.is-primary').click()
    await expect(result).resolves.toEqual({ folderId: 'f2' })
  })

  it('未选必填项时不提交、给出飞书红字，并在选中后清掉', async () => {
    const { result } = open()
    dialog().querySelector('.larkdoc-host-btn.is-primary').click()
    await settle()
    expect(dialog()).not.toBeNull()
    expect(dialog().querySelector('.larkdoc-host-error').textContent).toBe('请选择目标目录')
    expect(dialog().querySelector('.larkdoc-host-field').classList.contains('is-invalid')).toBe(true)

    trigger().click()
    dialog().querySelectorAll('.larkdoc-host-option')[0].click()
    expect(dialog().querySelector('.larkdoc-host-error')).toBeNull()

    dialog().querySelector('.larkdoc-host-btn.is-primary').click()
    await expect(result).resolves.toEqual({ folderId: 'f1' })
  })

  it('取消 / 关闭 / Esc 都返回 null，且移除弹窗', async () => {
    for (const target of ['cancel', 'close']) {
      const { result } = open()
      if (target === 'cancel') dialog().querySelector('.larkdoc-host-btn').click()
      else dialog().querySelector('.larkdoc-host-close').click()
      await expect(result).resolves.toBeNull()
      expect(dialog()).toBeNull()
    }
    const { result } = open()
    const event = new Event('cancel', { cancelable: true })
    dialog().dispatchEvent(event)
    await expect(result).resolves.toBeNull()
    expect(dialog()).toBeNull()
  })

  it('多字段（转移所有权形态）按定义顺序渲染，checkbox 默认未勾选', () => {
    const { close } = open({
      fields: [
        { type: 'select', name: 'targetPrincipalId', label: '新所有者', required: true, options: [{ value: 'p1', label: 'Bella' }] },
        { type: 'checkbox', name: 'removeOldOwner', label: '移除原所有者权限', value: false },
        { type: 'input', name: 'confirmation', label: '输入“转移”确认', required: true },
      ],
    })
    const labels = [...dialog().querySelectorAll('.larkdoc-host-field-label, .larkdoc-host-check span')].map(node => node.textContent)
    expect(labels).toEqual(['新所有者', '移除原所有者权限', '输入“转移”确认'])
    expect(dialog().querySelector('input[name="removeOldOwner"]').checked).toBe(false)
    close(null)
  })
})
