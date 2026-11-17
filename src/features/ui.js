/** Element 低频编辑面板的真实实现；不依赖编辑器内核或移动正文样式。 */
// Element injects this optional panel CSS before publishing ui.ready. Standard
// distributions continue to ship the complete public stylesheet.
import '../styles/versioning.css'
import '../styles/deferred-ui.css'
import '../components/lark-doc/template-library.css'
import { registerFeature } from '../core/features/registry'
import { createCommentPanel, createSaveVersionDialog, createVersionPanel } from '../ui/panels'
import { createEmbedDialog, createHelpDrawer, createLinkDialog, createMathDialog, createTablePickerDialog, createTemplateSaveDialog } from '../ui/dialogs'
import { createExtendedOverlays } from '../ui/extendedOverlays'
import { createColorPalette } from '../ui/colorPalette'
import { createRevisionPanels } from '../ui/revision'
import { createIsvPanel } from '../ui/isvPanel'
import { createReminder } from '../ui/reminder'
import { createCalendarSearch } from '../ui/calendarSearch'
import { createSearchPanel } from '../ui/searchPanel'
import { createCommandMenu } from '../ui/commandMenu'
import { createTemplateLibrary } from '../ui/templateLibrary'
import { createDocumentOverlays } from '../ui/overlays'
import { createNotifications } from '../ui/notifications'
import { createTableTools, createTableBoundaryTools } from '../ui/tableTools'
import { createTableOverlays } from '../ui/tableOverlays'
import { createCellPlusTools } from '../ui/cellPlusTools'
import { createLinkTools } from '../ui/linkTools'
import { createBubbleBar } from '../ui/bubbleBar'
import { createPanelPresentation } from '../components/lark-doc/editor/panelPresentation'
import { createVersioningPresentation } from '../components/lark-doc/editor/versioningPresentation'
import { createTablePresentation } from '../components/lark-doc/editor/tablePresentation'
import { createWorkspacePanels } from '../ui/workspacePanels'
import { createCommentInteraction } from '../components/lark-doc/editor/commentInteraction'
import { createShareInteraction } from '../components/lark-doc/editor/shareInteraction'
import { createExportInteraction } from '../components/lark-doc/editor/exportInteraction'
import { createCalloutPresentation } from '../components/lark-doc/editor/calloutPresentation'
import { createCalloutTools } from '../ui/calloutTools'
import { createTopBarMenus } from '../ui/topBarMenus'
import { createBlockHandleMenus } from '../ui/blockHandleMenus'
import { createBlockInteraction } from '../components/lark-doc/editor/blockInteraction'

export const uiApi = {
  createCommentPanel, createSaveVersionDialog, createVersionPanel,
  createEmbedDialog, createHelpDrawer, createLinkDialog, createMathDialog, createTablePickerDialog, createTemplateSaveDialog,
  createExtendedOverlays, createColorPalette, createRevisionPanels, createIsvPanel, createReminder,
  createCalendarSearch, createSearchPanel, createCommandMenu, createTemplateLibrary,
  createDocumentOverlays, createNotifications, createTableTools, createTableBoundaryTools,
  createTableOverlays, createCellPlusTools, createLinkTools,
  createBubbleBar: options => createBubbleBar(options.host, options),
  createPanelPresentation, createVersioningPresentation,
  createTablePresentation,
  createWorkspacePanels,
  createCommentInteraction, createShareInteraction, createExportInteraction,
  createCalloutPresentation, createCalloutTools,
  createTopBarMenus, createBlockHandleMenus, createBlockInteraction,
}
registerFeature('ui', () => uiApi)
registerFeature('ui.ready', () => uiApi)

