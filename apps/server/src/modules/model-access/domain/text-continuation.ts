/** Join a successfully completed tail. A repeated answer without new text cannot complete a truncated turn. */
export function joinTextContinuation(prefix: string, tail: string): string | null {
  if (!tail.trim() || prefix.includes(tail.trim())) return null;
  // The prefix-function finds the longest suffix of the existing answer equal to a prefix
  // of the new text in linear time, including when the model restarts its whole answer.
  const length = Math.min(prefix.length, tail.length);
  const pattern = tail.slice(0, length);
  const failure = new Uint32Array(length);
  let matched = 0;
  for (let i = 1; i < length; i++) {
    while (matched > 0 && pattern[matched] !== pattern[i]) matched = failure[matched - 1]!;
    if (pattern[matched] === pattern[i]) matched++;
    failure[i] = matched;
  }
  matched = 0;
  for (let i = prefix.length - length; i < prefix.length; i++) {
    while (matched > 0 && pattern[matched] !== prefix[i]) matched = failure[matched - 1]!;
    if (pattern[matched] === prefix[i]) matched++;
  }
  const added = tail.slice(matched);
  return added.trim() ? prefix + added : null;
}
