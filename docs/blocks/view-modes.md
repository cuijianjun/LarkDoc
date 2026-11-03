# 视图模式

视图模式组件提供阅读模式、演示（幻灯）模式、全屏与文档宽度切换，均归属工具栏 `viewModes` 分组。只读预览可配合 `readonly` 实现纯展示页。

## 配置示例

```ts
new LarkDoc({
  element: '#editor',
  features: { viewModes: true },
  toolbarKeys: ['viewModes'],     // 别名 fullscreen / read / preview / slides / theme
})
```

## 配置与用法

| 模式 | 说明 |
| --- | --- |
| 阅读模式 | 隐藏编辑交互（块句柄、气泡菜单），保留目录与滚动。 |
| 演示模式 | 按章节分页展示，适合评审走查。 |
| 全屏 | 编辑区铺满视口。 |
| 宽度切换 | 标准 / 宽幅两种版心宽度。 |

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `features.viewModes` | `boolean` | `true` | 关闭后视图切换入口隐藏。 |
| `readonly` | `boolean` | `false` | 从构造参数或 `doc.setReadonly()` 传入。 |
| `layout.titleBarFixed` | `boolean` | `false` | 标题栏是否吸附顶端（配合长文阅读）。 |
| `layout.toolbarFixed` | `boolean` | `false` | 格式工具栏是否吸附顶端；与 `titleBarFixed` 同开时固定在标题栏下方。 |
| `layout.headerVisible` | `boolean` | `true` | 是否显示顶部标题栏。置 `false` 时整行隐藏，原 `header-actions` 插槽内容（保存 / 模板 / 导入导出等）自动移入格式工具栏右侧「⋯」下拉弹窗。 |

::: tip 纯只读预览页
```ts
new LarkDoc({ element: '#preview', readonly: true, features: { ai: false, search: false } })
```
推荐同时关掉与编辑态绑定的入口，让预览页更干净。
:::

## 三态模式：编辑 / 修订 / 阅读

顶栏右上角的「编辑 / 修订 / 阅读」按钮，三种状态由构造参数里的 `modes` 控制。下面五项分别控制默认状态、可选项、记忆、文案和快捷键：

```js
new LarkDoc({
  element: '#editor',
  modes: {
    default: 'edit',                    // 首屏模式
    allow: ['edit', 'suggest', 'read'], // 下拉里保留哪几项
    persist: true,                       // 记住上次的选择
    labels: { read: '预览' },             // 改叫法
    shortcuts: true,                     // ⌘⌥E / ⌘⌥X / ⌘⌥V
  },
})
```

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `default` | `'edit'` | 不在 `allow` 里会自动回落到 `allow[0]`。 |
| `allow` | 三项全留 | 只剩一项时按钮退化成静态文字：没有箭头、点不动。 |
| `persist` | `true` | `false` = 不读写 `localStorage`。 |
| `labels` | `{}` | 只认三个已知键，值是非空字符串。 |
| `shortcuts` | `true` | `false` = 键位不接管，也不会 `preventDefault`。 |

| 想做的事 | 写法 |
| --- | --- |
| 不让用户进修订态 | `allow: ['edit', 'read']` |
| 完全锁死在编辑态 | `allow: ['edit']` |
| 打开就是只读 | `default: 'read'` |
| 每次进来都回到默认 | `persist: false` |
| 把「修订」改成「审阅」 | `labels: { suggest: '审阅' }` |

```js
// 只读站：不留修订入口，打开即阅读态，也不记状态
new LarkDoc({ element: '#viewer', modes: { allow: ['edit', 'read'], default: 'read', persist: false } })
```

几点要注意：

- 下拉菜单的选中行会跟随当前主题配色；绿档显示绿色，飞书主题显示蓝色。
- 悬停按钮即可打开菜单，移开鼠标会自动收起；点击选项、按 Esc 或点击外部都可以关闭。
- **配置压不过会话权限**：没有编辑权限时 `suggest` 会被降级成 `read`，配 `allow: ['suggest']` 也强开不出来。
- **`allow` 传空数组等于没传**：空数组 / 非法值一律回落成三项全留，避免一次笔误把整个功能吞掉。想关切换写 `allow: ['edit']`。
- **摘掉 `read` 会连带隐藏**：工具栏「阅读模式」按钮、工具栏「⋯」里的阅读项都会跟着消失 —— 留着也是点了不生效。
- `features.viewModes: false` 关的是工具栏那一组（宽度 / 演示 / 全屏 / 阅读），**顶栏三态按钮不受它管**，要收三态请用 `modes`。
- `shortcuts: false` 只关实际按键，快捷键帮助面板（⌘/）里那三行是静态文案，不跟着消失。
