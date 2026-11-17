/**
 * 侧栏面板 / 对话框 / 浮层这类「点了才用」的面板工厂。
 *
 * 它们随 `uiPanels` 包按需下发：评论、版本、模板库、搜索、提醒这些要么在侧栏、
 * 要么是模态框，触发点都在一次显式点击之后，多等一个脚本不影响手感。
 * 面板的挂载语义仍由 createDeferredUi 守住——状态不满足就永远不下载这个包。
 */
import { createCommentPanel, createVersionPanel, createVersionToast } from '../ui/panels'
import { createEmbedDialog, createHelpDrawer, createLinkDialog, createMathDialog, createTablePickerDialog, createTemplateSaveDialog } from '../ui/dialogs'
import { createRevisionPanels } from '../ui/revision'
import { createIsvPanel } from '../ui/isvPanel'
import { createReminder } from '../ui/reminder'
import { createCalendarSearch } from '../ui/calendarSearch'
import { createSearchPanel } from '../ui/searchPanel'
import { createTemplateLibrary } from '../ui/templateLibrary'
import { createDocumentOverlays } from '../ui/overlays'
import { createNotifications } from '../ui/notifications'
import { createWorkspacePanels } from '../ui/workspacePanels'
import { createPanelPresentation } from '../components/lark-doc/editor/panelPresentation'
import { createCalloutPresentation } from '../components/lark-doc/editor/calloutPresentation'
import { createCommentInteraction } from '../components/lark-doc/editor/commentInteraction'
import { createVersioningPresentation } from '../components/lark-doc/editor/versioningPresentation'

export const uiPanelFactories = {
  createCommentPanel, createVersionPanel, createVersionToast,
  createEmbedDialog, createHelpDrawer, createLinkDialog, createMathDialog, createTablePickerDialog, createTemplateSaveDialog,
  createRevisionPanels, createIsvPanel, createReminder, createCalendarSearch, createSearchPanel,
  createTemplateLibrary, createDocumentOverlays, createNotifications, createWorkspacePanels,
  createPanelPresentation, createCommentInteraction, createVersioningPresentation,
  // 高亮块表情表与面板 presentation 共用 labels-data / identity-data（77 KB 源码），
  // 放这里两边只打一份；A 包不再引用 core/emoji 任何模块。
  createCalloutPresentation,
}
