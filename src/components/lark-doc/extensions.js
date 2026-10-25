/**
 * 扩展装配入口。
 *
 * createLarkDocExtensions 是 schema 的唯一来源：这里决定文档 JSON 认识哪些
 * 节点、mark 和属性；config.features 开关在此映射为各 Tiptap 扩展的启停，
 * 关闭能力只隐藏入口，历史 JSON 仍可解析。
 *
 * P0-04 起本文件只做装配：块定义在 core/blocks/*.js，经 registry/blocks.js
 * 汇入；这里的扩展数组顺序逐项保持与拆分前一致 —— 顺序影响 schema 与
 * 插件优先级，schema 快照（test/fixtures/schema-v1.json）必须逐字节相同。
 */
import StarterKit from '@tiptap/starter-kit'
import { CharacterCount } from '@tiptap/extensions'
import FileHandler from '@tiptap/extension-file-handler'
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details'
import Highlight from '@tiptap/extension-highlight'
import Placeholder from '@tiptap/extension-placeholder'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyleKit } from '@tiptap/extension-text-style'
import Typography from '@tiptap/extension-typography'
import { safeUrl } from '../../core/documentOperations'
import { createNetworkPolicy } from '../../core/policy/network'
import { withUnfurlGate } from '../../core/embed/unfurl'
import { wrapContainerAllowed } from '../../core/blocks/container-depth'
import { imageUrlPasteExtension } from '../../core/blocks/image-paste'
import {
  LarkDocHeading, LarkDocOrderedList, Callout, Columns, Column, Formatting,
  LarkDocBlockId, LarkDocListItemNumber, LarkDocEmoji, LarkDocMention, LarkDocReminder, LarkDocBlockquote,
  UnknownBlock, codeExtension, imageExtension, mathExtension, documentExtension,
  FileBlock, WebEmbed, CardEmbed, Bookmark,
} from '../../registry/blocks'

const LarkDocCharacterCount = CharacterCount.extend({
  addProseMirrorPlugins() {
    // 官方 filter 持有本次 options；只更新该 limit，保留插件、光标与正文历史。
    this.storage.setLimit = (limit) => { this.options.limit = limit > 0 ? limit : 0 }
    return this.parent()
  },
})

// P1-05：setDetails 命令层深度守卫——折叠块套在已达上限的容器链里时拒绝（纯 wrap 语义，无拆引用分支）。
const LarkDocDetails = Details.extend({
  addCommands() {
    const parentCommands = this.parent?.() ?? {}
    return {
      setDetails: (...args) => (props) => {
        const { from, to } = props.state.selection
        if (!wrapContainerAllowed(props.state, from, to, 1)) return false
        return parentCommands.setDetails?.(...args)?.(props) ?? false
      },
    }
  },
})

// 工厂不加载 Vue 单文件组件，可在无 DOM 的 Node 14 中检查 schema。
export function createLarkDocExtensions(options = {}) {
  const enabled = (name) => options.config?.features?.[name] !== false
  /**
   * 出网策略的**唯一实例**（P3-06）：粘贴过滤（`document.js` 的 `transformPastedHTML`）、
   * 载入降级（`LarkDocEditor.setContent`）、内嵌网页闸门、卡片抓取闸门共用它。
   *
   * core 不 import 策略 —— 判定实现与「谁是策略」解耦，三端换一套只需换注入的东西：
   * 这里做「策略 → 闸门」的转换，core 只收 `canEmbed` 谓词 / `allows` 谓词。
   * 默认档是 `open`，两个闸门都**不接线**，行为与 P3-05 逐字节一致。
   */
  const network = createNetworkPolicy(options.config?.network)
  const gated = network.mode !== 'open'
  return [
    // blockquote 换成自有 LarkDocBlockquote（P1-01：quote_container 兼容读取），
    // schema 规格与 StarterKit 内置版逐字节一致（content: 'block+' 容器），
    // 仅追加 parseHTML 规则；位置紧随 StarterKit，命令与 inputRule 原样继承。
    StarterKit.configure({ heading: false, codeBlock: false, orderedList: false, blockquote: false, link: { openOnClick: false, autolink: true, isAllowedUri: (url) => safeUrl(url), HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } } }),
    LarkDocBlockquote,
    LarkDocHeading, LarkDocOrderedList, codeExtension(options.config), imageExtension(options.resolveImageFile),
    // P2-04：文件 / 视频块紧跟在图片之后——两者是同层原子块，schema 顺序沿用
    // 「图片 → 文件」的落位直觉；关掉 features.files 只藏入口，节点仍在 schema 里，
    // 历史 JSON 照样解析（P0-04 约定）。
    FileBlock.configure({ resolveFileUrl: options.resolveFileUrl || null }),
    // P3-01：内嵌网页紧跟文件块——同为「外部内容占位」的同层原子块。
    // `canEmbed` 是出网策略闸门（P3-06 接线）：offline / allowlist 下返回 false 的
    // src 连 iframe 都不造（`STATUS.BLOCKED`），有 poster 就只显示快照图。
    // 宿主显式传 `canEmbed` 时以宿主为准（自备一套判定）；`open` 档不接线，
    // 保持 P3-01 的「不干预」。
    // 桥回调（标题回写 / 嵌入内容存盘）也走这里注入，core 不认识宿主。
    WebEmbed.configure({
      canEmbed: options.canEmbed || (gated ? (src) => network.allows(src) : null),
      sandbox: options.embedSandbox || null,
      allow: options.embedAllow || null,
      bridgeTimeout: options.embedBridgeTimeout,
      onSetTitle: options.onEmbedTitle || null,
      onSave: options.onEmbedSave || null,
    }),
    // P3-04：卡片块紧跟内嵌网页——同为「外部内容占位」，区别在渲染方式（DOM / iframe）。
    // `onAction` 是动作冒泡通道（编辑器不持 token，跳转与提交都由宿主决定）；
    // `providers` 为 null = 全认，宿主声明后未列出的 providerId 才降级成占位卡。
    CardEmbed.configure({
      onAction: options.onEmbedCardAction || null,
      providers: options.embedProviders || null,
    }),
    // P3-05：网页卡片紧跟卡片块——同样的 chrome，不同的事（一张固定的 URL 卡）。
    // `unfurl` 是第 6 个可选 provider（09 §265）：不传就降级成「URL + 域名标题」，
    // **不阻塞任何能力**；`onOpen` 交出「点了去哪」的决定权，不传就自己 `window.open`。
    // P3-06：抓取同样过出网闸门 —— 被拦的地址不进宿主函数（offline 下零外部请求）。
    Bookmark.configure({
      unfurl: gated ? withUnfurlGate(options.unfurlProvider, network.allows) : options.unfurlProvider || null,
      onOpen: options.onBookmarkOpen || null,
    }),
    LarkDocDetails.configure({ persist: true }), DetailsSummary, DetailsContent,
    Callout, Columns, Column, Formatting, LarkDocBlockId, LarkDocListItemNumber, Highlight.configure({ multicolor: true }),
    TaskList, TaskItem.configure({ nested: true }), TextAlign.configure({ types: ['paragraph', 'heading'] }),
    // P4-02a：日期提醒紧跟提及之后 —— 同为「行内小物件」，但它是 **mark**（挂在文本上，
    // 文案即 chip 文字），不是 atom。位置放这里只为可读性：mark 注册在 schema.marks 里，
    // 顺序只影响 fixture 字节，不影响行为。
    TextStyleKit, Subscript, Superscript, Typography, LarkDocEmoji, LarkDocMention, LarkDocReminder, UnknownBlock,
    LarkDocCharacterCount.configure({ limit: options.maxLength > 0 ? options.maxLength : 0, autoTrim: false, textCounter: (text) => Array.from(text).length }),
    FileHandler.configure({
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'], consumePasteEvent: true,
      onPaste: (editor, files) => { if (enabled('images') && editor.isEditable && options.onImageFiles) options.onImageFiles(files, editor.state.selection.from) },
      onDrop: (editor, files, pos) => { if (enabled('images') && editor.isEditable && options.onImageFiles) options.onImageFiles(files, pos) },
    }),
    // P2-03：没有文件、只有一个图片地址的粘贴走这里（见 core/blocks/image-paste.js）。
    imageUrlPasteExtension({ enabled: () => enabled('images') }),
    mathExtension('inlineMath', options.onError), mathExtension('blockMath', options.onError),
    Table.configure({ resizable: true }), TableRow, TableCell, TableHeader,
    Placeholder.configure({ placeholder: (options.config && options.config.text && options.config.text.placeholder) || '输入正文，或输入 / 插入内容' }), documentExtension(options, network),
  ]
}

export { applyLineStartMarker } from '../../registry/blocks'
