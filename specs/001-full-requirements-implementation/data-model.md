# Data Model: 全量需求实现

## Block

| 字段 | 类型 | 约束 |
|---|---|---|
| `blockId` | string | 文档内稳定唯一；复制/粘贴重新生成，移动/撤销/重做保持预期 ID |
| `type` | string | 必须是已注册块类型或进入 unknown-block 降级 |
| `attrs` | object | 由块 schema 校验；不得携带第三方凭据 |
| `parentId` | string/null | 根块为 null；父节点必须存在且不能形成循环 |
| `children` | string[] | 顺序稳定；只能引用直接子节点 |
| `asyncState` | enum | `empty/loading/failed/unauthorized/over_limit`，仅异步块使用 |
| `capabilities` | object | visible/read/edit/delete/comment/restore 等能力投影 |

## BlockOperation

| 字段 | 类型 | 约束 |
|---|---|---|
| `operation` | enum | insert/update/remove/move/duplicate/transform/get/children/batch |
| `blockIds` | string[] | 所有 ID 必须存在或按操作契约允许为空 |
| `origin` | string | local/remote/provider/system；影响历史与审计 |
| `transactionId` | string | 用于原子提交、失败回滚和幂等关联 |
| `capability` | string | 执行前检查；拒绝不改变文档 |

## HistoryEntry

- `steps`: 可逆编辑步骤。
- `blockIds`: 受影响的稳定 ID。
- `origin`: 本地 `local` 或远端/系统来源。
- `capturedAt`: 分组时间。
- `groupKey`: 约 800ms 窗口内合并。
- 限制：本地最多 100 步；远端更新、accept/reject 不入本地栈。

## ClipboardPayload

- `mime`: 私有内部块 MIME、`text/html`、`text/plain`。
- `schemaVersion`: 版本号。
- `blocks`: 序列化块子树。
- `idMap`: 原 blockId 到新 blockId 的映射。
- `sanitized`: 是否经过外部内容白名单清洗。
- `failure`: 空剪贴板、损坏 MIME、图片上传失败等可恢复错误。

## Capability

- `visible`, `read`, `edit`, `delete`, `comment`, `restore`, `duplicate`, `export`。
- 投影结果：visible、disabled、read-only、rejected。
- 权限变化必须可从可写降级到只读，不得通过 UI 或 API 绕过。

## ProviderTask

| 字段 | 类型 | 约束 |
|---|---|---|
| `taskId` | string | 宿主任务唯一标识 |
| `kind` | enum | survey/import/ai/meeting-notes/cross-table/subscription/template |
| `status` | enum | queued/running/partial/succeeded/failed/rolled_back |
| `idempotencyKey` | string | 同一逻辑提交重复请求必须复用 |
| `progress` | number | 0–100 |
| `items` | array | 逐项结果、错误和可重试状态 |
| `snapshot` | object | 提交/回滚/刷新回读依据 |

## DocumentSnapshot

- `docId`, `versionId`, `content`, `source`, `createdAt`, `sizeBytes`。
- 离线单份快照最大 512KB；超限时拒绝或分层保存并返回明确错误。
- 刷新回读必须能区分当前、旧、删除、恢复和不可用状态。

## AuditEvent

- `eventId`, `actorId`, `docId`, `action`, `result`, `reason`, `source`, `timestamp`, `sensitiveFields`, `taskId`。
- 用于复制、输出、权限拒绝、Provider 写入和敏感字段处理；不记录第三方 token。

## 状态关系

```text
ProviderTask: queued -> running -> succeeded
                           ├-> partial -> succeeded
                           ├-> failed -> running (retry)
                           └-> rolled_back
AsyncBlockState: empty -> loading -> empty|failed|unauthorized|over_limit
Capability: editable -> read_only -> rejected
DocumentSnapshot: current -> stale -> restored|deleted|unavailable
```
