/** 输入以十进制字符串转整数微元，不用浮点乘法进行金额计算。 */
export function yuanToMicros(value: string): number {
  if (!/^\d{1,9}(\.\d{1,6})?$/.test(value.trim())) throw new Error('金额最多填写六位小数');
  const [whole, fraction = ''] = value.trim().split('.');
  const amount = BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('金额太大');
  return Number(amount);
}
export function formatMoney(micros: number): string {
  if (!Number.isSafeInteger(micros)) throw new Error('金额格式无效');
  return (
    '¥ ' +
    (micros / 1_000_000).toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    })
  );
}
