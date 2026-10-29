/**
 * 外部服务 provider 注册层（17 §17.5 的接入半边）。
 *
 * `external-block.js` 只回答「这个 kind 的某个动作是什么档位」——它是**判定层**，零依赖、
 * 纯查表。但「档位是 provider」并不等于「永远做不了」：宿主一旦把多维表格 / Jira /
 * 白板这些服务接进来，同一张表里的 `provider` 档就该立刻变成可执行。中间缺的那一层
 * 就是本文件：**注册 → 解析 → 状态**。
 *
 * 三层职责（改代码前先认同这三句）：
 *   1. `external-block.js`：静态档位（§17.5 原文），永远不变；
 *   2. `provider-registry.js`（本文件）：运行时接入状态，进程内单例 Map；
 *   3. `blockApi`：执行前的闸门 —— 只有这一处 `throw`，UI 层只读状态做置灰。
 *
 * 为什么是**进程内单例**而不是 per-editor：
 *   provider 是「应用级能力」（一个页面接入了多维表格服务，该页面所有文档都该能用），
 *   不是「文档级状态」。按 editor 实例存会让同一页面里两个编辑器互相看不见对方的接入。
 *   代价是测试之间要 `resetExternalProviders()` —— 已在导出里给出。
 *
 * 为什么**不做网络**：
 *   本仓库的定位是编辑器内核，不带任何外部服务的鉴权 / 请求实现（17 §17.13 的口径是
 *   「能力缺失时统一报错、不伪造本地成功」）。provider 对象只是个**能力声明 + 可选钩子**，
 *   真正的请求由宿主在钩子里发；我们不 import 任何请求库，也不假设协议。
 */

import {
  EXTERNAL_PROVIDER_LABELS,
  EXTERNAL_STATUS,
  ERR_PROVIDER_REQUIRED,
  ERR_UNSUPPORTED_OPERATION,
  externalBlockCapability,
  externalBlockMeta,
  externalBlockReason,
} from './external-block'

/* ---------- 单例表 ---------- */

/** name → provider 对象。`Map` 而不是对象字面量：provider 名可能是 `__proto__` 这类脏值。 */
const registry = new Map()

/**
 * provider 对象形状（全部可选，除了 `name`）：
 *   {
 *     name: 'bitable',            // 必填，对应 EXTERNAL_PROVIDER_LABELS 的键
 *     label: '多维表格',           // 可选，缺省取目录里的中文名
 *     kinds: ['view'],            // 可选，声明支持的 kind；省略 = 该 provider 名下全部 kind
 *     readonly: false,            // 可选，true = 只能读（状态推到 `readonly` 而不是 `ready`）
 *     handlers: { read?, update?, create? },  // 可选，宿主自己调，本层不执行
 *   }
 */

/** provider 名合法性：与 `safeExternalProvider` 同一套字符集（避免两处各写一遍正则）。 */
const PROVIDER_NAME_RE = /^[a-z][a-z0-9_.-]*$/

/**
 * 注册（或替换）一个 provider。返回 `true` = 注册成功。
 *
 * 为什么同名重复注册是**替换**而不是报错：热更新 / 换鉴权后重新注册是常态，
 * 报错会逼宿主先 `unregister` 再 `register`，多一步还容易漏。
 */
export function registerExternalProvider(provider) {
  if (!provider || typeof provider !== 'object') return false
  const name = typeof provider.name === 'string' ? provider.name.trim() : ''
  if (!name || name.length > 64 || !PROVIDER_NAME_RE.test(name)) return false
  const kinds = Array.isArray(provider.kinds)
    ? provider.kinds.filter(kind => typeof kind === 'string' && kind)
    : null
  registry.set(name, {
    name,
    label: typeof provider.label === 'string' && provider.label
      ? provider.label
      : (EXTERNAL_PROVIDER_LABELS[name] || name),
    kinds,
    readonly: provider.readonly === true,
    handlers: provider.handlers && typeof provider.handlers === 'object' ? provider.handlers : {},
  })
  return true
}

/** 注销。返回 `true` = 之前确实注册过。 */
export function unregisterExternalProvider(name) {
  return registry.delete(name)
}

/** 清空（**只给测试与文档切换用**：生产代码没有「把所有服务断开」这个动作）。 */
export function resetExternalProviders() {
  registry.clear()
}

/** 解析：拿到 provider 对象本身（宿主调 `handlers` 时用），没有则 `null`。 */
export function resolveExternalProvider(name) {
  if (typeof name !== 'string' || !name) return null
  return registry.get(name) || null
}

/** 已注册的 provider 名列表（调试面板 / 文档用，顺序 = 注册顺序）。 */
export function externalProviderNames() {
  return Array.from(registry.keys())
}

/**
 * provider 是否声明支持某 kind。
 *
 * 没写 `kinds` 视为「该 provider 名下的 kind 全支持」—— 这比默认为空更符合直觉：
 * 宿主注册 `{ name: 'bitable' }` 的意思是「多维表格我接了」，不是「我接了但什么都不支持」。
 */
export function externalProviderSupports(name, kind) {
  const provider = resolveExternalProvider(name)
  if (!provider) return false
  if (!provider.kinds) return true
  return provider.kinds.indexOf(kind) !== -1
}

/* ---------- 状态 ---------- */

/**
 * provider 级状态：`unavailable` / `readonly` / `ready`。
 *
 * 注意它与 `externalBlockCapability()` 的**层次差**：那个说「这个动作在表上是什么档」，
 * 这个说「服务现在能不能用」。两者组合才是卡片最终的角标文案。
 */
export function externalProviderStatus(name) {
  const provider = resolveExternalProvider(name)
  if (!provider) return EXTERNAL_STATUS.UNAVAILABLE
  return provider.readonly ? EXTERNAL_STATUS.READONLY : EXTERNAL_STATUS.READY
}

/**
 * kind 级状态：provider 没声明支持这个 kind 时，即使服务注册了也算 `unavailable`
 * （否则会给出「已接入」角标却点不动，比诚实地说未接入更糟）。
 */
export function externalBlockStatus(kind) {
  const meta = externalBlockMeta(kind)
  if (!meta.provider) return EXTERNAL_STATUS.UNAVAILABLE
  if (!externalProviderSupports(meta.provider, kind)) return EXTERNAL_STATUS.UNAVAILABLE
  return externalProviderStatus(meta.provider)
}

/**
 * 卡片角标文案（17 §17.5「可解释的 disabled 状态」）：
 *   - `unavailable` → 「未接入 · 去接入」（告诉用户下一步动作，而不是死掉的「未接入」）；
 *   - `readonly`    → 「只读」；
 *   - `ready`       → 空串 —— 服务正常时不该有角标占视觉，返回 `''` 让渲染侧整段不输出。
 *
 * provider 中文名**不**拼进角标：窄卡片会被挤换行，且 provider 已出现在卡片标题行。
 * 需要完整句子（悬浮 / 读屏）读 `externalBlockStatusHint()`。
 */
export function externalBlockStatusLabel(kind) {
  const status = externalBlockStatus(kind)
  if (status === EXTERNAL_STATUS.READY) return ''
  if (status === EXTERNAL_STATUS.READONLY) return '只读'
  return '未接入 · 去接入'
}

/**
 * 角标的 `title` / `aria-label`：角标本身只有两三个字，读屏与悬浮提示需要说清
 * 「是哪个服务、现在怎么了」。与 `externalBlockStatusLabel()` 同源同判，
 * 组件不许再自己 `if (status === ...)` 拼一遍。
 */
export function externalBlockStatusHint(kind) {
  const status = externalBlockStatus(kind)
  const meta = externalBlockMeta(kind)
  const provider = EXTERNAL_PROVIDER_LABELS[meta.provider] || '外部服务'
  if (status === EXTERNAL_STATUS.READY) return `已接入${provider}`
  if (status === EXTERNAL_STATUS.READONLY) return `已接入${provider}，当前只读，内容不可编辑`
  return `${provider}未接入，接入后可编辑`
}

/* ---------- 执行闸门 ---------- */

/**
 * 带 `errorCode` 的错误对象：调用方可以 `catch (e) { if (e.code === ...) }` 而不靠文案匹配。
 *
 * `extra` 里挂 `kind` / `action` / `status` 三个字段（17 §17.5 要求的统一错误码载荷）：
 * 宿主上报时能直接说清「哪一类块、哪个动作、当时服务是什么状态」，
 * 不用回头翻 DOM 上的 `data-external-*`。三字段恒存在（缺省给空串 / `unavailable`），
 * 免得上报平台因为字段缺失把整条日志判成脏数据。
 */
export function externalOperationError(code, reason, extra = {}) {
  const error = new Error(reason)
  error.code = code
  error.reason = reason
  error.kind = extra.kind || ''
  error.action = extra.action || ''
  error.status = extra.status || EXTERNAL_STATUS.UNAVAILABLE
  return error
}

/**
 * 把「静态档位」与「运行时状态」合成一次判定 —— **UI 置灰与 blockApi 抛错都读它**，
 * 保证两处口径不会漂。
 *
 * 返回 `{ allowed, code, reason, mode }`：
 *   - `allowed: true`  ⇒ 可执行（本地档位 / 已接入 / delete 白名单）；
 *   - `allowed: false` ⇒ `code` 必是 `ERR_PROVIDER_REQUIRED` 或 `ERR_UNSUPPORTED_OPERATION`
 *     之一，`reason` 是可以直接给用户看的中文句子。
 */
export function externalOperationState(kind, action) {
  const capability = externalBlockCapability(kind, action)
  if (capability.errorCode === ERR_UNSUPPORTED_OPERATION) {
    return { allowed: false, code: ERR_UNSUPPORTED_OPERATION, reason: capability.reason, mode: capability.mode }
  }
  if (capability.errorCode === ERR_PROVIDER_REQUIRED) {
    // 档位是 provider，但服务已接入 → 放行。这是本文件存在的全部理由。
    const status = externalBlockStatus(kind)
    if (status === EXTERNAL_STATUS.READY) {
      return { allowed: true, code: null, reason: '', mode: capability.mode }
    }
    // 错误码同为 PROVIDER_REQUIRED，但**只读 ≠ 未接入**：前者服务在、今天不给写，后者根本
    // 没接。文案不分开，用户会去点「重新接入」而其实该找管理员要写权限。
    const reason = status === EXTERNAL_STATUS.READONLY
      ? externalBlockReason(kind, status)
      : capability.reason
    return { allowed: false, code: ERR_PROVIDER_REQUIRED, reason, mode: capability.mode }
  }
  return { allowed: true, code: null, reason: '', mode: capability.mode }
}

/**
 * 断言版：不允许就抛。`blockApi` 的三个写入口用它。
 *
 * 为什么抛而不是返回 false：`blockApi` 的写方法签名是「返回受影响的 blockId / 无返回」，
 * 没有「失败原因」的通道。静默 no-op 会让宿主以为写成功了（§17.5 表下说明明确要求
 * **不伪造本地成功**），所以这里选择让错误穿透到调用点的 try/catch。
 */
export function assertExternalOperation(kind, action) {
  const state = externalOperationState(kind, action)
  if (state.allowed) return state
  throw externalOperationError(state.code, state.reason, {
    kind,
    action,
    status: externalBlockStatus(kind),
  })
}

export default {
  registerExternalProvider,
  unregisterExternalProvider,
  resetExternalProviders,
  resolveExternalProvider,
  externalProviderNames,
  externalProviderSupports,
  externalProviderStatus,
  externalBlockStatus,
  externalBlockStatusLabel,
  externalBlockStatusHint,
  externalOperationState,
  assertExternalOperation,
  externalOperationError,
}
