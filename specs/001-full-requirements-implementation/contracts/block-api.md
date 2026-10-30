# BlockAPI Contract

公共入口必须提供：`insert`、`update`、`remove`、`move`、`duplicate`、`transform`、`get`、`children`、`batch`。

- 非法 `blockId`、非法父节点、循环引用、无权限或事务失败：拒绝并保持文档不变。
- `duplicate`/paste：所有副本重生成 blockId，并返回原 ID 到新 ID 的映射。
- `move`/undo/redo：保留预期 blockId、父子关系和锚点。
- `batch`：原子提交；任一操作失败则整体回滚。
- 每次成功操作产生可观察 operation/event 结果，错误使用稳定 code 和 message。
