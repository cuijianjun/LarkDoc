// 使用真实 HTML 验证旧公告加载；示例图片为内嵌数据，不依赖外部资源或后端。
import { SAMPLE_CONTENT_BRAND } from '../../ui/palette'

const sampleImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAIUlEQVR42mNg2NEORPq539AQAwGJ15/ew9H/Q75AREUJADolXv0Q9HhPAAAAAElFTkSuQmCC'

export const TEMPLATES = [
  { id: 'sample', label: '旧 HTML 示例', title: '把想法写成行动', html: `<h1>一份更有条理的文档</h1><p>这里是独立的单人文档 Demo。保留熟悉的飞书式交互，使用 <strong>Tiptap</strong> 管理正文，使用项目的 <span style="color:${SAMPLE_CONTENT_BRAND}">绿色主题</span>。</p><p>输入 <strong>/</strong> 插入内容，选中文字设置格式，也可以通过左侧手柄移动内容块。</p><h2>从旧公告开始</h2><p>这段内容通过 HTML 加载。<a href="https://tiptap.dev" target="_blank" rel="noopener noreferrer">了解编辑器</a>，或试试标题、列表、图片和表格。</p><ul><li><p>保持已有 HTML 可读</p></li><li><p>正文保存为 Tiptap JSON，本地导出 HTML</p></li><li><p>当前不连接评论、协作、RAG 或后台服务</p></li></ul><h2>本周计划</h2><table><tbody><tr><th><p>事项</p></th><th><p>负责人</p></th><th><p>状态</p></th></tr><tr><td><p>确认文档范围</p></td><td><p>产品团队</p></td><td><p>进行中</p></td></tr><tr><td><p>检查旧 HTML 显示</p></td><td><p>研发团队</p></td><td><p>待验证</p></td></tr></tbody></table><h2>留一点空间给灵感</h2><blockquote><p>清晰的表达，让复杂的事变得简单。</p></blockquote><p>支持本地图片，单张不超过 20 MB。图片会随 JSON 草稿保存。</p><img src="${sampleImage}" alt="旧 HTML 内嵌图片示例" width="80"><p></p>` },
  { id: 'blank', label: '空白文档', title: '未命名文档', html: '<p></p>' },
  { id: 'meeting', label: '会议纪要', title: '项目会议纪要', html: '<h1>会议纪要</h1><p>时间：　　参会人：</p><h2>会议目标</h2><p>请填写本次会议要解决的问题。</p><h2>讨论要点</h2><ul><li><p>议题一</p></li><li><p>议题二</p></li></ul><h2>行动事项</h2><table><tbody><tr><th><p>行动</p></th><th><p>负责人</p></th><th><p>截止时间</p></th></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table><h2>待确认</h2><p></p>' },
  { id: 'weekly', label: '工作周报', title: '本周工作周报', html: '<h1>工作周报</h1><p>汇报周期：　　汇报人：</p><h2>本周进展</h2><ul><li><p>完成事项与结果</p></li></ul><h2>遇到的问题</h2><blockquote><p>记录风险及需要的支持。</p></blockquote><h2>下周计划</h2><ol><li><p>关键任务</p></li><li><p>预期交付</p></li></ol><h2>补充说明</h2><p></p>' },
]
