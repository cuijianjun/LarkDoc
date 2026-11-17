/**
 * 工作区控制器 —— 模板与历史域。
 *
 * 模板选择器开关、套用模板、快照列表 / 创建 / 恢复。
 */
import { validateDocument } from '../components/lark-doc/documentOperations'
import { migrateRecordContent } from '../core/migrations'
import { validateDerivedSnapshot } from '../core/derive/snapshot'
import { logger } from '../utils/logger'
import { nextPaintFrame } from './workspaceShared'

export const templateMethods = {
  applyTemplate(id) {
    if (!this.featureEnabled('templates') || !id || !this.writable()) return false
    const template = this.state.templateItems.find(item => item.id === id)
    if (!template || !this.confirm('替换当前正文？可用撤销恢复正文；建议先保存快照。')) return false
    this.closeAI()
    this.setContent(template.html)
    this.state.title = template.title
    this.queueSave()
    return true
  },

  openTemplatePicker() {
    if (!this.featureEnabled('templates') || !this.writable()) return
    this.state.historyOpen = false
    this.state.aiOpen = false
    this.state.templateQuery = ''
    this.state.templateOpen = true
    if (this.host.nextTick) this.host.nextTick(() => this.host.focusTemplateSearch?.())
  },

  closeTemplatePicker() {
    this.state.templateOpen = false
    this.state.templateQuery = ''
    this.focus()
  },

  chooseTemplate(id) {
    if (this.applyTemplate(id)) this.closeTemplatePicker()
  },

  async toggleHistory() {
    if (!this.featureEnabled('history')) return
    this.state.historyOpen = !this.state.historyOpen
    if (!this.state.historyOpen) return
    try { this.state.snapshots = await this.callWorkspace('snapshots') } catch (error) { this.storageFailure(error) }
  },

  async createSnapshot() {
    if (!this.featureEnabled('history') || !this.writable()) return
    try {
      await this.callWorkspace('snapshot', this.record())
      this.state.snapshots = await this.callWorkspace('snapshots')
      this.state.notice = `快照已保存到${this.persistenceLabel()}`
      logger.info('storage', 'lark-doc.snapshot.created', { itemCount: this.state.snapshots.length })
    } catch (error) { this.storageFailure(error) }
  },

  async restoreSnapshot(id) {
    if (!this.featureEnabled('history') || !this.writable()) return
    try {
      const entry = await this.callWorkspace('restore', id)
      const editor = this.getEditor()
      const json = validateDocument(migrateRecordContent(entry.json, entry.schemaVersion), editor.schema)
      if (!this.confirm('恢复此快照并替换当前正文？恢复后可撤销正文。')) return
      if (this.host.hydrateOutline && this.host.hydrateOutline(validateDerivedSnapshot(entry.derived, json)?.outline)) await nextPaintFrame()
      if (this._disposed) return
      this.closeAI()
      this.setContent(json)
      this.state.title = entry.title
      this.state.notice = '已恢复快照，可撤销正文'
    } catch (error) { this.state.notice = error.message }
  }
}
