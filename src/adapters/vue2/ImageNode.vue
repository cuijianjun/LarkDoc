<template>
  <node-view-wrapper
    as="figure"
    class="lark-doc-image"
    :class="{ 'is-selected': selected }"
    :data-align="node.attrs.align || 'center'"
    :data-block-id="node.attrs.blockId || null"
    contenteditable="false"
  >
    <div
      v-if="editable && selected"
      class="lark-doc-image-toolbar"
      role="toolbar"
      aria-label="图片工具"
      @mousedown.stop.prevent
    >
      <button
        type="button"
        aria-label="裁剪"
        title="裁剪"
        @click.stop="openCrop"
      >
        ⌗
      </button>
      <button
        type="button"
        aria-label="替换图片"
        title="替换图片"
        @click.stop="openReplace"
      >
        ▧
      </button>
      <button
        type="button"
        aria-label="编辑图片说明"
        title="编辑图片说明"
        @click.stop="focusCaption"
      >
        ▤
      </button>
      <button
        type="button"
        aria-label="重置裁剪"
        title="重置裁剪"
        :disabled="!node.attrs.originalSrc || node.attrs.originalSrc === node.attrs.src"
        @click.stop="resetImage"
      >
        ↶
      </button>
      <span
        class="lark-doc-image-toolbar-divider"
        aria-hidden="true"
      />
      <button
        v-for="item in alignments"
        :key="item.value"
        type="button"
        :aria-label="item.label"
        :title="item.label"
        :aria-pressed="String((node.attrs.align || 'center') === item.value)"
        @click.stop="setAlign(item.value)"
      >
        {{ item.glyph }}
      </button>
      <span
        class="lark-doc-image-toolbar-divider"
        aria-hidden="true"
      />
      <button
        type="button"
        aria-label="预览图片"
        title="预览图片"
        @click.stop="openPreview"
      >
        ◉
      </button>
    </div>
    <div
      class="lark-doc-image-frame"
      :style="frameStyle"
    >
      <div
        v-if="blocked"
        class="lark-doc-image-blocked"
        role="img"
        aria-label="外链图片已被离线策略拦截"
      >
        <strong>外链图片已拦截</strong>
        <code v-if="node.attrs.originalSrc">{{ node.attrs.originalSrc }}</code>
        <span>把图片上传到本地或对象存储后替换，或调整 network 策略放行该域名</span>
      </div>
      <img
        v-else
        ref="image"
        :src="node.attrs.src"
        :alt="node.attrs.alt || node.attrs.caption || '文档图片'"
        draggable="false"
        @dblclick="openPreview"
      >
      <template v-if="editable && selected">
        <button
          v-for="corner in resizeCorners"
          :key="corner"
          type="button"
          class="lark-doc-image-resize"
          :class="`is-${corner}`"
          :aria-label="`拖动调整图片宽度（${cornerLabels[corner]}）`"
          :title="`拖动调整图片宽度（${cornerLabels[corner]}）`"
          :data-corner="corner"
          @mousedown.stop.prevent="startResize($event, corner)"
        />
      </template>
    </div>
    <div
      v-if="selected"
      class="lark-doc-image-actions"
      @mousedown.stop
    >
      <button
        type="button"
        @click="openPreview"
      >
        预览
      </button>
      <template v-if="editable">
        <label>宽度 <input
          aria-label="图片宽度"
          type="number"
          min="40"
          max="2400"
          :value="node.attrs.width || 640"
          @change="setWidth($event.target.value)"
        ></label>
      </template>
    </div>
    <input
      v-if="editable && selected"
      ref="replaceInput"
      class="lark-doc-image-replace-input"
      type="file"
      accept="image/png,image/jpeg,image/gif,image/webp"
      aria-label="替换图片文件"
      @change="replaceImage"
    >
    <input
      v-if="editable && selected"
      ref="caption"
      class="lark-doc-image-caption"
      aria-label="图片说明"
      placeholder="添加图片说明"
      :value="node.attrs.caption"
      @change="setCaption($event.target.value)"
    >
    <figcaption v-else-if="node.attrs.caption">
      {{ node.attrs.caption }}
    </figcaption>
    <p
      v-if="error"
      class="lark-doc-media-error"
      role="alert"
    >
      {{ error }}
    </p>
    <div
      v-if="dialog"
      class="lark-doc-media-backdrop"
      @keydown.esc.stop.prevent="closeDialog"
      @click.self="closeDialog"
    >
      <section
        ref="dialog"
        class="lark-doc-media-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="dialog === 'crop' ? '裁剪图片' : '图片预览'"
        tabindex="-1"
        @keydown.tab="trapFocus"
        @keydown.enter.stop.prevent="dialog === 'crop' ? applyCrop() : null"
      >
        <div class="lark-doc-media-heading">
          <strong>{{ dialog === 'crop' ? '裁剪图片' : '图片预览' }}</strong>
          <button
            ref="close"
            type="button"
            aria-label="关闭图片窗口"
            @click="closeDialog"
          >
            关闭
          </button>
        </div>
        <div
          ref="cropPreview"
          class="lark-doc-crop-preview"
        >
          <img
            :src="dialog === 'crop' ? node.attrs.originalSrc || node.attrs.src : node.attrs.src"
            alt="图片预览"
          >
          <div
            v-if="dialog === 'crop'"
            class="lark-doc-crop-region"
            :style="cropStyle"
            @mousedown.stop.prevent="startCropDrag"
          />
        </div>
        <template v-if="dialog === 'crop'">
          <p>以原图百分比设置裁剪区域。原图会保留，可随时重置。</p>
          <div class="lark-doc-crop-fields">
            <label
              v-for="field in cropFields"
              :key="field.key"
            >{{ field.label }} % <input
              v-model.number="crop[field.key]"
              type="number"
              min="0"
              max="100"
              :aria-label="field.label"
            ></label>
          </div>
          <button
            type="button"
            :disabled="busy || !editable"
            @click="applyCrop"
          >
            {{ busy ? '正在裁剪…' : '应用裁剪' }}
          </button>
        </template>
        <p
          v-if="error"
          class="lark-doc-media-error"
          role="alert"
        >
          {{ error }}
        </p>
      </section>
    </div>
  </node-view-wrapper>
</template>

<script>
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-2'
import { safeUrl } from '../../components/lark-doc/documentOperations'
import { BLOCKED_IMAGE_PLACEHOLDER } from '../../networkPolicy'

export default {
  name: 'LarkDocImageNode',
  components: { NodeViewWrapper },
  props: nodeViewProps,
  data() {
    return {
      editable: this.editor.isEditable, dialog: '', error: '', busy: false, resizeWidth: null, resizeStart: null, cropDrag: null, cropGeneration: 0, replaceGeneration: 0,
      crop: { x: 10, y: 10, width: 80, height: 80 },
      cropFields: [{ key: 'x', label: '左边界' }, { key: 'y', label: '上边界' }, { key: 'width', label: '裁剪宽度' }, { key: 'height', label: '裁剪高度' }],
      resizeCorners: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
      cornerLabels: { 'top-left': '左上角', 'top-right': '右上角', 'bottom-left': '左下角', 'bottom-right': '右下角' },
      alignments: [{ value: 'left', label: '左对齐', glyph: '⇤' }, { value: 'center', label: '居中对齐', glyph: '≡' }, { value: 'right', label: '右对齐', glyph: '⇥' }],
    }
  },
  computed: {
    // 外链图片在离线策略下被替换为透明占位，渲染时改成说明块而不是空图。
    blocked() { return !this.node.attrs.src || this.node.attrs.src === BLOCKED_IMAGE_PLACEHOLDER },
    displayWidth() { return this.resizeWidth || this.node.attrs.width },
    frameStyle() {
      const align = this.node.attrs.align || 'center'
      return { width: this.displayWidth ? `${this.displayWidth}px` : 'auto', marginLeft: align === 'right' ? 'auto' : align === 'center' ? 'auto' : '0', marginRight: align === 'left' ? 'auto' : align === 'center' ? 'auto' : '0' }
    },
    cropStyle() { return { left: `${this.crop.x}%`, top: `${this.crop.y}%`, width: `${this.crop.width}%`, height: `${this.crop.height}%` } },
  },
  created() { this.editor.on('update', this.syncEditable); this.editor.on('transaction', this.syncEditable); this.editor.on('editableUpdate', this.syncEditable) },
  beforeDestroy() { this.stopResize(false); this.stopCropDrag(); this.cropGeneration += 1; this.replaceGeneration += 1; this.editor.off('update', this.syncEditable); this.editor.off('transaction', this.syncEditable); this.editor.off('editableUpdate', this.syncEditable) },
  methods: {
    syncEditable() { this.editable = this.editor.isEditable; if (!this.editable) { this.stopResize(false); this.stopCropDrag(); if (this.dialog === 'crop') this.closeDialog() } },
    setWidth(value) {
      if (!this.editor.isEditable) return
      const width = Number(value)
      if (!Number.isFinite(width) || width < 40 || width > 2400) { this.error = '图片宽度须为 40–2400 像素'; return }
      this.updateAttributes({ width: Math.round(width), height: null })
      this.error = ''
    },
    setCaption(value) {
      if (!this.editor.isEditable) return
      this.updateAttributes({ caption: String(value).slice(0, 100000) })
    },
    startResize(event, corner = 'bottom-right') {
      if (!this.editor.isEditable || this.blocked || !this.$refs.image) return
      this.resizeStart = { x: event.clientX, width: this.$refs.image.getBoundingClientRect().width, direction: corner.includes('left') ? -1 : 1 }
      window.addEventListener('mousemove', this.onResize)
      window.addEventListener('mouseup', this.finishResize)
    },
    onResize(event) {
      if (!this.editor.isEditable || !this.resizeStart) { this.stopResize(false); return }
      this.resizeWidth = Math.max(40, Math.min(2400, this.resizeStart.width + this.resizeStart.direction * (event.clientX - this.resizeStart.x)))
    },
    finishResize() { this.stopResize(true) },
    stopResize(commit) {
      window.removeEventListener('mousemove', this.onResize)
      window.removeEventListener('mouseup', this.finishResize)
      if (commit && this.resizeWidth && this.editor.isEditable) this.setWidth(this.resizeWidth)
      this.resizeWidth = null
      this.resizeStart = null
    },
    startCropDrag(event) {
      if (!this.editor.isEditable || this.dialog !== 'crop' || !this.$refs.cropPreview) return
      const rect = this.$refs.cropPreview.getBoundingClientRect()
      this.cropDrag = { x: event.clientX, y: event.clientY, rect, crop: { ...this.crop } }
      window.addEventListener('mousemove', this.onCropDrag)
      window.addEventListener('mouseup', this.finishCropDrag)
    },
    onCropDrag(event) {
      if (!this.cropDrag) return
      const { x, y, rect, crop } = this.cropDrag
      const dx = (event.clientX - x) / rect.width * 100
      const dy = (event.clientY - y) / rect.height * 100
      this.crop = { ...crop, x: Math.max(0, Math.min(100 - crop.width, crop.x + dx)), y: Math.max(0, Math.min(100 - crop.height, crop.y + dy)) }
    },
    finishCropDrag() { this.stopCropDrag() },
    stopCropDrag() {
      window.removeEventListener('mousemove', this.onCropDrag)
      window.removeEventListener('mouseup', this.finishCropDrag)
      this.cropDrag = null
    },
    setAlign(value) {
      if (!this.editor.isEditable || !['left', 'center', 'right'].includes(value)) return
      this.updateAttributes({ align: value })
    },
    focusCaption() {
      this.$nextTick(() => this.$refs.caption?.focus())
    },
    openReplace() {
      if (!this.editor.isEditable) return
      this.$refs.replaceInput?.click()
    },
    async replaceImage(event) {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file || !this.editor.isEditable) return
      const generation = ++this.replaceGeneration
      try {
        const image = await this.extension.options.resolveImageFile(file)
        if (!image || generation !== this.replaceGeneration || this.editor.isDestroyed || !this.editor.isEditable) return
        this.updateAttributes({ ...image, originalSrc: image.src, originalAttchId: image.attchId, alt: file.name })
        this.error = ''
      } catch (error) { if (generation === this.replaceGeneration && !this.editor.isDestroyed && this.editor.isEditable) this.error = error.message || '图片替换失败' }
    },
    openPreview() { if (this.blocked) return this.openReplace(); this.openDialog('preview') },
    openCrop() {
      if (!this.editor.isEditable) return
      // 被离线策略拦截的图片没有本地像素，裁剪会重新请求远端原图。
      if (this.blocked) { this.error = '外链图片已被拦截，请先上传到本地再裁剪'; return }
      this.crop = { x: 10, y: 10, width: 80, height: 80 }
      this.openDialog('crop')
    },
    openDialog(type) {
      this.returnFocus = document.activeElement
      this.dialog = type
      this.error = ''
      this.$nextTick(() => { this.$refs.close?.focus() })
    },
    closeDialog() {
      this.stopCropDrag()
      this.cropGeneration += 1
      this.busy = false
      this.dialog = ''
      this.returnFocus?.focus()
    },
    trapFocus(event) {
      const elements = Array.from(this.$refs.dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]'))
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    },
    resetImage() {
      if (!this.editor.isEditable || !safeUrl(this.node.attrs.originalSrc, true)) return
      this.cropGeneration += 1
      this.busy = false
      this.updateAttributes({ src: this.node.attrs.originalSrc, attchId: this.node.attrs.originalAttchId })
      this.error = ''
    },
    async applyCrop() {
      if (!this.editor.isEditable || this.busy) return
      const { x, y, width, height } = this.crop
      if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 100 || y + height > 100) { this.error = '裁剪区域须在原图范围内，宽高必须大于零'; return }
      const source = this.node.attrs.originalSrc || this.node.attrs.src
      const originalAttchId = source === this.node.attrs.src ? this.node.attrs.attchId : this.node.attrs.originalAttchId
      if (!safeUrl(source, true)) { this.error = '图片地址无效'; return }
      this.busy = true
      this.error = ''
      const generation = ++this.cropGeneration
      try {
        const image = await new Promise((resolve, reject) => {
          const resource = new Image()
          resource.crossOrigin = 'anonymous'
          resource.onload = () => resolve(resource)
          resource.onerror = () => reject(new Error('图片无法加载，请使用本地图片或允许跨域访问的图片'))
          resource.src = source
        })
        if (generation !== this.cropGeneration || !this.editor.isEditable || this.dialog !== 'crop') return
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.naturalWidth * width / 100))
        canvas.height = Math.max(1, Math.round(image.naturalHeight * height / 100))
        if (canvas.width * canvas.height > 24000000) throw new Error('图片像素过大，请先缩小原图')
        const context = canvas.getContext('2d')
        if (!context) throw new Error('浏览器不支持图片裁剪')
        context.drawImage(image, image.naturalWidth * x / 100, image.naturalHeight * y / 100, image.naturalWidth * width / 100, image.naturalHeight * height / 100, 0, 0, canvas.width, canvas.height)
        const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('图片裁剪失败')), 'image/png'))
        if (generation !== this.cropGeneration || !this.editor.isEditable || this.dialog !== 'crop') return
        // 裁剪与插图共用宿主上传；每个 URL 都带上对应附件 ID，重置时恢复原映射。
        const uploadedImage = await this.extension.options.resolveImageFile(new File([blob], 'cropped-image.png', { type: 'image/png' }))
        if (!uploadedImage || generation !== this.cropGeneration || !this.editor.isEditable || this.dialog !== 'crop') return
        this.updateAttributes({ ...uploadedImage, originalSrc: source, originalAttchId })
        this.closeDialog()
      } catch (error) { if (generation === this.cropGeneration) this.error = error.name === 'SecurityError' ? '远程图片禁止跨域裁剪，请导入本地图片后重试' : error.message }
      finally { if (generation === this.cropGeneration) this.busy = false }
    },
  },
}
</script>

<style>
.lark-doc .lark-doc-image { position: relative; margin: 18px 0; max-width: 100%; }
.lark-doc .lark-doc-image-frame { position: relative; max-width: 100%; }
.lark-doc .lark-doc-image-frame img { display: block; max-width: 100%; width: 100%; height: auto; border-radius: 6px; filter: brightness(var(--ld-media-dim)); }
/* 深色下的图片压暗开关（T3-05）：默认 --ld-media-dim: 1 = 一个像素都不改；
   宿主觉得深纸上媒体太亮时自己设 0.8~0.9。hover 一律恢复原亮度（读图场景）。 */
.lark-doc .lark-doc-image-frame img:hover { filter: none; }
.lark-doc .lark-doc-image.is-selected .lark-doc-image-frame { outline: 2px solid #2f6df6; outline-offset: -1px; }
/* 离线策略拦截的外链图片：不渲染 img，避免浏览器发起外部请求。 */
.lark-doc .lark-doc-image-blocked { display: grid; gap: 4px; justify-items: start; padding: 18px 20px; border: 1px dashed #c9d4cf; border-radius: 8px; background: #f7faf8; color: #5a6b63; font-size: 12px; }
.lark-doc .lark-doc-image-blocked strong { color: #2f3835; font-size: 13px; }
.lark-doc .lark-doc-image-blocked code { max-width: 100%; overflow-wrap: anywhere; color: #7c8b84; font-size: 11px; }
.lark-doc .lark-doc-image-toolbar { position: absolute; z-index: 5; top: -58px; left: 50%; display: flex; align-items: center; gap: 2px; min-height: 42px; padding: 4px 8px; border: 1px solid #d9dfdc; border-radius: 10px; background: #fff; box-shadow: 0 5px 18px #1c43311f; transform: translateX(-50%); white-space: nowrap; }
.lark-doc .lark-doc-image-toolbar button { min-width: 34px; height: 34px; padding: 0 7px; border: 0; border-radius: 7px; background: transparent; color: #2f3835; cursor: pointer; font-size: 20px; line-height: 1; }
.lark-doc .lark-doc-image-toolbar button:hover, .lark-doc .lark-doc-image-toolbar button[aria-pressed="true"] { background: #e7f0ff; color: #2f6df6; }
.lark-doc .lark-doc-image-toolbar-divider { width: 1px; height: 26px; margin: 0 5px; background: #d9dfdc; }
.lark-doc .lark-doc-image-resize { position: absolute; z-index: 2; width: 12px; min-width: 12px; height: 12px; min-height: 12px; padding: 0; border: 2px solid #2f6df6; border-radius: 50%; background: #fff; cursor: nwse-resize; transform: translate(-50%, -50%); }
.lark-doc .lark-doc-image-resize.is-top-left { top: 0; left: 0; cursor: nwse-resize; }
.lark-doc .lark-doc-image-resize.is-top-right { top: 0; left: 100%; cursor: nesw-resize; }
.lark-doc .lark-doc-image-resize.is-bottom-left { top: 100%; left: 0; cursor: nesw-resize; }
.lark-doc .lark-doc-image-resize.is-bottom-right { top: 100%; left: 100%; cursor: nwse-resize; }
.lark-doc .lark-doc-image-replace-input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.lark-doc .lark-doc-image-actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 8px 0; font-size: 12px; }
.lark-doc .lark-doc-image-actions input { width: 72px; }
.lark-doc .lark-doc-image-caption { width: 100%; box-sizing: border-box; border: 0; border-bottom: 1px solid #e8eceb; padding: 6px 0; color: #687570; }
.lark-doc .lark-doc-image figcaption { font-size: 13px; color: #687570; }
.lark-doc .lark-doc-media-error { font-size: 13px; color: #b52a34; }
.lark-doc .lark-doc-media-backdrop { position: fixed; inset: 0; background: #152f286b; z-index: 2000; display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; }
.lark-doc .lark-doc-media-dialog { width: 760px; max-width: 100%; max-height: 90vh; overflow: auto; padding: 20px; border-radius: 12px; background: white; color: #21352e; box-sizing: border-box; }
.lark-doc .lark-doc-media-heading { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.lark-doc .lark-doc-crop-preview { position: relative; width: fit-content; max-width: 100%; margin: auto; }
.lark-doc .lark-doc-crop-preview img { display: block; max-width: 100%; max-height: 56vh; }
.lark-doc .lark-doc-crop-region { position: absolute; z-index: 1; outline: 2px solid #161b24; background: #ffffff12; box-shadow: 0 0 0 9999px #00000066; cursor: move; }
.lark-doc .lark-doc-crop-fields { display: flex; flex-wrap: wrap; gap: 12px; margin: 12px 0; }
.lark-doc .lark-doc-crop-fields input { width: 64px; }
</style>
