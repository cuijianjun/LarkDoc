/**
 * 选区 / 悬浮 / 表格 / 顶栏这类「鼠标一动就要用」的面板工厂。
 *
 * 它们随 `ui` 包首帧下发：选中一段文字、悬停一个块、点开顶栏菜单都要立刻出界面，
 * 不能等第二个脚本。侧栏面板与对话框不在这里，见 ui-panels-factories.js。
 */
import { createCommandMenu } from '../ui/commandMenu'
import { createTableTools, createTableBoundaryTools } from '../ui/tableTools'
import { createTableOverlays } from '../ui/tableOverlays'
import { createCellPlusTools } from '../ui/cellPlusTools'
import { createLinkTools } from '../ui/linkTools'
import { createBubbleBar } from '../ui/bubbleBar'
import { createCalloutTools } from '../ui/calloutTools'
import { createTopBarMenus } from '../ui/topBarMenus'
import { createBlockHandleMenus } from '../ui/blockHandleMenus'
import { createTablePresentation } from '../components/lark-doc/editor/tablePresentation'
import { createExportInteraction } from '../components/lark-doc/editor/exportInteraction'
import { createBlockInteraction } from '../components/lark-doc/editor/blockInteraction'

export const uiCoreFactories = {
  createCommandMenu,
  createTableTools, createTableBoundaryTools, createTableOverlays, createCellPlusTools,
  createLinkTools,
  // 宿主把 host 混在 options 里传进来，这里还原成 bubbleBar 自己的签名。
  createBubbleBar: options => createBubbleBar(options.host, options),
  createCalloutTools, createTopBarMenus, createBlockHandleMenus,
  createTablePresentation,
  createExportInteraction, createBlockInteraction,
}
