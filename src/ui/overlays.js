/**
 * 分享 / 导出浮层 —— 原生 DOM 版（阶段 5 批次 5）。
 *
 * 原 SharePopover.vue、PermissionDialog.vue、ExportDialog.vue 的渲染层集中在这里；
 * 状态和业务动作仍由 shareMixin / exportMixin 持有，渲染器只负责 DOM、事件和显隐。
 */
import { applyStyle, lockPageScroll, mountNode, setAttr, setText, syncChildren } from './dom'
import { iconNode } from './icon'
import { SHARE_ICON_COLORS } from './palette'
import { SECURE_CONFIRM_MESSAGES, SECURE_LINK_TIP, cloneShareExcerpt } from '../components/lark-doc/editor/shareContent'
import { imageCropGeometry, imageCropStyles } from '../core/media/image-crop'
import { safeUrl } from '../core/policy/url'
import { createNetworkPolicy, BLOCKED_IMAGE_PLACEHOLDER } from '../core/policy/network'
import { createShareEntry } from './shareEntry'

const SHARE_REFERENCE_ICONS = {
  "LarkLogoColorful": `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" data-icon="LarkLogoColorful"><path d="m12.924 12.803.056-.054c.038-.034.076-.072.11-.11l.077-.076.23-.227 1.334-1.319.335-.331c.063-.063.13-.123.195-.183a7.777 7.777 0 0 1 1.823-1.24 7.607 7.607 0 0 1 1.014-.4 13.177 13.177 0 0 0-2.5-5.013 1.203 1.203 0 0 0-.94-.448h-9.65c-.173 0-.246.224-.107.325a28.23 28.23 0 0 1 8 9.098c.007-.006.016-.013.023-.022Z" fill="${SHARE_ICON_COLORS.larkTeal}"></path><path d="M9.097 21.299a13.258 13.258 0 0 0 11.82-7.247 5.576 5.576 0 0 1-.731 1.076 5.315 5.315 0 0 1-.745.7 5.117 5.117 0 0 1-.615.404 4.626 4.626 0 0 1-.726.331 5.312 5.312 0 0 1-1.883.312 5.892 5.892 0 0 1-.524-.031 6.509 6.509 0 0 1-.729-.126c-.06-.016-.12-.029-.18-.044-.166-.044-.33-.092-.494-.14-.082-.024-.164-.046-.246-.072-.123-.038-.247-.072-.366-.11l-.3-.095-.284-.094-.192-.067c-.08-.025-.155-.053-.234-.082a3.49 3.49 0 0 1-.167-.06c-.11-.04-.221-.079-.328-.12-.063-.025-.126-.047-.19-.072l-.252-.098c-.088-.035-.18-.07-.268-.107l-.174-.07c-.072-.028-.141-.06-.214-.088l-.164-.07c-.057-.024-.114-.05-.17-.075l-.149-.066-.135-.06-.14-.063a90.183 90.183 0 0 1-.141-.066 4.808 4.808 0 0 0-.18-.083c-.063-.028-.123-.06-.186-.088a5.697 5.697 0 0 1-.199-.098 27.762 27.762 0 0 1-8.067-5.969.18.18 0 0 0-.312.123l.006 9.21c0 .4.199.779.533 1a13.177 13.177 0 0 0 7.326 2.205Z" fill="${SHARE_ICON_COLORS.larkBlue}"></path><path d="M23.732 9.295a7.55 7.55 0 0 0-3.35-.776 7.521 7.521 0 0 0-2.284.35c-.054.016-.107.035-.158.05a8.297 8.297 0 0 0-.855.35 7.14 7.14 0 0 0-.552.297 6.716 6.716 0 0 0-.533.347c-.123.089-.243.18-.363.275-.13.104-.252.211-.375.321-.067.06-.13.123-.196.184l-.334.328-1.338 1.321-.23.228-.076.075c-.038.038-.076.073-.11.11l-.057.054a1.914 1.914 0 0 1-.085.08c-.032.028-.063.06-.095.088a13.286 13.286 0 0 1-2.748 1.946c.06.028.12.057.18.082l.142.066c.044.022.091.041.139.063l.135.06.149.067.17.075.164.07c.073.031.142.06.215.088.056.025.116.047.173.07.088.034.177.072.268.107.085.031.168.066.253.098l.189.072c.11.041.218.082.328.12.057.019.11.041.167.06.08.028.155.053.234.082l.192.066.284.095.3.095c.123.037.243.075.366.11l.246.072c.164.048.331.095.495.14.06.015.12.03.18.043.114.029.227.05.34.07.13.022.26.04.389.057a5.815 5.815 0 0 0 .994.019 5.172 5.172 0 0 0 1.413-.3 5.405 5.405 0 0 0 .726-.334c.06-.035.122-.07.182-.108a7.96 7.96 0 0 0 .432-.297 5.362 5.362 0 0 0 .577-.517 5.285 5.285 0 0 0 .37-.429 5.797 5.797 0 0 0 .527-.827l.13-.258 1.166-2.325-.003.006a7.391 7.391 0 0 1 1.527-2.186Z" fill="${SHARE_ICON_COLORS.larkDeepBlue}"></path></svg>`,
  "SubscriptionShareColorful": `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" data-icon="SubscriptionShareColorful"><path d="M20.267 7.333 15.333 2.4H5.067a1.333 1.333 0 0 0-1.334 1.333v15.2A2.667 2.667 0 0 0 6.4 21.6h2.545a.93.93 0 0 0 .038 0h9.95a1.333 1.333 0 0 0 1.334-1.334V7.334Z" fill="url(#u7n__ud15HE6rLqLRQcxkoDzw97kj__a)"></path><path d="M11.666 8.003a.435.435 0 0 1 .8 0l.785 1.945a.433.433 0 0 0 .373.267l2.106.15a.429.429 0 0 1 .25.76l-1.618 1.343a.432.432 0 0 0-.143.436l.515 2.032a.433.433 0 0 1-.65.47l-1.785-1.114a.436.436 0 0 0-.461 0l-1.784 1.113a.432.432 0 0 1-.65-.47l.512-2.036a.43.43 0 0 0-.14-.436L8.157 11.12a.43.43 0 0 1 .248-.76l2.104-.144a.429.429 0 0 0 .372-.267l.784-1.946Z" fill="${SHARE_ICON_COLORS.subscriptionWhite}"></path><path d="M15.333 2.4v3.528a1.406 1.406 0 0 0 1.405 1.405h3.529L15.333 2.4Z" fill="url(#u7n__ud15HE6rLqLRQcxkoDzw97kj__b)"></path><defs><linearGradient id="u7n__ud15HE6rLqLRQcxkoDzw97kj__a" x1="3.133" y1="1.8" x2="19.933" y2="21.6" gradientUnits="userSpaceOnUse"><stop offset="0.055" stop-color="${SHARE_ICON_COLORS.subscriptionLightPurple}"></stop><stop offset="1" stop-color="${SHARE_ICON_COLORS.subscriptionPurple}"></stop></linearGradient><linearGradient id="u7n__ud15HE6rLqLRQcxkoDzw97kj__b" x1="15.155" y1="2.246" x2="19.323" y2="7.95" gradientUnits="userSpaceOnUse"><stop stop-color="${SHARE_ICON_COLORS.subscriptionMediumPurple}"></stop><stop offset="1" stop-color="${SHARE_ICON_COLORS.subscriptionDeepPurple}"></stop></linearGradient></defs></svg>`,
  "WechatColorful": `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" data-icon="WechatColorful"><path d="M0 9.212c0 2.164 1.18 4.14 3.003 5.45.16.106.24.266.24.48 0 .053-.026.134-.026.187-.134.534-.375 1.416-.402 1.443-.027.08-.054.133-.054.213 0 .16.134.294.295.294.054 0 .107-.027.161-.053l1.904-1.095a.905.905 0 0 1 .455-.134c.08 0 .188 0 .268.027.885.267 1.85.4 2.842.4 4.799 0 8.686-3.232 8.686-7.212C17.372 5.232 13.485 2 8.686 2 3.887 2 0 5.232 0 9.212Z" fill="url(#u7o__ud4pEN9WVPoVdCFyDnKQWMEp__a)"></path><path d="M16.779 20.669c.83 0 1.631-.108 2.354-.323.053-.027.133-.027.213-.027.134 0 .268.054.375.108l1.578.915c.053.026.08.053.134.053a.24.24 0 0 0 .24-.242c0-.054-.026-.108-.026-.188 0-.027-.214-.754-.321-1.211-.027-.054-.027-.108-.027-.162a.51.51 0 0 1 .214-.403C23.037 18.085 24 16.443 24 14.613c0-3.337-3.236-6.055-7.221-6.055s-7.22 2.691-7.22 6.055c0 3.338 3.235 6.056 7.22 6.056Z" fill="url(#u7o__ud4pEN9WVPoVdCFyDnKQWMEp__b)"></path><path d="M6.907 6.884C6.907 7.507 6.414 8 5.79 8a1.108 1.108 0 0 1-1.117-1.116c0-.623.494-1.116 1.117-1.116s1.116.493 1.116 1.116Zm5.79 0c0 .623-.493 1.116-1.116 1.116a1.108 1.108 0 0 1-1.116-1.116c0-.623.493-1.116 1.116-1.116.623 0 1.117.493 1.117 1.116Z" fill="${SHARE_ICON_COLORS.wechatDarkGreen}"></path><path d="M18.279 12.744c0 .543.434.977.977.977a.973.973 0 0 0 .976-.977.973.973 0 0 0-.976-.976.973.973 0 0 0-.977.976Zm-4.814 0c0 .543.434.977.977.977a.973.973 0 0 0 .976-.977.973.973 0 0 0-.976-.976.973.973 0 0 0-.977.976Z" fill="${SHARE_ICON_COLORS.wechatGray}"></path><defs><linearGradient id="u7o__ud4pEN9WVPoVdCFyDnKQWMEp__a" x1="8.696" y1="16.385" x2="8.696" y2="2.067" gradientUnits="userSpaceOnUse"><stop stop-color="${SHARE_ICON_COLORS.wechatGreen}"></stop><stop offset="1" stop-color="${SHARE_ICON_COLORS.wechatLightGreen}"></stop></linearGradient><linearGradient id="u7o__ud4pEN9WVPoVdCFyDnKQWMEp__b" x1="16.792" y1="20.565" x2="16.792" y2="8.553" gradientUnits="userSpaceOnUse"><stop stop-color="${SHARE_ICON_COLORS.wechatLightGray}"></stop><stop offset="1" stop-color="${SHARE_ICON_COLORS.wechatWhite}"></stop></linearGradient></defs></svg>`,
  "QrOutlined": "<svg width=\"1em\" height=\"1em\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\" data-icon=\"QrOutlined\"><path d=\"M6.5 7.5a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1Z\" fill=\"currentColor\"></path><path d=\"M4.5 2.5c-1.1 0-2 .9-2 2v7c0 1.1.9 2 2 2h7c1.1 0 2-.9 2-2v-7c0-1.1-.9-2-2-2h-7Zm0 2h7v7h-7v-7ZM11 16a1 1 0 1 1 2 0 1 1 0 0 1-2 0Zm0 3.5a1 1 0 1 1 2 0v1a1 1 0 1 1-2 0v-1Zm4-7.5a1 1 0 1 1 2 0 1 1 0 0 1-2 0Zm3.5 0a1 1 0 0 1 1-1h1a1 1 0 1 1 0 2h-1a1 1 0 0 1-1-1ZM15 17c0-1.1.9-2 2-2h2.5c1.1 0 2 .9 2 2v2.5c0 1.1-.9 2-2 2H17c-1.1 0-2-.9-2-2V17Zm4.5 0H17v2.5h2.5V17Zm-15-2c-1.1 0-2 .9-2 2v2.5c0 1.1.9 2 2 2H7c1.1 0 2-.9 2-2V17c0-1.1-.9-2-2-2H4.5Zm0 2H7v2.5H4.5V17ZM15 4.5c0-1.1.9-2 2-2h2.5c1.1 0 2 .9 2 2V7c0 1.1-.9 2-2 2H17c-1.1 0-2-.9-2-2V4.5Zm4.5 0H17V7h2.5V4.5Z\" fill=\"currentColor\"></path></svg>",
  "LinkLockOutlined": "<svg width=\"1em\" height=\"1em\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\" data-icon=\"LinkLockOutlined\"><path d=\"m16.397 10.853 1.834-2.264a3.164 3.164 0 1 0-4.917-3.982l-2.987 3.688a3.164 3.164 0 0 0 1.85 5.095l-1.427 1.761a5.273 5.273 0 0 1-2.062-8.184l2.987-3.688a5.273 5.273 0 1 1 8.195 6.637l-.852 1.053a4.858 4.858 0 0 0-2.62-.116Z\" fill=\"currentColor\"></path><path d=\"M13.623 9.27a5.275 5.275 0 0 0-1.283-.768l-1.425 1.76c.49.097.965.31 1.38.647a3.152 3.152 0 0 1 1.141 2.01 4.886 4.886 0 0 1 1.73-1.596 5.25 5.25 0 0 0-1.543-2.053ZM11 20.273c0 .177.013.35.037.521a5.274 5.274 0 0 1-7.816-7.056l2.856-3.528.091.866c.064.61.273 1.168.588 1.646L4.86 15.066a3.164 3.164 0 0 0 4.917 3.982l1.225-1.512-.002.102v2.636Zm4.596-6.821a2.857 2.857 0 0 0-.96 2.139V16a1.645 1.645 0 0 0-.61.118A1.637 1.637 0 0 0 13 17.636v2.637c0 .904.733 1.636 1.637 1.636h5.727c.904 0 1.636-.732 1.636-1.636v-2.637c0-.903-.733-1.636-1.636-1.636v-.41a2.864 2.864 0 0 0-4.768-2.138Zm1.904.912c.678 0 1.227.55 1.227 1.227V16h-2.454v-.41c0-.677.55-1.226 1.227-1.226Z\" fill=\"currentColor\"></path></svg>",
  "SettingOutlined": "<svg width=\"1em\" height=\"1em\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\" data-icon=\"SettingOutlined\"><path d=\"m4.328 19.734-.31-.34a10.91 10.91 0 0 1-2.386-4.146l-.135-.436L3.545 12 1.497 9.188l.135-.436a10.91 10.91 0 0 1 2.385-4.147l.311-.339 3.442.377 1.398-3.187.448-.101A10.843 10.843 0 0 1 12 1.09c.809 0 1.607.089 2.384.264l.448.1 1.398 3.188 3.442-.377.31.34a10.91 10.91 0 0 1 2.386 4.146l.135.436L20.455 12l2.048 2.812-.135.436a10.91 10.91 0 0 1-2.385 4.147l-.311.339-3.442-.377-1.398 3.187-.448.101a10.848 10.848 0 0 1-4.768 0l-.448-.1-1.398-3.188-3.442.377Zm3.485-2.21a1.488 1.488 0 0 1 1.525.881l1.12 2.554a9.05 9.05 0 0 0 3.084 0l1.12-2.554a1.488 1.488 0 0 1 1.524-.881l2.755.3c.665-.8 1.19-1.71 1.547-2.69l-1.644-2.258a1.488 1.488 0 0 1 0-1.752l1.644-2.258a9.091 9.091 0 0 0-1.547-2.69l-2.755.3a1.488 1.488 0 0 1-1.524-.881l-1.12-2.554a9.053 9.053 0 0 0-3.084 0l-1.12 2.554a1.488 1.488 0 0 1-1.525.881l-2.754-.3a9.09 9.09 0 0 0-1.548 2.69l1.645 2.258c.38.522.38 1.23 0 1.752l-1.644 2.258c.358.98.882 1.89 1.547 2.69l2.754-.3ZM12 16.545c-2.502 0-4.528-2.036-4.528-4.545 0-2.51 2.026-4.545 4.528-4.545S16.528 9.49 16.528 12 14.502 16.545 12 16.545Zm0-1.818c1.496 0 2.71-1.22 2.71-2.727A2.719 2.719 0 0 0 12 9.273 2.719 2.719 0 0 0 9.29 12 2.719 2.719 0 0 0 12 14.727Z\" fill=\"currentColor\"></path></svg>",
  "MaybeOutlined": "<svg width=\"1em\" height=\"1em\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\" data-icon=\"MaybeOutlined\"><path d=\"M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0 2C5.925 23 1 18.075 1 12S5.925 1 12 1s11 4.925 11 11-4.925 11-11 11Zm-1-6a1 1 0 1 1 2 0 1 1 0 0 1-2 0ZM8.05 9.282a5.17 5.17 0 0 1 .039-.28c.195-1.085.689-1.883 1.481-2.394.62-.405 1.383-.608 2.288-.608 1.189 0 2.176.288 2.962.864.787.575 1.18 1.428 1.18 2.558 0 .693-.17 1.277-.513 1.752-.2.287-.584.655-1.152 1.103l-.56.44c-.305.24-.507.52-.607.84a2.742 2.742 0 0 0-.072.486.5.5 0 0 1-.498.457h-1.12a.5.5 0 0 1-.498-.546c.065-.696.134-1.136.207-1.321.137-.344.49-.74 1.058-1.188l.575-.455c.19-.144 1.166-.831 1.166-1.44 0-.608-.106-.832-.412-1.166-.305-.333-.993-.44-1.613-.44-.61 0-1.132.161-1.387.572-.118.19-.215.393-.284.6a2.097 2.097 0 0 0-.073.307.5.5 0 0 1-.493.415H8.547a.5.5 0 0 1-.497-.556Z\" fill=\"currentColor\"></path></svg>",
  "AddOutlined": "<svg width=\"1em\" height=\"1em\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\" data-icon=\"AddOutlined\"><path d=\"M12 2a1 1 0 0 0-1 1v8H3a1 1 0 1 0 0 2h8v8a1 1 0 1 0 2 0v-8h8a1 1 0 1 0 0-2h-8V3a1 1 0 0 0-1-1Z\" fill=\"currentColor\"></path></svg>"
}

function callHandler(handlers, name, ...args) {
  const fn = handlers && handlers[name]
  return typeof fn === 'function' ? fn(...args) : undefined
}

function text(tag, className, value) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (value !== undefined) node.textContent = value
  return node
}

function button(className, label, onClick) {
  const node = document.createElement('button')
  node.type = 'button'
  if (className) node.className = className
  if (label !== undefined) node.textContent = label
  if (onClick) node.addEventListener('click', onClick)
  return node
}

function attr(node, name, value) {
  if (value !== undefined) node.setAttribute(name, String(value))
  return node
}



function svgIcon(kind, size = 16) {
  if (SHARE_REFERENCE_ICONS[kind]) {
    const template = document.createElement('template')
    template.innerHTML = SHARE_REFERENCE_ICONS[kind]
    const icon = template.content.firstElementChild
    icon.setAttribute('aria-hidden', 'true'); icon.setAttribute('focusable', 'false')
    icon.style.width = `${size}px`; icon.style.height = `${size}px`
    return icon
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.4')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  if (kind === 'gear') path.setAttribute('d', 'M12 4.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4Zm0-3v2.2m0 7.8v2.2M4.6 4.6l1.9 1.1m11-1.1-1.9 1.1M4.6 11.4l1.9-1.1m11 1.1-1.9-1.1')
  else if (kind === 'pencil') path.setAttribute('d', 'm10.4 2.6 3 3-7.5 7.5-3.4.5.5-3.4 7.4-7.6Zm-1.2 1.2 3 3')
  else path.setAttribute('d', 'm7 7 10 10M17 7 7 17')
  svg.appendChild(path)
  return svg
}

function makeClose(className, label, handler) {
  const node = button(className, '', handler)
  attr(node, 'aria-label', label)
  node.appendChild(iconNode('close', 14))
  return node
}

function makeShareClose(className, label, handler) {
  const node = button(className, '✕', handler)
  attr(node, 'aria-label', label)
  return node
}

function setInputValue(node, value) {
  const next = value == null ? '' : String(value)
  if (node.value !== next) node.value = next
}

function selectNode(className, label, value, options, onChange) {
  const node = document.createElement('select')
  node.className = className
  attr(node, 'aria-label', label)
  options.forEach((option) => {
    const item = document.createElement('option')
    item.value = option
    item.textContent = option
    node.appendChild(item)
  })
  node.value = value
  node.addEventListener('change', (event) => onChange(event.target.value))
  return node
}

function createShareView(options) {
  const handlers = options.handlers || {}
  const layer = text('div', 'lark-doc-share-layer')
  const state = {}

  const popover = text('div', 'lark-doc-share-popover')
  attr(popover, 'role', 'dialog')
  attr(popover, 'aria-label', '分享文档')
  const popoverInner = text('div', 'lark-doc-share-popover-inner')
  const shareHeader = text('div', 'lark-doc-share-header')
  const shareTitle = text('h3', 'lark-doc-share-header-title', '分享文档')
  const shareHelp = text('span', 'lark-doc-share-header-help')
  const shareHelpText = '可邀请协作者或复制链接；访问范围以文档权限为准'
  attr(shareHelp, 'role', 'img'); attr(shareHelp, 'aria-label', shareHelpText)
  shareHelp.title = shareHelpText; shareHelp.tabIndex = 0
  shareHelp.appendChild(svgIcon('MaybeOutlined', 14)); shareTitle.appendChild(shareHelp)
  shareHeader.appendChild(shareTitle)
  const headerActions = text('div', 'lark-doc-share-header-actions')
  const permissionButton = button('lark-doc-share-perm-btn')
  attr(permissionButton, 'aria-label', '权限设置')
  attr(permissionButton, 'data-capability', 'canManagePermission')
  permissionButton.appendChild(svgIcon('SettingOutlined'))
  permissionButton.appendChild(text('span', '', '权限设置'))
  permissionButton.addEventListener('click', () => callHandler(handlers, 'onOpenPermissionDialog'))
  headerActions.appendChild(permissionButton)
  shareHeader.appendChild(headerActions)
  popoverInner.appendChild(shareHeader)

  const memberRow = text('div', 'lark-doc-share-member-row')
  memberRow.appendChild(text('span', 'lark-doc-share-member-text', '邀请协作者'))
  const avatars = button('lark-doc-share-avatars', '', () => {
    if (!popover.isConnected || !state.sharePopoverOpen || state.shareCanManagePermission === false) return
    setPage('members'); callHandler(handlers, 'onLoadShareMembers')
  })
  attr(avatars, 'aria-label', '查看协作者')
  avatars.appendChild(text('span', 'lark-doc-share-avatar'))
  const avatarMore = text('span', 'lark-doc-share-avatar-more'); avatars.appendChild(avatarMore)
  avatars.appendChild(text('span', 'lark-doc-share-members-chevron', '›'))
  memberRow.appendChild(avatars)
  popoverInner.appendChild(memberRow)

  const invite = text('div', 'lark-doc-share-invite')
  const inviteInput = document.createElement('input')
  attr(inviteInput, 'aria-label', '邀请协作者')
  inviteInput.placeholder = '搜索用户、群组、部门、用户组或智能体'
  inviteInput.addEventListener('input', (event) => {
    if (!popover.isConnected || !state.sharePopoverOpen) return
    callHandler(handlers, 'onSetShareInviteQuery', event.target.value)
    if (isMobile()) setPage('invite')
  })
  invite.appendChild(inviteInput)
  const inviteEntry = attr(button('lark-doc-share-org-entry', '', () => { if (popover.isConnected && state.sharePopoverOpen) setPage('invite') }), 'aria-label', '添加协作者')
  inviteEntry.appendChild(svgIcon('AddOutlined', 16)); invite.appendChild(inviteEntry)
  popoverInner.appendChild(invite)

  const lower = text('div', 'lark-doc-share-lower')
  const linkCard = text('div', 'lark-doc-share-link-card')
  const linkHead = text('div', 'lark-doc-share-link-head')
  linkHead.appendChild(text('span', 'lark-doc-share-link-title', '链接分享'))
  const linkTag = text('span', 'lark-doc-share-link-tag')
  const linkTagValue = text('span')
  linkTag.appendChild(linkTagValue)
  linkHead.appendChild(linkTag)
  linkCard.appendChild(linkHead)
  const linkBody = text('div', 'lark-doc-share-link-body')
  const linkIcon = text('span', 'lark-doc-share-link-icon')
  linkIcon.appendChild(iconNode('link', 14))
  linkBody.appendChild(linkIcon)
  const linkMain = text('div', 'lark-doc-share-link-main')
  const orgButton = document.createElement('select')
  orgButton.className = 'lark-doc-share-org-btn'
  attr(orgButton, 'aria-label', '链接范围')
  orgButton.addEventListener('change', () => {
    if (popover.isConnected && state.sharePopoverOpen && state.shareLinkWritable && !orgButton.disabled) callHandler(handlers, 'onSetShareLinkAudience', orgButton.value)
  })
  linkMain.appendChild(orgButton)
  const scopeText = text('span', 'lark-doc-share-scope-text')
  linkMain.appendChild(scopeText)
  linkBody.appendChild(linkMain)
  const linkSelect = document.createElement('select')
  linkSelect.className = 'lark-doc-share-perm-select'
  attr(linkSelect, 'aria-label', '链接权限')
  linkSelect.disabled = true; linkSelect.title = '链接权限设置尚未接入文档服务。'
  linkSelect.addEventListener('change', () => {
    if (popover.isConnected && state.sharePopoverOpen && state.shareLinkWritable && !linkSelect.disabled) callHandler(handlers, 'onSetShareLinkPerm', linkSelect.value)
  })
  linkBody.appendChild(linkSelect)
  linkCard.appendChild(linkBody)
  const linkFeedback = text('div', 'lark-doc-share-status')
  attr(linkFeedback, 'role', 'status')
  const linkReload = button('lark-doc-share-btn-outlined', '重新载入', () => {
    if (popover.isConnected && state.sharePopoverOpen && state.shareLinkAvailable && !state.shareLinkBusy) callHandler(handlers, state.shareLinkPending ? 'onQueryShareLink' : 'onLoadShareLink')
  })
  const linkStatus = text('span')
  linkFeedback.append(linkStatus, linkReload)
  linkCard.appendChild(linkFeedback)
  const copyRow = text('div', 'lark-doc-share-copy-row')
  const copyLink = button('lark-doc-share-copy-link', '', () => { if (popover.isConnected && state.sharePopoverOpen) callHandler(handlers, 'onCopyShareLink') })
  copyLink.append(iconNode('link', 14), text('span', '', '复制链接')); copyRow.appendChild(copyLink)
  for (const [label, icon, size] of [['通过飞书分享', 'LarkLogoColorful', 18], ['分享至收藏', 'SubscriptionShareColorful', 20], ['通过微信分享', 'WechatColorful', 20], ['分享二维码', 'QrOutlined', 16], ['加密链接分享', 'LinkLockOutlined', 16]]) {
    const channel = button('lark-doc-share-channel', ''); channel.disabled = true
    attr(channel, 'aria-label', label); channel.title = label + '服务尚未配置'; channel.appendChild(svgIcon(icon, size)); copyRow.appendChild(channel)
  }
  for (const [label, icon] of [['图片分享', 'image'], ['朋友圈', 'share-link'], ['QQ', 'share-link'], ['微博', 'share-link'], ['更多分享方式', 'more']]) {
    const channel = button('lark-doc-share-channel', '')
    channel.disabled = true; channel.title = `${label}服务尚未配置，暂不可用`; attr(channel, 'aria-label', channel.title)
    channel.appendChild(iconNode(icon, 18)); copyRow.appendChild(channel)
  }
  linkCard.appendChild(copyRow)
  lower.appendChild(linkCard)
  popoverInner.appendChild(lower)
  popover.appendChild(popoverInner)

  // Mobile routes reuse the same guarded business actions as the desktop view.
  const mobile = text('section', 'lark-doc-share-mobile')
  const mobileHead = text('header', 'lark-doc-share-mobile-head')
  const mobileTitle = text('h3', '', '协作者')
  let mobilePage = 'index', mobileVisible = false, restoreFocus = null, unlock = null, invitationStatus = 'idle'
  const directoryRows = new Map()
  const isMobile = () => layer.ownerDocument.defaultView.innerWidth <= 760
  const closeMobile = () => callHandler(handlers, 'onCloseSharePopover')
  const setPage = page => { mobilePage = page; render(state); (page === 'invite' ? mobileInput.hidden ? mobileRole.disabled ? mobileInviteFeedback : mobileRole : mobileInput : mobileBack).focus() }
  const mobileBack = button('', '‹', () => { setPage('index'); inviteInput.focus() })
  attr(mobileBack, 'aria-label', '返回协作者')
  const mobileClose = button('', '×', closeMobile); attr(mobileClose, 'aria-label', '关闭协作者')
  mobileHead.append(mobileBack, mobileTitle, mobileClose); mobile.append(mobileHead)
  const mobileIndex = text('div', 'lark-doc-share-mobile-index')
  const mobileRow = (label, icon, action) => {
    const row = button('lark-doc-share-mobile-row', '', action)
    row.append(iconNode(icon, 20), text('span', '', label))
    return row
  }
  const mobileInvite = mobileRow('邀请协作者', 'members', () => setPage('invite')); attr(mobileInvite, 'aria-label', '邀请协作者')
  mobileInvite.append(text('span', 'lark-doc-share-mobile-chevron', '›'))
  const mobileMembers = mobileRow('协作者', 'members', () => { setPage('members'); callHandler(handlers, 'onLoadShareMembers') }); attr(mobileMembers, 'aria-label', '查看协作者')
  const mobileMemberAvatar = text('span', 'lark-doc-share-mobile-avatar'); mobileMembers.append(mobileMemberAvatar)
  const mobileCopy = mobileRow('复制链接', 'link', () => callHandler(handlers, 'onCopyShareLink'))
  mobileIndex.append(mobileInvite, text('div', 'lark-doc-share-mobile-divider'), mobileMembers, text('div', 'lark-doc-share-mobile-divider'), mobileCopy)
  const mobileSearch = text('div', 'lark-doc-share-mobile-search')
  const mobileInput = document.createElement('input')
  mobileInput.placeholder = inviteInput.placeholder; attr(mobileInput, 'aria-label', '搜索协作者')
  mobileInput.addEventListener('input', event => callHandler(handlers, 'onSetShareInviteQuery', event.target.value))
  mobileSearch.append(mobileInput)
  const mobileResults = text('div', 'lark-doc-share-mobile-results'); mobileSearch.append(mobileResults)
  const mobileSearchRetry = button('lark-doc-share-mobile-retry', '重试搜索', () => callHandler(handlers, 'onSearchShareDirectory')); mobileSearch.append(mobileSearchRetry)
  const mobileMemberPage = text('div', 'lark-doc-share-mobile-members')
  const mobileMemberList = text('div', 'lark-doc-share-mobile-member-list')
  const mobileMemberRetry = button('lark-doc-share-mobile-retry', '重新加载协作者', () => callHandler(handlers, 'onLoadShareMembers'))
  const mobileSettings = button('lark-doc-share-mobile-settings', '权限与链接设置', () => setPage('settings'))
  mobileMemberPage.append(mobileMemberList, mobileMemberRetry, mobileSettings)
  const mobileStatus = text('p', 'lark-doc-share-mobile-status'); attr(mobileStatus, 'role', 'status')
  mobileSearch.append(mobileStatus)
  const mobileConfirm = text('div', 'lark-doc-share-mobile-confirm')
  const mobileRecipient = text('p', 'lark-doc-share-mobile-recipient')
  const mobileRoleLabel = text('label', 'lark-doc-share-mobile-role', '权限')
  const mobileRole = document.createElement('select'); attr(mobileRole, 'aria-label', '邀请权限')
  ;[['read', '可阅读'], ['edit', '可编辑'], ['manage', '可管理']].forEach(([value, label]) => {
    const option = document.createElement('option'); option.value = value; option.textContent = label; mobileRole.append(option)
  })
  mobileRole.addEventListener('change', () => callHandler(handlers, 'onSetShareInviteRole', mobileRole.value)); mobileRoleLabel.append(mobileRole)
  const mobileInviteFeedback = text('p', 'lark-doc-share-mobile-status'); attr(mobileInviteFeedback, 'role', 'status'); mobileInviteFeedback.tabIndex = -1
  const mobileSend = button('lark-doc-share-mobile-send', '发送', () => callHandler(handlers, 'onSubmitShareInvitation'))
  const mobileQuery = button('lark-doc-share-mobile-retry', '查询原邀请操作', () => callHandler(handlers, 'onQueryShareInvitation'))
  const mobileReselect = button('lark-doc-share-mobile-retry', '重新选择协作者', () => callHandler(handlers, 'onCancelShareInvitation'))
  mobileConfirm.append(mobileRecipient, mobileRoleLabel, mobileInviteFeedback, mobileSend, mobileQuery, mobileReselect); mobileSearch.append(mobileConfirm)
  mobile.append(mobileIndex, mobileSearch, mobileMemberPage)
  popover.prepend(mobile)
  const mobileMask = text('div', 'lark-doc-share-mobile-mask')
  mobileMask.addEventListener('click', closeMobile)
  popover.addEventListener('keydown', event => {
    if (!mobileVisible || state.permissionDialogOpen) return
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation()
      if (mobilePage !== 'index') { setPage('index'); inviteInput.focus() } else closeMobile()
    } else if (event.key === 'Tab') {
      const nodes = [...popover.querySelectorAll('button,input,select')].filter(node => !node.disabled && !node.closest('[hidden]'))
      const first = nodes[0], last = nodes[nodes.length - 1], active = layer.ownerDocument.activeElement
      if (event.shiftKey && active === first || !event.shiftKey && active === last) { event.preventDefault(); (event.shiftKey ? last : first)?.focus() }
    }
  })

  const permissionLayer = createPermissionView({ handlers })
  const childStates = {}, childFocus = new Map()
  layer.addEventListener('keydown', event => {
    if (!mobileVisible || !state.permissionDialogOpen || !permissionLayer.el.contains(event.target)) return
    const dialog = permissionLayer.el.querySelector(state.passwordDialogOpen ? '.lark-doc-share-password' : state.secureLinkConfirmOpen ? '.lark-doc-share-confirm' : '.lark-doc-permission-dialog')
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation()
      callHandler(handlers, state.passwordDialogOpen ? 'onClosePasswordDialog' : state.secureLinkConfirmOpen ? 'onCancelSecureLinkConfirm' : 'onClosePermissionDialog')
    } else if (event.key === 'Tab') {
      const nodes = [...dialog.querySelectorAll('button,input,select,[tabindex="0"]')].filter(node => !node.disabled && !node.closest('[hidden]'))
      const first = nodes[0], last = nodes[nodes.length - 1], active = layer.ownerDocument.activeElement
      if (event.shiftKey && active === first || !event.shiftKey && active === last) { event.preventDefault(); (event.shiftKey ? last : first)?.focus() }
    }
  })
  layer.appendChild(popover)
  layer.appendChild(permissionLayer.el)

  function render(next) {
    const inviteFocusOwned = mobileSearch.contains(layer.ownerDocument.activeElement)
    Object.assign(state, next || {})
    const restoreChildren = [], openingChildren = []
    for (const key of ['permissionDialogOpen', 'secureLinkConfirmOpen', 'passwordDialogOpen']) {
      if (state[key] && !childStates[key]) { childFocus.set(key, layer.ownerDocument.activeElement); openingChildren.push(key) }
      if (!state[key] && childStates[key]) { restoreChildren.unshift(childFocus.get(key)); childFocus.delete(key) }
      childStates[key] = !!state[key]
    }
    const visible = !!state.sharePopoverOpen && state.shareCanManagePermission !== false && isMobile()
    if (visible && !mobileVisible) { restoreFocus = layer.ownerDocument.activeElement; mobilePage = 'index' }
    popover.classList.toggle('is-mobile-reference', visible)
    if (visible && copyRow.parentNode !== popoverInner) popoverInner.appendChild(copyRow)
    else if (!visible && copyRow.parentNode !== linkCard) linkCard.appendChild(copyRow)
    copyLink.className = visible ? 'lark-doc-share-copy-link' : 'lark-doc-share-btn-filled'
    copyRow.querySelectorAll('.lark-doc-share-channel').forEach(node => { node.hidden = !visible; node.style.display = visible ? '' : 'none' })
    popoverInner.hidden = state.sharePopoverOpen && !['index', 'settings'].includes(mobilePage)
    mobile.hidden = !state.sharePopoverOpen || mobilePage === 'index'
    attr(popover, 'aria-label', visible && mobilePage !== 'index' ? '协作者' : '分享文档')
    setAttr(popover, 'aria-modal', visible && mobilePage !== 'index' ? 'true' : null)
    if (unlock) { unlock(); unlock = null }
    mobileTitle.textContent = mobilePage === 'invite' ? '邀请协作者' : mobilePage === 'settings' ? '权限与链接设置' : '协作者'
    mobileBack.hidden = mobilePage === 'index'; mobileIndex.hidden = mobilePage !== 'index'; mobileSearch.hidden = mobilePage !== 'invite'; mobileMemberPage.hidden = mobilePage !== 'members'
    setInputValue(mobileInput, state.shareInviteQuery)
    const members = state.shareMembers || {}, directory = state.shareDirectory || {}, invitation = state.shareInvitation || {}
    setText(mobileMemberAvatar, members.status === 'ready' && members.items?.length ? members.items[0].principalId.slice(0, 1) : '')
    mobileMemberAvatar.hidden = !mobileMemberAvatar.textContent
    mobileMemberList.replaceChildren()
    if (members.status === 'ready') {
      (members.items || []).forEach(member => {
        const row = text('div', 'lark-doc-share-mobile-member')
        row.append(text('span', 'lark-doc-share-mobile-avatar', member.principalId.slice(0, 1)), text('span', '', member.principalId), text('span', 'lark-doc-share-mobile-scope', member.scopes?.includes('grant.manage') ? '可管理' : member.scopes?.includes('document.write') ? '可编辑' : '可阅读'))
        mobileMemberList.append(row)
      })
      if (!members.items?.length) mobileMemberList.textContent = '暂无协作者'
    } else mobileMemberList.textContent = members.status === 'failed' ? members.error || '无法加载协作者。' : '正在加载协作者…'
    mobileMemberRetry.hidden = members.status !== 'failed'
    const wantedCandidates = new Set((directory.items || []).map(candidate => candidate.principalId))
    directoryRows.forEach((row, id) => { if (!wantedCandidates.has(id)) { row.remove(); directoryRows.delete(id) } })
    syncChildren(mobileResults, (directory.items || []).map(candidate => {
      let row = directoryRows.get(candidate.principalId)
      if (!row) { row = button('lark-doc-share-mobile-member', '', () => callHandler(handlers, 'onSelectShareInviteCandidate', candidate.principalId)); directoryRows.set(candidate.principalId, row) }
      setText(row, candidate.displayName || candidate.principalId)
      attr(row, 'aria-label', `选择协作者 ${candidate.displayName || candidate.principalId}`)
      return { node: row, on: true }
    }))
    mobileSearchRetry.hidden = !['failed', 'blocked'].includes(directory.status)
    setText(mobileStatus, directory.status === 'loading' ? '正在搜索…' : ['failed', 'blocked'].includes(directory.status) ? directory.error : directory.status === 'ready' && !directory.items?.length ? '未找到协作者' : '')
    const confirming = !!invitation.candidate
    mobileConfirm.hidden = !confirming
    mobileInput.hidden = confirming; mobileResults.hidden = confirming; mobileStatus.hidden = confirming
    if (confirming) mobileSearchRetry.hidden = true
    setText(mobileRecipient, invitation.candidate?.displayName || invitation.candidate?.principalId)
    mobileRole.value = invitation.role || 'read'; mobileRole.disabled = invitation.status !== 'confirm'
    mobileSend.hidden = !['confirm', 'sending', 'querying', 'preparing'].includes(invitation.status)
    if (['sending', 'querying'].includes(invitation.status) && mobileConfirm.contains(document.activeElement)) mobileInviteFeedback.focus()
    mobileSend.disabled = invitation.status !== 'confirm'
    mobileQuery.hidden = !(['unknown', 'blocked'].includes(invitation.status) || invitation.status === 'committed' && !invitation.verified)
    mobileReselect.hidden = !(invitation.status === 'failed' || invitation.status === 'committed' && invitation.verified)
    setText(mobileInviteFeedback, invitation.error || (invitation.status === 'preparing' ? '正在确认协作者版本…' : invitation.status === 'sending' ? '正在发送邀请…' : invitation.status === 'querying' ? '正在查询原邀请操作…' : invitation.status === 'committed' && invitation.verified ? '协作者权限已保存' : '确认邀请后，将为此协作者授予所选权限。'))
    syncChildren(layer, [
      { node: mobileMask, on: false },
      { node: popover, on: !!state.sharePopoverOpen },
      { node: permissionLayer.el, on: !!state.permissionDialogOpen },
    ])
    permissionButton.disabled = state.shareCanManagePermission === false
    attr(permissionButton, 'aria-disabled', String(permissionButton.disabled))
    applyStyle(popover, state.sharePopoverStyle || {})
    setInputValue(inviteInput, state.shareInviteQuery)
    const firstMember = state.shareMembers?.status === 'ready' ? state.shareMembers.items?.[0]?.principalId : null
    setText(avatars.children[0], state.shareMembers ? firstMember?.slice(0, 1) || '' : state.shareCollaboratorInitial)
    avatars.children[0].style.display = avatars.children[0].textContent ? '' : 'none'
    setText(avatarMore, state.shareMembers?.status === 'ready' && state.shareMembers.items?.length > 1 ? `+${state.shareMembers.items.length - 1}` : '')
    avatarMore.hidden = !avatarMore.textContent
    const scopeConfigured = !!state.shareLinkState
    orgButton.replaceChildren(...(scopeConfigured ? [['collaborators', '仅协作者'], ['public', '互联网用户']] : [['', '未配置']]).map(([value, label]) => {
      const option = document.createElement('option'); option.value = value; option.textContent = label; return option
    }))
    orgButton.value = state.shareLinkState?.audience || ''
    orgButton.disabled = !state.shareLinkWritable
    orgButton.title = scopeConfigured ? '' : '链接范围设置尚未接入文档服务。'
    linkSelect.disabled = !state.shareLinkWritable
    linkSelect.title = scopeConfigured ? '' : '链接权限设置尚未接入文档服务。'
    setText(linkStatus, state.shareLinkBusy ? '正在读取或保存链接权限…' : state.shareLinkError || (state.shareLinkPending ? '链接操作待确认，请查询原操作。' : !state.shareLinkAvailable ? '链接权限服务尚未接入，当前不可用。' : ''))
    linkReload.hidden = !state.shareLinkAvailable
    linkReload.disabled = !!state.shareLinkBusy
    setText(linkReload, state.shareLinkPending ? '查询原操作' : '重新载入')
    setText(linkTagValue, scopeConfigured ? state.shareLinkPermLabel : '未配置')
    setText(scopeText, scopeConfigured ? state.shareScopeText : '链接范围与权限服务尚未配置')
    linkSelect.textContent = ''
    ;(scopeConfigured ? state.shareLinkPermOptions || [] : ['未配置']).forEach((option) => {
      const item = document.createElement('option')
      item.value = option
      item.textContent = option
      linkSelect.appendChild(item)
    })
    linkSelect.value = scopeConfigured ? state.shareLinkPermLabel || '' : '未配置'
    permissionLayer.update({ ...state, shareMobile: visible })
    if (visible && openingChildren.length) {
      const selector = state.passwordDialogOpen ? '.lark-doc-share-password' : state.secureLinkConfirmOpen ? '.lark-doc-share-confirm' : '.lark-doc-permission-dialog'
      permissionLayer.el.querySelector(`${selector} button:not(:disabled)`)?.focus()
    }
    if (visible && restoreChildren.length) (restoreChildren.find(node => node?.isConnected && !node.closest('[hidden]')) || permissionButton).focus({ preventScroll: true })
    if (visible && !mobileVisible) permissionButton.focus()
    if (visible && mobilePage === 'invite' && invitationStatus !== (invitation.status || 'idle') && inviteFocusOwned) {
      const focus = invitation.status === 'confirm' ? mobileRole : ['unknown', 'blocked'].includes(invitation.status) ? mobileQuery : !confirming ? mobileInput : mobileInviteFeedback
      focus.focus({ preventScroll: true })
    }
    invitationStatus = invitation.status || 'idle'
    if (!visible && mobileVisible && restoreFocus?.isConnected && !state.permissionDialogOpen) restoreFocus.focus({ preventScroll: true })
    mobileVisible = visible
  }

  return { el: layer, update: render, destroy() { unlock?.(); unlock = null; if (layer.parentNode) layer.parentNode.removeChild(layer) } }
}

function createPermissionView(options) {
  const handlers = options.handlers || {}
  let currentState = {}
  const layer = text('div', 'lark-doc-permission-layer')
  const mask = text('div', 'lark-doc-permission-mask')
  mask.addEventListener('click', () => callHandler(handlers, 'onClosePermissionDialog'))
  const dialog = text('div', 'lark-doc-permission-dialog')
  attr(dialog, 'role', 'dialog')
  attr(dialog, 'aria-label', '权限设置')
  const header = text('div', 'lark-doc-permission-header')
  header.appendChild(text('div', 'lark-doc-permission-crumb', '分享文档'))
  const headRow = text('div', 'lark-doc-permission-head-row')
  headRow.appendChild(text('h3', 'lark-doc-permission-title', '权限设置'))
  headRow.appendChild(makeShareClose('lark-doc-share-close', '关闭', () => callHandler(handlers, 'onClosePermissionDialog')))
  header.appendChild(headRow)
  dialog.appendChild(header)
  const body = text('div', 'lark-doc-permission-body')
  const column = text('div', 'lark-doc-permission-column')
  column.appendChild(text('div', 'lark-doc-permission-invite-row', '邀请协作者'))
  column.appendChild(text('div', 'lark-doc-permission-group-title', '对外分享'))
  const search = text('div', 'lark-doc-permission-search')
  const searchInput = document.createElement('input')
  attr(searchInput, 'aria-label', '搜索用户、群组、部门、用户组或智能体')
  searchInput.placeholder = '搜索用户、群组、部门、用户组或智能体'
  searchInput.addEventListener('input', (event) => callHandler(handlers, 'onSetShareInviteQuery', event.target.value))
  search.appendChild(searchInput)
  column.appendChild(search)

  const outside = createToggleRow('shareOutsideOrg', '允许内容被分享到组织外', '', handlers, () => currentState.permissionDialogOpen)
  const outsideDesc = text('div', 'lark-doc-permission-desc', '仅"可管理权限"可以将内容分享到组织外')
  column.appendChild(outside.root)
  column.appendChild(outsideDesc)
  const secure = createSecureSection(handlers)
  column.appendChild(secure.root)
  const detail = text('div', 'lark-doc-permission-link-detail')
  const detailOrg = selectNode('lark-doc-permission-org-btn', '链接范围', '', ['仅协作者', '互联网用户'], value => {
    if (dialog.isConnected && currentState.permissionDialogOpen && currentState.shareLinkWritable) callHandler(handlers, 'onSetShareLinkAudience', value === '互联网用户' ? 'public' : 'collaborators')
  })
  const detailPermission = selectNode('lark-doc-permission-select', '链接权限', '', ['可阅读', '可编辑'], value => {
    if (dialog.isConnected && currentState.permissionDialogOpen && currentState.shareLinkWritable) callHandler(handlers, 'onSetShareLinkPerm', value)
  })
  const detailScope = text('span', 'lark-doc-permission-scope-text')
  detail.appendChild(detailOrg)
  detail.appendChild(detailScope)
  detail.appendChild(detailPermission)
  column.appendChild(detail)
  const feedback = text('div', 'lark-doc-permission-desc')
  attr(feedback, 'role', 'status')
  const feedbackText = text('span')
  const reload = button('lark-doc-share-btn-outlined', '重新载入', () => {
    if (dialog.isConnected && currentState.permissionDialogOpen && currentState.shareLinkAvailable && !currentState.shareLinkBusy) callHandler(handlers, currentState.shareLinkPending ? 'onQueryShareLink' : 'onLoadShareLink')
  })
  feedback.append(feedbackText, reload)
  column.appendChild(feedback)

  const selectRows = [
    ['collaborators', '谁可以查看、添加、移除协作者', '仅组织内的用户可以查看、添加、移除协作者'],
    ['copy', '谁可以复制内容', ''],
    ['duplicate', '谁可以创建副本、打印和下载', ''],
    ['comment', '谁可以评论', ''],
  ]
  const selectNodes = {}
  const staticChildren = [column.children[0], column.children[1], column.children[2], outside.root, outsideDesc, secure.root, detail, feedback]
  selectRows.forEach(([id, title, desc]) => {
    const row = createPermissionSelectRow(id, title, desc, handlers)
    selectNodes[id] = row.select
    staticChildren.push(row.root)
    column.appendChild(row.root)
  })

  const advancedButton = button('lark-doc-permission-collapse-head')
  const advancedCaret = text('span', 'lark-doc-permission-caret')
  attr(advancedCaret, 'aria-hidden', 'true')
  advancedButton.appendChild(advancedCaret)
  advancedButton.appendChild(text('span', '', '更多高级设置'))
  advancedButton.addEventListener('click', () => callHandler(handlers, 'onToggleAdvancedSettings'))
  column.appendChild(advancedButton)
  const advancedChildren = [text('div', 'lark-doc-permission-group-title', '企业信息公开设置')]
  const advancedSelects = {}
  const advancedToggle1 = createToggleRow('ownerLeaderAutoPass', '文档所有者上级', '申请访问时自动通过', handlers, () => currentState.permissionDialogOpen)
  const advancedToggle2 = createToggleRow('ownerLeaderSearchable', '文档所有者上级', '可搜索和访问该文档', handlers, () => currentState.permissionDialogOpen)
  advancedChildren.push(advancedToggle1.root, advancedToggle2.root)
  ;[
    ['visitorAvatar', '谁可以查看访问者头像和点赞者头像', ''],
    ['requestAccess', '谁可以在文档内申请引用文档访问权限', '仅可管理权限的用户可以申请'],
  ].forEach(([id, title, desc]) => {
    const row = createPermissionSelectRow(id, title, desc, handlers)
    advancedSelects[id] = row.select
    advancedChildren.push(row.root)
  })
  body.appendChild(column)
  dialog.appendChild(body)
  layer.appendChild(mask)
  layer.appendChild(dialog)

  const confirm = createConfirmView(handlers)
  const password = createPasswordView(handlers)

  function update(state) {
    currentState = state
    setText(feedbackText, state.shareLinkBusy ? '正在读取或保存链接权限…' : state.shareLinkError || (state.shareLinkPending ? '链接操作待确认，请查询原操作。' : !state.shareLinkAvailable ? '链接权限服务尚未接入，当前不可用。' : '组织高级权限尚未接入；组织免密绕过不可用。'))
    reload.hidden = !state.shareLinkAvailable
    reload.disabled = !!state.shareLinkBusy
    setText(reload, state.shareLinkPending ? '查询原操作' : '重新载入')
    attr(dialog, 'aria-modal', state.shareMobile && !state.passwordDialogOpen && !state.secureLinkConfirmOpen ? 'true' : null)
    setInputValue(searchInput, state.shareInviteQuery)
    outside.update(state.permissionValues || {}, !!state.shareLinkWritable)
    secure.update(state)
    advancedToggle1.update(state.permissionValues || {}, false)
    advancedToggle2.update(state.permissionValues || {}, false)
    detailOrg.disabled = !state.shareLinkWritable
    detailOrg.value = state.shareLinkState?.audience === 'public' ? '互联网用户' : '仅协作者'
    detailPermission.disabled = !state.shareLinkWritable
    detailPermission.value = state.shareLinkState?.permission === 'edit' ? '可编辑' : '可阅读'
    setText(detailScope, state.shareDialogScopeText)
    Object.keys(selectNodes).forEach((id) => {
      const node = selectNodes[id]
      node.disabled = true; node.title = '此项组织权限服务尚未接入，当前不可用。'
      node.textContent = ''
      const item = document.createElement('option'); item.value = ''; item.textContent = '服务尚未接入'; node.appendChild(item)
    })
    Object.keys(advancedSelects).forEach((id) => {
      const node = advancedSelects[id]
      node.disabled = true; node.title = '此项组织权限服务尚未接入，当前不可用。'
      node.textContent = ''
      const item = document.createElement('option'); item.value = ''; item.textContent = '服务尚未接入'; node.appendChild(item)
    })
    setText(advancedCaret, state.permissionAdvancedOpen ? '▾' : '▸')
    setAttr(advancedButton, 'aria-expanded', state.permissionAdvancedOpen ? 'true' : 'false')
    syncChildren(column, [
      ...staticChildren.map((node) => ({ node, on: true })),
      { node: advancedButton, on: true },
      ...advancedChildren.map((node) => ({ node, on: !!state.permissionAdvancedOpen })),
    ])
    syncChildren(layer, [
      { node: mask, on: true },
      { node: dialog, on: true },
      { node: confirm.el, on: !!state.secureLinkConfirmOpen },
      { node: password.el, on: !!state.passwordDialogOpen },
    ])
    confirm.update(state)
    password.update(state)
  }

  return { el: layer, update }
}

function createToggleRow(id, title, desc, handlers, isOpen) {
  const root = text('div', 'lark-doc-permission-item')
  const row = text('div', 'lark-doc-permission-row')
  row.appendChild(text('span', 'lark-doc-permission-item-title', title))
  const toggle = button('lark-doc-permission-switch')
  attr(toggle, 'role', 'switch')
  attr(toggle, 'aria-label', desc ? `${title} ${desc}` : title)
  toggle.addEventListener('click', () => { if (root.isConnected && isOpen() && !toggle.disabled) callHandler(handlers, 'onTogglePermissionValue', id) })
  row.appendChild(toggle)
  root.appendChild(row)
  if (desc) root.appendChild(text('div', 'lark-doc-permission-desc', desc))
  return { root, update(values, canManage) {
    const on = !!values[id]
    toggle.classList.toggle('is-on', on)
    attr(toggle, 'aria-checked', on ? 'true' : 'false')
    attr(toggle, 'data-capability', 'canManagePermission')
    toggle.disabled = canManage === false
    attr(toggle, 'aria-disabled', String(toggle.disabled))
  } }
}

function createPermissionSelectRow(id, title, desc, handlers) {
  const root = text('div', 'lark-doc-permission-item')
  const row = text('div', 'lark-doc-permission-row')
  row.appendChild(text('span', 'lark-doc-permission-item-title', title))
  root.appendChild(row)
  const value = text('div', 'lark-doc-permission-value')
  const select = selectNode('lark-doc-permission-select', title, '', [], (next) => callHandler(handlers, 'onSetPermissionValue', id, next))
  value.appendChild(select)
  root.appendChild(value)
  if (desc) root.appendChild(text('div', 'lark-doc-permission-desc', desc))
  return { root, select }
}

function createSecureSection(handlers) {
  let current = {}
  const root = text('div', 'lark-doc-secure-link')
  const operation = text('div', 'lark-doc-secure-link-operation')
  const checkbox = document.createElement('input')
  checkbox.className = 'lark-doc-secure-link-checkbox'
  checkbox.type = 'checkbox'
  attr(checkbox, 'aria-label', '启用加密链接')
  checkbox.addEventListener('change', () => { if (root.isConnected && !checkbox.disabled) callHandler(handlers, 'onToggleSecureLink') })
  operation.appendChild(checkbox)
  const description = text('span', 'lark-doc-secure-link-desc', '启用加密链接')
  description.addEventListener('click', () => { if (root.isConnected && !checkbox.disabled) callHandler(handlers, 'onToggleSecureLink') })
  operation.appendChild(description)
  root.appendChild(operation)
  const passwordArea = text('div', 'lark-doc-secure-link-password-area')
  const passwordRow = text('div', 'lark-doc-secure-link-password-row')
  passwordRow.appendChild(text('span', 'lark-doc-secure-link-password-label', '密码：'))
  const passwordValue = button('lark-doc-secure-link-password-val')
  const copyPassword = () => { if (root.isConnected && current.shareLinkWritable && current.shareLinkState?.passwordAvailable) callHandler(handlers, 'onCopyLinkAndPassword') }
  passwordValue.addEventListener('click', copyPassword)
  passwordRow.appendChild(passwordValue)
  const editPassword = button('lark-doc-secure-link-edit', '', () => { if (root.isConnected && !editPassword.disabled) callHandler(handlers, 'onOpenPasswordDialog') })
  attr(editPassword, 'aria-label', '修改密码')
  editPassword.appendChild(svgIcon('pencil'))
  passwordRow.appendChild(editPassword)
  const copy = button('lark-doc-secure-link-copy-btn', '复制链接和密码', copyPassword)
  passwordRow.appendChild(copy)
  passwordArea.appendChild(passwordRow)
  const tip = text('p', 'lark-doc-secure-link-tip', SECURE_LINK_TIP)
  root.appendChild(passwordArea)
  root.appendChild(tip)
  return {
    root,
    update(state) {
      current = state
      checkbox.disabled = !state.shareLinkWritable || !state.secureLinkEnabled && !state.shareLinkState?.cryptoReady
      editPassword.disabled = !state.shareLinkWritable || !state.shareLinkState?.cryptoReady
      copy.disabled = passwordValue.disabled = !state.shareLinkWritable || !state.shareLinkState?.passwordAvailable
      checkbox.checked = !!state.secureLinkEnabled
      setText(passwordValue, state.secureLinkPassword)
      syncChildren(root, [
        { node: operation, on: true },
        { node: passwordArea, on: !!state.secureLinkEnabled },
        { node: tip, on: !!state.secureLinkEnabled },
      ])
    },
  }
}

function createConfirmView(handlers) {
  let current = {}
  const el = text('div', 'lark-doc-share-confirm')
  attr(el, 'role', 'dialog'); attr(el, 'aria-label', '提示')
  const header = text('div', 'lark-doc-share-confirm-header')
  const row = text('div', 'lark-doc-permission-head-row')
  row.appendChild(text('h3', 'lark-doc-share-confirm-title', '提示'))
  row.appendChild(makeShareClose('lark-doc-share-close', '关闭', () => callHandler(handlers, 'onCancelSecureLinkConfirm')))
  header.appendChild(row)
  const body = text('div', 'lark-doc-share-confirm-body')
  SECURE_CONFIRM_MESSAGES.forEach((message, index) => {
    const paragraph = text('p', 'lark-doc-share-confirm-text')
    if (index === 2) {
      paragraph.appendChild(document.createTextNode('具体说明及安全事项请查看'))
      paragraph.appendChild(text('span', 'lark-doc-share-confirm-link', '服务协议'))
      paragraph.appendChild(document.createTextNode('和'))
      paragraph.appendChild(text('span', 'lark-doc-share-confirm-link', '隐私政策'))
      paragraph.appendChild(document.createTextNode('。'))
    } else paragraph.textContent = message
    body.appendChild(paragraph)
  })
  const footer = text('div', 'lark-doc-share-confirm-footer')
  footer.appendChild(button('lark-doc-share-btn-outlined', '取消', () => callHandler(handlers, 'onCancelSecureLinkConfirm')))
  const confirm = button('lark-doc-share-btn-filled', '确认', () => { if (el.isConnected && current.secureLinkConfirmOpen && !confirm.disabled) callHandler(handlers, 'onConfirmSecureLink') })
  footer.appendChild(confirm)
  el.appendChild(header); el.appendChild(body); el.appendChild(footer)
  return { el, update(state) { current = state; confirm.disabled = !state.shareLinkWritable || !state.shareLinkState?.cryptoReady } }
}

function createPasswordView(handlers) {
  let current = {}
  const el = text('div', 'lark-doc-share-password')
  attr(el, 'role', 'dialog'); attr(el, 'aria-label', '修改密码')
  const header = text('div', 'lark-doc-share-password-header')
  header.appendChild(text('h3', 'lark-doc-share-password-title', '修改密码'))
  header.appendChild(makeShareClose('lark-doc-share-close', '关闭', () => callHandler(handlers, 'onClosePasswordDialog')))
  const body = text('div', 'lark-doc-share-password-body')
  const content = text('div', 'lark-doc-share-password-content')
  const inputRow = text('div', 'lark-doc-share-password-input-row')
  const inputWrap = text('div', 'lark-doc-share-password-input')
  const input = document.createElement('input'); attr(input, 'aria-label', '请输入新密码'); input.placeholder = '请输入新密码'
  input.addEventListener('input', (event) => { if (el.isConnected && current.passwordDialogOpen && !input.disabled) callHandler(handlers, 'onSetPasswordDraft', event.target.value) })
  const clear = button('lark-doc-share-password-clear', '✕', () => callHandler(handlers, 'onSetPasswordDraft', ''))
  attr(clear, 'aria-label', '清空')
  inputWrap.appendChild(input); inputWrap.appendChild(clear)
  inputRow.appendChild(inputWrap)
  const random = button('lark-doc-share-btn-outlined lark-doc-share-password-random', '', () => callHandler(handlers, 'onRandomizePasswordDraft'))
  random.appendChild(svgIcon('gear')); random.appendChild(text('span', '', '随机生成'))
  inputRow.appendChild(random); content.appendChild(inputRow)
  const rules = text('div', 'lark-doc-share-password-rules'); content.appendChild(rules)
  content.appendChild(text('p', 'lark-doc-share-password-hints', '安全提示：请勿使用个人常用或其他平台中的密码'))
  const footer = text('div', 'lark-doc-share-password-footer')
  footer.appendChild(button('lark-doc-share-btn-outlined', '取消', () => callHandler(handlers, 'onClosePasswordDialog')))
  const save = button('lark-doc-share-btn-filled', '保存', () => { if (el.isConnected && current.passwordDialogOpen && !save.disabled) callHandler(handlers, 'onSaveSharePassword') })
  footer.appendChild(save)
  content.appendChild(footer); body.appendChild(content); el.appendChild(header); el.appendChild(body)
  function update(state) {
    current = state
    input.disabled = !state.shareLinkWritable
    clear.disabled = random.disabled = !state.shareLinkWritable
    setInputValue(input, state.passwordDraft)
    save.disabled = !!state.sharePasswordSaveDisabled
    setAttr(save, 'aria-disabled', state.sharePasswordSaveDisabled ? 'true' : 'false')
    clear.style.display = state.passwordDraft ? '' : 'none'
    rules.textContent = ''
    ;(state.sharePasswordRules || []).forEach((rule) => {
      const row = text('div', `lark-doc-share-password-rule is-${rule.state}`)
      const icon = text('span', 'lark-doc-share-password-rule-icon')
      icon.innerHTML = rule.state === 'error' ? '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="m7.5 8.5 9 7m0-7-9 7" stroke="var(--ld-share-surface)" stroke-width="2"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="m7 12 3.2 3.2L17 8.8" stroke="var(--ld-share-surface)" stroke-width="2"/></svg>'
      row.appendChild(icon); row.appendChild(text('span', 'lark-doc-share-password-rule-text', rule.text)); rules.appendChild(row)
    })
    syncChildren(inputWrap, [{ node: input, on: true }, { node: clear, on: !!state.passwordDraft }])
  }
  return { el, update }
}

function createExportView(options) {
  const handlers = options.handlers || {}
  let current = {}
  const visible = () => panel.isConnected && current.exportOpen
  const layer = text('div', 'lark-doc-export-layer')
  const toast = text('div', 'lark-doc-export-toast'); attr(toast, 'role', 'status'); attr(toast, 'aria-live', 'polite')
  const toastInner = text('div', 'lark-doc-export-toast-inner'), toastMessage = text('span')
  const query = button('lark-doc-export-query', '查询原任务', () => {
    if (toast.isConnected && current.exportPendingOperationId && current.exportCanExport && !current.exportBusy) callHandler(handlers, 'onQueryRemoteExport')
  })
  toastInner.append(toastMessage, query); toast.appendChild(toastInner)
  const backdrop = text('div', 'lark-doc-export-backdrop')
  backdrop.addEventListener('click', (event) => { if (visible() && event.target === backdrop) callHandler(handlers, 'onCancelExport') })
  const panel = text('section', 'lark-doc-export-panel'); attr(panel, 'role', 'dialog'); attr(panel, 'aria-modal', 'true')
  const header = text('header', 'lark-doc-export-header')
  const title = text('strong', 'lark-doc-export-title')
  header.appendChild(title)
  header.appendChild(makeClose('lark-doc-export-close', '关闭导出设置', () => { if (visible()) callHandler(handlers, 'onCloseExportDialog') }))
  const routeBox = text('div', 'lark-doc-export-route')
  const routeLabel = text('label', '', '导出方式'), route = document.createElement('select')
  attr(route, 'aria-label', '导出方式')
  for (const [value, label] of [['remote', '文档服务'], ['local', '本地导出']]) { const option = text('option', '', label); option.value = value; route.appendChild(option) }
  route.addEventListener('change', () => { if (visible() && !route.disabled) callHandler(handlers, 'onSelectExportRoute', route.value) })
  routeLabel.appendChild(route)
  const description = text('p', 'lark-doc-export-route-description'); attr(description, 'role', 'status')
  routeBox.append(routeLabel, description)
  const body = text('div', 'lark-doc-export-body'); body.appendChild(text('span', 'lark-doc-export-range-label', '内容范围'))
  const radios = text('div', 'lark-doc-export-radio-group'); attr(radios, 'role', 'radiogroup'); attr(radios, 'aria-label', '内容范围')
  body.appendChild(radios)
  const footer = text('footer', 'lark-doc-export-footer'); const buttons = text('div', 'lark-doc-export-btns')
  buttons.appendChild(button('lark-doc-export-cancel', '取消', () => { if (visible()) callHandler(handlers, 'onCancelExport') }))
  const submit = button('lark-doc-export-submit', '导出', () => { if (visible() && !submit.disabled) callHandler(handlers, 'onSubmitExport') }); buttons.appendChild(submit); footer.appendChild(buttons)
  const formats = text('div', 'lark-doc-export-formats'); attr(formats, 'aria-label', '下载格式')
  for (const [id, label] of [['word', 'Word'], ['pdf', 'PDF'], ['image', '图片'], ['markdown', 'Markdown']]) {
    const choice = button('lark-doc-export-format', label, () => { if (visible() && !choice.disabled) callHandler(handlers, 'onChooseExportFormat', id) })
    choice.dataset.exportFormat = id
    if (id === 'image') { choice.disabled = true; choice.title = '未配置图片导出服务'; choice.setAttribute('aria-description', choice.title) }
    formats.appendChild(choice)
  }
  const unavailable = text('p', 'lark-doc-export-format-notice', '图片导出尚未配置，暂不可用。'); attr(unavailable, 'role', 'status'); formats.appendChild(unavailable)
  panel.appendChild(header); panel.appendChild(formats); panel.appendChild(routeBox); panel.appendChild(body); panel.appendChild(footer); backdrop.appendChild(panel)
  layer.appendChild(toast); layer.appendChild(backdrop)
  function update(state) {
    current = state
    setText(toastMessage, state.exportToast || (state.exportPendingOperationId ? state.exportCanExport ? '原导出请求待查询。' : '原导出请求已保留，当前无权查询。' : ''))
    query.hidden = !state.exportPendingOperationId
    query.disabled = !state.exportCanExport || !!state.exportBusy
    routeBox.hidden = !!state.exportFormatPicker || !state.exportRemoteAvailable && state.exportRoute !== 'remote'
    route.value = state.exportRoute === 'remote' ? 'remote' : 'local'
    route.disabled = !state.exportCanExport || !!state.exportBusy
    route.querySelector('[value=remote]').disabled = !state.exportRemoteAvailable
    setText(description, state.exportRouteDescription)
    setText(title, state.exportPanelTitle)
    attr(panel, 'aria-label', state.exportPanelTitle)
    panel.classList.toggle('is-format-picker', !!state.exportFormatPicker)
    formats.hidden = !state.exportFormatPicker
    body.hidden = footer.hidden = !!state.exportFormatPicker
    for (const choice of formats.querySelectorAll('[data-export-format]')) choice.disabled = !state.exportCanExport || choice.dataset.exportFormat === 'image'
    const watermark = state.outputWatermarkAttributes || {}
    setAttr(panel, 'data-watermark', watermark['data-watermark'])
    setAttr(panel, 'data-watermark-text', watermark['data-watermark-text'])
    attr(submit, 'data-capability', 'canExport')
    submit.disabled = !!state.exportSubmitDisabled
    attr(submit, 'aria-disabled', state.exportSubmitDisabled ? 'true' : 'false')
    submit.classList.toggle('is-disabled', !!state.exportSubmitDisabled)
    radios.textContent = ''
    ;(state.exportScopeOptions || []).forEach((option) => {
      const label = text('label', 'lark-doc-export-option'); label.classList.toggle('is-disabled', !state.exportCanExport)
      attr(label, 'data-capability', 'canExport')
      attr(label, 'aria-disabled', String(!state.exportCanExport))
      const radio = text('span', 'lark-doc-export-radio')
      const input = document.createElement('input'); input.className = 'lark-doc-export-radio-input'; input.type = 'radio'; input.name = 'lark-doc-export-scope'; input.value = option.value; input.checked = state.exportScopeValue === option.value; input.disabled = !state.exportCanExport
      input.addEventListener('change', () => { if (visible() && input.isConnected && !input.disabled) callHandler(handlers, 'onSelectExportScope', option.value) })
      const wallpaper = text('span', 'lark-doc-export-radio-wallpaper'); if (input.checked) wallpaper.appendChild(text('span', 'lark-doc-export-radio-ink'))
      radio.appendChild(input); radio.appendChild(wallpaper); label.appendChild(radio); label.appendChild(text('span', 'lark-doc-export-option-text', option.label)); radios.appendChild(label)
    })
    syncChildren(layer, [{ node: toast, on: !!state.exportToast || !!state.exportPendingOperationId }, { node: backdrop, on: !!state.exportOpen }])
  }
  return { el: layer, update, destroy() { if (layer.parentNode) layer.parentNode.removeChild(layer) } }
}

function createImageShareView(handlers) {
  const root = text('div', 'lark-doc-image-share-layer')
  const dialog = text('section', 'lark-doc-image-share-dialog')
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-label', '分享给')
  const header = text('header', 'lark-doc-image-share-header')
  const title = text('strong', '', '分享给')
  header.appendChild(title)
  const close = button('lark-doc-image-share-close', '', () => {
    if (mobile && confirming) { confirming = false; renderLayout(); renderResults(); return }
    callHandler(handlers, 'onImageShareClose')
  })
  close.setAttribute('aria-label', '关闭分享')
  close.appendChild(iconNode('close', 18))
  header.appendChild(close)
  const body = text('div', 'lark-doc-image-share-body')
  const selector = text('div', 'lark-doc-image-share-selector')
  const chips = text('div', 'lark-doc-image-share-recipients')
  const input = document.createElement('input')
  input.placeholder = '搜索'
  input.setAttribute('aria-label', '搜索接收人或会话')
  input.setAttribute('role', 'combobox')
  input.setAttribute('aria-autocomplete', 'list')
  const results = text('div', 'lark-doc-image-share-results')
  results.setAttribute('role', 'listbox')
  results.setAttribute('aria-label', '接收人或会话')
  const media = root.ownerDocument.defaultView.matchMedia?.('(max-width: 760px) and (pointer: coarse)')
  let current = null, available = false, unavailableReason = '', searchOpen = false, multi = false, activeIndex = 0, network = createNetworkPolicy()
  let mobile = false, confirming = false, destroyed = false, unlock = null
  const search = text('div', 'lark-doc-image-share-search')
  search.appendChild(iconNode('search', 20))
  const createGroup = button('lark-doc-image-share-create-group', '创建群组并转发')
  createGroup.disabled = true
  createGroup.title = '未配置创建群组并转发服务'
  const groupArrow = iconNode('chevron-right', 18); groupArrow.setAttribute('aria-hidden', 'true'); createGroup.appendChild(groupArrow)
  const mode = button('lark-doc-image-share-mode', '多选', () => {
    if (!current || current.sending) return
    if (multi && current.recipients.length) { confirming = true; searchOpen = false }
    else { multi = !multi; confirming = false }
    renderLayout(); renderResults(); paintPreview()
  })
  const summary = text('div', 'lark-doc-image-share-summary')
  const choose = item => {
    if (!current || current.sending || !root.isConnected || (mobile && confirming)) return
    const clearQuery = !multi && !!current.query
    if (mobile && !multi) confirming = !current.recipients.some(value => value.id === item.id && value.kind === item.kind)
    if (!multi) searchOpen = false
    callHandler(handlers, 'onImageShareRecipient', item.id, item.kind)
    if (clearQuery) callHandler(handlers, 'onImageShareQuery', '')
    renderResults()
  }
  function recipientAvatar(item) {
    const avatar = text('span', 'lark-doc-image-share-avatar', item.kind === 'chat' ? '群' : String(item.name || '').slice(0, 1))
    if (safeUrl(item.avatar, true) && network.allows(item.avatar)) {
      const img = document.createElement('img')
      img.src = item.avatar; img.alt = ''
      avatar.replaceChildren(img)
    }
    return avatar
  }
  function renderResults() {
    results.replaceChildren()
    const visible = mobile ? !confirming : searchOpen
    results.hidden = !visible
    input.setAttribute('aria-expanded', String(visible))
    if (!current) return
    activeIndex = Math.min(activeIndex, Math.max(0, current.results.length - 1))
    const heading = text('div', 'lark-doc-image-share-results-head', current.query ? '搜索结果' : mobile ? '接收人或会话' : '最近对话')
    heading.hidden = !!current.query && (current.loading || !current.results.length)
    const mode = button('', multi ? '切换单选' : '切换多选', () => { multi = !multi; renderResults() })
    mode.addEventListener('mousedown', event => event.preventDefault())
    if (!mobile) heading.appendChild(mode)
    results.appendChild(heading)
    if (current.loading) results.appendChild(text('div', 'lark-doc-image-share-empty', '搜索中…'))
    else if (!current.results.length) { if (!unavailableReason) results.appendChild(text('div', 'lark-doc-image-share-empty', '没有匹配结果，换个关键词试试吧')) }
    else current.results.forEach((item, index) => {
      const selected = current.recipients.some(value => value.id === item.id && value.kind === item.kind)
      const row = button(`lark-doc-image-share-result${index === activeIndex ? ' is-active' : ''}`, '', () => choose(item))
      if (multi) row.appendChild(text('span', `lark-doc-image-share-check${selected ? ' is-checked' : ''}`, selected ? '✓' : ''))
      const avatar = recipientAvatar(item)
      const name = text('span', 'lark-doc-image-share-result-name', item.name)
      if (current.query && item.department) name.appendChild(text('small', '', item.department))
      row.append(avatar, name)
      if (!multi && selected) row.appendChild(text('span', 'lark-doc-image-share-selected', '✓'))
      row.setAttribute('role', 'option')
      row.setAttribute('aria-selected', String(selected))
      row.addEventListener('mousedown', event => event.preventDefault())
      results.appendChild(row)
    })
  }
  input.addEventListener('focus', () => { searchOpen = true; renderResults() })
  input.addEventListener('click', () => { if (current && !current.sending) { searchOpen = true; renderResults() } })
  input.addEventListener('input', () => { searchOpen = true; activeIndex = 0; callHandler(handlers, 'onImageShareQuery', input.value) })
  input.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229 || !current || current.sending) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); searchOpen = true
      const count = current.results.length
      activeIndex = count ? (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + count) % count : 0
      renderResults()
      results.querySelector('.is-active')?.scrollIntoView?.({ block: 'nearest' })
    } else if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && searchOpen) {
      event.preventDefault(); event.stopPropagation()
      if (current.results[activeIndex] && !current.loading) choose(current.results[activeIndex])
    } else if (event.key === 'Backspace' && !input.value && current.recipients.length) {
      choose(current.recipients[current.recipients.length - 1])
    }
  })
  selector.append(chips, input, results)
  const preview = text('div', 'lark-doc-image-share-preview')
  const frame = text('figure', 'lark-doc-image-share-preview-frame')
  const excerpt = text('div', 'lark-doc-image-share-excerpt')
  const before = text('div', 'lark-doc-image-share-context is-before')
  const after = text('div', 'lark-doc-image-share-context is-after')
  const viewport = text('div')
  const image = document.createElement('img')
  const caption = text('figcaption')
  viewport.appendChild(image)
  excerpt.append(before, viewport, caption, after)
  frame.appendChild(excerpt)
  function paintContext(node, value) {
    if (value?.dom) node.replaceChildren(cloneShareExcerpt(value.dom, network))
    else node.textContent = value?.text || ''
  }
  function paintSelectionPreview() {
    const snapshot = current.preview
    const unsupported = !!snapshot.unsupported
    excerpt.classList.toggle('is-unsupported', unsupported)
    let content
    const width = unsupported ? 344 : Math.max(1, snapshot.width)
    const height = unsupported ? 198 : Math.max(1, snapshot.height)
    if (unsupported) {
      content = text('section', 'lark-doc-selection-share-unsupported')
      const title = text('header')
      const compass = iconNode('share-embed-compass', 16)
      compass.setAttribute('aria-hidden', 'true')
      title.append(compass, document.createTextNode('内嵌网页'))
      const body = text('div')
      const illustration = iconNode('share-unsupported-illustration', 75, 'lark-doc-selection-share-illustration')
      illustration.style.height = '70px'
      illustration.setAttribute('aria-hidden', 'true')
      body.append(illustration, text('p', '', '该内容暂不支持预览'))
      content.append(title, body)
    } else if (snapshot.dom) content = cloneShareExcerpt(snapshot.dom, network)
    else content = text('div', '', current.selection.text)
    const factor = unsupported ? 1 : Math.min(1, 340 / width)
    const excerptHeight = unsupported ? 286 : Math.ceil(height * factor + 122)
    const scale = Math.min(320 / 400, 254 / excerptHeight)
    viewport.className = 'lark-doc-selection-share-content ProseMirror'
    applyStyle(viewport, { position: 'relative', width: `${unsupported ? 344 : 340}px`, height: `${height * factor}px`, minHeight: '0', padding: '0', overflow: 'hidden', flexShrink: '0' })
    Object.assign(content.style, { width: `${width}px`, minWidth: '0', maxWidth: 'none', margin: '0', transform: `scale(${factor})`, transformOrigin: 'top left' })
    viewport.replaceChildren(content)
    Object.assign(excerpt.style, { height: `${excerptHeight}px`, transform: `scale(${scale})` })
    Object.assign(frame.style, { width: `${400 * scale + 2}px`, height: `${excerptHeight * scale}px` })
    paintContext(before, current.excerpt?.before)
    paintContext(after, current.excerpt?.after)
  }
  function paintPreview() {
    if (!current || (mobile && !confirming)) return
    if (current.target === 'selection') { paintSelectionPreview(); return }
    if (excerpt.classList.contains('is-unsupported')) applyStyle(viewport, {})
    excerpt.classList.remove('is-unsupported')
    viewport.className = ''
    if (viewport.firstChild !== image || viewport.childNodes.length !== 1) viewport.replaceChildren(image)
    const width = current.image.naturalWidth || image.naturalWidth, height = current.image.naturalHeight || image.naturalHeight
    const natural = imageCropGeometry(width, height, current.image.crop)
    if (!natural) return
    const displayWidth = Math.min((Number(current.image.width) || width) * natural.width / width, 340)
    const factor = displayWidth / natural.width
    const geometry = imageCropGeometry(width * factor, height * factor, current.image.crop)
    const styles = imageCropStyles(geometry)
    const excerptHeight = Math.ceil(geometry.height + 122 + (current.image.caption ? 28 : 0))
    const scale = Math.min(320 / 400, 254 / excerptHeight)
    Object.assign(excerpt.style, { height: `${excerptHeight}px`, transform: `scale(${scale})` })
    Object.assign(frame.style, { width: `${400 * scale + 2}px`, height: `${excerptHeight * scale}px` })
    applyStyle(viewport, styles.viewport)
    Object.assign(image.style, styles.image, { maxHeight: 'none' })
    paintContext(before, current.excerpt?.before)
    paintContext(after, current.excerpt?.after)
  }
  image.addEventListener('load', paintPreview)
  preview.appendChild(frame)
  const message = document.createElement('textarea')
  message.className = 'lark-doc-image-share-message'
  message.placeholder = '添加留言（内容会发送到飞书会话）'
  message.setAttribute('aria-label', '添加留言')
  message.addEventListener('input', () => callHandler(handlers, 'onImageShareMessage', message.value))
  body.append(selector, preview, message)
  const error = text('div', 'lark-doc-image-share-error')
  error.setAttribute('role', 'alert')
  const serviceNotice = text('div', 'lark-doc-image-share-empty lark-doc-image-share-service-notice')
  serviceNotice.setAttribute('role', 'status')
  const footer = text('footer', 'lark-doc-image-share-footer')
  const cancel = button('', '取消', () => callHandler(handlers, 'onImageShareClose'))
  const send = button('is-primary', '发送 (⌘+Enter)', () => { if (current && root.isConnected && !send.disabled) callHandler(handlers, 'onImageShareSend') })
  footer.append(cancel, send)
  dialog.append(header, body, error, footer)
  root.appendChild(dialog)
  root.addEventListener('mousedown', event => {
    if (event.target === root) { callHandler(handlers, 'onImageShareClose'); return }
    if (!selector.contains(event.target)) { searchOpen = false; renderResults() }
  })
  root.addEventListener('keydown', event => {
    if (!current || event.isComposing || event.keyCode === 229) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); callHandler(handlers, 'onImageShareClose') }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !send.disabled) { event.preventDefault(); callHandler(handlers, 'onImageShareSend') }
  })
  function renderLayout() {
    mobile = !!media?.matches
    if (!current?.recipients.length) confirming = false
    dialog.classList.toggle('is-mobile', mobile)
    dialog.classList.toggle('is-confirming', mobile && confirming)
    title.textContent = mobile && confirming ? '确认分享' : '分享给'
    close.setAttribute('aria-label', mobile && confirming ? '返回接收人' : '关闭分享')
    close.replaceChildren(iconNode(mobile && confirming ? 'chevronDown' : 'close', mobile ? 24 : 18))
    mode.textContent = multi ? current?.recipients.length ? `确定 (${current.recipients.length})` : '取消多选' : '多选'
    mode.setAttribute('aria-label', multi && current?.recipients.length ? '确认接收人' : multi ? '取消多选' : '多选接收人')
    mode.disabled = !!current?.sending
    mode.setAttribute('aria-pressed', String(multi))
    syncChildren(header, [{ node: title, on: true }, { node: close, on: true }, { node: mode, on: mobile && !confirming }])
    if (mobile) {
      if (input.parentNode !== search) search.appendChild(input)
      syncChildren(selector, [{ node: search, on: true }, { node: chips, on: !!current?.recipients.length }, { node: createGroup, on: true }, { node: results, on: true }])
    } else syncChildren(selector, [{ node: chips, on: true }, { node: input, on: true }, { node: results, on: true }])
    summary.textContent = `发送给：${(current?.recipients || []).map(item => item.name).join('、')}`
    syncChildren(body, [{ node: selector, on: !mobile || !confirming }, { node: summary, on: mobile && confirming },
      { node: preview, on: !mobile || confirming }, { node: message, on: !mobile || confirming }])
    syncChildren(dialog, [{ node: header, on: true }, { node: serviceNotice, on: !!unavailableReason }, { node: body, on: true }, { node: error, on: true }, { node: footer, on: !mobile || confirming }])
    send.disabled = !current || current.sending || !current.recipients.length || !available || (mobile && !confirming)
    send.textContent = current?.sending ? '发送中…' : mobile ? '发送' : '发送 (⌘+Enter)'
    if (mobile && current && root.isConnected && !unlock) unlock = lockPageScroll(root.ownerDocument.body)
    else if ((!mobile || !current) && unlock) { unlock(); unlock = null }
  }
  const mediaChanged = () => { if (!destroyed && current) { renderLayout(); renderResults(); paintPreview() } }
  media?.addEventListener?.('change', mediaChanged)
  if (!media?.addEventListener) media?.addListener?.(mediaChanged)
  return {
    el: root,
    update(state) {
      if (destroyed) return
      const opening = !current && !!state.imageShare
      current = state.imageShare
      available = !!state.imageShareAvailable
      unavailableReason = state.imageShareUnavailableReason || ''
      serviceNotice.textContent = unavailableReason
      network = createNetworkPolicy(state.imageShareNetwork)
      root.hidden = !current
      if (!current) { searchOpen = false; multi = false; confirming = false; renderLayout(); return }
      if (opening) activeIndex = 0
      if (input.value !== current.query) input.value = current.query
      input.placeholder = current.recipients.length ? '' : '搜索'
      if (message.value !== current.message) message.value = current.message
      chips.replaceChildren()
      for (const item of current.recipients) {
        const chip = button('', '', () => choose(item))
        chip.append(recipientAvatar(item), document.createTextNode(`${item.name} ×`))
        chip.setAttribute('aria-label', `移除${item.name}`)
        chips.appendChild(chip)
      }
      if (current.target === 'selection') image.removeAttribute('src')
      else {
        const previewSrc = safeUrl(current.image.src, true) && network.allows(current.image.src) ? current.image.src : BLOCKED_IMAGE_PLACEHOLDER
        if (image.getAttribute('src') !== previewSrc) image.src = previewSrc
        image.alt = current.image.alt || '分享图片预览'
      }
      renderLayout()
      paintPreview()
      caption.textContent = current.image?.caption || ''
      error.textContent = current.error || ''
      error.hidden = !current.error
      input.disabled = message.disabled = current.sending
      send.title = available ? '' : unavailableReason || '分享暂不可用'
      renderResults()
      if (opening) queueMicrotask(() => { if (!destroyed && current && root.isConnected) (mobile ? close : input).focus({ preventScroll: true }) })
    },
    destroy() {
      destroyed = true; current = null; unlock?.(); unlock = null
      media?.removeEventListener?.('change', mediaChanged)
      if (!media?.removeEventListener) media?.removeListener?.(mediaChanged)
    },
  }
}

export function createDocumentOverlays(options = {}) {
  let destroyed = false
  const host = options.host || null
  const handlers = options.handlers || {}
  const share = createShareView({ handlers, host })
  const exportView = createExportView({ handlers })
  const imageShare = createImageShareView(handlers)
  const el = text('div', 'lark-doc-p6b-layer')
  el.appendChild(share.el)
  el.appendChild(exportView.el)
  function update(state) {
    if (destroyed) return
    mountNode(host, el, true)
    share.update(state)
    exportView.update(state)
    mountNode(el, imageShare.el, !!state.imageShare)
    imageShare.update(state)
  }
  return {
    el,
    update,
    destroy() { if (destroyed) return; destroyed = true; share.destroy(); exportView.destroy(); imageShare.destroy(); if (el.parentNode) el.parentNode.removeChild(el) },
  }
}

/** Preserve the synchronous standalone renderer, including permission denial. */
export function createOverlays(options = {}) {
  const dialogs = createDocumentOverlays(options)
  const entry = createShareEntry({ ...options, host: dialogs.el })
  return { el: dialogs.el,
    update(state) { dialogs.update(state); entry.update(state) },
    destroy() { entry.destroy(); dialogs.destroy() },
  }
}
