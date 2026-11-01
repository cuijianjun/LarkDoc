# FR-001–FR-021 追踪表

> 状态基于 `requirements/00-README.md`、`requirements/10-缺口与待补清单.md`、`requirements/15-闭环审计与端到端流程.md` 与当前 `src/`、`test/` 代码核对。`Implemented` 表示已有主体实现，`Partial` 表示存在代码但仍需本轮契约收口。

| FR | 主题 | 当前状态 | 主要源码 | 主要测试 | 验收命令 |
|---|---|---|---|---|---|
| FR-001 | BlockAPI 统一寻址与 CRUD | Partial | `src/core/blockApi/index.js`, `src/core/blockApi/tree.js` | `test/unit/block-api.test.js` | `npm run test:unit -- test/unit/block-api.test.js` |
| FR-002 | 容器、父子关系与深度 | Partial | `src/core/blockApi/nodes.js`, `src/core/blocks/container-depth.js` | `test/unit/container-depth.test.js`, `test/unit/heading-container.test.js` | `npm run test:unit -- test/unit/container-depth.test.js test/unit/heading-container.test.js` |
| FR-003 | blockId 稳定、复制重建、移动保持 | Partial | `src/core/blocks/block-id.js`, `src/core/blockApi/nodes.js` | `test/unit/block-api.test.js`, `test/collab/anchors.test.js` | `npm run test:unit -- test/unit/block-api.test.js` |
| FR-004 | 原子事务与 operation metadata | Partial | `src/core/transactionMetadata.js`, `src/session/DocumentSession.js` | `test/unit/block-api.test.js` | `npm run test:unit -- test/unit/block-api.test.js` |
| FR-005 | 撤销/重做历史栈 | Partial | `src/components/lark-doc/extensions.js`, `src/core/transactionMetadata.js` | `test/unit/versioning-core.test.js`, `test/unit/revision.test.js` | `npm run test:unit -- test/unit/versioning-core.test.js test/unit/revision.test.js` |
| FR-006 | 协同远端 origin 隔离 | Partial | `src/collab/`, `src/core/transactionMetadata.js` | `test/unit/collab-editor.test.js`, `test/collab/converge.test.js` | `npm run test:unit -- test/unit/collab-editor.test.js` |
| FR-007 | 块级剪贴板与多块选择 | Partial | `src/core/blocks/document-commands.js`, `src/utils/importExport.js` | `test/unit/table-clip.test.js`, `test/unit/image-insert.test.js` | `npm run test:unit -- test/unit/table-clip.test.js test/unit/image-insert.test.js` |
| FR-008 | 外部内容清洗与图片失败 | Implemented | `src/utils/importExport.js`, `src/core/blocks/image-paste.js` | `test/unit/insert-atomicity.test.js`, `test/unit/export-roundtrip.test.js` | `npm run test:unit -- test/unit/insert-atomicity.test.js test/unit/export-roundtrip.test.js` |
| FR-009 | 异步块五态 | Partial | `src/core/blocks/shared.js`, async block modules | `test/unit/file-block.test.js`, `test/unit/unknown-block.test.js` | `npm run test:unit -- test/unit/file-block.test.js test/unit/unknown-block.test.js` |
| FR-010 | Capability 投影与权限降级 | Partial | `src/providers/authorization.js`, `src/core/policy/` | `test/unit/security-provider.test.js` | `npm run test:unit -- test/unit/security-provider.test.js` |
| FR-011 | 评论、提及与跨账号 | Partial | `src/providers/comments.js`, `src/core/mention/` | `test/unit/comments-core.test.js`, `test/unit/mention.test.js` | `npm run test:unit -- test/unit/comments-core.test.js test/unit/mention.test.js` |
| FR-012 | 版本只读、恢复与回读 | Partial | `src/session/DocumentSession.js`, versioning UI | `test/unit/versioning-core.test.js`, `test/unit/versioning-ui.test.js` | `npm run test:unit -- test/unit/versioning-core.test.js test/unit/versioning-ui.test.js` |
| FR-013 | 离线快照与协同恢复 | Partial | `src/core/storage/`, `src/collab/` | `test/unit/storage-idb.test.js`, `test/collab/converge.test.js` | `npm run test:unit -- test/unit/storage-idb.test.js` |
| FR-014 | survey/import/provider 写入 | Partial | `src/providers/survey.js`, `src/providers/import.js`, `src/providers/embedded.js` | `test/unit/survey-provider.test.js`, `test/unit/import-provider.test.js` | `npm run test:unit -- test/unit/survey-provider.test.js test/unit/import-provider.test.js` |
| FR-015 | A4 按钮块动作与刷新回读 | Partial | `src/core/blocks/isv.js`, `src/providers/embedded.js` | `test/unit/isv.test.js`, `test/unit/embedded-provider.test.js` | `npm run test:unit -- test/unit/isv.test.js test/unit/embedded-provider.test.js` |
| FR-016 | 回收站与删除恢复 | Partial | `src/core/versioning/`, `src/components/lark-doc/VersionPanel.vue` | `test/unit/versioning-core.test.js` | `npm run test:unit -- test/unit/versioning-core.test.js` |
| FR-017 | 复制、打印、下载、水印 | Partial | `src/providers/security.js`, `src/utils/download.js`, `src/styles/print.css` | `test/unit/security-provider.test.js` | `npm run test:unit -- test/unit/security-provider.test.js` |
| FR-018 | AuditEvent 与敏感字段隔离 | Partial | `src/providers/security.js`, `src/providers/ai.js` | `test/unit/security-provider.test.js`, `test/unit/ai-provider.test.js` | `npm run test:unit -- test/unit/security-provider.test.js test/unit/ai-provider.test.js` |
| FR-019 | 性能、派生索引与 IndexedDB | Partial | `src/core/derive/`, `src/core/storage/`, `scripts/perf/` | `test/unit/derived-index.test.js`, `test/unit/storage-idb.test.js` | `npm run check:perf` |
| FR-020 | 适配器、产物和门禁 | Implemented | `src/adapters/`, `scripts/ensure-artifacts.mjs` | adapter tests and gate scripts | `npm run check:gate && npm run check:artifacts` |
| FR-021 | 白板/画板与 webEmbed 边界 | Partial | `src/core/blocks/web-embed.js`, editor embed modules | `test/unit/web-embed.test.js` | `npm run test:unit -- test/unit/web-embed.test.js` |

## 基线环境

- Node: `v22.22.2`
- npm: `10.9.7`
- Vitest: `5.0.5`
- specify: `1.2.6.dev0`
- 当前执行 worktree: `/Users/cjjxw/codex/.wt-larkdoc/full-requirements`
- 原 `next/0.12` 工作区不得写入。
