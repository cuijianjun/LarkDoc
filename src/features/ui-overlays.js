import { registerFeature } from '../core/features/registry'
import { openTemplateSave } from '../editor/templateSave'
import { createImportConfirmation } from '../ui/dialogs'
import { createSlideStage } from '../ui/stage'
import { registerUiApi } from './ui-registry'
import { uiOverlayFactories } from './ui-overlays-factories'

registerFeature('ui.templateSave', () => ({ openTemplateSave }))
registerFeature('ui.importConfirmation', () => ({ createImportConfirmation }))
registerFeature('ui.stage', () => ({ createSlideStage }))
export const uiApi = registerUiApi('ui.overlays', uiOverlayFactories)
