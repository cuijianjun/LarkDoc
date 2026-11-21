/**
 * 分享二维码：把文档链接编成可扫的 QR 矩阵（byte mode / ECC-L / 版本 1-6）。
 *
 * 只服务「分享二维码」按钮：链接通常 < 100 字节，v6-L 容量 136 字节足够；
 * 超长链接返回 null，由调用方降级为复制链接（shortcut: 长链接不编码， upgrade 时提高版本表）。
 * 零依赖、按需动态加载，不进任何首屏预算；算法为 Nayuki QR 生成器的紧凑实现。
 */

const ECC_PER_BLOCK = [7, 10, 15, 20, 26, 18]
const BLOCKS = [1, 1, 1, 1, 1, 2]
const DATA_CODEWORDS = [19, 34, 55, 80, 108, 136]

const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
for (let i = 0, x = 1; i < 255; i += 1) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d }
for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255]
const gfMul = (a, b) => a && b ? EXP[LOG[a] + LOG[b]] : 0

function eccDivisor(degree) {
  const divisor = new Array(degree).fill(0)
  divisor[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      divisor[j] = gfMul(divisor[j], root)
      if (j + 1 < degree) divisor[j] ^= divisor[j + 1]
    }
    root = gfMul(root, 2)
  }
  return divisor
}

function eccRemainder(data, divisor) {
  const result = new Array(divisor.length).fill(0)
  for (const byte of data) {
    const factor = byte ^ result.shift()
    result.push(0)
    for (let i = 0; i < divisor.length; i += 1) result[i] ^= gfMul(divisor[i], factor)
  }
  return result
}

function alignmentPositions(version) {
  const size = version * 4 + 17
  const count = Math.floor(version / 7) + 2
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2
  const positions = [6]
  for (let pos = size - 7; positions.length < count; pos -= step) positions.splice(1, 0, pos)
  return positions
}

function penalty(modules, size) {
  let score = 0
  const at = (x, y) => modules[y * size + x]
  for (let y = 0; y < size; y += 1) {
    let run = 1
    for (let x = 1; x < size; x += 1) {
      if (at(x, y) === at(x - 1, y)) { run += 1; if (run === 5) score += 3; else if (run > 5) score += 1 }
      else run = 1
    }
  }
  for (let x = 0; x < size; x += 1) {
    let run = 1
    for (let y = 1; y < size; y += 1) {
      if (at(x, y) === at(x, y - 1)) { run += 1; if (run === 5) score += 3; else if (run > 5) score += 1 }
      else run = 1
    }
  }
  return score
}

function maskBit(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0
    case 1: return y % 2 === 0
    case 2: return x % 3 === 0
    case 3: return (x + y) % 3 === 0
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0
    case 5: return x * y % 2 + x * y % 3 === 0
    case 6: return (x * y % 2 + x * y % 3) % 2 === 0
    default: return (x + y) % 2 + x * y % 3 === 0
  }
}

function formatBits(eclBits, mask) {
  let data = eclBits << 3 | mask
  let rem = data
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  return ((data << 10 | rem) ^ 0x5412) & 0x7fff
}

function drawFunctionPatterns(modules, isFunction, size, version) {
  const set = (x, y, dark) => { modules[y * size + x] = dark; isFunction[y * size + x] = true }
  // 三个定位图形（含分隔带）
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx, y = cy + dy
        if (x >= 0 && x < size && y >= 0 && y < size) {
          const dist = Math.max(Math.abs(dx), Math.abs(dy))
          set(x, y, dist !== 2 && dist !== 4)
        }
      }
    }
  }
  // 定时图形
  for (let i = 8; i < size - 8; i += 1) {
    if (!isFunction[6 * size + i]) set(i, 6, i % 2 === 0)
    if (!isFunction[i * size + 6]) set(6, i, i % 2 === 0)
  }
  // 校正图形
  const positions = alignmentPositions(version)
  for (const cx of positions) {
    for (const cy of positions) {
      if (isFunction[cy * size + cx]) continue
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
      }
    }
  }
  set(8, size - 8, true) // 固定黑点
}

function drawFormatBits(modules, size, mask) {
  const bits = formatBits(1, mask) // ECC-L = 01
  const set = (x, y, dark) => { modules[y * size + x] = dark }
  for (let i = 0; i <= 5; i += 1) set(8, i, (bits >>> i & 1) !== 0)
  set(8, 7, (bits >>> 6 & 1) !== 0)
  set(8, 8, (bits >>> 7 & 1) !== 0)
  set(7, 8, (bits >>> 8 & 1) !== 0)
  for (let i = 9; i < 15; i += 1) set(14 - i, 8, (bits >>> i & 1) !== 0)
  for (let i = 0; i < 8; i += 1) set(size - 1 - i, 8, (bits >>> i & 1) !== 0)
  for (let i = 8; i < 15; i += 1) set(8, size - 15 + i, (bits >>> i & 1) !== 0)
  set(8, size - 8, true)
}

function drawCodewords(modules, isFunction, size, codewords) {
  let bit = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j
        const upward = (right + 1 & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (isFunction[y * size + x]) continue
        let dark = false
        if (bit < codewords.length * 8) dark = ((codewords[bit >>> 3] >>> (7 - (bit & 7))) & 1) !== 0
        modules[y * size + x] = dark
        bit += 1
      }
    }
  }
}

/** 生成布尔矩阵（true = 黑块）；输入超长返回 null。 */
export function encodeQrMatrix(text) {
  const bytes = Array.from(new TextEncoder().encode(String(text || '')))
  if (!bytes.length) return null
  const needed = bits => bits + 4 + 8 // byte mode：4 bit mode + 8 bit 字符计数（v1-9）
  let version = 0
  while (version < 6 && needed(bytes.length * 8) > DATA_CODEWORDS[version] * 8) version += 1
  if (version >= 6 && needed(bytes.length * 8) > DATA_CODEWORDS[5] * 8) return null
  version += 1 // DATA_CODEWORDS 是 0-based，版本从 1 起
  const raw = []
  const pushBits = (value, length) => { for (let i = length - 1; i >= 0; i -= 1) raw.push(value >>> i & 1) }
  pushBits(4, 4) // byte mode
  pushBits(bytes.length, 8) // v1-9 的 byte mode 字符计数固定 8 bit
  for (const byte of bytes) pushBits(byte, 8)
  const capacity = DATA_CODEWORDS[version - 1] * 8
  for (let i = 0; i < 4 && raw.length < capacity; i += 1) raw.push(0)
  while (raw.length % 8) raw.push(0)
  const data = []
  for (let i = 0; i < raw.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j += 1) byte = byte << 1 | raw[i + j]
    data.push(byte)
  }
  for (let pad = 0xec; data.length < DATA_CODEWORDS[version - 1]; pad ^= 0xfd) data.push(pad)

  const degree = ECC_PER_BLOCK[version - 1]
  const numBlocks = BLOCKS[version - 1]
  const divisor = eccDivisor(degree)
  const shortLen = Math.floor(data.length / numBlocks)
  const longBlocks = data.length % numBlocks
  const blocks = []
  const eccs = []
  let offset = 0
  for (let i = 0; i < numBlocks; i += 1) {
    const len = shortLen + (i >= numBlocks - longBlocks ? 1 : 0)
    const block = data.slice(offset, offset + len)
    offset += len
    blocks.push(block)
    eccs.push(eccRemainder(block, divisor))
  }
  const codewords = []
  for (let i = 0; i < shortLen + 1; i += 1) {
    for (const block of blocks) if (i < block.length) codewords.push(block[i])
  }
  for (let i = 0; i < degree; i += 1) for (const ecc of eccs) codewords.push(ecc[i])

  const size = version * 4 + 17
  const base = new Array(size * size).fill(false)
  const isFunction = new Array(size * size).fill(false)
  drawFunctionPatterns(base, isFunction, size, version)
  drawCodewords(base, isFunction, size, codewords)

  let best = null
  let bestScore = Infinity
  for (let mask = 0; mask < 8; mask += 1) {
    const modules = base.slice()
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) if (!isFunction[y * size + x] && maskBit(mask, x, y)) modules[y * size + x] = !modules[y * size + x]
    }
    drawFormatBits(modules, size, mask)
    const score = penalty(modules, size)
    if (score < bestScore) { bestScore = score; best = modules }
  }
  return { size, modules: best }
}
