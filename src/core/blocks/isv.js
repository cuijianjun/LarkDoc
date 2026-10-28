/**
 * 第三方文档小组件块 `isv`（P4-04）。
 *
 * 规格来源 requirements/02 §22（①~⑦ 全链实测），色值对照 06。
 *
 * 一个节点类型背两种形态（`kind` 分叉），这是 02 §22 ⑦ 采坑表的直接结论：
 *
 *   - `catalog`（目录导航）：真飞书跑在 `web_offline` iframe 里，宿主 DOM **永远没有**
 *     目录节点。V1 无外网、CDN 不可达，所以按 ④-5 的实测几何在宿主 DOM 里复刻
 *     （`ul>li>ul>li` 真嵌套 —— 因为「父 item 高度 = 32 + 后代之和」）。
 *   - `button`（按钮）：2026-10-25 人工 E2 复核推翻了「按钮也是 iframe」—— 真机是
 *     宿主 `<span class="docx-button-component">`，72×26 的纯文本按钮（⑤-3）。
 *
 * 与 `webEmbed` 的差别：iframe 块**不存内容只存钥匙**（src），isv 块虽然同族，但
 * 按钮形态的内容（文案 / 底色 / 动作 / 链接）**全部落在 attrs 里** —— 因为它根本
 * 不进 iframe，这些就是它的全部，落 JSON 才能随文档走。
 *
 * 对齐层默认 `left`（④-1 实测），与图片块的 `center` 不同 —— 别照抄图片。
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { BLOCK_ID_PATTERN } from '../documentOperations'
import { validateAttribute } from './shared'
import { getNodeView } from '../nodeviews/registry'
import { createIsvNodeView } from '../nodeviews/isv'
import {
  ISV_KINDS,
  safeIsvAppId, safeIsvInstanceId, safeIsvAlign, safeIsvKind, safeIsvHeight,
  safeButtonText, safeButtonColor, safeButtonAction, safeIsvLink,
  normalizeIsv, validateIsvButton,
} from '../embed/isv'

/**
 * 常量与判定函数的唯一出处是判定层 `core/embed/isv.js`（块定义 / NodeView / 面板三点
 * 共用，互相 import 会成环 —— 先例 `core/blocks/web-embed.js`）。这里原样再导一次：
 * 上层只需要认识 `registry/blocks.js` 一个入口，不用记 core 内部路径（P0-04 硬规则 1）。
 */
export {
  ISV_APP_ID, ISV_BUILD_TS, ISV_BUILD_HASH, ISV_CDN_ORIGIN, ISV_KINDS, ISV_ALIGNS,
  ISV_DEFAULT_HEIGHT, ISV_BUTTON_HEIGHT, ISV_MIN_HEIGHT, ISV_MAX_HEIGHT,
  ISV_INSTANCE_PATTERN, ISV_BUTTON_ACTIONS, BUTTON_ACTION_DEFAULT, BUTTON_TEXT_DEFAULT,
  BUTTON_TEXT_MAX, ISV_VALIDATION_MESSAGE, ISV_REQUIRED_FIELDS, ISV_PANEL,
  isvInstanceId, isvEmbedUrl, isvPanelHeight, catalogIndent, catalogFontWeight,
  readIsv, resolveIsvHeight, readIsvAlign, normalizeIsv, validateIsvButton,
  isButtonLinkValid, normalizeButtonLink, safeIsvLink,
  buildCatalogTree, flattenCatalogTree,
} from '../embed/isv'

const readAttr = (name) => (el) => {
  const value = el.getAttribute(name)
  return value === null || value === '' ? null : value
}

const readNumber = (name) => (el) => {
  const raw = el.getAttribute(name)
  if (raw === null || raw === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

const Isv = Node.create({
  name: 'isv',
  group: 'block',
  // 两种形态都没有可编辑 contentDOM：目录是只读树，按钮是单个 span。
  // `selectable` 让点击选中整块、删除键一次删整块（与 webEmbed / fileBlock 同口径）。
  atom: true,
  draggable: true,
  selectable: true,

  /**
   * 两个回调都是**宿主能力通道**，core 不自己发明行为（与 calendar-event 同口径）：
   *   - `onButtonAction(action, view)`：「创建副本 / 关注文档更新」要读文档系统，core 没有；
   *     不传就静默 —— ⑤-2 实测这两个动作的行为本身也是「未采」，别猜。
   *   - `onCatalogJump(pos)`：目录项点击要滚到对应标题；不传就退化为 `scrollIntoView`
   *     （④-5 实测就是滚动，不是换选区）。
   */
  addOptions() {
    return { onButtonAction: null, onCatalogJump: null }
  },

  addAttributes() {
    return {
      /** 形态：`catalog` / `button`。默认目录导航（菜单里点「目录导航」直接落块，不弹面板）。 */
      kind: {
        default: ISV_KINDS.catalog,
        validate: validateAttribute('isv.kind', safeIsvKind),
        parseHTML: (el) => {
          const value = readAttr('data-isv-kind')(el)
          return safeIsvKind(value) && value ? value : ISV_KINDS.catalog
        },
        rendered: false,
      },
      /**
       * 实例键（真机是 iframe 的 `uuid` 路由参数）。**没有它的块画不出东西**：
       * `readIsv` 遇到空值直接返回 null（→ NodeView 画「数据缺失」，同 calendar_event
       * 的口径），不画一个假组件骗眼睛。
       */
      instanceId: {
        default: null,
        validate: validateAttribute('isv.instanceId', safeIsvInstanceId),
        parseHTML: readAttr('data-instance-id'),
        rendered: false,
      },
      appId: {
        default: null,
        validate: validateAttribute('isv.appId', safeIsvAppId),
        parseHTML: readAttr('data-app-id'),
        rendered: false,
      },
      /** 对齐层取值；默认 `left`（④-1 实测，与图片的 center 不同）。 */
      align: {
        default: 'left',
        validate: validateAttribute('isv.align', safeIsvAlign),
        parseHTML: (el) => {
          const value = readAttr('data-align')(el)
          return safeIsvAlign(value) && value ? value : 'left'
        },
        rendered: false,
      },
      /** 块高。真机上由 iframe 自报，**不是常量**；这里只存落块时那一档（335 / 222）。 */
      height: {
        default: null,
        validate: validateAttribute('isv.height', safeIsvHeight),
        parseHTML: readNumber('data-height'),
        rendered: false,
      },
      buttonText: {
        default: null,
        validate: validateAttribute('isv.buttonText', safeButtonText),
        parseHTML: readAttr('data-button-text'),
        rendered: false,
      },
      /**
       * 按钮底色。**空 = 用 CSS 的浅蓝默认**（`--ld-bg-selected` #E0E9FF = ⑤-3 真机
       * `.light-blue` 实测值）；有值才写 inline 背景 —— 属用户内容色，随文档走不随主题变，
       * 所以收不进 CSS 变量（11 §V4 / 12 T0-05，同 TEXT_BACKGROUND 的口径）。
       *
       * 🔴 空值**不是**「色板默认格 #E1EAFF」：那格是面板里又一个可选值（④-4a），
       * 与真机默认渲染值差 1/1/1。面板在色板**没被点过**时故意留空走 CSS，
       * 见 `isvMixin.isvColorPristine` —— 别「顺手补一个默认值」把像素改掉。
       */
      buttonColor: {
        default: null,
        validate: validateAttribute('isv.buttonColor', safeButtonColor),
        parseHTML: readAttr('data-button-color'),
        rendered: false,
      },
      action: {
        default: null,
        validate: validateAttribute('isv.action', safeButtonAction),
        parseHTML: readAttr('data-action'),
        rendered: false,
      },
      linkUrl: {
        default: null,
        validate: validateAttribute('isv.linkUrl', safeIsvLink),
        parseHTML: readAttr('data-link-url'),
        rendered: false,
      },
    }
  },

  /**
   * 只认自带标记，且**必须有合法 `instanceId`**：拿不到实例键的 isv 节点连「是谁」
   * 都定不了，让它退化成 unknown-block 保留原文，比渲染一个空壳诚实（同 web-embed）。
   */
  parseHTML() {
    return [{
      tag: 'div[data-type="isv"]',
      getAttrs: (el) => (safeIsvInstanceId(el.getAttribute('data-instance-id'))
        && el.getAttribute('data-instance-id') ? null : false),
    }]
  },

  addCommands() {
    return {
      /**
       * 落块。**按钮形态在这里就把关**：校验不过一律 `false`，面板据此「不关、不插块」
       * （02 §22 ⑤-1：面板不关、块不插入、报错文案 `超链接不合法，请重新输入`）。
       */
      setIsv: (attrs) => ({ state, commands }) => {
        const next = normalizeIsv(attrs || {})
        if (next.kind === ISV_KINDS.button && validateIsvButton(next).length) return false
        // 属性合不合法交给 schema validator 判：`insertContent` 遇到非法属性只打一条
        // warning 然后**照常返回 true**，不先 `create` 一遍就会「命令说成功、正文空」。
        try { state.schema.nodes[this.name].create(next) } catch (_) { return false }
        return commands.insertContent({ type: this.name, attrs: next })
      },
    }
  },

  renderHTML({ node }) {
    const attrs = node.attrs || {}
    const root = {
      class: 'block docx-isv-block',
      'data-type': 'isv',
      'data-block-type': 'isv',
      'data-isv-kind': safeIsvKind(attrs.kind) && attrs.kind ? attrs.kind : ISV_KINDS.catalog,
    }
    // 自绘 renderHTML 不会自动合入全局属性，稳定块 id 要显式带上（同 image / webEmbed）。
    if (typeof attrs.blockId === 'string' && BLOCK_ID_PATTERN.test(attrs.blockId)) root['data-block-id'] = attrs.blockId
    if (safeIsvInstanceId(attrs.instanceId) && attrs.instanceId) root['data-instance-id'] = attrs.instanceId
    if (safeIsvAppId(attrs.appId) && attrs.appId) root['data-app-id'] = attrs.appId
    if (safeIsvAlign(attrs.align) && attrs.align) root['data-align'] = attrs.align
    if (safeIsvHeight(attrs.height) && attrs.height !== null) root['data-height'] = String(attrs.height)
    if (safeButtonText(attrs.buttonText) && attrs.buttonText) root['data-button-text'] = attrs.buttonText
    if (safeButtonColor(attrs.buttonColor) && attrs.buttonColor) root['data-button-color'] = attrs.buttonColor
    if (safeButtonAction(attrs.action) && attrs.action) root['data-action'] = attrs.action
    if (safeIsvLink(attrs.linkUrl) && attrs.linkUrl) root['data-link-url'] = attrs.linkUrl
    return ['div', mergeAttributes(root)]
  },

  // NodeView 先查注册表（三端可覆盖），没有再落 core 的纯 DOM 实现。
  addNodeView() { return getNodeView('isv') || createIsvNodeView },
})

export { Isv }
