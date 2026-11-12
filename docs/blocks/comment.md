# 评论

评论由 `comments` Provider 保存，正文只保存线程锚点。原绿色主题使用现有语义色。

活动评论解决后进入“历史评论”；文档顶栏更多菜单调用 `openCommentHistory(event?)`。
历史弹层宽 360px、头部高 48px，按 `canEdit` 与 `canView` 能力开放（切换阅读模式不等于失去权限），
显示“已解决此评论”和“重新打开”。重新打开使用已有
`reopen(threadId)`，成功刷新后恢复活动卡。失败保留历史条目，不以本地改状态冒充保存成功。
顶栏可调用 `commentCanViewHistory()` 判断入口能力，不依赖版本历史 feature。

历史垃圾桶使用可选 `deleteThread({ threadId, author }) => Promise<true>` 原子接口，并遵守
`canView + canEdit + canComment` 能力。内存 Provider 用一次 `Map.delete` 实现且允许幂等重放。没有该方法时置灰；失败或
非 `true` 响应保留线程并提示，等待时禁止重复删除，迟到响应不得作用于新会话。不会把多次 `deleteReply`
拼成线程级原子操作。此接口是本地已实现的宿主能力；源历史垃圾桶的永久删除流程尚未实测，不标源验收完成。

## 图片

Provider 必须显式声明 `supportsAttachments: true`，才能接受评论图片。此声明表示
`createThread`、`reply`、`list` 均支持回复上的 `attachments`，而非只支持上传文件。
没有声明时图片按钮置灰。`createMemoryCommentsProvider()` 已实现此能力，但它是内存存储。

```js
{
  content: '', // 至少有一张图片时允许空文字
  attachments: [{
    url: '/uploads/comment.png', // 同上传 Provider 的结果
    name: 'comment.png',
    mime: 'image/png',
    size: 1234,
    attchId: 'optional-attachment-id',
  }],
}
```

图片复用 `uploader` / `uploadImage` 及现有上传校验、进度、重试和 AbortSignal；未配置上传器时
复用现有本地 FileReader 上传器。评论专用 MIME 为 `image/gif,image/jpg,image/jpeg,image/bmp,image/png`，
多选。默认大小上限沿用编辑器图片配置。失败保留文字与图片草稿，可重试或移除；未上传完成或存在失败项时
不发送。发送成功仅移除该次发送的图片与未变更的文字，避免清掉发送期间新写的草稿。
封面外框为 64×64，图片为 62×62、`object-fit: cover`、圆角 5px，草稿删除命中区为 24×24。
已保存缩略图打开现有图片查看器，以 100% 初始缩放展示；查看器使用 `initialScale: 1` 选项。

URL 经过现有安全校验；已保存图片按当前网络策略决定是否加载。非 open 模式的自定义上传器必须声明
`offline: true`（承诺本地处理），或提供已被策略允许的 `action` 地址。未知上传目的地不放行。
切换文档、评论 Provider、上传器或网络策略，以及权限撤销，会取消或隔离旧任务。编辑器只读模式不会
授权正文写入；评论独立遵守 `canComment`。

## 翻译和举报

现有五个必需方法不变。以下可选方法存在且有 `canView` 时菜单才启用。未配置时不使用模拟结果或默认远程接口。

```js
translateReply({
  documentId, threadId, commentId,
  author, // 当前操作人
  replyAuthor, // 被操作评论的作者
  content, targetLanguage: 'en', signal,
}) // => Promise<{ content: string }>

reportReply({ documentId, threadId, commentId, author, replyAuthor, content, signal })
// => Promise<{ url: string }>
```

翻译结果只改变阅读呈现，保留源内容，显示 `Translated by AI`，悬停或聚焦“查看原文”查看源文；点击返回原文。
空译文视为失败，保留原文；翻译进行中可取消。举报菜单在用户点击时先打开隔离 opener 的空白页，收到安全的
HTTP(S) URL 且当前网络策略允许后才导航到举报服务页面。被阻止的弹窗、失败、空结果或无效 URL 均不报成功；
失败会关闭该空白页。返回 URL 代表打开举报表单，不代表举报已提交。举报的原因选择和实际提交由宿主服务页面负责。

可选服务接收 AbortSignal；实现方负责自己的认证、传输和服务端授权。换文档、换 Provider、销毁、撤销能力或
评论被编辑/删除后，旧结果不能更新当前评论。内存 Provider 不伪造翻译或举报服务。
