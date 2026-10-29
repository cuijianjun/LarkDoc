/**
 * 特性包：图表渲染（阶段 4）。
 *
 * dist/features/mermaid.js：自带 vendored mermaid UMD（3 MB），宿主按需
 * `<script>` 引入即完成 'mermaid' 注册；lite 主产物的图表分支从 fallback
 * 的 stub 降级恢复为完整渲染。页面已自行加载 mermaid（window.mermaid）
 * 时主产物直接复用全局实例，本包不会被用到。
 */
import { registerFeature } from '../core/features/registry'
import mermaidVendor from 'lark-doc/mermaid-vendor'

const mermaid = (mermaidVendor && mermaidVendor.default) || mermaidVendor

registerFeature('mermaid', () => Promise.resolve(mermaid))
