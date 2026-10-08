/**
 * 统计嵌入模块（Phase 1，ADR-0020）。
 *
 * 用 bigram + 字符 TF-IDF 生成 256 维余弦归一化向量。
 * 不调用任何外部服务，不计费，纯 CPU 运算。
 * Phase 2：当 ModelGatewayPort 扩展出 generateEmbedding 时替换为神经模型（见契约变更申请）。
 *
 * 向量明文存储（见 ADR-0020 第 2 节），仅携带语义方向，不包含原文。
 */

const DIM = 256;

/**
 * 将文本分解为 bigram + unigram 特征集。
 * CJK 字符用 bigram（相邻两字），拉丁/数字用 2 字符以上的小写子串。
 */
function features(text: string): Map<number, number> {
  const normalized = text.toLocaleLowerCase().normalize('NFKC');
  const counts = new Map<number, number>();
  function add(hash: number) {
    counts.set(hash, (counts.get(hash) ?? 0) + 1);
  }
  // CJK bigrams
  const cjk = normalized.match(/[\p{Script=Han}]+/gu) ?? [];
  for (const run of cjk) {
    for (let i = 0; i < run.length; i++) {
      add(hashBucket(run[i]!, DIM));
      if (i + 1 < run.length) add(hashBucket(run.slice(i, i + 2), DIM));
    }
  }
  // ASCII tokens
  const ascii = normalized.match(/[a-z0-9]{2,}/g) ?? [];
  for (const tok of ascii) {
    add(hashBucket(tok, DIM));
    for (let i = 0; i + 2 <= tok.length; i++) add(hashBucket(tok.slice(i, i + 2), DIM));
  }
  return counts;
}

/** FNV-1a 哈希，映射到 [0, buckets)。 */
function hashBucket(s: string, buckets: number): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % buckets;
}

/** L2 归一化。 */
export function embed(text: string): Float32Array {
  const vec = new Float32Array(DIM);
  if (!text.trim()) return vec;
  const counts = features(text);
  for (const [bucket, count] of counts) vec[bucket] = (vec[bucket] ?? 0) + count;
  // L2 归一化
  let norm = 0;
  for (let i = 0; i < DIM; i++) norm += (vec[i] ?? 0) * (vec[i] ?? 0);
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < DIM; i++) vec[i] = (vec[i] ?? 0) / norm;
  return vec;
}

/** 余弦相似度（两向量必须已归一化）。 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < DIM; i++) dot += a[i]! * b[i]!;
  return dot;
}

/** 将 Float32Array 转为 PostgreSQL pgvector 字面量字符串（如 "[0.1,0.2,...]"）。 */
export function toVectorLiteral(v: Float32Array): string {
  return '[' + Array.from(v).join(',') + ']';
}

/** 将数据库返回的向量字符串解析回 Float32Array。 */
export function fromVectorLiteral(s: string): Float32Array {
  return new Float32Array(s.slice(1, -1).split(',').map(Number));
}

export const VECTOR_DIM = DIM;
