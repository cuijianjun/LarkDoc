# Research: 全量需求实现技术决策

## Decision 1: 统一 BlockAPI 作为结构操作唯一入口

- **Decision**: insert/update/remove/move/duplicate/transform/get/children/batch 全部经 `src/core/blockApi/`，由 core 负责 blockId、父子关系、权限前置检查、事务回滚和事件语义。
- **Rationale**: `requirements/15` 将 BlockAPI、容器和 blockId 视为后续能力共同地基；分散在 UI 或 Provider 中会导致协同、剪贴板和输出行为不一致。
- **Alternatives considered**: 继续由各块命令直接操作 ProseMirror；被否决，因为无法保证跨块统一错误和事务行为。

## Decision 2: 历史栈复用 ProseMirror/Tiptap 与 Yjs origin

- **Decision**: 本地编辑使用现有 Tiptap/ProseMirror history 能力；协同使用 Yjs `local` tracked origin、800ms capture window、100 步上限；远端更新和 accept/reject 不进入本地历史。
- **Rationale**: 需求已明确这些契约，且项目已经使用 Tiptap/Yjs；重复实现历史栈会增加 blockId 和协同边界风险。
- **Alternatives considered**: 自建 JSON 快照历史；被否决，因为粒度、远端隔离和编辑器 selection 恢复更难保证。

## Decision 3: 内部私有 MIME + 外部白名单清洗

- **Decision**: 内部剪贴板写入私有 MIME 与 `text/html`/`text/plain` 降级；内部数据在粘贴时重映射 blockId；外部 HTML/Markdown 只进入白名单 schema，拒绝脚本、事件属性和未知危险 URL。
- **Rationale**: 保证跨 tab 保真，同时满足外部粘贴安全和无私有 MIME 环境的可用性。
- **Alternatives considered**: 只使用 HTML；被否决，因为容器 attrs 和内部块语义会丢失。

## Decision 4: Provider 任务状态机与幂等回读

- **Decision**: survey/import/AI/妙记/跨表引用等写入统一使用 ProviderTask：queued/running/partial/succeeded/failed/rolled_back；请求带幂等 key，结果支持重试、提交、回滚和刷新回读。
- **Rationale**: `requirements/17` 的宿主契约和 `requirements/10` 的真实缺口都要求不假成功、不重复提交、可回读。
- **Alternatives considered**: 直接在 UI click handler 中调用宿主并乐观更新；被否决，因为宿主拒绝、断网和刷新会留下旧状态。

## Decision 5: 权限/异步状态使用正交投影

- **Decision**: AsyncBlockState 与 Capability 分离；状态负责数据请求生命周期，能力负责 visible/disabled/read-only/rejected；失败和无权限默认保留原内容。
- **Rationale**: 同一异步块可能在加载时拥有读权限、后续被降权；将两者混成一个枚举会造成错误覆盖。
- **Alternatives considered**: 每种块分别维护自定义状态枚举；被否决，因为矩阵不可复用且 UI 反馈不一致。

## Decision 6: 移动端和真实宿主采用可注入替代验收

- **Decision**: 真实第二账号、Safari、移动端宿主和第三方 Provider 不可用时，优先用 deterministic mock/provider 完成逻辑验收，真实环境标记 `BLOCKED`。
- **Rationale**: 不能把缺少环境证据误判为代码完成，也不能因为宿主不可用而停止 core 可测试实现。
- **Alternatives considered**: 直接跳过测试并标记 DONE；被否决，因为无法证明权限、离线和回读语义。

## Decision 7: 性能优化证据驱动

- **Decision**: 先运行现有 `check:perf`、DerivedIndex、storage 和 perf gate；只有预算超标时才实施脏区更新、IndexedDB 分层或条件性虚拟化。
- **Rationale**: 需求明确要求不为指标而无证据重构，且现有项目已有性能脚本和测试。
- **Alternatives considered**: 立即引入全量虚拟化；被否决，因为可能破坏选区、锚点和 Web Component 产物。
