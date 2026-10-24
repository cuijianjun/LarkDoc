# 协同服务端契约

lark-doc 的协同服务端是**独立 package `@lark-doc/collab-server`**（独立仓库、独立发布），不在本仓库。本页是它的**实现契约**：任何满足本契约的服务端（自研或第三方）都能驱动 lark-doc 客户端，客户端代码只对契约编程。

本仓库只保留三样：① 客户端入口 `lark-doc/collab`（`src/collab/index.js`）；② 本契约文档；③ e2e 里用第三方 `@hocuspocus/server` 起内存实例。

## 协议版本

- 契约版本常量：`COLLAB_PROTOCOL_VERSION = 1`（`import { COLLAB_PROTOCOL_VERSION } from 'lark-doc/collab'`）。
- 握手时**双向校验**：客户端与服务端各自上报版本，不一致 → 客户端抛 `E_PROTOCOL_MISMATCH`，**不回退、不静默、不半连**。
- 破坏性协议变更走 `/2` 新版本，不做兼容层。

## 客户端签名（P6a 实现）

```ts
// lark-doc/collab 子入口（src/collab/index.js，当前仅签名）
createCollabExtensions({ ydoc, onError })        // → [Collaboration, CollaborationCaret?]
createHocuspocusBridge({ url, documentId, token, user })
                                                 // → { ydoc, provider, destroy }
createCommentAnchors({ ydoc })                   // Y.RelativePosition 编解码（P6b）
```

## 服务端契约

| 项 | 契约 |
| --- | --- |
| 传输 | WebSocket，Hocuspocus 兼容协议（`@hocuspocus/server` 可直接满足） |
| 文档键 | `documentId` 由宿主给（建议 `<workspaceId>/<docId>`），服务端只当**不透明字符串**，不做解析 |
| 落盘格式 | 键 = `documentId`，值 = `Y.encodeStateAsUpdate` 二进制，与 Yjs 小版本解耦；具体存储由服务端负责 |
| 鉴权 | `onAuthenticate({ token, documentName })` → `{ user: { id, name, color }, capabilities }`；失败直接拒连 |
| 只读双保险 | `capabilities.canEdit === false` 时**服务端也要拒写**——客户端 `setEditable(false)` 只是 UI，双保险才算数 |
| 版本快照 | HTTP 形状：`POST /documents/:id/snapshots`、`GET /documents/:id/snapshots/:sid`，返回二进制 + 元信息；编辑器只消费，不实现 |
| 播种 | 空文档首次连接由服务端播种初始状态；同一文档多个客户端进入，初始正文只出现一次 |

## 评论锚点边界

评论 anchor 用 `Y.RelativePosition`（要求 `new Y.Doc({ gc: false })`）+ `blockId` 双保险，不用瞬时 from/to 坐标；并发编辑下锚点不漂移。

## 嵌入块协同边界（C9）

iframe 里的运行时归那个 app 管：两端 iframe 各自独立加载、不互相驱动；编辑器只同步「打开它的钥匙」（`providerId` / `src` / `title` / `height` 等 attrs），`src` 冲突以最后写入为准。若嵌入应用自身支持多人协同（如 Luckysheet），多人同时编辑由它负责——编辑器**不假装**替它做协同。

## 开发联调（本仓库 e2e）

```js
// 仅 test/ 下允许出现；CI 断言 hocuspocus 不得泄漏到 src/
import { Server } from '@hocuspocus/server'
const server = new Server({ port: 0, extensions: [] }) // 内存实例、随机端口
```

## 部署（nginx 反代）

```nginx
location /collab {
  proxy_pass http://127.0.0.1:9010;
  proxy_set_header Upgrade $http_upgrade;   # WebSocket 升级
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 3600s;                  # 长连接不断
}
```

## 服务端代码为什么不在本仓库

1. Node 版本不同：本仓构建链 Node 14，服务端 18+；
2. 发布节奏不同：客户端跟版本走，服务端跟部署走；
3. 服务端要接 Postgres / Redis / 鉴权 / 多实例，属运维领域——塞进来会污染本仓 `files` 白名单与 CI。

边界靠 CI 守：`hocuspocus/server` 只准出现在 `test/`，出现第二个位置就红（`scripts/check-architecture.js` 断言）。
