/**
 * 分享 / 导出浮层的共用积木：建元素、按钮、属性、内联 SVG、受控输入回写、下拉。
 *
 * 从 `ui/overlays.js` 原样搬出，函数体一行未改。四个浮层视图都要用这几颗，
 * 单独成文件免得每个视图各存一份。
 */
import { iconNode } from './icon'
import { SHARE_ICON_COLORS } from './palette'

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

export {
  callHandler, text, button, attr, svgIcon, makeClose, makeShareClose, setInputValue, selectNode,
}
