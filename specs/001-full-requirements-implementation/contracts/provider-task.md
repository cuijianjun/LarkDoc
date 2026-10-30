# ProviderTask Contract

Provider 写入必须接受 `{ kind, payload, idempotencyKey, signal }`，返回任务句柄或确定性错误。

任务状态：`queued`、`running`、`partial`、`succeeded`、`failed`、`rolled_back`。

必须支持：查询进度、重试失败项、提交、回滚、刷新回读。重复使用同一幂等 key 不得创建重复宿主副作用。宿主拒绝、网络失败和超时不得在 editor/core 中伪造成功。
