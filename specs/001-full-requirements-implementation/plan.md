# Implementation Plan: 按需求文档完成 lark-doc 全量代码逻辑

**Branch**: `spec-kit/requirements-audit` | **Date**: 2026-10-30 | **Spec**: [spec.md](./spec.md)

## Summary

本计划将 `requirements/` 中已确认属于当前 lark-doc 0.12 范围的需求，转换为可逐阶段实现和验收的代码任务。当前项目已有大量主体能力，计划不重复实现已完成模块，而是先建立真实基线，再从 Core/Workflow 地基开始，依次收口异步状态、宿主 Provider、协同跨端、输出安全、性能和交付门禁。

技术策略：保持 `src/core` 框架无关；Vue 2.7 + Tiptap 3.32 继续作为主要 UI 载体；React/Vue3/Web Component 只维护适配边界；Yjs/Hocuspocus 负责协同；宿主能力通过可注入 Provider 和明确错误/权限契约接入；所有不能在当前环境取得真实宿主或浏览器证据的项目标记为 `BLOCKED`，不得伪报完成。

## Technical Context

**Language/Version**: JavaScript, Vue 2.7.14, Node.js >=14.21.3, npm >=8.19.4

**Primary Dependencies**: Tiptap 3.32.0, ProseMirror via `@tiptap/pm`, Yjs 13.6.33, Hocuspocus 4.7.1, Vue CLI 5, Vitest 5, jsdom, mammoth, marked, turndown, docx

**Storage**: Provider 抽象；持久化与协同由宿主 Provider/Yjs/Hocuspocus 提供；离线能力使用 IndexedDB 分层存储；不得把第三方 token 写入 core/editor 状态。

**Testing**: Vitest 单元测试；协同测试位于 `test/collab/`；浏览器/产物/架构/主题/性能由 `scripts/` 和 package scripts 验证；必要时增加 Safari、移动端和宿主注入测试。

**Target Platform**: 桌面现代浏览器、Safari 验证矩阵、移动端独立 runtime 契约；Node 14+ 构建与验证环境；Vue2、Vue3、React、Web Component 适配产物。

**Project Type**: 可复用文档编辑器前端库 + Vue 工作区 UI + 协同/Provider 集成层。

**Performance Goals**: 以 `requirements/09` 和现有 `check:perf` 基线为准；至少覆盖首屏、击键帧、decorations、滚动 FPS、保存耗时、堆内存、2,000 块文档预算和包体预算。优化前必须先有可复现基线。

**Constraints**: 保留现有 API 和产物兼容性；core 不依赖 Vue；复制/粘贴副本必须重建 blockId，移动/撤销/重做/评论锚点保持预期 ID；Provider 失败不得产生假成功、误删或覆盖；离线单份快照遵守 512KB 限制；不实现已审计明确不做的兄弟产品和不存在的飞书 UI。

**Scale/Scope**: 18 份需求文档、约 26,188 行需求材料、约 298 个 src 文件、约 80 个测试文件；覆盖 21 项功能需求、6 条用户旅程、18 类块与跨切面编辑/协同/Provider/输出能力。

## Constitution Check

项目当前未提供 `.specify/memory/constitution.md`，因此本次按需求规格和既有架构门禁执行等价约束：

- **Core 边界**：核心模型、命令、BlockAPI、策略和数据结构不得依赖 Vue。
- **契约优先**：公共 BlockAPI、Provider、协同 origin、错误码和状态矩阵先定义再实现。
- **可验证交付**：每项需求必须映射到源码、测试和验收命令；真实宿主不可用时必须保留确定性替代测试并标记 BLOCKED。
- **兼容性保护**：不破坏现有 Vue2 入口、React/Vue3/Web Component 适配器、构建产物和 Node 14 约束。
- **安全失败**：权限拒绝、网络失败、超限、部分成功和重复回调不能改变原有有效数据。

**Gate result**: PASS（无 constitution 文件可加载，但已采用项目现有架构与门禁约束；无已知需要架构例外的设计）。

## Research Summary

详细决策见 [research.md](./research.md)。关键结论：

1. BlockAPI 作为所有结构操作的唯一入口，事务和权限检查集中在 core。
2. 历史栈优先复用 Tiptap/ProseMirror 能力；协同场景使用 Yjs tracked origin `local`，800ms capture window，100 步上限。
3. 剪贴板使用私有内部 MIME + `text/html`/`text/plain` 降级；所有外部内容经过白名单转换和 ID 重映射。
4. Provider 写入采用幂等 key、任务状态机、回读和可重试错误；宿主实现留在 Provider，不下沉到 core。
5. 移动端、Safari、真实第二账号和真实宿主写入优先使用确定性注入测试，真实环境未具备时只能标记 BLOCKED。
6. 性能优化以现有 `check:perf`、DerivedIndex、IndexedDB 测试为证据门槛，不预先引入无证据的虚拟化或重构。

## Project Structure

### Documentation

```text
specs/001-full-requirements-implementation/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── block-api.md
│   ├── provider-task.md
│   ├── capability-state.md
│   └── output-audit.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code

```text
src/
├── core/
│   ├── blockApi/          # 统一块操作、树结构和事务
│   ├── blocks/            # 块 schema、命令、ID 和容器
│   ├── derive/            # 派生索引和增量更新
│   ├── policy/            # capability、权限和安全策略
│   ├── storage/           # IndexedDB/快照分层
│   └── transactionMetadata.js
├── collab/                # Yjs/Hocuspocus 协同和锚点
├── providers/             # persistence、comments、security、import、survey、AI 等
├── session/               # DocumentSession 与 Provider 生命周期
├── components/lark-doc/   # Vue2 编辑器、工作区、浮层和输出 UI
├── adapters/              # Vue2/Vue3/React 适配
└── web-component/         # Web Component 入口

test/
├── unit/                  # core、UI、Provider、适配器和性能单测
├── collab/                # 收敛、wire、锚点和协同回归
└── browser/               # 浏览器矩阵（按环境可用性执行）

scripts/
├── check-*.js             # 架构、部署、主题、产物和门禁
├── perf/                  # 性能采集和报告
└── verify.mjs             # 验证场景编排
```

**Structure Decision**: 采用现有单仓库库项目结构，不新增 backend/frontend 拆分。core、collab、providers、Vue UI 和 adapters 按职责隔离；测试按 unit/collab/browser 分层；任何新模块必须落入既有边界。

## Implementation Phases

### Phase 0: 基线和设计冻结

- 运行并记录 `test:unit`、`check:gate`、`check:artifacts`、`verify:all`、架构和性能预检。
- 以 `data-model.md` 与 contracts 固化 Block、History、Clipboard、Capability、AsyncBlockState、ProviderTask、Snapshot、AuditEvent。
- 对外部环境依赖设置 BLOCKED 规则和替代测试。

### Phase 1: Core 地基（MVP）

- 完整统一 BlockAPI：CRUD、move、duplicate、transform、children、batch、权限、事务、回滚、事件。
- 历史栈：800ms 分组、100 步、本地 origin、远端隔离、accept/reject 不入栈、blockId 恢复。
- 块级剪贴板和多块选择：内部 MIME、容器子树、外部 HTML/Markdown 清洗、失败恢复。
- 引用/标题容器和 derive 索引调用链。

### Phase 2: 异步块和宿主写入

- 统一五态矩阵和 capability projection。
- A4 按钮动作、删除后刷新回读。
- survey/import/AI/妙记/跨表引用等可用 Provider 的幂等写入、任务进度、重试、提交、回滚和回读。

### Phase 3: 协同、跨端和安全输出

- 第二账号、mention、评论、Safari 回读和版本只读。
- 移动端 runtime、通知、锚点、横屏、离线快照与恢复同步。
- 回收站、复制/打印/下载/水印、截图与审计策略。

### Phase 4: 性能、白板边界和交付

- 建立性能/存储证据，按需实现 DerivedIndex、脏区更新、IndexedDB 分层或 webEmbed 骨架。
- 全量单测、协同、浏览器、架构、产物、主题和门禁回归。
- 同步 `spec.md`、根 `tasks.md` 和需求文档状态。

## Complexity Tracking

无需要突破现有项目边界的复杂度例外。若实施中必须新增跨层依赖，必须先更新 contracts、说明替代方案，并在评审前暂停代码实现。
