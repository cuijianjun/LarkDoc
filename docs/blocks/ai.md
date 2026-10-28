# AI 组件

AI 组件提供选区 / 整块的 AI 交互面板，内置 11 种动作（续写、改写、扩写、精简、摘要、翻译、校对、正式语气、友好语气、生成标题、生成大纲），默认由内置 Mock 流式输出驱动，可完整走通交互；接入真实模型只需提供 `ai.stream` 函数。

## 配置示例

```ts
new LarkDoc({
  element: '#editor',
  features: { ai: true },
  ai: {
    // 宿主接管：返回可取消的流式控制器
    stream: (action, text, options) => {
      // action: { value: 'rewrite', label: '改写' }
      // text:   上下文文本（选区 / 当前块）
      // options: { prompt, language, appendMessage } 等
      return myLLMStream({
        prompt: buildPrompt(action, text),
        onStart: () => {},
        onChunk: (chunk) => process.stdout?.write(chunk),
        onDone: () => {},
        onError: (err) => {},
      })
    },
  },
})
```

## 配置与用法

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `features.ai` | `boolean` | `true` | 关闭后 AI 面板与工具栏入口隐藏。 |
| `ai.stream` | `(action, text, options) => StreamController` | 内置 Mock | 宿主接管生成。控制器需提供 `cancel()`。 |

### 内置动作（AI_ACTIONS）

| value | label | value | label | value | label |
| --- | --- | --- | --- | --- | --- |
| `continue` | 续写 | `rewrite` | 改写 | `expand` | 扩写 |
| `shorten` | 精简 | `summarize` | 摘要 | `translate` | 翻译 |
| `proofread` | 校对 | `formal` | 正式语气 | `friendly` | 友好语气 |
| `title` | 生成标题 | `outline` | 生成大纲 | | |

### 上下文来源（AI_CONTEXTS）

| value | label |
| --- | --- |
| `none` | 无上下文 |
| `selection` | 当前选区 |
| `block` | 当前块 |
| `document` | 全文 |

### 交互流程

| 入口 | 行为 |
| --- | --- |
| 工具栏 AI 按钮 / 气泡菜单 | 打开 AI 面板，选择动作与上下文。 |
| 流式输出 | 预览区逐字显示，可随时停止。 |
| 确认 / 放弃 | 确认后写入文档（并入撤销历史）；放弃不改动正文。 |
| 校对 | 额外输出问题清单（Mock 内置规则审查）。 |

::: warning 生命周期
实例销毁时自动取消进行中的 AI 流（停 AI → 触发事件 → 销毁编辑器），不会出现销毁后仍写入的回调。
:::
