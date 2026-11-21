/** Desktop-only presence and document information use the authorized, current-document data. */
import { setText } from './dom'
import { iconNode } from './icon'

export function createDesktopHeaderDetails({ el, paperMetaRow, paperMeta, membersButton }) {
  const document = el.ownerDocument
  let state = {}, disposed = false, factsSignature = ''
  const paperSettings = document.createElement('details'), paperSettingsTrigger = document.createElement('summary'), paperSettingsMenu = document.createElement('div')
  paperSettings.className = 'lark-doc-paper-info-settings'
  paperSettingsTrigger.setAttribute('aria-label', '选择要展示的文档信息')
  paperSettingsTrigger.appendChild(iconNode('info', 17))
  paperSettingsMenu.setAttribute('aria-label', '文档信息显示选项')
  paperSettings.append(paperSettingsTrigger, paperSettingsMenu)
  paperSettings.addEventListener('keydown', event => {
    if (event.key === 'Escape' && paperSettings.open) { event.stopPropagation(); paperSettings.open = false; paperSettingsTrigger.focus() }
  })
  const dismissPaperSettings = event => { if (!paperSettings.contains(event.target)) paperSettings.open = false }
  paperSettings.ownerDocument.addEventListener('pointerdown', dismissPaperSettings)
  let metadataRequest, paperScope, informationHidden = false, visibleInformation
  const paperFields = [['author', '作者'], ['createdAt', '创建时间'], ['visitors', '访问人数'], ['visits', '访问次数'],
    ['likes', '点赞总数'], ['comments', '评论总数'], ['modifiedAt', '最近修改时间']]
  const paperChoices = paperFields.map(([field, text]) => {
    const label = document.createElement('label'), input = document.createElement('input')
    input.type = 'checkbox'
    input.addEventListener('change', () => {
      if (input.checked) visibleInformation.add(field); else visibleInformation.delete(field)
      update(state)
    })
    label.append(input, document.createTextNode(text)); paperSettingsMenu.appendChild(label)
    return input
  })
  const hideInformation = document.createElement('button')
  hideInformation.type = 'button'
  hideInformation.addEventListener('click', () => { informationHidden = !informationHidden; paperSettings.open = false; update(state); paperSettingsTrigger.focus() })
  paperSettingsMenu.appendChild(hideInformation)
  const peers = document.createElement('div')
  peers.className = 'lark-doc-online-peers'
  peers.setAttribute('aria-label', '在线协作者')
  let peerSignature = ''

  function update(next) {
    state = next
    if (!state.open) {
      paperSettings.open = false
      metadataRequest = null; factsSignature = ''; paperSettings.remove(); peers.remove()
      return
    }
    const online = [...new Map((state.collaborationUsers || []).filter(user => user.id && user.name && user.avatarVisible !== false)
      .map(user => [user.id, user])).values()]
    const peerList = online.length > 1 ? online : []
    const signature = JSON.stringify(peerList.map(user => [user.id, user.name, user.colorIndex]))
    if (peerSignature !== signature) {
      peerSignature = signature
      peers.replaceChildren(...peerList.slice(0, 4).map(user => {
        const avatar = document.createElement('span'), tip = document.createElement('span')
        avatar.className = `lark-doc-online-peer lark-doc-peer-color-${[0, 1, 2].includes(user.colorIndex) ? user.colorIndex : 0}`
        avatar.tabIndex = 0
        avatar.setAttribute('aria-label', `${user.name}，在线`)
        tip.className = 'lark-doc-header-tip'; tip.setAttribute('aria-hidden', 'true'); tip.textContent = user.name
        avatar.append(document.createTextNode(Array.from(user.name).slice(0, 2).join('')), tip)
        return avatar
      }))
      if (peerList.length > 4) peers.append(document.createTextNode(`+${peerList.length - 4}`))
    }
    if (peerList.length) { if (peers.nextSibling !== membersButton) el.insertBefore(peers, membersButton) } else peers.remove()

    const scope = JSON.stringify([state.currentDocumentId, state.currentUser?.id])
    if (paperScope !== scope) {
      paperScope = scope; visibleInformation = new Set(['author', 'modifiedAt']); informationHidden = false; paperSettings.open = false
    }
    if (!state.readDocumentMetadata) metadataRequest = null
    else if (metadataRequest?.key !== state.mobileContextKey) {
      const ticket = metadataRequest = { key: state.mobileContextKey }
      state.readDocumentMetadata().then(value => {
        if (disposed || metadataRequest !== ticket || !value) return
        ticket.value = value
        update(state)
      }).catch(() => {})
    }
    const information = metadataRequest?.value
    const metadata = state.documentMetadata || {}
    const authors = Array.isArray(metadata.authors) ? metadata.authors : [metadata.author || { name: information?.creatorName || information?.creatorId }]
    const names = authors.map(person => typeof person?.name === 'string' ? person.name.trim() : '').filter(Boolean)
    const modified = new Date(metadata.modifiedAt ?? information?.updatedAt)
    const bodyTime = !Number.isFinite(modified.getTime()) ? '' : modified.toDateString() === new Date().toDateString()
      ? '今天修改' : `${modified.toLocaleDateString('zh-CN')}修改`
    const values = { author: names[0], modifiedAt: bodyTime, createdAt: information?.createdAt ? new Date(information.createdAt).toLocaleDateString('zh-CN') : '',
      ...information?.interaction }
    const facts = JSON.stringify([names, values, [...visibleInformation], informationHidden])
    if (facts !== factsSignature) {
      factsSignature = facts
      paperMeta.replaceChildren()
      paperFields.forEach(([key, label], index) => {
        paperChoices[index].checked = visibleInformation.has(key)
        paperChoices[index].disabled = values[key] == null || values[key] === ''
        if (informationHidden || !visibleInformation.has(key) || paperChoices[index].disabled) return
        if (key === 'author') {
          names.forEach(name => {
            const badge = document.createElement('span'), author = document.createElement('span')
            badge.className = 'lark-doc-document-author-avatar'; badge.setAttribute('aria-hidden', 'true'); badge.textContent = Array.from(name).slice(-2).join('')
            author.className = 'lark-doc-document-author-name'; author.textContent = name
            paperMeta.append(badge, author)
          })
        } else {
          const value = document.createElement('span')
          value.textContent = key === 'modifiedAt' ? values[key] : `${label} ${values[key]}`
          paperMeta.append(value)
        }
      })
      setText(hideInformation, informationHidden ? '显示文档信息' : '隐藏文档信息')
    }
    if (paperSettings.parentNode !== paperMetaRow) paperMetaRow.prepend(paperSettings)
  }
  return { update, destroy() {
    disposed = true
    document.removeEventListener('pointerdown', dismissPaperSettings)
    paperSettings.remove(); peers.remove()
  } }
}
