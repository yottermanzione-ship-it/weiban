/** 安全检查/跟进走可信平台端口；普通高危聊天仍由用户计费，保留规则兜底。 */
import {
  type GenerateTextInput,
  type ModelGatewayPort,
  type ModelGatewayPlatformPort,
} from '@weiban/contracts';
export interface CareFacts {
  highRisk: boolean;
  careActive: boolean;
  suspected: boolean;
}
export function callModelForCare(
  gateway: ModelGatewayPort,
  input: GenerateTextInput,
  _facts: CareFacts,
  platform?: ModelGatewayPlatformPort,
) {
  const clean = { ...input };
  delete clean.safetyPriority;
  if (clean.purpose === 'safety_check' || clean.purpose === 'safety_followup') {
    return platform
      ? platform.generatePlatformText({ ...clean, purpose: clean.purpose })
      : Promise.resolve({ ok: false as const, error: 'not_configured' as const });
  }
  return gateway.generateText(clean);
}
const FACTS =
  '请联系身边信任的人陪着你，可以拨打12356心理援助热线；如果眼下有危险，立即拨打110或120。';
export const CARE_TEMPLATE_VERSION = 'care-v1';
export function careFallback(
  cardText: string | undefined,
  variant: number,
  address: string | null,
): string[] {
  const rawName = (address ?? '你').replace(/[\r\n]/g, ' ').slice(0, 50);
  const name = /余额|模型|API|系统|性行为|做爱|性交|高潮|裸照/iu.test(rawName) ? '你' : rawName;
  const safeCard = cardText && !/余额|模型|API|系统/iu.test(cardText) ? cardText.trim() : null;
  const choices = [
    safeCard ?? `${name}，我在这里陪着你。`,
    `${name}，先别一个人承受，好吗？`,
    `${name}，先到安全的地方，我们一起缓一缓。`,
  ];
  const first = choices[((variant % choices.length) + choices.length) % choices.length]!;
  return [first.slice(0, 2000), FACTS];
}
