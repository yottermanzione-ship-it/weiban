import { Form } from 'antd';
import { costPlusPriceMicros } from '@weiban/contracts';
import { yuanToMicros } from '@weiban/client-core';
import { FieldHelp } from '../../ui/page.js';

export function costPlusYuan(cost: number): number {
  return costPlusPriceMicros(yuanToMicros(String(cost))) / 1_000_000;
}

export function CostPlusHint({ name }: { name: string | (string | number)[] }) {
  const cost = Form.useWatch(name) as number | null | undefined;
  let price: number | null = null;
  if (cost != null) {
    try {
      price = costPlusYuan(cost);
    } catch {
      /* 表单负责显示金额格式错误。 */
    }
  }
  return (
    <FieldHelp>
      {price == null ? '填写成本后，日常售价自动加三成。' : `日常售价 ${price} 元；限时折扣另算。`}
    </FieldHelp>
  );
}
