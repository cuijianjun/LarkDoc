# 实例与事件

`new LarkDoc()` 返回一个无框架控制器，方法覆盖内容读写、选区操作、只读切换与销毁；事件既支持 `onReady/onUpdate` 这类构造参数，也支持 `doc.on('save', fn)` 这类订阅式写法。销毁顺序固定为：停止 AI → 触发事件 → 销毁编辑器 → 释放控制器与 UI 监听 → 移除 DOM。

## 方法速览

```ts
const doc = new LarkDoc({ element: '#editor', content: '<p>hi</p>' })

// 内容读写
doc.getHTML()            // string
doc.getJSON()            // Tiptap JSON
doc.getText()            // 纯文本
doc.getTitle()
doc.setTitle('项目周报')
doc.setContent('<h2>小节</h2><p>正文</p>')

// 选区与焦点
doc.focus()
doc.insert('<p>插入的段落</p>')
doc.insertText('追加文字')
doc.undo()
doc.redo()

// 状态
doc.isReadonly()
doc.setReadonly(true)
doc.save()               // 触发一次持久化
doc.setAutoSave({ enabled: false })  // 运行时关闭自动保存（不重建实例）
doc.getAutoSave()        // { enabled, delay, effective }
doc.getEditor()          // Tiptap Editor 实例
doc.getWorkspace()       // 无框架工作台控制器
doc.getConfig()          // 当前归一化后的配置

// 事件
doc.on('update', (payload) => {})
doc.off('update', handler)

// 销毁
doc.destroy()
```

## 方法与事件

### 实例方法

| 方法 | 返回 | 说明 |
| --- | --- | --- |
| `getHTML()` | `string` | 当前正文 HTML。 |
| `getJSON()` | `object` | 当前正文 Tiptap JSON。 |
| `getText()` | `string` | 纯文本内容。 |
| `getTitle()` / `setTitle(v)` | `string` / `void` | 读写文档标题。 |
| `setContent(v)` | `void` | 替换正文，支持 HTML / JSON / DocumentRecord。 |
| `insert(html)` | `void` | 在光标处插入 HTML 片段。 |
| `insertText(text)` | `void` | 在光标处插入纯文本。 |
| `focus()` | `void` | 聚焦正文。 |
| `undo()` / `redo()` | `void` | 历史操作。 |
| `isReadonly()` | `boolean` | 当前是否只读。 |
| `setReadonly(v)` | `void` | 切换只读。 |
| `save()` | `Promise` | 触发一次保存流程。 |
| `setAutoSave(patch)` | `object` / `null` | 运行时改 `{ enabled?, delay? }`，同步 `options` / `config`，重排已排队定时器；销毁后返回 `null`。 |
| `getAutoSave()` | `object` / `null` | `{ enabled, delay, effective }`；`effective` 叠加了持久化总闸。销毁后返回 `null`。 |
| `getEditor()` | `Editor` | 底层 Tiptap 实例，用于高级扩展。 |
| `getWorkspace()` | `WorkspaceController` | 无框架工作台控制器（含模板、快照、AI 状态）。 |
| `getConfig()` | `object` | 当前归一化后的完整配置，包含工作台配置热更新。 |
| `on(event, fn)` / `off(event, fn)` | `void` | 事件订阅。 |
| `destroy()` | `void` | 销毁实例并移除 DOM。 |

### 事件

| 事件 | 回调参数 | 说明 |
| --- | --- | --- |
| `ready` | `{ document, editor, workspace }` | 编辑器挂载完成。 |
| `update` | `{ html, json, text, title }` | 正文变更（受 `performance.changeDebounce` 影响）。 |
| `change` | `{ html, json, title }` | 编辑器原生 change 事件。 |
| `title-change` | `string` | 标题变更。 |
| `save` | 保存结果 | `doc.save()` 或自动持久化后触发。 |
| `import-report` | 转换报告 | 旧数据（Vditor HTML）归一化完成。 |
| `error` | `Error` | 初始化或运行时错误。 |
| `destroy` | - | 实例销毁。 |

### 构造回调与事件对应

| 构造参数 | 等价事件 |
| --- | --- |
| `onReady` | `ready` |
| `onUpdate` | `update` |
| `onChange` | `change` |
| `onSave` | `save` |
| `onImportReport` | `import-report` |
| `onError` | `error` |
| `onDestroy` | `destroy` |

::: warning 销毁时机
`destroy()` 之后所有方法失效。在 Vue `beforeDestroy` / React `useEffect` 清理里调用一次即可，重复调用是安全的（内部做了幂等处理）。
:::
