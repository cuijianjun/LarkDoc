# 协同与权限

lark-doc 的协同、权限、版本、评论能力都收敛在 `DocumentSession` 会话层。编辑器组件只依赖会话，宿主通过替换 Provider 接入自己的后端，UI 代码零改动。

## 架构分层

```
宿主应用
  └─ LarkDoc（门面：配置翻译 + 会话透传）
       └─ LarkDocWorkspace（草稿 / 快照 / AI / 导入导出）
            └─ DocumentSession（协同 / 权限 / 版本 / 评论 Provider 的宿主）
                 ├─ persistence     持久化（load/save/snapshots/snapshot/restore）
                 ├─ collaboration   协同连接（connect/disconnect）
                 ├─ versioning      版本快照（list/createSnapshot/get/restore）
                 ├─ comments        评论（list/createThread/reply/resolve/reopen）
                 └─ authorization   权限能力（getCapabilities）
```

## 快速接入

### 方式一：直接传会话实例

```ts
import { createLarkDoc, createDocumentSession } from 'lark-doc'

const session = createDocumentSession({
  documentId: 'doc-1',
  user: { id: 'u-1', name: '张三' },
  providers: {
    collaboration: myCollaborationProvider, // 实现 connect/disconnect
    authorization: myAuthorizationProvider, // 实现 getCapabilities
  },
  mode: 'collaborative',
})

const doc = createLarkDoc({ element: '#editor', session })
```

### 方式二：散配置快捷项（门面代建会话）

```ts
const doc = createLarkDoc({
  element: '#editor',
  documentId: 'doc-1',
  user: { id: 'u-1', name: '张三' },
  collaboration: myCollaborationProvider,
  authorization: myAuthorizationProvider,
  // 等价于 providers: { collaboration, authorization }
})
```

门面代建的会话随 `doc.destroy()` 一起释放；宿主传入的 `session` 由宿主自行管理生命周期。

## 实例方法

| 方法 | 说明 |
| --- | --- |
| `doc.getSession()` | 返回 `DocumentSession` 实例，可进一步 `getProvider(name)` / `on('capabilities')`。 |
| `doc.can(capability)` | 查询权限能力（如 `canEdit`、`canCreateVersion`）；未配置授权 Provider 时默认放行。 |
| `doc.connectCollaboration()` | 连接协同服务，返回连接结果；本地模式返回 `{ status: 'local' }`。 |
| `doc.disconnectCollaboration()` | 断开协同连接。 |

## 权限能力

UI 用能力值控制交互（例如 `canEdit: false` 时编辑区自动转为只读、命令入口禁用），服务端始终是最终授权方：

```ts
const capabilities = {
  canView: true,        // 默认 true
  canEdit: true,        // false 时编辑区只读
  canComment: true,
  canCreateVersion: true,
  canRestoreVersion: true,
}
```

授权 Provider 只需实现一个方法：

```ts
const authorization = {
  async getCapabilities({ documentId, user }) {
    return fetch(`/api/docs/${documentId}/acl?user=${user.id}`).then(r => r.json())
  },
}
```

## 协同 Provider 契约

```ts
const collaboration = {
  // 必需：建立连接。返回 { status, ... } 会通过 session.emit('connection') 广播。
  async connect({ documentId, user, session }) { ... },
  // 必需：断开连接。
  async disconnect({ documentId, session }) { ... },
}
```

Tiptap 底层基于 Yjs。宿主接入 Yjs 服务时，可在 `connect()` 里把 `session.getEditor().view` 的文档与 Y.Doc 绑定（如使用 `y-prosemirror`），或直接传 `@hocuspocus/provider` 的能力包装成上述契约。

## 版本与评论

会话层的版本 / 评论方法带权限把关，宿主按钮直接调用即可：

```ts
await session.createVersion({ label: '发布前快照' })   // 检查 canCreateVersion
await session.restoreVersion('rev-42')                 // 检查 canRestoreVersion
```

::: tip 事务来源
会话的 `dispatch(transaction, { origin, actorId })` 会给每次 ProseMirror 事务写入来源元数据（host / import / ai / remote…），协同实现可据此区分本地与远端变更，避免回环。常量见 `TRANSACTION_ORIGINS`。
:::
