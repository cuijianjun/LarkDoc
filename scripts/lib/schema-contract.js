'use strict'

/**
 * schema 结构契约的序列化 —— capture-baseline.js（抓基线）与
 * test/unit/quote.test.js（快照守卫）共用同一套，保证比对口径一致。
 *
 * 只序列化「决定某种 JSON 能不能解析回来」的那部分契约：
 * parseHTML / renderHTML / validate 是函数，序列化进快照只会让每次比对产生噪声。
 */

const SPEC_KEYS = ['content', 'group', 'inline', 'atom', 'selectable', 'draggable', 'code', 'whitespace', 'defining', 'isolating', 'linebreakReplacement', 'tableRole']

const jsonSafe = (value) => {
  try { JSON.parse(JSON.stringify(value === undefined ? null : value)); return true } catch (_) { return false }
}

function serializeAttrs(attrs) {
  const out = {}
  for (const name of Object.keys(attrs || {}).sort()) {
    const spec = attrs[name]
    out[name] = { default: jsonSafe(spec.default) ? spec.default : `<${typeof spec.default}>` }
  }
  return out
}

function serializeSpec(spec) {
  const out = {}
  for (const key of SPEC_KEYS) {
    if (spec[key] === undefined) continue
    const value = Array.isArray(spec[key]) ? [...spec[key]].sort() : spec[key]
    out[key] = jsonSafe(value) ? value : `<${typeof value}>`
  }
  if (spec.marks !== undefined) out.marks = Array.isArray(spec.marks) ? [...spec.marks].sort() : spec.marks
  out.attrs = serializeAttrs(spec.attrs)
  return out
}

// 按名字排序再写：OrderedMap 的插入顺序没有语义，重排不该被算成回归。
function serializeMap(map) {
  const acc = {}
  map.forEach((name, spec) => { acc[name] = serializeSpec(spec) })
  const sorted = {}
  for (const name of Object.keys(acc).sort()) sorted[name] = acc[name]
  return sorted
}

module.exports = { SPEC_KEYS, jsonSafe, serializeAttrs, serializeSpec, serializeMap }
