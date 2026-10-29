# 外部服务块

飞书文档里有一批块，内容本身存在**别的系统**里：Jira issue、多维表格视图、思维导图、OKR、议程、白板、同步块…… 它们在 17 §17.5 的 BlockType 表里是 tier C / P3，CRUD 档标 `provider` / `unsupported`——意思是「要靠外接服务才能读写」。

本库对这 11 族 22 个 type 的处理是：`externalBlock` **一个节点 + `kind` 分叉**，卡片上明确标出「认得出来，只是没接服务」。它和「编辑器不认识这块」的 `unknownBlock` 是两回事，界面上必须能分辨。

## 登记清单

机器可读目录见 `externalBlocks.EXTERNAL_BLOCK_KINDS`，下表是它的逐字快照（CRUD 档照抄 §17.5，不做推断）：

| 族 | 卡片标题 | §17.5 type | 依赖服务 | C / R / U |
| --- | --- | --- | --- | --- |
| chat_card | 会话卡片 | 20 | 飞书会话 | `provider` / `provider` / `provider` |
| diagram | 流程图 | 21 | 流程图服务 | `unsupported` / `provider` / `provider` |
| mindnote | 思维导图 | 29 | 思维导图 | `unsupported` / `provider` / `provider` |
| view | 视图 | 33 | 多维表格 | `operation` / `block.get` / `unsupported` |
| task | 任务 | 35 | 任务服务 | `unsupported` / `unsupported` / `unsupported` |
| okr | OKR | 36 | OKR 服务 | `provider` / `provider` / `provider` |
| okr | OKR 目标 | 37 | OKR 服务 | `operation` / `provider` / `provider` |
| okr | OKR 关键结果 | 38 | OKR 服务 | `operation` / `provider` / `provider` |
| okr | OKR 进展 | 39 | OKR 服务 | `operation` / `provider` / `provider` |
| jira_issue | Jira 问题 | 41 | Jira | `provider` / `provider` / `provider` |
| folder_manager | 知识库目录 | 42 | 知识库 | `block.insert` / `provider` / `provider` |
| agenda | 议程 | 44 | 议程服务 | `web.slash` / `block.get` / `provider` |
| agenda | 议程项 | 45 | 议程服务 | `operation` / `block.get` / `provider` |
| agenda | 议程标题 | 46 | 议程服务 | `operation` / `block.get` / `editor` |
| agenda | 议程内容 | 47 | 议程服务 | `operation` / `block.get` / `editor` |
| synced | 同步块（源） | 49 | 同步块服务 | `unsupported` / `block.get` / `provider` |
| synced | 同步块（引用） | 50 | 同步块服务 | `unsupported` / `block.get` / `provider` |
| folder_manager | 子页面列表 | 51 | 知识库 | `block.insert` / `provider` / `provider` |
| board | 画板 | — | 白板 | `block.insert` / `provider` / `bridge` |
| board | 白板 | — | 白板 | `block.insert` / `bridge` / `bridge` |
| folder_manager | 文件夹管理 | — | 知识库 | `block.insert` / `provider` / `provider` |
| folder_manager | 知识库最近更新 | — | 知识库 | `block.insert` / `provider` / `provider` |

后 4 项在 §17.5 里没有分配 type 号（以名称登记），`EXTERNAL_BLOCK_KINDS` 里对应键是 `whiteboard` / `folder_manager` / `wiki_recent_update`，`type` 字段为 `null`。

## 配置与用法

外部块**默认就在 schema 里**，不需要任何 `features` 开关——它不是可选功能，而是「文档里出现这种块时不能崩」的兜底。宿主需要的是**接入判定**：

```ts
import { externalBlocks } from 'lark-doc'

const meta = externalBlocks.externalBlockMeta('jira_issue')   // { label, family, provider, crud, ... }
const caps = externalBlocks.externalBlockCapabilities('jira_issue')

caps.update
// { supported: false, mode: 'provider', errorCode: 'ERR_PROVIDER_REQUIRED',
//   reason: 'Jira 问题需接入Jira后才能更新' }
caps.delete
// { supported: true, mode: 'block-delete', errorCode: null,
//   reason: '块删除统一走 BlockModuleAPI.remove（17 §17.5）' }
```

| API | 说明 |
| --- | --- |
| `externalBlockMeta(kind)` | 取登记项；认不出的 kind 返回 `EXTERNAL_BLOCK_GENERIC` 兜底，不返回 `null`。 |
| `externalBlockCapability(kind, action)` | 单动作判定，`action` ∈ `create` / `read` / `update` / `delete`。 |
| `externalBlockCapabilities(kind)` | 四个动作一次查全，供面板渲染「哪些能点」。 |
| `externalBlockReason(kind, status)` | 卡片副文案，未接入时给可解释的原因。 |
| `isExternalKind` / `isExternalBlockType` | 目录成员判定（后者按官方 type 名）。 |
| `normalizeExternalBlock(attrs)` | attrs 落库前清洗：控制字符、长度上限、枚举归零。 |
| `externalBlockPreview(item)` | 从原始 JSON 里摘标题与链接，降级时填卡面。 |

### 错误码

| 码 | 含义 | UI 应当 |
| --- | --- | --- |
| `ERR_UNSUPPORTED_OPERATION` | §17.5 登记为 `unsupported`，官方也不支持 | 直接禁用，文案说明「不支持」 |
| `ERR_PROVIDER_REQUIRED` | 支持，但要接外部服务 | 禁用 + 给「去接入」入口，别写成「做不了」 |

::: warning 删除恒放行
§17.5 表头说明「Delete 对块统一允许通过 `BlockModuleAPI.remove`」，所以 `delete` 不参与 CRUD 档判定，**一律 `supported: true`**。否则外接服务一挂，用户就删不掉文档里的块——那是死锁。
:::

## 降级与保真

文档里的外部块会被 `validateDocument` 降级成 `externalBlock` 节点，原始 JSON **逐字节**存进 `payload`，出口由 `restoreUnknownBlocks` 还原。与 `unknownBlock` 共用同一条通道，两处差别：

- 降级分支必须排在「未知 type」**之前**，否则外部块会先被 `unknownBlock` 吃掉，`kind` 信息就没了；
- `BLOCK_ID_TYPES` 含 `externalBlock`——必须可读、可删、可保真，没有 `blockId` 就没有删除与锚点的落点。

导出侧：Markdown 与 DOCX 都会**跳过** `externalBlock`。未接入时它就是一张钥匙卡，落进纯文本只得到一串 JSON 乱码。

## 设计约定

- **不新增 22 个 ProseMirror 节点。** schema 每加一个节点就要动快照、契约、导出白名单与序列化口径，22 倍成本换不来 22 倍收益。这 11 族的共同点是同一套生命周期（未接入 → 只读 → 已接入），本就该是同一个东西——沿用 `isv` 节点既有的「一个节点背多形态」范式。
- **状态只有三档**：`unavailable` / `readonly` / `ready`，卡片靠**描边**区分（虚线 → 实线表示已接入）。这是唯一的「可用 / 不可用」视觉开关，不发明第二种。
- **颜色不新增字面值**，全部复用 `--ld-unknown-card-*` token。外部块与未知块在视觉上刻意同族，差别只在右上角角标。
- 想让某个外部块真正可编辑，宿主需要自行实现对应 Provider 并把卡片 `status` 置为 `ready`——本库只负责「认得出来 + 说得清为什么不能用 + 不丢数据」。
