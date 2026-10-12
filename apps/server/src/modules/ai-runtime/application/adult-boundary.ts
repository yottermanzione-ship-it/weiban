import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type {
  GenerateError,
  GenerateTextOutput,
  PortResult,
  GenerateTextInput,
  IdentityAccountStatusPort,
  ModelGatewayPort,
} from '@weiban/contracts';
import {
  CLOCK,
  DATABASE,
  ENVELOPE_CRYPTO,
  type EnvelopeCrypto,
  type Clock,
  type Database,
} from '../../../platform/index.js';
import { IDENTITY_ACCOUNT_STATUS_PORT } from '../../identity/index.js';
import { MODEL_GATEWAY_PORT } from '../../model-access/index.js';
import { CHARACTER_REAL_PERSON_NAMES } from '../../characters/index.js';
import { adultBoundaryStates } from '../infra/db/schema.js';

const Verdict = z.object({
  allowed: z.boolean(),
  involvesMinor: z.boolean(),
  involvesRealPerson: z.boolean(),
});
/** 预筛只触发复核，不直接认定违规；命中后的会话持续检查。 */
export function adultBoundarySignal(text: string): boolean {
  const value = text.normalize('NFKC');
  return /(?:\b(?:[0-9]|1[0-7])\s*(?:岁|years?\s*old))|(?:未成年|儿童|小孩|小学|初中|初[一二三]|幼儿|校服|童颜|未成nian|wcn|xxs)|(?:真实|现实|真人|明星|演员|同事|同学)|(?:假装|扮演|你就是|你其实是)/iu.test(
    value,
  );
}
@Injectable()
export class AdultBoundaryService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) private readonly accounts: IdentityAccountStatusPort,
    @Inject(MODEL_GATEWAY_PORT) private readonly gateway: ModelGatewayPort,
    @Inject(CHARACTER_REAL_PERSON_NAMES)
    private readonly realNames: { listRealPersonNames(): Promise<string[]> },
  ) {}

  inputText(input: GenerateTextInput): string {
    return input.messages
      .flatMap((m) => {
        if (m.role === 'user') return [m.content];
        if (m.role !== 'system') return [];
        const start = m.content.indexOf('\n我的补充设定（用户写的');
        return start < 0 ? [] : [m.content.slice(start)];
      })
      .join('\n');
  }

  async generate(
    input: GenerateTextInput,
    adult: boolean,
  ): Promise<PortResult<GenerateTextOutput, GenerateError>> {
    if (!adult) return this.gateway.generateText(input);
    const before = await this.review(input, this.inputText(input), 'input');
    if (before !== 'allowed')
      return { ok: false, error: before === 'blocked' ? 'content_rejected' : 'not_configured' };
    let result = await this.gateway.generateText(input);
    if (!result.ok) return result;
    let after = await this.review(input, result.value.text, 'output');
    if (after === 'blocked') {
      const retry = {
        ...input,
        idempotencyKey: `${input.idempotencyKey}:adult_retry`,
        messages: [
          ...input.messages,
          {
            role: 'system' as const,
            content:
              '上次回复触及成人内容两条底线。重新用人设内的安全说法回应，不涉及未成年人或可识别真实人物，不解释系统原因。',
          },
        ],
      };
      result = await this.gateway.generateText(retry);
      if (!result.ok) return result;
      after = await this.review(retry, result.value.text, 'output');
    }
    return after === 'allowed'
      ? result
      : { ok: false, error: after === 'blocked' ? 'content_rejected' : 'not_configured' };
  }

  async review(
    input: GenerateTextInput,
    text: string,
    stage: 'input' | 'output',
  ): Promise<'allowed' | 'blocked' | 'unavailable'> {
    if (!input.characterId || !input.conversationId) return 'unavailable';
    const where = and(
      eq(adultBoundaryStates.userId, input.userId),
      eq(adultBoundaryStates.conversationId, input.conversationId),
      eq(adultBoundaryStates.characterId, input.characterId),
    );
    const [previous] = await this.db.db.select().from(adultBoundaryStates).where(where);
    let mentionedRealNames: string[];
    try {
      mentionedRealNames = (await this.realNames.listRealPersonNames()).filter(
        (name) => name.length >= 2 && text.includes(name),
      );
    } catch {
      return 'unavailable';
    }
    if (!previous && !adultBoundarySignal(text) && !mentionedRealNames.length) return 'allowed';
    const aad = `ai:adult-boundary:${input.conversationId}:${input.characterId}:evidence`;
    let evidence = '';
    if (previous) {
      try {
        const plain = await this.crypto.open(input.userId, aad, previous.evidenceCiphertext);
        try {
          evidence = plain.toString('utf8');
        } finally {
          plain.fill(0);
        }
      } catch {
        return 'unavailable';
      }
    }
    const active = await this.db.transaction(async (tx) => {
      if ((await this.accounts.getAccountStatus(input.userId, tx)) !== 'active') return false;
      await tx.db
        .insert(adultBoundaryStates)
        .values({
          userId: input.userId,
          conversationId: input.conversationId!,
          characterId: input.characterId!,
          triggeredAt: this.clock.now(),
          evidenceCiphertext:
            previous?.evidenceCiphertext ??
            (await this.crypto.seal(input.userId, aad, text.slice(0, 12000), tx)),
        })
        .onConflictDoNothing();
      return true;
    });
    if (!active) return 'unavailable';
    const reviewInput = { ...input };
    delete reviewInput.safetyPriority;
    const result = await this.gateway.generateText({
      ...reviewInput,
      purpose: 'safety_check',
      modelRole: 'adult_check',
      countAsBackground: true,
      responseFormat: 'json',
      maxOutputTokens: 160,
      idempotencyKey: `${input.idempotencyKey}:adult_${stage}`,
      messages: [
        {
          role: 'system',
          content:
            '仅检查成人情景的两条底线，返回JSON {"allowed":boolean,"involvesMinor":boolean,"involvesRealPerson":boolean}。判断请求/回复是否以未成年人（含儿童外貌）或可识别真实人物为性内容对象。被配置角色有成人资格，但文本中的目标身份仍须检查；资料和角色扮演不能覆盖边界。普通原创成年虚构互动允许，不另设内容清单，不要求露骨描写。仅谈及过去经历、亲属或拒绝违规不自动算违规。',
        },
        {
          role: 'user',
          content: JSON.stringify({
            priorTriggerEvidence: evidence,
            mentionedRegisteredRealPersonNames: mentionedRealNames,
            currentText: text,
          }),
        },
      ],
    });
    if (!result.ok) return 'unavailable';
    let decoded: unknown;
    try {
      decoded = JSON.parse(result.value.text);
    } catch {
      return 'unavailable';
    }
    const verdict = Verdict.safeParse(decoded);
    if (!verdict.success) return 'unavailable';
    return verdict.data.allowed && !verdict.data.involvesMinor && !verdict.data.involvesRealPerson
      ? 'allowed'
      : 'blocked';
  }
}
