/** Element 低频编辑面板的真实实现；不依赖编辑器内核或移动正文样式。 */
import { registerFeature } from '../core/features/registry'
import { createCommentPanel, createSaveVersionDialog, createVersionPanel } from '../ui/panels'
import { createEmbedDialog, createHelpDrawer, createLinkDialog, createMathDialog, createTablePickerDialog } from '../ui/dialogs'
import { createExtendedOverlays } from '../ui/extendedOverlays'
import { createColorPalette } from '../ui/colorPalette'
import { createRevisionPanels } from '../ui/revision'
import { createIsvPanel } from '../ui/isvPanel'
import { createReminder } from '../ui/reminder'
import { createCalendarSearch } from '../ui/calendarSearch'
import { createSearchPanel } from '../ui/searchPanel'
import { createCommandMenu } from '../ui/commandMenu'

const api = {
  createCommentPanel, createSaveVersionDialog, createVersionPanel,
  createEmbedDialog, createHelpDrawer, createLinkDialog, createMathDialog, createTablePickerDialog,
  createExtendedOverlays, createColorPalette, createRevisionPanels, createIsvPanel, createReminder,
  createCalendarSearch, createSearchPanel, createCommandMenu,
}
registerFeature('ui', () => api)
registerFeature('ui.ready', () => api)

