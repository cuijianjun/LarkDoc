/** core/blocks 共享小工具：标题层级表与 schema 属性校验器工厂。 */
export const levels = [1, 2, 3, 4, 5, 6, 7, 8, 9]
export const validateAttribute = (name, predicate) => (value) => { if (!predicate(value)) throw new Error(`无效属性：${name}`) }
