# Feishu Document 包接入指南

## 目标

`@tiptap-integration/feishu-document` 把飞书风格文档能力作为可复用 Vue 2 包提供。宿主应用负责路由、业务页面和权限上下文；包负责编辑器、工作台、文档转换和本地单人模式。

## 对外组件

- `FeishuDocumentEditor`：Tiptap 编辑器、工具栏、块菜单、表格、图片、公式、目录、搜索替换和编辑辅助。
- `FeishuDocumentWorkspace`：编辑器之上的标题、模板、本地草稿、本地快照、导入导出和 Mock AI 预览。

## 迁移基线

正文以 Tiptap JSON 作为完整结构，HTML 继续作为 Vue 2 `v-model` 兼容入口。当前默认 Provider 是本地浏览器存储，不主动创建网络连接。复杂块、图片属性和公式应使用 JSON 保存。

## 后续扩展边界

后续重构会在不改变两个组件入口的前提下增加：

- `DocumentSession`：协调编辑器、文档状态、事务、连接和能力。
- `collaboration` Provider：协同文档、在线状态和远端更新。
- `versioning` Provider：不可变快照、比较和恢复。
- `comments` Provider：评论线程、回复、锚点和解决状态。
- `authorization` Provider：查看、编辑、评论、恢复和导出等能力。

评论锚点使用稳定块 ID 和 Provider 位置抽象，版本快照带有 `schemaVersion`，在线光标等 awareness 数据不写入正文版本。服务端权限是最终判断，组件的只读状态只负责交互表现。

## Demo 接入

`vue2-webpack-node14` 通过本地包依赖调用 `FeishuDocumentWorkspace`，只保留路由和 Demo 页面入口。运行时仍锁定 Node 14.21.3、npm 8.19.4、Vue 2.7.14 和 Tiptap 3.27.4。
