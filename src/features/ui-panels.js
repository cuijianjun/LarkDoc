/**
 * Element 面板包 B：侧栏面板 / 对话框 / 浮层。
 *
 * 只在用户真正点开某个面板时才拉；工厂并进 A 包建好的那张全局表，
 * 因此已经注入的 ui.ready 句柄随后就能看到它们。
 */
import { registerUiApi } from './ui-registry'
import { uiPanelFactories } from './ui-panels-factories'

export const uiApi = registerUiApi('ui.panels', uiPanelFactories)
