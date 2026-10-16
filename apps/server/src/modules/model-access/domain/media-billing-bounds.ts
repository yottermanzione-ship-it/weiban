/** 仅接受能从服务器文件字节证明时长的无压缩PCM WAV；不信任上传durationMs。 */
export function pcmWavSeconds(bytes: Uint8Array): number | null {
  const buffer = Buffer.from(bytes);
  if (
    buffer.length < 44 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WAVE' ||
    buffer.readUInt32LE(4) + 8 !== buffer.length
  )
    return null;
  let byteRate = 0,
    blockAlign = 0,
    dataSize = 0,
    formatSeen = false,
    dataSeen = false;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const size = buffer.readUInt32LE(offset + 4),
      end = offset + 8 + size;
    if (end > buffer.length) return null;
    const kind = buffer.toString('ascii', offset, offset + 4);
    if (kind === 'fmt ') {
      if (formatSeen || size < 16 || buffer.readUInt16LE(offset + 8) !== 1) return null;
      const channels = buffer.readUInt16LE(offset + 10),
        rate = buffer.readUInt32LE(offset + 12),
        bits = buffer.readUInt16LE(offset + 22);
      blockAlign = buffer.readUInt16LE(offset + 20);
      byteRate = buffer.readUInt32LE(offset + 16);
      if (
        !channels ||
        !rate ||
        ![8, 16, 24, 32].includes(bits) ||
        blockAlign !== (channels * bits) / 8 ||
        byteRate !== rate * blockAlign
      )
        return null;
      formatSeen = true;
    } else if (kind === 'data') {
      if (dataSeen) return null;
      dataSize = size;
      dataSeen = true;
    }
    offset = end + (size % 2);
  }
  return formatSeen && dataSeen && dataSize > 0 && dataSize % blockAlign === 0
    ? dataSize / byteRate
    : null;
}

/** 每个HTTP请求单独按供应商已核粒度进位，不能把多次请求汇成一次分钟。 */
export function roundAsr(seconds: number, step: number): number {
  return Math.ceil(seconds / step) * step;
}
