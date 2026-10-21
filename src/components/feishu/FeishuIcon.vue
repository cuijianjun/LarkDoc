<script>
/**
 * FeishuIcon — 工具栏扁平图标（functional 组件）。
 * 从 ./icons.js 取 SVG 字符串渲染为 inline span，颜色由 CSS currentColor 控制，
 * 激活态（aria-pressed / aria-expanded）自动跟随按钮变色，无需多套图标。
 */
import { ICONS } from './editor/icons'

export default {
  name: 'FeishuIcon',
  functional: true,
  props: {
    name: { type: String, required: true },
    size: { type: Number, default: 16 },
  },
  render(h, context) {
    const { name, size } = context.props
    const svg = ICONS[name]
    const data = { ...context.data }
    data.class = [data.class, 'feishu-icon']
    if (!svg) return h('span', data)
    data.style = { ...(data.style || {}), width: `${size}px`, height: `${size}px` }
    data.domProps = { innerHTML: svg }
    return h('span', data)
  },
}
</script>
