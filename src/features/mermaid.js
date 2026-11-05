/**
 * 特性包：图表渲染（阶段 4）。
 *
 * dist/features/mermaid.js：ESM 引入同包的共享 Mermaid 运行时；CDN feature
 * UMD 自带实现。宿主按格式引入后完成 'mermaid' 注册；lite 主产物的图表分支从 fallback
 * 的 stub 降级恢复为完整渲染。页面已自行加载 mermaid（window.mermaid）
 * 时主产物直接复用全局实例，本包不会被用到。
 */
import { registerFeature } from '../core/features/registry'
import mermaidVendor from 'lark-doc/mermaid-vendor'

const mermaid = (mermaidVendor && mermaidVendor.default) || mermaidVendor

registerFeature('mermaid', () => Promise.resolve(mermaid))
