/** Element 低频编辑面板的真实实现；不依赖编辑器内核或移动正文样式。 */
// Element injects this optional panel CSS before publishing ui.ready. Standard
// distributions continue to ship the complete public stylesheet.
import '../styles/versioning.css'
import '../styles/deferred-ui.css'
import '../components/lark-doc/template-library.css'
import { registerUiApi } from './ui-registry'
import { uiCoreFactories } from './ui-core-factories'
import { uiPanelFactories } from './ui-panels-factories'

// 非 Element 宿主（es/cjs/lite）只认这一个入口：包内置动态 import 拿到的必须是
// 全集，所以这里把两个 UMD 包各自的工厂表并起来。Element 侧分别走
// features/ui-core.js 与 features/ui-panels.js，本文件不进任何一个 UMD 包。
export const uiApi = { ...uiCoreFactories, ...uiPanelFactories }
registerUiApi('ui', uiApi)
