/**
 * Element 面板包 A：选区 / 悬浮 / 表格 / 顶栏。
 *
 * 这是鼠标一动就要用的那一半，样式表也由本包下发（两个包共用同一份
 * lark-doc-element.ui.css，先到的那个把 <link> 塞进 head，后到的靠
 * data-lark-doc-feature 去重），所以 B 包自己不需要再带样式。
 */
import '../styles/versioning.css'
import '../styles/deferred-ui.css'
import '../components/lark-doc/template-library.css'
import { registerUiApi } from './ui-registry'
import { uiCoreFactories } from './ui-core-factories'

export const uiApi = registerUiApi('ui', uiCoreFactories)
