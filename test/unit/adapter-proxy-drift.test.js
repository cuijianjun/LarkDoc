// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { PROXY_METHODS } from '../../src/adapters/react'
import LarkDocElement from '../../src/web-component/LarkDocElement'

// 适配层把方法名手抄成一份名单，元素侧改名/删方法时它只会静默返回 undefined。
// 这里把名单钉在元素原型上，改名立刻红。
describe('适配层方法代理不漂移', () => {
  it('React 代理名单都能在 <lark-doc> 元素上解析到', () => {
    const missing = PROXY_METHODS.filter(name => typeof LarkDocElement.prototype[name] !== 'function')
    expect(missing).toEqual([])
  })
})
