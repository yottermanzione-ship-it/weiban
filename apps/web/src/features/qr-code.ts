/*
 * Portions adapted from QR Code generator library by Project Nayuki.
 * Copyright (c) Project Nayuki. (MIT License)
 * https://www.nayuki.io/page/qr-code-generator-library
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 * of the Software, and to permit persons to whom the Software is furnished to do
 * so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/**
 * 二维码编码器（字节模式、纠错级别 L、版本 1–10）。只给插件页画微信绑定二维码用。
 *
 * 为什么自己写：站点 CSP 是 `img-src 'self' blob: data:`，二维码不能从外部图片服务加载；
 * 而仓库的 web 端没有任何二维码依赖，本轮也不允许加依赖。这里按 ISO/IEC 18004 实现：
 * 模式指示 + 长度 + 数据 → 分块 RS 纠错 → 交织 → 功能图形 → 掩码 → 格式/版本信息。
 *
 * 兼容性：与 Nayuki 参考实现（仓库里 @rc-component/qrcode 自带的 qrcodegen）在
 * 同版本 / 同 ECC L / 同掩码下逐像素一致，由 channel QR 的离线矩阵比对验证过。
 * 这不是「真机扫码通过」：真机扫码仍需实网验证（见交接报告）。
 */

export interface QrMatrix {
  size: number;
  version: number;
  /** 最终使用的掩码（0–7）。 */
  mask: number;
  get(x: number, y: number): boolean;
}

/** 纠错级别 L：每块纠错码字数与块数（版本 1–10，与参考实现一致）。 */
const QR_EC_PER_BLOCK = [7, 10, 15, 20, 26, 18, 20, 24, 30, 18];
const QR_NUM_BLOCKS = [1, 1, 1, 1, 1, 2, 2, 2, 2, 4];

/** 版本 ver 的数据区模块数（不含功能图形）。 */
function qrRawModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function qrDataCodewords(ver: number): number {
  return Math.floor(qrRawModules(ver) / 8) - QR_EC_PER_BLOCK[ver - 1]! * QR_NUM_BLOCKS[ver - 1]!;
}

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j]!, root);
      if (j + 1 < result.length) result[j] = result[j]! ^ result[j + 1]!;
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = divisor.map(() => 0);
  for (const value of data) {
    const factor = value ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coefficient, index) => {
      result[index] = result[index]! ^ gfMul(coefficient, factor);
    });
  }
  return result;
}

/** 加纠错码并按规范交织；返回全部码字。 */
function addEcc(data: readonly number[], ver: number): number[] {
  const numBlocks = QR_NUM_BLOCKS[ver - 1]!;
  const blockEcc = QR_EC_PER_BLOCK[ver - 1]!;
  const rawCodewords = Math.floor(qrRawModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const divisor = rsDivisor(blockEcc);
  const blocks: number[][] = [];
  for (let index = 0, offset = 0; index < numBlocks; index++) {
    const dataLength = shortBlockLen - blockEcc + (index < numShortBlocks ? 0 : 1);
    const block = data.slice(offset, offset + dataLength);
    offset += dataLength;
    const ecc = rsRemainder(block, divisor);
    if (index < numShortBlocks) block.push(0);
    blocks.push(block.concat(ecc));
  }
  const result: number[] = [];
  for (let index = 0; index < blocks[0]!.length; index++) {
    blocks.forEach((block, blockIndex) => {
      if (index !== shortBlockLen - blockEcc || blockIndex >= numShortBlocks) {
        result.push(block[index]!);
      }
    });
  }
  return result;
}

function alignPositions(ver: number, size: number): number[] {
  if (ver === 1) return [];
  const count = Math.floor(ver / 7) + 2;
  const step = Math.ceil((ver * 4 + 4) / (count * 2 - 2)) * 2;
  const positions = new Array<number>(count);
  positions[0] = 6;
  for (let index = count - 1, position = size - 7; index >= 1; index--, position -= step) {
    positions[index] = position;
  }
  return positions;
}

export interface QrOptions {
  /** 强制版本（1–10）；不传按内容自动选最小版本。测试与矩阵比对用。 */
  version?: number;
  /** 强制掩码（0–7）；不传按罚分选最优。测试与矩阵比对用。 */
  mask?: number;
}

export function encodeQr(text: string, options: QrOptions = {}): QrMatrix {
  const bytes = [...new TextEncoder().encode(text)];
  let ver = 0;
  if (options.version !== undefined) {
    if (!Number.isInteger(options.version) || options.version < 1 || options.version > 10) {
      throw new Error('二维码版本只能是 1–10');
    }
    const lengthBits = options.version < 10 ? 8 : 16;
    if (4 + lengthBits + bytes.length * 8 > qrDataCodewords(options.version) * 8) {
      throw new Error('内容放不进指定版本');
    }
    ver = options.version;
  } else {
    for (let candidate = 1; candidate <= 10; candidate++) {
      const lengthBits = candidate < 10 ? 8 : 16;
      if (4 + lengthBits + bytes.length * 8 <= qrDataCodewords(candidate) * 8) {
        ver = candidate;
        break;
      }
    }
  }
  if (!ver) throw new Error('二维码内容过长');

  const lengthBits = ver < 10 ? 8 : 16;
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let index = length - 1; index >= 0; index--) bits.push((value >>> index) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, lengthBits);
  bytes.forEach((byte) => push(byte, 8));
  const capacity = qrDataCodewords(ver) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data: number[] = [];
  for (let index = 0; index < bits.length; index += 8) {
    let value = 0;
    for (let offset = 0; offset < 8; offset++) value = (value << 1) | bits[index + offset]!;
    data.push(value);
  }

  const size = ver * 4 + 17;
  const modules = new Uint8Array(size * size);
  const isFunction = new Uint8Array(size * size);
  const at = (x: number, y: number) => y * size + x;
  const setFunction = (x: number, y: number, dark: boolean) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    modules[at(x, y)] = dark ? 1 : 0;
    isFunction[at(x, y)] = 1;
  };

  // 定位图形 + 分隔带 + 时序图形
  for (let row = 0; row < size; row++) {
    setFunction(6, row, row % 2 === 0);
    setFunction(row, 6, row % 2 === 0);
  }
  const drawFinder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        setFunction(cx + dx, cy + dy, distance !== 2 && distance !== 4);
      }
    }
  };
  drawFinder(3, 3);
  drawFinder(size - 4, 3);
  drawFinder(3, size - 4);

  // 校正图形
  const positions = alignPositions(ver, size);
  for (let i = 0; i < positions.length; i++) {
    for (let j = 0; j < positions.length; j++) {
      const corner =
        (i === 0 && j === 0) ||
        (i === 0 && j === positions.length - 1) ||
        (i === positions.length - 1 && j === 0);
      if (corner) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFunction(
            positions[i]! + dx,
            positions[j]! + dy,
            Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
          );
        }
      }
    }
  }

  // 格式信息（纠错级别 L = 01；掩码先占位，选好掩码后重画）
  const drawFormat = (mask: number) => {
    const dataBitsValue = (0b01 << 3) | mask;
    let remainder = dataBitsValue;
    for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    const value = ((dataBitsValue << 10) | remainder) ^ 0x5412;
    const bit = (index: number) => ((value >>> index) & 1) !== 0;
    for (let i = 0; i <= 5; i++) setFunction(8, i, bit(i));
    setFunction(8, 7, bit(6));
    setFunction(8, 8, bit(7));
    setFunction(7, 8, bit(8));
    for (let i = 9; i < 15; i++) setFunction(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) setFunction(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) setFunction(8, size - 15 + i, bit(i));
    setFunction(8, size - 8, true);
  };
  drawFormat(0);

  // 版本信息（版本 7 起）
  if (ver >= 7) {
    let remainder = ver;
    for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    const value = (ver << 12) | remainder;
    for (let i = 0; i < 18; i++) {
      const dark = ((value >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunction(a, b, dark);
      setFunction(b, a, dark);
    }
  }

  // 数据区（之字形填码）
  const codewords = addEcc(data, ver);
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (isFunction[at(x, y)] || bitIndex >= codewords.length * 8) continue;
        modules[at(x, y)] =
          ((codewords[bitIndex >>> 3]! >>> (7 - (bitIndex & 7))) & 1) !== 0 ? 1 : 0;
        bitIndex++;
      }
    }
  }

  const maskFn = (mask: number, x: number, y: number): boolean => {
    switch (mask) {
      case 0:
        return (x + y) % 2 === 0;
      case 1:
        return y % 2 === 0;
      case 2:
        return x % 3 === 0;
      case 3:
        return (x + y) % 3 === 0;
      case 4:
        return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5:
        return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6:
        return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      default:
        return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    }
  };

  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (isFunction[at(x, y)]) continue;
        if (maskFn(mask, x, y)) modules[at(x, y)] = modules[at(x, y)] ? 0 : 1;
      }
    }
  };

  // 罚分（选掩码用）。按参考实现的四条规则逐条移植，保证选出的掩码与参考一致。
  const PENALTY_N1 = 3;
  const PENALTY_N2 = 3;
  const PENALTY_N3 = 40;
  const PENALTY_N4 = 10;

  const addHistory = (runLength: number, history: number[]) => {
    if (history[0] === 0) runLength += size; // 起始游程前面补一圈浅色边框
    history.pop();
    history.unshift(runLength);
  };

  const countPatterns = (history: number[]): number => {
    const n = history[1]!;
    const core =
      n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
    return (
      (core && history[0]! >= n * 4 && history[6]! >= n ? 1 : 0) +
      (core && history[6]! >= n * 4 && history[0]! >= n ? 1 : 0)
    );
  };

  const terminateAndCount = (
    currentColor: boolean,
    currentRun: number,
    history: number[],
  ): number => {
    if (currentColor) {
      addHistory(currentRun, history);
      currentRun = 0;
    }
    currentRun += size; // 末尾补一圈浅色边框
    addHistory(currentRun, history);
    return countPatterns(history);
  };

  const penalty = (): number => {
    let score = 0;
    // 行：同色连续 + 类定位图形
    for (let y = 0; y < size; y++) {
      let runColor = false;
      let runX = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let x = 0; x < size; x++) {
        if ((modules[at(x, y)] === 1) === runColor) {
          runX++;
          if (runX === 5) score += PENALTY_N1;
          else if (runX > 5) score++;
        } else {
          addHistory(runX, history);
          if (!runColor) score += countPatterns(history) * PENALTY_N3;
          runColor = modules[at(x, y)] === 1;
          runX = 1;
        }
      }
      score += terminateAndCount(runColor, runX, history) * PENALTY_N3;
    }
    // 列：同上
    for (let x = 0; x < size; x++) {
      let runColor = false;
      let runY = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let y = 0; y < size; y++) {
        if ((modules[at(x, y)] === 1) === runColor) {
          runY++;
          if (runY === 5) score += PENALTY_N1;
          else if (runY > 5) score++;
        } else {
          addHistory(runY, history);
          if (!runColor) score += countPatterns(history) * PENALTY_N3;
          runColor = modules[at(x, y)] === 1;
          runY = 1;
        }
      }
      score += terminateAndCount(runColor, runY, history) * PENALTY_N3;
    }
    // 2×2 同色块
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const value = modules[at(x, y)];
        if (
          value === modules[at(x + 1, y)] &&
          value === modules[at(x, y + 1)] &&
          value === modules[at(x + 1, y + 1)]
        ) {
          score += PENALTY_N2;
        }
      }
    }
    // 深浅比例
    let dark = 0;
    for (let index = 0; index < modules.length; index++) dark += modules[index]!;
    const total = size * size;
    const ratio = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    return score + Math.max(0, ratio) * PENALTY_N4;
  };

  let bestMask = 0;
  if (options.mask !== undefined) {
    if (!Number.isInteger(options.mask) || options.mask < 0 || options.mask > 7) {
      throw new Error('二维码掩码只能是 0–7');
    }
    bestMask = options.mask;
  } else {
    let bestScore = Number.POSITIVE_INFINITY;
    for (let mask = 0; mask < 8; mask++) {
      applyMask(mask);
      drawFormat(mask);
      const score = penalty();
      if (score < bestScore) {
        bestScore = score;
        bestMask = mask;
      }
      applyMask(mask); // 掩码是异或，再走一遍即还原
    }
  }
  applyMask(bestMask);
  drawFormat(bestMask);

  return {
    size,
    version: ver,
    mask: bestMask,
    get: (x: number, y: number) => modules[at(x, y)] === 1,
  };
}
