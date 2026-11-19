/** CDN直挂入口：特性从当前脚本的同目录UMD资源按需加载。 */
import '../features/element'
import { closeHistory } from '@tiptap/pm/history'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { publishSharedModules } from '../core/features/shared-host'
import * as uiIcons from '../ui/icons'
import * as uiIcon from '../ui/icon'
import * as uiDom from '../ui/dom'
import * as uiPalette from '../ui/palette'
import * as uiMenuLayout from '../ui/menuLayout'
import * as uiHeadingMenu from '../ui/headingMenu'
import * as uiDiagramMenu from '../ui/diagramMenu'
import * as uiTooltip from '../ui/tooltip'
import * as uiSelect from '../ui/select'
import * as emojiIdentityData from '../core/emoji/identity-data'
import * as emojiIdentity from '../core/emoji/identity'
import * as policyUrl from '../core/policy/url'
import * as policyNetwork from '../core/policy/network'
import * as imageCrop from '../core/media/image-crop'
import * as commentImages from '../components/lark-doc/editor/commentImages'
import * as editorConstants from '../components/lark-doc/editor/constants'
export * from './index'
export { default } from './index'

// 两支 UI 包与本文件同版本同目录部署，构建期会把下面这些模块换成转发 shim
// （见 rollup.config.mjs 的 sharedHostModules）。这里发布的是同一份实现，所以
// 包内不再各打一份 icons / select / emoji 身份表。名字必须与构建期登记一致，
// test/unit/build-contract.test.js 守着这条对齐。
publishSharedModules({
  '@tiptap/pm/history': { closeHistory },
  '@tiptap/pm/state': { Plugin, PluginKey, TextSelection },
  '@tiptap/pm/view': { Decoration, DecorationSet },
  'ui.icons': uiIcons,
  'ui.icon': uiIcon,
  'ui.dom': uiDom,
  'ui.palette': uiPalette,
  'ui.menuLayout': uiMenuLayout,
  'ui.headingMenu': uiHeadingMenu,
  'ui.diagramMenu': uiDiagramMenu,
  'ui.tooltip': uiTooltip,
  'ui.select': uiSelect,
  'core.emojiIdentityData': emojiIdentityData,
  'core.emojiIdentity': emojiIdentity,
  'core.policyUrl': policyUrl,
  'core.policyNetwork': policyNetwork,
  'core.imageCrop': imageCrop,
  'editor.commentImages': commentImages,
  'editor.constants': editorConstants,
})
