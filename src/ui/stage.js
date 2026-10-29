/**
 * 幻灯片演示舞台 —— `editor/PaperStage.vue` 的原生等价物（阶段 5 批次 5F）。
 *
 * 这是阶段 5 里唯一一个**用条件把整页正文换掉**的组件（其余都是浮层 / 面板），所以
 * 三条语义比结构更值得写清楚：
 *
 * 1. **开合是 `v-if`，不是 `v-show`** —— 关掉时整棵真的不在 DOM 里。这里就是
 *    `mountNode(host, el, on)`：`on === false` 即 `removeChild`。别为了「省一次
 *    重建」改成常驻 + `display:none`，那会让演示稿的 `h1` / 正文在非演示态也能被
 *    读屏和 `querySelector` 读到（断言 `[开合] 非演示态舞台不在 DOM 里` 就是锁这个）。
 * 2. **与 `.lark-doc-paper` 是二选一，但两者手段不同**：纸张容器是 `v-show`
 *    （始终在 DOM 里、只切 `display`，由主壳负责），舞台是 `v-if`。所以「演示态下
 *    `document.querySelector('.lark-doc-paper')` 仍然找得到」是正确的，不要当成 bug。
 * 3. **舞台不是浮层**：它是 `.lark-doc-main` 的**首个子元素**，靠 `min-height: 70vh`
 *    撑满一屏。宿主因此是 `.lark-doc-main` 里的一个 `display: contents` 空壳 ——
 *    壳自身不参与布局，`grid` / `70vh` / `margin: auto` 才会按「直接子元素」生效。
 *    `mountNode` 只能 `appendChild`（排到队尾），所以固定顺序必须靠宿主位置解决。
 *
 * 四段子节点顺序（`.lark-doc-slide-counter` 的 `:not()` 选择器依赖它）：
 *   页码 `p` → 标题 `h1` → 正文 `p` → 按钮组 `div`
 * 按钮组是**裸 `div`**（无 class / 无 role），三颗按钮全是 `button[type=button]`，
 * 文案固定「上一页 / 下一页 / 退出演示」。
 *
 * 「上一页」在首页、「下一页」在末页各置 `disabled`，但**「退出演示」永远可用** ——
 * 演示态是只读的（`effectiveReadonly` 把 `slides` 算进去），不能把人锁在里面。
 */

import { mountNode, setAttr, setText } from './dom'

/** 初始 state：与 `v-if="ed.slides"` 为假时一致 —— 什么都不挂。 */
function initialState() {
  return { open: false, index: 0, total: 1, title: '', text: '' }
}

/** 统一取 handler：缺项静默（与 `panels.js` / `dialogs.js` 同口径）。 */
function handlerCaller(handlers) {
  return (name, ...args) => {
    const fn = handlers[name]
    return typeof fn === 'function' ? fn(...args) : undefined
  }
}

/**
 * @param {{host: HTMLElement|null, handlers: Record<string, Function>}} options
 * @returns {{el: HTMLElement, update: (patch?: object) => void, destroy: () => void}}
 */
export function createSlideStage({ host, handlers }) {
  const call = handlerCaller(handlers || {})
  const state = initialState()

  const counter = document.createElement('p')
  counter.className = 'lark-doc-slide-counter'

  const heading = document.createElement('h1')

  const body = document.createElement('p')

  // 按钮组：SFC 里就是裸 `<div>`（靠 `.lark-doc-slide-stage` 的 `gap` 分行），
  // 不要「顺手」给它加类名 —— 断言锁了它 className 为空、无 role。
  const actions = document.createElement('div')

  const buttons = ['上一页', '下一页', '退出演示'].map((label, index) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    // `@click` 三连：上一页 / 下一页 / 退出演示。原样透传事件对象，
    // 便于将来接「点空白退出」之类需要 `event` 的逻辑。
    button.addEventListener('click', (event) => {
      call(['onPrev', 'onNext', 'onExit'][index], event)
    })
    actions.appendChild(button)
    return button
  })

  const el = document.createElement('div')
  el.className = 'lark-doc-slide-stage'
  setAttr(el, 'aria-label', '幻灯片演示')
  el.appendChild(counter)
  el.appendChild(heading)
  el.appendChild(body)
  el.appendChild(actions)

  function render() {
    mountNode(host, el, !!state.open)
    if (!state.open) return
    // 页码：`{{ index + 1 }} / {{ total }}` —— 两侧各一个空格，与 SFC 逐字一致。
    setText(counter, `${state.index + 1} / ${state.total}`)
    setText(heading, state.title)
    setText(body, state.text)
    // 阀门：首页的「上一页」、末页的「下一页」。`disabled` 是布尔属性，
    // 关掉时整个属性摘掉（`setAttr(null)`），不是写成 `disabled="false"`。
    setAttr(buttons[0], 'disabled', state.index <= 0 ? '' : null)
    setAttr(buttons[1], 'disabled', state.index >= state.total - 1 ? '' : null)
    setAttr(buttons[2], 'disabled', null)
  }

  render()

  return {
    el,
    /** 只覆盖传进来的字段；`open` 一翻就真进真出 DOM。 */
    update(patch) {
      if (!patch) return
      Object.keys(patch).forEach((key) => {
        if (key in state) state[key] = patch[key]
      })
      render()
    },
    destroy() {
      if (el.parentNode) el.parentNode.removeChild(el)
    },
  }
}
