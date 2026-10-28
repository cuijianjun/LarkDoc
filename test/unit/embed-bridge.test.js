/**
 * P3-02 `lark-embed/1` 桥：握手 / origin 严格校验 / 超时 / 版本取低 / resize 节流。
 *
 * 桥是纯逻辑（零 DOM），所以这里不起编辑器、不造 iframe：target 就是一个记录
 * `postMessage` 调用的假窗口，收消息直接调 `handleMessage(event)`。
 * 只有「伪造 origin 被丢弃」这一条是安全断言，其余都是协议行为。
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  BRIDGE_NAMESPACE, BRIDGE_REQUIRED, BRIDGE_TIMEOUT_MS, BRIDGE_VERSION, RESIZE_MIN_DELTA,
  RESIZE_THROTTLE_MS, createEmbedBridge, parseBridgeFrame, resolveBridgeOrigin,
} from '../../src/core/embed/bridge'

const SRC = 'https://draw.example.com/d/abc123'
const ORIGIN = 'https://draw.example.com'

/** 假 iframe 窗口：只记「发了什么、目标 origin 是谁」。 */
function makeTarget() {
  const sent = []
  return {
    sent,
    postMessage(message, targetOrigin) { sent.push({ message, targetOrigin }) },
  }
}

function makeEvent(origin, data) {
  return { origin, data, source: { fake: true } }
}

const frame = (type, payload, reqId) => {
  const value = { ns: BRIDGE_NAMESPACE, v: BRIDGE_VERSION, type }
  if (reqId) value.reqId = reqId
  if (payload !== undefined) value.payload = payload
  return value
}

afterEach(() => { vi.useRealTimers() })

describe('resolveBridgeOrigin：只认 https，localhost 仅 dev 例外', () => {
  it('https 取 origin（含端口，丢路径与查询）', () => {
    expect(resolveBridgeOrigin('https://draw.example.com/d/abc?x=1#y')).toBe('https://draw.example.com')
    expect(resolveBridgeOrigin('https://figma.com:8443/embed')).toBe('https://figma.com:8443')
  })

  it('本地开发例外：http 的 localhost / 127.0.0.1 / [::1] 放行', () => {
    expect(resolveBridgeOrigin('http://localhost:5173/play')).toBe('http://localhost:5173')
    expect(resolveBridgeOrigin('http://127.0.0.1:8080/')).toBe('http://127.0.0.1:8080')
    expect(resolveBridgeOrigin('http://[::1]:9000/x')).toBe('http://[::1]:9000')
  })

  it('http 公网 / 非 http(s) 协议 / 相对地址一律判 null（桥随即失效）', () => {
    for (const src of [
      'http://draw.example.com/d/abc',
      'javascript:alert(1)',
      'data:text/html,<script>1</script>',
      '/files/local.html',
      '//draw.example.com/d/abc',
      '',
      null,
      undefined,
      42,
    ]) expect(resolveBridgeOrigin(src), String(src)).toBeNull()
  })

  it('带用户名密码的地址不进信任链', () => {
    expect(resolveBridgeOrigin('https://user:pass@draw.example.com/d/1')).toBeNull()
  })
})

describe('parseBridgeFrame：只判形状', () => {
  it('合法帧原样返回，不合法返回 null', () => {
    expect(parseBridgeFrame(frame('ready', { bridgeVersion: 1 }))).toBeTruthy()
    for (const bad of [
      null, undefined, 42, 'ready', [],
      { type: 'ready', v: 1 },                                  // 缺 ns
      { ns: 'other-embed', v: 1, type: 'ready' },                // ns 不对
      { ns: BRIDGE_NAMESPACE, v: 0, type: 'ready' },             // 版本非正整数
      { ns: BRIDGE_NAMESPACE, v: 1.5, type: 'ready' },
      { ns: BRIDGE_NAMESPACE, v: 1, type: '' },                  // 空 type
      { ns: BRIDGE_NAMESPACE, v: 1 },                            // 缺 type
    ]) expect(parseBridgeFrame(bad), JSON.stringify(bad)).toBeNull()
  })
})

describe('握手：init 只发到目标 origin，ready 后版本取低', () => {
  it('start() 发 init（目标 origin 写死，永不用 *），3s 前不判超时', () => {
    vi.useFakeTimers()
    const target = makeTarget()
    const onTimeout = vi.fn()
    const bridge = createEmbedBridge({ src: SRC, target, onTimeout })

    expect(bridge.start()).toBe(true)
    expect(target.sent).toHaveLength(1)
    expect(target.sent[0].message).toMatchObject({
      ns: BRIDGE_NAMESPACE, v: BRIDGE_VERSION, type: 'init',
      payload: { bridgeVersion: BRIDGE_VERSION, capabilities: [...BRIDGE_REQUIRED] },
    })
    expect(target.sent[0].targetOrigin).toBe(ORIGIN)
    expect(target.sent.every((item) => item.targetOrigin !== '*')).toBe(true)

    vi.advanceTimersByTime(BRIDGE_TIMEOUT_MS - 1)
    expect(onTimeout).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onTimeout).toHaveBeenCalledTimes(1)
    expect(bridge.state()).toMatchObject({ ready: false, timedOut: true })
  })

  it('ready 之后不再判超时，版本取双方较低者', () => {
    vi.useFakeTimers()
    const onReady = vi.fn()
    const onTimeout = vi.fn()
    const bridge = createEmbedBridge({ src: SRC, target: makeTarget(), onReady, onTimeout })

    bridge.start()
    expect(bridge.handleMessage(makeEvent(ORIGIN, frame('ready', { bridgeVersion: 1, capabilities: ['resize', 'setTitle'] })))).toBe(true)
    expect(onReady).toHaveBeenCalledWith({ origin: ORIGIN, version: 1, capabilities: ['resize', 'setTitle'] })
    expect(bridge.state()).toMatchObject({ ready: true, version: 1, timedOut: false })

    vi.advanceTimersByTime(BRIDGE_TIMEOUT_MS * 2)
    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('iframe 报出更高版本时取宿主版本；报 0 / 非数字时按宿主版本兜底', () => {
    const cases = [[2, 1], [99, 1], [0, 1], [null, 1], ['1', 1], [undefined, 1]]
    for (const [remote, expected] of cases) {
      const bridge = createEmbedBridge({ src: SRC, target: makeTarget() })
      bridge.start()
      bridge.handleMessage(makeEvent(ORIGIN, frame('ready', { bridgeVersion: remote })))
      expect(bridge.state().version, `remote=${remote}`).toBe(expected)
    }
  })

  it('iframe 换实例（重挂载）不重建桥，只换 target', () => {
    const first = makeTarget()
    const second = makeTarget()
    const bridge = createEmbedBridge({ src: SRC, target: first })
    bridge.setTarget(second)
    bridge.start()
    expect(first.sent).toHaveLength(0)
    expect(second.sent).toHaveLength(1)
  })

  it('origin 推导不出来时桥整体失效：不发送、也不接受任何消息', () => {
    const target = makeTarget()
    const bridge = createEmbedBridge({ src: 'http://draw.example.com/d/abc', target })
    expect(bridge.origin).toBeNull()
    expect(bridge.start()).toBe(false)
    expect(target.sent).toHaveLength(0)
    expect(bridge.handleMessage(makeEvent('http://draw.example.com', frame('ready', {})))).toBe(false)
  })
})

describe('origin 严格校验：伪造来源的消息必须被丢弃', () => {
  const attacks = [
    ['同协议不同域', 'https://evil.example.com'],
    ['子域也算伪造', 'https://draw.example.com.evil.com'],
    ['父域', 'https://example.com'],
    ['协议降级', 'http://draw.example.com'],
    ['端口不同', 'https://draw.example.com:8443'],
    ['null origin（sandbox / data: 页）', 'null'],
    ['空串', ''],
  ]

  it.each(attacks)('伪造 origin（%s）的 ready 不改变状态', (_label, origin) => {
    const onReady = vi.fn()
    const bridge = createEmbedBridge({ src: SRC, target: makeTarget(), onReady })
    bridge.start()
    expect(bridge.handleMessage(makeEvent(origin, frame('ready', { bridgeVersion: 1 })))).toBe(false)
    expect(onReady).not.toHaveBeenCalled()
    expect(bridge.state()).toMatchObject({ ready: false, version: 0 })
  })

  it('伪造 origin 的 resize / save 也不会触发业务回调', () => {
    const onResize = vi.fn()
    const onSave = vi.fn()
    const target = makeTarget()
    const bridge = createEmbedBridge({ src: SRC, target, onResize, onSave })
    bridge.start()
    expect(bridge.handleMessage(makeEvent('https://evil.example.com', frame('resize', { height: 900 })))).toBe(false)
    expect(bridge.handleMessage(makeEvent('https://evil.example.com', frame('save', {}, 'r1')))).toBe(false)
    expect(onResize).not.toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
    // 只有 init 一条，没有给伪造方回过 saveResult。
    expect(target.sent.map((item) => item.message.type)).toEqual(['init'])
  })

  it('反向帧（host→iframe 类型）从 iframe 发回来一律当伪造', () => {
    const bridge = createEmbedBridge({ src: SRC, target: makeTarget() })
    bridge.start()
    for (const type of ['init', 'theme', 'command', 'saveResult', 'destroy']) {
      expect(bridge.handleMessage(makeEvent(ORIGIN, frame(type, {}))), type).toBe(false)
    }
    expect(bridge.state().receivedCount).toBe(0)
  })
})

describe('5 条必备能力各自的行为', () => {
  it('resize：≤4px 丢弃，累计超过阈值才上抛', () => {
    vi.useFakeTimers()
    const onResize = vi.fn()
    const bridge = createEmbedBridge({ src: SRC, target: makeTarget(), onResize })
    bridge.start()

    bridge.handleMessage(makeEvent(ORIGIN, frame('resize', { height: 400 })))
    expect(onResize).toHaveBeenCalledWith(400)

    // 连续 3 次小抖动：每次都 ≤4px，但相对上次上抛值累计 6px → 第三次必须发出去。
    bridge.handleMessage(makeEvent(ORIGIN, frame('resize', { height: 402 })))
    bridge.handleMessage(makeEvent(ORIGIN, frame('resize', { height: 404 })))
    bridge.handleMessage(makeEvent(ORIGIN, frame('resize', { height: 406 })))
    // 前两次被丢弃；第三次进了节流窗口，等窗口到点才发。
    expect(onResize).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(RESIZE_THROTTLE_MS)
    expect(onResize).toHaveBeenLastCalledWith(406)
  })

  it(`resize：窗口内狂发只留最后一个（${RESIZE_THROTTLE_MS}ms 节流）`, () => {
    vi.useFakeTimers()
    const onResize = vi.fn()
    const bridge = createEmbedBridge({ src: SRC, target: makeTarget(), onResize })
    bridge.start()

    bridge.handleMessage(makeEvent(ORIGIN, frame('resize', { height: 300 })))
    expect(onResize).toHaveBeenCalledTimes(1)

    for (let height = 320; height <= 400; height += 20) {
      bridge.handleMessage(makeEvent(ORIGIN, frame('resize', { height })))
    }
    expect(onResize).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(RESIZE_THROTTLE_MS)
    expect(onResize).toHaveBeenCalledTimes(2)
    expect(onResize).toHaveBeenLastCalledWith(400)
  })

  it('resize：阈值正好 4px 不上抛（判据是「大于」而不是「大于等于」）', () => {
    vi.useFakeTimers()
    const onResize = vi.fn()
    const bridge = createEmbedBridge({ src: SRC, target: makeTarget(), onResize })
    bridge.start()
    bridge.handleMessage(makeEvent(ORIGIN, frame('resize', { height: 500 })))
    bridge.handleMessage(makeEvent(ORIGIN, frame('resize', { height: 500 + RESIZE_MIN_DELTA })))
    vi.advanceTimersByTime(RESIZE_THROTTLE_MS)
    expect(onResize).toHaveBeenCalledTimes(1)
  })

  it('setTitle：同步标题栏，空标题与超长标题不采信', () => {
    const onSetTitle = vi.fn()
    const bridge = createEmbedBridge({ src: SRC, target: makeTarget(), onSetTitle })
    bridge.start()
    expect(bridge.handleMessage(makeEvent(ORIGIN, frame('setTitle', { title: '  画板 A  ' })))).toBe(true)
    expect(onSetTitle).toHaveBeenLastCalledWith('画板 A')
    expect(bridge.handleMessage(makeEvent(ORIGIN, frame('setTitle', { title: '   ' })))).toBe(false)
    expect(bridge.handleMessage(makeEvent(ORIGIN, frame('setTitle', { title: 'x'.repeat(513) })))).toBe(false)
    expect(bridge.handleMessage(makeEvent(ORIGIN, frame('setTitle', {})))).toBe(false)
    expect(onSetTitle).toHaveBeenCalledTimes(1)
  })

  it('save：必须有应答（saveResult 带同一个 reqId），且业务回调照常收到 payload', () => {
    const onSave = vi.fn()
    const target = makeTarget()
    const bridge = createEmbedBridge({ src: SRC, target, onSave })
    bridge.start()
    target.sent.length = 0

    bridge.handleMessage(makeEvent(ORIGIN, frame('save', { fields: { a: 1 } }, 'req-7')))
    expect(onSave).toHaveBeenCalledWith({ payload: { fields: { a: 1 } } })
    const reply = target.sent.find((item) => item.message.type === 'saveResult')
    expect(reply).toBeTruthy()
    expect(reply.message.reqId).toBe('req-7')
    expect(reply.message.payload).toMatchObject({ ok: true })
    expect(reply.targetOrigin).toBe(ORIGIN)
  })

  it('error：把可读报错交给宿主', () => {
    const onError = vi.fn()
    const bridge = createEmbedBridge({ src: SRC, target: makeTarget(), onError })
    bridge.start()
    expect(bridge.handleMessage(makeEvent(ORIGIN, frame('error', { message: '画板加载失败' })))).toBe(true)
    expect(onError).toHaveBeenCalledWith({ message: '画板加载失败' })
  })

  it('fullscreen：iframe 请求全屏，宿主决定怎么实现', () => {
    const onFullscreen = vi.fn()
    const bridge = createEmbedBridge({ src: SRC, target: makeTarget(), onFullscreen })
    bridge.start()
    expect(bridge.handleMessage(makeEvent(ORIGIN, frame('fullscreen')))).toBe(true)
    expect(onFullscreen).toHaveBeenCalledTimes(1)
  })

  it('init-ack 只被收下，不改变握手状态', () => {
    const bridge = createEmbedBridge({ src: SRC, target: makeTarget() })
    bridge.start()
    expect(bridge.handleMessage(makeEvent(ORIGIN, frame('init-ack', {})))).toBe(true)
    expect(bridge.state()).toMatchObject({ ready: false, version: 0 })
  })

  it('未知 type 被丢弃', () => {
    const bridge = createEmbedBridge({ src: SRC, target: makeTarget() })
    bridge.start()
    expect(bridge.handleMessage(makeEvent(ORIGIN, frame('whatever', {})))).toBe(false)
  })
})

describe('宿主下行：setTheme / command / destroy', () => {
  it('setTheme / command 都发到目标 origin', () => {
    const target = makeTarget()
    const bridge = createEmbedBridge({ src: SRC, target })
    bridge.start()
    target.sent.length = 0

    bridge.setTheme({ mode: 'dark' })
    bridge.command('card.submit', { id: 1 })
    expect(target.sent.map((item) => item.message.type)).toEqual(['theme', 'command'])
    expect(target.sent[1].message.payload).toEqual({ id: 'card.submit', payload: { id: 1 } })
    expect(target.sent.every((item) => item.targetOrigin === ORIGIN)).toBe(true)

    expect(bridge.command('')).toBe(false)
  })

  it('destroy：发 destroy、清计时器，之后不再收发', () => {
    vi.useFakeTimers()
    const onTimeout = vi.fn()
    const onReady = vi.fn()
    const target = makeTarget()
    const bridge = createEmbedBridge({ src: SRC, target, onTimeout, onReady })
    bridge.start()
    bridge.destroy()

    expect(target.sent.map((item) => item.message.type)).toEqual(['init', 'destroy'])
    vi.advanceTimersByTime(BRIDGE_TIMEOUT_MS * 2)
    expect(onTimeout).not.toHaveBeenCalled()
    expect(bridge.handleMessage(makeEvent(ORIGIN, frame('ready', {})))).toBe(false)
    expect(onReady).not.toHaveBeenCalled()
  })
})

/**
 * 回归：P3-07 首帧丢失。
 *
 * 症状：demo 里嵌入块高度恒为 attrs 的 520，内容真实高度 424 永远同步不上，
 * 直到用户手点一次「加高」才对 —— 看着像「resize 不生效」。
 *
 * 根因不是节流、也不是 CSS，而是**桥的 message 监听挂得太晚**：nodeview 构造期
 * 这块 DOM 还游离在 ProseMirror 之外，`iframe.contentWindow` 为 null，所以原实现
 * 要等 iframe `load` 才建桥挂监听；可嵌入页在 `load` **同一刻**就把 `ready` 和
 * 首帧 `resize` 发出来了（实测三帧同在 943ms 到达窗口）——帧到了，监听没在，永久丢。
 *
 * 修法：桥支持「先建桥（无 target）→ 收帧 → 后补 target」。下面三条锁住该契约。
 */
describe('target 后补：桥必须先于 iframe 上屏就位（P3-07 首帧丢失回归）', () => {
  it('没有 target 也能收 ready / 首帧 resize，高度立刻上抛（不进节流窗口）', () => {
    const onReady = vi.fn()
    const onResize = vi.fn()
    const bridge = createEmbedBridge({ src: SRC, onReady, onResize })

    expect(bridge.origin).toBe(ORIGIN)
    expect(bridge.handleMessage(makeEvent(ORIGIN, frame('ready', { bridgeVersion: 1 })))).toBe(true)
    expect(onReady).toHaveBeenCalledTimes(1)

    // 首帧 resizeHeight 基准为 null，必须直接 flush：拖后面等于让用户先看到错高度。
    expect(bridge.handleMessage(makeEvent(ORIGIN, frame('resize', { height: 424 })))).toBe(true)
    expect(onResize).toHaveBeenCalledWith(424)
    expect(bridge.state().resizeHeight).toBe(424)
  })

  it('构造期不发 init：没有 target 时 start() 为 false，补 target 后才发', () => {
    const bridge = createEmbedBridge({ src: SRC })
    expect(bridge.start()).toBe(false)   // 游离期 iframe 没有 contentWindow，发不出去
    expect(bridge.state().sentCount).toBe(0)

    const target = makeTarget()
    bridge.setTarget(target)
    expect(bridge.start()).toBe(true)
    expect(target.sent.map((item) => item.message.type)).toEqual(['init'])
    expect(target.sent[0].targetOrigin).toBe(ORIGIN)
  })

  it('先收到 ready 再补 target：不重发 init、不误判超时（startBridge 幂等的前提）', () => {
    vi.useFakeTimers()
    const onTimeout = vi.fn()
    const bridge = createEmbedBridge({ src: SRC, onTimeout })

    bridge.handleMessage(makeEvent(ORIGIN, frame('ready', { bridgeVersion: 1 })))
    expect(bridge.state().ready).toBe(true)

    const target = makeTarget()
    bridge.setTarget(target)
    // 宿主侧就是这句守卫（web-embed.js 的 startBridge），ready 之后不再握手。
    if (!bridge.state().ready) bridge.start()
    expect(target.sent).toHaveLength(0)
    // 即便守卫失效误调一次，start() 自己也返回 false —— 两道闸门。
    expect(bridge.start()).toBe(false)
    expect(target.sent).toHaveLength(0)

    vi.advanceTimersByTime(BRIDGE_TIMEOUT_MS * 2)
    expect(onTimeout).not.toHaveBeenCalled()
  })
})
