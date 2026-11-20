/** Optional controls for an attached video. Playback and fullscreen stay in the node view. */
export function bindVideoPopups({ shell, video, rate, quality, volume, el, markUi, icons }) {
  const doc = shell.ownerDocument
  const view = doc.defaultView
  let openPopup = null
  let openTrigger = null
  let popupHideTimer = null
  let popupResize = null
  const onPopupResize = () => closePopup(openPopup?.contains(doc.activeElement))
  const cancelPopupHide = () => {
    view.clearTimeout(popupHideTimer)
    popupHideTimer = null
  }
  const closePopup = (restoreFocus = false) => {
    cancelPopupHide()
    const trigger = openTrigger
    const popup = openPopup
    openPopup = null
    openTrigger = null
    view.removeEventListener('resize', onPopupResize)
    popupResize?.disconnect()
    popupResize = null
    popup?.remove()
    trigger?.setAttribute('aria-expanded', 'false')
    if (restoreFocus) trigger?.focus({ preventScroll: true })
  }
  const placePopup = (popup, trigger) => {
    const playerRect = shell.getBoundingClientRect()
    const triggerRect = trigger.getBoundingClientRect()
    const width = popup.offsetWidth
    const left = Math.max(8, Math.min(playerRect.width - width - 8, triggerRect.left - playerRect.left + triggerRect.width / 2 - width / 2))
    popup.style.left = `${Math.round(left)}px`
  }
  const showPopup = (popup, trigger) => {
    cancelPopupHide()
    if (openPopup === popup) return
    closePopup()
    shell.appendChild(popup)
    openPopup = popup
    openTrigger = trigger
    trigger.setAttribute('aria-expanded', 'true')
    placePopup(popup, trigger)
    view.addEventListener('resize', onPopupResize)
    if (view.ResizeObserver) {
      popupResize = new view.ResizeObserver(() => {
        if (openPopup === popup) placePopup(popup, trigger)
      })
      popupResize.observe(shell)
    }
  }
  const bindPopupHover = (popup, trigger) => {
    const leave = () => {
      if (openPopup !== popup) return
      cancelPopupHide()
      popupHideTimer = view.setTimeout(() => {
        if (openPopup === popup && !popup.contains(doc.activeElement)) closePopup()
      }, 200)
    }
    trigger.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'touch') showPopup(popup, trigger)
    })
    trigger.addEventListener('pointerleave', leave)
    popup.addEventListener('pointerenter', cancelPopupHide)
    popup.addEventListener('pointerleave', leave)
    popup.addEventListener('focusout', event => {
      if (openPopup === popup && !popup.contains(event.relatedTarget)) closePopup()
    })
  }
  const buildMenu = (ariaLabel, options, current, onPick) => {
    const popup = markUi(el('div', 'lark-doc-video-popup lark-doc-video-menu', { role: 'menu', 'aria-label': ariaLabel }))
    const rows = options.map((option) => {
      const item = el('button', 'lark-doc-video-menu-item', { type: 'button', role: 'menuitemradio', 'aria-checked': String(option.value === current) })
      const check = el('span', 'lark-doc-video-menu-check', { 'aria-hidden': 'true' })
      check.textContent = '✓'
      const label = el('span', 'lark-doc-video-menu-label')
      label.textContent = option.label
      item.appendChild(check)
      item.appendChild(label)
      item.addEventListener('click', (event) => {
        event.stopPropagation()
        onPick(option.value)
        rows.forEach((row) => row.setAttribute('aria-checked', String(row === item)))
        closePopup(popup.contains(doc.activeElement))
      })
      popup.appendChild(item)
      return item
    })
    return popup
  }

  const RATE_OPTIONS = [2, 1.5, 1, 0.75, 0.5].map(value => ({ value, label: `${value}x` }))
  const rateMenu = buildMenu('播放速度', RATE_OPTIONS, 1, (value) => {
    video.playbackRate = value
    rate.textContent = `${value}x`
  })
  const QUALITY_OPTIONS = ['360p', '480p', '原画'].map(value => ({ value, label: value }))
  // 本地只有一个源文件，清晰度是**档位展示**（切档不换源，和飞书同款菜单交互）。
  const qualityMenu = buildMenu('清晰度', QUALITY_OPTIONS, '480p', (value) => { quality.textContent = value })

  for (const [trigger, menu] of [[rate, rateMenu], [quality, qualityMenu]]) {
    bindPopupHover(menu, trigger)
    trigger.addEventListener('click', event => {
      event.stopPropagation()
      showPopup(menu, trigger)
      if (event.detail === 0) menu.querySelector('[aria-checked="true"]').focus()
    })
    const items = Array.from(menu.children)
    menu.addEventListener('keydown', event => {
      const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
      if (!step) return
      event.preventDefault()
      event.stopPropagation()
      items[(items.indexOf(event.target) + step + items.length) % items.length].focus()
    })
  }

  /* 音量面板 */
  const volumePanel = markUi(el('div', 'lark-doc-video-popup lark-doc-video-volume', { role: 'group', 'aria-label': '音量' }))
  const volumeValue = el('span', 'lark-doc-video-volume-value')
  const volumeTrack = markUi(el('div', 'lark-doc-video-volume-track', {
    role: 'slider', tabindex: '0', 'aria-label': '音量', 'aria-orientation': 'vertical', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '100',
  }))
  const volumeFill = el('div', 'lark-doc-video-volume-fill')
  const volumeKnob = el('span', 'lark-doc-video-volume-knob')
  volumeTrack.appendChild(volumeFill)
  volumeTrack.appendChild(volumeKnob)
  volumePanel.appendChild(volumeValue)
  volumePanel.appendChild(volumeTrack)

  let lastVolume = 1
  const currentVolume = () => (video.muted ? 0 : (Number.isFinite(video.volume) ? video.volume : 1))
  const syncVolume = () => {
    const value = Math.max(0, Math.min(1, currentVolume()))
    const percent = Math.round(value * 100)
    volumeValue.textContent = `${percent}%`
    volumeFill.style.height = `${percent}%`
    volumeKnob.style.bottom = `${percent}%`
    volumeTrack.setAttribute('aria-valuenow', String(percent))
    volume.classList.toggle('is-muted', value === 0)
    volume.innerHTML = value === 0 ? icons.muted : icons.volume
    volume.setAttribute('aria-label', value === 0 ? '取消静音' : '静音')
  }
  const setVolume = (value) => {
    const next = Math.max(0, Math.min(1, value))
    video.volume = next
    video.muted = next === 0
    if (next > 0) lastVolume = next
    syncVolume()
  }
  const volumeAt = (clientY) => {
    const rect = volumeTrack.getBoundingClientRect()
    if (!rect.height) return
    setVolume((rect.bottom - clientY) / rect.height)
  }
  bindPopupHover(volumePanel, volume)
  volume.addEventListener('keydown', event => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    event.stopPropagation()
    showPopup(volumePanel, volume)
    volumeTrack.focus()
  })
  volume.addEventListener('click', (event) => {
    event.stopPropagation()
    if (event.pointerType === 'touch' && openPopup !== volumePanel) {
      showPopup(volumePanel, volume)
      return
    }
    if (currentVolume() === 0) setVolume(lastVolume || 1)
    else setVolume(0)
  })
  let volumeDragging = false
  volumeTrack.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    event.stopPropagation()
    volumeDragging = true
    volumeAt(event.clientY)
    volumeTrack.setPointerCapture?.(event.pointerId)
  })
  volumeTrack.addEventListener('pointermove', (event) => {
    if (!volumeDragging) return
    event.stopPropagation()
    volumeAt(event.clientY)
  })
  const endVolumeDrag = () => { volumeDragging = false }
  volumeTrack.addEventListener('pointerup', endVolumeDrag)
  volumeTrack.addEventListener('pointercancel', endVolumeDrag)
  volumeTrack.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    event.stopPropagation()
    setVolume(currentVolume() + (event.key === 'ArrowUp' ? 0.05 : -0.05))
  })

  /* 点空白处 / Esc 收起弹层（挂在 document 上，随块销毁解绑）。 */
  const onDocumentPointerDown = (event) => {
    if (!openPopup) return
    if (openPopup.contains(event.target) || openTrigger.contains(event.target)) return
    closePopup()
  }
  const onDocumentKeyDown = (event) => {
    if (event.key !== 'Escape' || !openPopup) return
    if (shell.contains(event.target)) event.stopPropagation()
    closePopup(openPopup.contains(doc.activeElement))
  }
  doc.addEventListener('pointerdown', onDocumentPointerDown, true)
  doc.addEventListener('keydown', onDocumentKeyDown, true)
  video.addEventListener('volumechange', syncVolume)
  syncVolume()
  return () => {
    video.removeEventListener('volumechange', syncVolume)
    doc.removeEventListener('pointerdown', onDocumentPointerDown, true)
    doc.removeEventListener('keydown', onDocumentKeyDown, true)
    closePopup()
  }
}
