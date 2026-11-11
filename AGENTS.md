# AGENTS.md

执行遵循 `/Users/cjjxw/.codex/skills/dev-agent/SKILL.md`（本会话已读则不重复）。开工读本规则、`HANDOFF.md`指向的唯一活动卡和当前task片段；其他资料按需读。

## 业务批次

- 一个可验收业务结果可覆盖多个原task；保留依赖、[P]和完整验收。已授权就绪任务自动接续，不按固定1项/1–3项返回或换会话；外部阻塞只挡依赖项。
- 主Agent默认直接实现；仅委派独立且有收益的工作，提供必要上下文而非整段聊天。共享核心单写入者，避免源码修改与同一编译输出竞争。
- 新注入规格约≤8k token，`requirements/*.md`/`MASTER_PLAN.md`/`tasks.md`不整篇读；用 `rg -n` 定位切片，索引缺失时定向搜索。必要安全事实不能省略。
- 活动卡约2KB，阶段/续接时更新，不追加历史；审计结论收齐后复用。原task实现、本地验证和外部验收分开说明，stub/历史绿不能算当前完整成功。

## 验证

| 时机 | 要求 |
| --- | --- |
| Bug修复前 | 最小失败复现 |
| 业务批次完成 | 合并执行 `npm run test:affected -- <本批次文件>` + `npm run check:quick` |
| 合并/提交前 | `npm run check:code` |
| 发布前 | `npm run check` + `npm run verify:all` |

受影响检查包含下游与全局守卫（no-dead-code/core-no-vue/editor-dom-snapshot/production-evidence/perf-gate，按现有runner）；无映射不跳守卫。公共核心/接口/配置/依赖或失败扩大范围。后端使用自己的Node22和现有命令。
复用有效诊断/结果须相关输入、运行时和必要环境未变且时效合适，注明来源/时间/范围；不确定则重验。保留安全负例、超时/回滚/竞态、必要浏览器/集成验证及批次独立审查，不重复已有效检查。

## 范围与硬闸门

最小改动，保留dirty和锁定工具链，不改无关代码。默认档出现视觉变化、需新造实测色值、断言/构建连修3次未绿时，停下说明并询问；已有明确授权不重复询问。commit/merge/push/发布/部署、真实业务DB与故障注入须对应授权。中文简洁，日志只回摘要与关键错误。

已安装CodeBuddy，实际入口 `.codebuddy/commands/speckit.implement.md`；已有spec-kit不另初始化OpenSpec/重生成task。
