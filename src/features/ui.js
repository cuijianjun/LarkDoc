/** Element 低频编辑面板的真实实现；不依赖编辑器内核或移动正文样式。 */
// Element injects this optional panel CSS before publishing ui.ready. Standard
// distributions continue to ship the complete public stylesheet.
import '../styles/versioning.css'
import '../styles/deferred-ui.css'
import '../styles/panel-tools.css'
import '../components/lark-doc/template-library.css'
import { registerUiApi } from './ui-registry'
import { uiCoreFactories } from './ui-core-factories'
import { uiPanelFactories } from './ui-panels-factories'
import { uiOverlayFactories } from './ui-overlays-factories'

// 非 Element 宿主（es/cjs/lite）只认这一个入口：包内置动态 import 拿到的必须是
// 全集，所以这里合并各经典 UMD 包的工厂表。
export const uiApi = { ...uiCoreFactories, ...uiPanelFactories, ...uiOverlayFactories }
registerUiApi('ui', uiApi)
