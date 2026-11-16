/** 外部应用只做链接预览与跳转；旧 sheet/bitable/cardEmbed 节点继续兼容读取。 */
import { BOARD_DIAGRAM_ITEMS } from './board-diagram'
import { ENTERPRISE_MENU_ITEMS } from './enterprise'

export const APP_PREVIEW_ITEMS = [
  { id: 'sheet', label: '电子表格' },
  { id: 'bitable', label: '多维表格' },
  { id: 'whiteboard', label: '画板' },
  ...BOARD_DIAGRAM_ITEMS.map(({ id, label }) => ({ id, label })),
  ...ENTERPRISE_MENU_ITEMS.filter(item => item.menuId !== 'agenda').map(item => ({ id: item.menuId, label: item.label })),
]

const byId = new Map(APP_PREVIEW_ITEMS.map(item => [item.id, item]))
export function appPreviewOf(id) { return byId.get(id) || null }
