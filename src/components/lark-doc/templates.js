// 使用真实 HTML 验证旧公告加载；示例图片为内嵌数据，不依赖外部资源或后端。
import { SAMPLE_CONTENT_BRAND } from '../../ui/palette'

const sampleImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAIUlEQVR42mNg2NEORPq539AQAwGJ15/ew9H/Q75AREUJADolXv0Q9HhPAAAAAElFTkSuQmCC'

export const TEMPLATES = [
  { id: 'sample', label: '旧 HTML 示例', title: '把想法写成行动', html: `<h1>一份更有条理的文档</h1><p>这里是独立的单人文档 Demo。保留熟悉的飞书式交互，使用 <strong>Tiptap</strong> 管理正文，使用项目的 <span style="color:${SAMPLE_CONTENT_BRAND}">绿色主题</span>。</p><p>输入 <strong>/</strong> 插入内容，选中文字设置格式，也可以通过左侧手柄移动内容块。</p><h2>从旧公告开始</h2><p>这段内容通过 HTML 加载。<a href="https://tiptap.dev" target="_blank" rel="noopener noreferrer">了解编辑器</a>，或试试标题、列表、图片和表格。</p><ul><li><p>保持已有 HTML 可读</p></li><li><p>正文保存为 Tiptap JSON，本地导出 HTML</p></li><li><p>当前不连接评论、协作、RAG 或后台服务</p></li></ul><h2>本周计划</h2><table><tbody><tr><th><p>事项</p></th><th><p>负责人</p></th><th><p>状态</p></th></tr><tr><td><p>确认文档范围</p></td><td><p>产品团队</p></td><td><p>进行中</p></td></tr><tr><td><p>检查旧 HTML 显示</p></td><td><p>研发团队</p></td><td><p>待验证</p></td></tr></tbody></table><h2>留一点空间给灵感</h2><blockquote><p>清晰的表达，让复杂的事变得简单。</p></blockquote><p>支持本地图片，单张不超过 20 MB。图片会随 JSON 草稿保存。</p><img src="${sampleImage}" alt="旧 HTML 内嵌图片示例" width="80"><p></p>` },
  { id: 'blank', label: '空白文档', title: '未命名文档', html: '<p></p>' },
  { id: 'meeting', label: '会议纪要', title: '项目会议纪要', html: '<h1>会议纪要</h1><p>时间：　　参会人：</p><h2>会议目标</h2><p>请填写本次会议要解决的问题。</p><h2>讨论要点</h2><ul><li><p>议题一</p></li><li><p>议题二</p></li></ul><h2>行动事项</h2><table><tbody><tr><th><p>行动</p></th><th><p>负责人</p></th><th><p>截止时间</p></th></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table><h2>待确认</h2><p></p>' },
  { id: 'weekly', label: '工作周报', title: '本周工作周报', html: '<h1>工作周报</h1><p>汇报周期：　　汇报人：</p><h2>本周进展</h2><ul><li><p>完成事项与结果</p></li></ul><h2>遇到的问题</h2><blockquote><p>记录风险及需要的支持。</p></blockquote><h2>下周计划</h2><ol><li><p>关键任务</p></li><li><p>预期交付</p></li></ol><h2>补充说明</h2><p></p>' },
]

/** Editor insertion shortcuts are separate from the workspace's whole-document examples. */
export const INSERT_TEMPLATES = [
  { id: 'reading', label: '读书笔记', title: '读书笔记', html: [
    '<h1>基本信息</h1><blockquote><p>填写书籍的基本信息，👉 新年充电 推荐书单</p></blockquote>',
    '<div data-type="columns"><div data-type="column" data-width="50"><div data-type="callout" data-emoji="👤"><p>作者：</p></div></div><div data-type="column" data-width="50"><div data-type="callout" data-emoji="📚"><p>类别：</p></div></div></div>',
    '<div data-type="columns"><div data-type="column" data-width="50"><div data-type="callout" data-emoji="❤"><p>推荐指数：⭐️⭐️⭐️⭐️⭐️</p></div></div><div data-type="column" data-width="50"><div data-type="callout" data-emoji="📒"><p>简介：</p></div></div></div>',
    '<div data-type="callout" data-emoji="✅"><p>阅读时间：</p></div>',
    '<h1>书摘</h1><blockquote><p>在空白行输入 “/glk” 插入高亮块，凸显部分内容</p></blockquote><h3>第 1 章</h3>',
    '<div data-type="columns"><div data-type="column" data-width="50"><div data-type="callout" data-emoji="🔆"><p>【精彩片段】</p><p></p></div></div><div data-type="column" data-width="50"><p>【评论 &amp; 感言】</p><p></p><p></p></div></div>',
    '<div data-type="columns"><div data-type="column" data-width="50"><p>【评论 &amp; 感言】</p></div><div data-type="column" data-width="50"><div data-type="callout" data-emoji="🔆"><p>【精彩片段】</p><p></p></div></div></div><hr>',
    '<h3>第 2 章</h3>',
    '<div data-type="columns"><div data-type="column" data-width="50"><div data-type="callout" data-emoji="✨"><p>【精彩片段】</p><p></p></div></div><div data-type="column" data-width="50"><p>【评论 &amp; 感言】</p><p></p></div></div>',
    '<div data-type="columns"><div data-type="column" data-width="50"><p>【评论 &amp; 感言】</p></div><div data-type="column" data-width="50"><div data-type="callout" data-emoji="✨"><p>【精彩片段】</p><p></p></div></div></div><hr>',
    '<h1>收获 &amp; 感悟</h1><blockquote><p>记录全书阅读的心得和体会</p></blockquote><h3></h3>',
    '<h1>书评</h1><blockquote><p>从多个维度分析、评价书籍</p></blockquote>',
  ].join('') },
  { id: 'personal', label: '个人总结', title: '个人总结', html: [
    '<div data-type="callout" data-emoji="⛳"><ul><li><p>汇报人：@张小唐</p></li><li><p>日期：20XX 年 X 月 X 日</p></li></ul></div>',
    '<h2>目标完成情况</h2><blockquote><p>此处主要展示全年的目标完成情况，可结合图表方式展示。</p></blockquote>',
    '<table><tbody><tr><td><p>项目名称</p></td><td><p>完成结果</p></td></tr><tr><td><p></p></td><td><p></p></td></tr></tbody></table>',
    '<h2>重点产出回顾</h2><blockquote><p>此处主要展示全年的重点项目产出，可以通过图片+文字的形式展示，数据侧成果可以通过添加图表进行展示。</p></blockquote>',
    '<h3>项目 1</h3><p></p><h3>项目 2</h3><p></p>',
    '<h2>经验与教训</h2><h3>做得好的</h3><p></p><h3>待提升的</h3><p></p>',
    '<h1>20XX 工作计划</h1><h2>全年目标</h2><p></p><h2>重点工作计划</h2>',
  ].join('') },
  { id: 'swot', label: 'SWOT 分析思维导图', title: 'SWOT 分析思维导图', html: null, unavailable: '当前不支持此模板中的思维导图，暂不可插入' },
  { id: 'report', label: '工作汇报', title: '工作汇报', html: [
    '<blockquote><p>部门：输入部门名称</p><p>汇报人：输入“@+人名”提及相关人</p><p>时间：X月X日-X月X日</p></blockquote>',
    '<p></p><p>【工作总结】</p>',
    '<div data-type="columns"><div data-type="column" data-width="50"><p>做的好的</p><ol><li><p>......</p></li><li><p>......</p></li></ol></div><div data-type="column" data-width="50"><p>待改进的</p><ol><li><p>......</p></li><li><p>......</p></li></ol></div></div>',
    '<p>【工作内容】</p>',
    '<table><tbody><tr><td><div data-type="heading" data-level="9">重点工作</div></td><td><div data-type="heading" data-level="9">负责人</div></td><td><div data-type="heading" data-level="9">关键进展</div></td><td><div data-type="heading" data-level="9">风险及应对措施</div></td></tr><tr><td><p>文案定稿，确认投放渠道</p></td><td><p>@某某人</p></td><td><p>确定文案初稿</p></td><td><p></p></td></tr><tr><td><p>完成产品功能介绍初版</p></td><td><p>@某某人</p></td><td><p>完成产品亮点功能梳理</p></td><td><p></p></td></tr><tr><td><p>...</p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table>',
    '<p>【后续计划】</p><blockquote><p>@相关负责人，并插入任务截止时间</p></blockquote>',
    '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>描述下周工作内容或项目    @xxx</p></li><li data-type="taskItem" data-checked="false"><p>...</p></li></ul><p></p>',
  ].join('') },
  { id: 'minutes', label: '会议记录', title: '会议记录', html: [
    '<div data-type="callout" data-emoji="📌"><ul><li><p>会议主题：简要描述会议主题和目标</p></li><li><p>参会人员：输入“@+人名”插入参会人员</p></li><li><p>会前必读：输入@ 插入相关背景资料</p></li></ul></div>',
    '<p></p><h3>议程 1 ：输入要讨论的议题</h3>',
    '<ul><li><p>讨论过程：</p><ul><li><p>记录讨论中的重要信息和建议</p></li><li><p>...</p></li></ul></li><li><p>重要结论：</p><ul><li><p>本次讨论的重要结论</p></li><li><p>...</p></li></ul></li><li><p>后续安排：</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>描述下一步安排或计划 ，负责人：<br>刘大建<br>，截止时间：11月4日</p></li><li data-type="taskItem" data-checked="false"><p>...</p></li></ul></li></ul>',
  ].join('') },
]
