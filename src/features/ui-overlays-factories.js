import { createColorPalette } from '../ui/colorPalette'
import { createExtendedOverlays } from '../ui/extendedOverlays'
import { createDocumentOverlays } from '../ui/overlays'
import { createShareInteraction } from '../components/lark-doc/editor/shareInteraction'

export const uiOverlayFactories = { createColorPalette, createExtendedOverlays, createDocumentOverlays, createShareInteraction }
