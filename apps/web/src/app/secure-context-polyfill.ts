/**
 * 无 HTTPS 的试运行地址（例如 http://服务器IP）不是浏览器“安全上下文”，
 * 此时 crypto.randomUUID 不存在，发送消息等生成请求 ID 的功能会直接报错。
 * crypto.getRandomValues 在非安全上下文仍可用，用它按 RFC 4122 v4 补一个等价实现。
 * HTTPS 或 localhost 下浏览器自带实现，不会被替换。
 */
if (typeof crypto !== 'undefined' && typeof crypto.randomUUID !== 'function') {
  Object.defineProperty(crypto, 'randomUUID', {
    configurable: true,
    value: (): `${string}-${string}-${string}-${string}-${string}` => {
      const b = crypto.getRandomValues(new Uint8Array(16));
      b[6] = (b[6]! & 0x0f) | 0x40;
      b[8] = (b[8]! & 0x3f) | 0x80;
      const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    },
  });
}

export {};
