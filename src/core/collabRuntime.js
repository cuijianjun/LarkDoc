import { Plugin, TextSelection } from '@tiptap/pm/state'
import { Node } from '@tiptap/pm/model'
import { ReplaceStep } from '@tiptap/pm/transform'
import { DecorationSet } from '@tiptap/pm/view'

// 跨入口传递扩展时类身份必须一致；Yjs 的位置与事务算法使用 instanceof。
const RUNTIME = Symbol.for('lark-doc.collabRuntime')
const runtime = [Plugin, TextSelection, Node, ReplaceStep, DecorationSet]

export function markCollabRuntime(extensions) {
  // 标记每个真实扩展，使宿主用 spread/filter 组合数组后仍能校验。
  for (const extension of [extensions, ...extensions]) {
    Object.defineProperty(extension, RUNTIME, { value: runtime })
  }
  return extensions
}

export function assertCollabRuntime(collab) {
  const extensions = collab && collab.extensions
  const values = Array.isArray(extensions) ? [extensions, ...extensions] : []
  if (values.some(extension => {
    const provided = extension && extension[RUNTIME]
    return provided && runtime.some((constructor, index) => provided[index] !== constructor)
  })) {
    throw new TypeError('协同 ProseMirror 运行时不一致：请使用同格式的 lark-doc 与 lark-doc/collab 入口及共享 PM 依赖；UMD 不支持外部协同扩展')
  }
}
