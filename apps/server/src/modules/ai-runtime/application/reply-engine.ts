import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  MessageContent,
  type ChatParticipantPort,
  type ModelGatewayPort,
  type ModelGatewayPlatformPort,
  type GenerateTextInput,
  type GenerateTextOutput,
  type PortResult,
  type GenerateError,
} from '@weiban/contracts';
import {
  AUDIT_LOG,
  CLOCK,
  LOGGER,
  OUTBOX,
  type Outbox,
  P01_REPLY_DELAY,
  P02_SPLIT_BUBBLES,
  P28_INSTANT_REPLY_MIN_TYPING_MS,
  type AuditLog,
  type Clock,
  type Logger,
} from '../../../platform/index.js';
import { CHAT_PARTICIPANT_PORT } from '../../chat/index.js';
import { MODEL_GATEWAY_PORT, MODEL_PLATFORM_GATEWAY_PORT } from '../../model-access/index.js';
import { replyPlans } from '../infra/db/schema.js';
import { ReplyPlanStore, type ReplyPlan } from './plan-store.js';
import { ReplyContext, ReplySnapshot } from './reply-context.js';
import { callModelForCare, careFallback } from './safety-care.js';
import { HEALTH_LABEL } from './health-care.js';
import { MediaAiService } from './media-ai.js';
import { PlannerService } from './planner.js';
import { QuirkService } from './quirk-service.js';
import { seriousQuirkContext, typoCorrection } from '../domain/quirks.js';
import {
  DELIBERATE_WAIT_HINT,
  fitReplyContents,
  fixedPrefix,
  lateRecoveryHint,
  permanentFailure,
  waitRetryDelayMs,
} from '../domain/reply-delivery.js';
import {
  outputAllowed,
  replyDelay,
  splitReply,
  stripHabits,
  takeAfterFinalMarker,
} from '../domain/reply-rules.js';
import { withoutImages } from '../domain/prompt-assembly.js';
import {
  captionPhrase,
  filterPeople,
  splitCaptionTail,
  type ImageCaption,
} from '../domain/image-caption.js';
import { ImageCaptionStore } from './image-captions.js';
import { ImagePublicSearch } from './image-public-search.js';
import { publicImageSource } from '../domain/image-public-search.js';
import { takeStickerMarker } from '../domain/sticker-marker.js';
import { takePhotoMarker } from '../domain/photo-marker.js';
import type { StickerMood } from '../domain/reply-media-candidates.js';
const Result = z.object({
  /** 文字气泡，最多 P-02 文字上限（T-20261103h 起 6 条；之前存下的结果最多 4 条）。 */
  bubbles: z.array(z.string().min(1).max(4000)).min(1).max(P02_SPLIT_BUBBLES.maxTextBubbles),
  snapshot: ReplySnapshot,
  care: z.boolean(),
  /**
   * T-071：实际要发的内容（语音替换文字、附表情包 / 照片 / 作品链接、撤回草稿、错字更正）；没有时按 bubbles 发文字。
   * 存之前已按 P-02 总上限封顶（8 条）；更早存下的旧结果最多 6 条，发送时再封顶。
   */
  contents: z.array(MessageContent).max(P02_SPLIT_BUBBLES.maxTotalBubbles).optional(),
  quirkDraftMessageId: z.uuid().optional(),
  /** v3.3：这次回复消耗（各次调用合计），发第一个正式气泡时交给 chat。 */
  charge: z
    .object({ usageRecordId: z.string().nullable(), chargedMicros: z.number().nonnegative() })
    .optional(),
});
@Injectable()
export class ReplyEngine {
  constructor(
    @Inject(ReplyPlanStore) readonly store: ReplyPlanStore,
    @Inject(ReplyContext) readonly context: ReplyContext,
    @Inject(MODEL_GATEWAY_PORT) readonly gateway: ModelGatewayPort,
    @Inject(CHAT_PARTICIPANT_PORT) readonly writer: ChatParticipantPort,
    @Inject(CLOCK) readonly clock: Clock,
    @Inject(AUDIT_LOG) readonly audit: AuditLog,
    @Inject(MediaAiService) readonly mediaAi: MediaAiService,
    @Inject(OUTBOX) readonly outbox: Outbox,
    @Inject(PlannerService) readonly planner: PlannerService,
    @Inject(QuirkService) readonly quirks: QuirkService,
    @Optional() @Inject(MODEL_PLATFORM_GATEWAY_PORT) readonly platform?: ModelGatewayPlatformPort,
    /** H3：图片描述存档。 */
    @Optional() @Inject(ImageCaptionStore) readonly captions?: ImageCaptionStore,
    @Optional() @Inject(ImagePublicSearch) readonly imageSearch?: ImagePublicSearch,
    @Optional() @Inject(LOGGER) readonly logger?: Logger,
  ) {}
  async run(id: string): Promise<void> {
    if (!z.uuid().safeParse(id).success) return;
    try {
      await this.execute(id);
    } catch (error) {
      // T-20261103e：违反约束这类确定性失败重试多少次都一样（10-29 曾空转 47 次）——直接作废并记下原因；
      // 发气泡和推进进度在同一个事务里，失败的那条随事务回滚，已发出的不受影响、之后也不再重发。
      const reason = permanentFailure(error);
      if (!reason) throw error;
      const ended = await this.store.fail(id, reason);
      this.logger?.error(
        { code: 'ai_reply_permanent_failure', planId: id, reason, ended },
        'ai.generate_reply permanent failure',
      );
    }
  }
  private async execute(id: string): Promise<void> {
    const row = await this.store.claim(id);
    if (!row) return;
    if (row.status === 'sending') {
      await this.emit(row);
      return;
    }
    const snapshot = row.inputCiphertext
      ? ReplySnapshot.parse(await this.store.open(row, 'input'))
      : await this.context.build(row);
    if (!snapshot) {
      await this.store.cancel(id);
      return;
    }
    if (snapshot.trial && (await this.context.currentEpoch(row, snapshot)) !== snapshot.epoch) {
      await this.store.cancel(id);
      return;
    }
    const saved = await this.saveInput(row, snapshot);
    if (!saved) return;
    await this.writer.markRead({
      conversationId: row.conversationId,
      participantId: snapshot.participantId,
      readSeq: snapshot.lastUserSeq,
    });
    // v3.3（积分制）：累计这次回复各次调用扣的钱，记在第一个气泡上（Message.pointsCost）。
    const charge = { usageRecordId: null as string | null, chargedMicros: 0 };
    const chargedGateway = trackCharges(this.gateway, charge);
    let imageReplyCalls = 0;
    const gw: ModelGatewayPort = {
      getModelStatus: (userId, characterId) => chargedGateway.getModelStatus(userId, characterId),
      generateText: (input) => {
        // P3's extra text answer shares the original two-call budget with all rewrite paths.
        if (snapshot.imageSlots.length && input.purpose === 'chat_reply' && ++imageReplyCalls > 2)
          return Promise.resolve({ ok: false as const, error: 'policy_denied' as const });
        return chargedGateway.generateText(input);
      },
    };
    const care = snapshot.highRisk || snapshot.careActive;
    let suspected = snapshot.suspected;
    if (suspected && !care) {
      // H2：私密模式里用户的话不出私密范围——疑似风险的判断交给该用户的私密模型；日常范围走平台检查模型。
      // H3（13 号 §6「安全把关由平台承担」）：两种范围都由平台付费（不扣用户积分，余额 ≤ 0 也照常判断）；
      // 私密范围仍用私密模型（modelRole = adult 经平台端口，契约 3.29）。
      const check = await callModelForCare(
        gw,
        {
          ...this.input(row, snapshot, 'check'),
          purpose: 'safety_check',
          messages: [
            {
              role: 'system',
              content: '仅判断是否有现实自杀/自伤高风险，输出HIGH或LOW；不提供任何方法。',
            },
            {
              role: 'user',
              content: snapshot.messages.filter((m) => m.role === 'user').at(-1)?.content ?? '',
            },
          ],
          maxOutputTokens: 20,
        },
        { highRisk: false, careActive: false, suspected: true },
        this.platform,
      );
      suspected = check.ok && check.value.text.trim() === 'HIGH';
    }
    const facts = {
      highRisk: snapshot.highRisk || suspected,
      careActive: snapshot.careActive,
      suspected: false,
    };
    const inCare = facts.highRisk || facts.careActive;
    // H3（13 号 §6「安全关怀由平台承担」）：私密模式里的关怀回合由平台付费（不扣用户积分、余额 ≤ 0 也照常），
    // 仍用该用户的私密模型（私密内容不出私密范围，契约 3.29 平台端口 modelRole = adult）。
    const privateCare = inCare && snapshot.scope === 'adult';
    const careAware = (input: GenerateTextInput): GenerateTextInput =>
      privateCare ? { ...input, purpose: 'safety_followup' } : input;
    // H3：一步看图——本轮新图附在请求里，回复正文后顺带输出描述尾标；这里剥掉尾标并收集描述。
    const slots = snapshot.imageSlots;
    const seen: (ImageCaption | null)[] = slots.map(() => null);
    let captionModel: string | null = null;
    // T-20261103d：模型在正文里写的「[表情:…]」标记——这里剥掉（用户看不到），情绪按这次输出记下，
    // 最终采用哪次输出的正文，就用哪次输出的情绪；换成兜底说法时不带表情。
    // T-20261103g：「[照片]」标记同样剥掉、按这次输出记下（只有提示里给过照片时才会真的发）。
    const marks = new WeakMap<GenerateTextOutput, { mood: StickerMood | null; photo: boolean }>();
    const strip = (
      result: PortResult<GenerateTextOutput, GenerateError>,
      sawImages = true,
    ): PortResult<GenerateTextOutput, GenerateError> => {
      if (!result.ok) return result;
      const parts = splitCaptionTail(result.value.text, slots.length);
      parts.captions.forEach((c, i) => {
        if (sawImages && c && !seen[i]) {
          seen[i] = c;
          captionModel ??= result.value.modelKey;
        }
      });
      const photo = takePhotoMarker(takeAfterFinalMarker(parts.reply));
      const marked = takeStickerMarker(photo.text);
      const value = { ...result.value, text: marked.text };
      marks.set(value, { mood: marked.mood, photo: photo.photo });
      return { ...result, value };
    };
    // 重写调用：已解析出全部描述就换成文字（不再花钱看一次图），否则照旧附图。
    const retryMessages = () =>
      slots.length && seen.every(Boolean)
        ? withoutImages(snapshot.messages, (n) => {
            const c = seen[slots.findIndex((x) => x.n === n)];
            return c ? captionPhrase(c) : null;
          })
        : snapshot.messages;
    // 3.25（G1-1）：私密模式不再调用成人内容检查模型；底线由角色资格、私密模式提示词与违禁词规则保证。
    let answer: PortResult<GenerateTextOutput, GenerateError> = snapshot.forceCareFallback
      ? { ok: false, error: 'policy_denied' }
      : strip(await this.imageReply(row, snapshot, gw, facts, privateCare));
    // 模型缺识图能力（或这次读不到图）：去掉附图、按「看不到图」再答一次。
    if (!answer.ok && answer.error === 'capability_missing' && slots.length)
      answer = strip(
        await callModelForCare(
          gw,
          careAware({
            ...this.input(row, snapshot, 'reply-blind'),
            messages: this.wire(withoutImages(snapshot.messages)),
          }),
          facts,
          this.platform,
        ),
        false,
      );
    if (
      answer.ok &&
      !outputAllowed(answer.value.text, snapshot.policy, snapshot.scope === 'adult')
    ) {
      answer = strip(
        await callModelForCare(
          gw,
          careAware({
            ...this.input(row, snapshot, 'guard'),
            messages: this.wire([
              ...retryMessages(),
              {
                role: 'system',
                content:
                  '上次输出不符合平台边界。请重新用安全、人设内的聊天纯文本回复，不透露技术原因。',
              },
            ]),
          }),
          facts,
          this.platform,
        ),
      );
    }
    let bubbles: string[] = [];
    let fallbackReason: string | null = null;
    let stickerMood: StickerMood | null = null;
    let photoWanted = false;
    if (
      answer.ok &&
      outputAllowed(answer.value.text, snapshot.policy, snapshot.scope === 'adult')
    ) {
      // 2026-10-30 双兜底出站过滤：只清本轮检出的习惯词，删完为空时 stripHabits 原样返回，绝不发空。
      bubbles = splitReply(
        stripHabits(answer.value.text, snapshot.habits ?? []),
        snapshot.splitBubbles,
      );
      stickerMood = marks.get(answer.value)?.mood ?? null;
      photoWanted = marks.get(answer.value)?.photo ?? false;
    }
    if (!bubbles.length) {
      stickerMood = null;
      photoWanted = false;
      if (inCare) {
        bubbles = careFallback(snapshot.careFallback, snapshot.careVariant, snapshot.addressAs);
        fallbackReason = answer.ok ? 'output_guard' : answer.error;
      } else if (row.kind === 'greeting')
        bubbles = splitReply(
          snapshot.fallbackGreetings.find((s) => outputAllowed(s, snapshot.policy, false)) ??
            '你好，很高兴认识你。',
          snapshot.splitBubbles,
        );
      else if ((!answer.ok && answer.error === 'content_rejected') || answer.ok)
        bubbles = splitReply(snapshot.deflect, snapshot.splitBubbles);
      else {
        await this.wait(row, answer.error);
        return;
      }
    }
    if (!bubbles.length) {
      await this.wait(row, 'output_guard');
      return;
    }
    if (inCare && !bubbles.every((b) => outputAllowed(b, snapshot.policy, false)))
      bubbles = careFallback(undefined, snapshot.careVariant, null);
    // T-071 MED-04 第 2 条：识过图的回合，回复里出现名单外真人姓名 → 重写一次，仍不行用安全说法。
    if (!inCare && snapshot.allowedNames) {
      const bad = await this.mediaAi.offendingNames(
        bubbles.join('\n'),
        snapshot.allowedNames,
        snapshot.userText,
      );
      if (bad.length) {
        const retry = await callModelForCare(
          gw,
          {
            ...this.input(row, snapshot, 'names'),
            messages: this.wire([
              ...retryMessages(),
              {
                role: 'system',
                content: `上次回复说出了你不能认出的人（${bad.join('、')}）。图片里名单外的人不能说出或猜测身份。请重新回复，只按外观描述，不提这些名字。`,
              },
            ]),
          },
          facts,
        );
        const retried = strip(retry);
        const again =
          retried.ok &&
          outputAllowed(retried.value.text, snapshot.policy, snapshot.scope === 'adult')
            ? splitReply(
                stripHabits(retried.value.text, snapshot.habits ?? []),
                snapshot.splitBubbles,
              )
            : [];
        const accepted =
          again.length > 0 &&
          !(
            await this.mediaAi.offendingNames(
              again.join('\n'),
              snapshot.allowedNames,
              snapshot.userText,
            )
          ).length;
        bubbles = accepted ? again : ['图里的人我不太认得呢，你跟我说说？'];
        const retriedMarks = accepted && retried.ok ? marks.get(retried.value) : undefined;
        stickerMood = retriedMarks?.mood ?? null;
        photoWanted = retriedMarks?.photo ?? false;
      }
    }
    // H3：把这一轮解析出的图片描述存档（加密，按图片 + 范围；私密范围的只在私密范围被读到）。
    if (seen.some(Boolean)) await this.saveCaptions(row, snapshot, seen, captionModel);
    // T-071：语音 / 表情包 / 作品链接（只在日常范围的普通回复里）。
    let contents: MessageContent[] | null = null;
    if (
      !inCare &&
      row.kind === 'message' &&
      !snapshot.trial &&
      snapshot.scope === 'normal' &&
      !['recall', 'typo'].includes(snapshot.quirk.kind)
    ) {
      const history = await this.context.chat
        .readMessages({ conversationId: row.conversationId, scopes: ['normal'], limit: 100 })
        .catch(() => []);
      contents = await this.mediaAi
        .planExtras({
          ctx: {
            userId: row.userId,
            characterId: row.characterId,
            conversationId: row.conversationId,
            defaultVoiceId: snapshot.defaultVoiceId,
          },
          triggerId: row.triggerId,
          bubbles,
          userText: snapshot.userText,
          history,
          voiceId: snapshot.voiceId,
          instant: snapshot.instantReply,
          quiet: snapshot.effectiveStyle === 'treehole',
          sensitive: snapshot.healthUsed,
          stickerMood,
          photo: photoWanted ? snapshot.photoOffer : null,
          onSearchCharged: (micros) => {
            charge.chargedMicros += Math.max(0, micros);
          },
        })
        .catch(() => null);
    }
    if (!inCare && snapshot.quirk.kind === 'recall') {
      const first = bubbles[0]!;
      const draft =
        '唔，' + [...first].slice(0, Math.max(1, Math.floor([...first].length / 2))).join('');
      if (outputAllowed(draft, snapshot.policy, false))
        contents = [
          { type: 'text', text: draft },
          ...bubbles.map((text) => ({ type: 'text' as const, text })),
        ];
      else snapshot.quirk.kind = 'none';
    }
    if (!inCare && snapshot.quirk.kind === 'typo') {
      const change = typoCorrection(bubbles[0]!);
      if (change && outputAllowed(change.text, snapshot.policy, false))
        contents = [
          { type: 'text', text: change.text },
          { type: 'text', text: change.correction },
          ...bubbles.slice(1).map((text) => ({ type: 'text' as const, text })),
        ];
      else snapshot.quirk.kind = 'none';
    }
    // T-20261103e：表情包 / 照片 / 链接 / 撤回草稿 / 错字更正都会多出一条，统一按 P-02 总上限封顶
    // （T-20261103h 起文字最多 6 条、总共最多 8 条，与 reply_plan_counters 的 next_bubble ≤ 8 一致）：
    // 相邻文字合并进后一条，合并不下再去掉附加内容；仍不行就只发文字气泡（这时撤回 / 错字小巧思不演）。
    if (contents) {
      const fitted = fitReplyContents(contents, fixedPrefix(snapshot.quirk.kind));
      if (!fitted && ['recall', 'typo'].includes(snapshot.quirk.kind)) snapshot.quirk.kind = 'none';
      contents = fitted;
    }
    // T-090 reply_timing：秒回关闭时由决策层在 fast / normal / slow 间挑（仍在 P-01 上下限内）；秒回开启不加人为延迟。
    let timing: 'fast' | 'normal' | 'slow' = 'normal';
    if (!inCare && !snapshot.instantReply && row.kind === 'message') {
      const d = await this.planner
        .decide({
          userId: row.userId,
          characterId: row.characterId,
          conversationId: row.conversationId,
          decisionType: 'reply_timing',
          options: ['fast', 'normal', 'slow'],
          ruleChoice: 'normal',
          ruleReason: '规则版按长度',
          conservative: 'normal',
          question:
            '这次回复按什么节奏发出：fast（按长度下限，像正好拿着手机）、normal（按长度中值）、slow（按长度上限，像在忙）？',
          features: {
            userMsgLength: [...snapshot.userText].length,
            replyLength: bubbles.join('').length,
            scenarioMode: snapshot.scenarioMode,
          },
          summary: snapshot.scope === 'adult' ? null : snapshot.userText.slice(0, 100),
          adult: snapshot.scope === 'adult',
          path: 'reply',
          idempotencyKey: `${row.id}:${row.retryEpoch}:timing`,
          timeoutMs: 3000,
        })
        .catch(() => null);
      if (d && (d.choice === 'fast' || d.choice === 'slow')) timing = d.choice;
    }
    await this.store.db.transaction(async (tx) => {
      if (!(await this.store.lock(tx, row.userId, row.conversationId))) return;
      const [current] = await tx.db
        .select()
        .from(replyPlans)
        .where(eq(replyPlans.id, row.id))
        .for('update');
      if (
        (await this.context.memory.revision(
          tx,
          row.userId,
          row.characterId,
          row.conversationId,
        )) !== snapshot.memoryRevision
      )
        return;
      if (!current || current.status !== 'generating' || current.leaseId !== row.leaseId) return;
      const resultCiphertext = await this.store.seal(tx, row, 'result', {
        bubbles,
        snapshot: { ...snapshot, highRisk: facts.highRisk },
        care: inCare,
        ...(contents ? { contents } : {}),
        ...(charge.chargedMicros > 0 ? { charge } : {}),
      });
      const elapsed = this.clock.nowMs() - Date.parse(snapshot.triggerAt);
      const base = inCare ? 0 : replyDelay(bubbles.join(''), snapshot.instantReply, elapsed);
      const delay =
        inCare || snapshot.instantReply || timing === 'normal'
          ? base
          : Math.max(
              0,
              Math.min(
                Math.min(
                  P01_REPLY_DELAY.maxMs,
                  Math.max(P01_REPLY_DELAY.minMs, base * (timing === 'fast' ? 0.6 : 1.5)),
                ),
                P01_REPLY_DELAY.firstBubbleDeadlineMs - elapsed,
              ),
            );
      const dueAt = new Date(
        Math.max(
          this.clock.nowMs() + Math.max(0, delay - (inCare ? 0 : P28_INSTANT_REPLY_MIN_TYPING_MS)),
          !inCare && snapshot.quirk.kind === 'read_delay' && snapshot.quirk.respondAt
            ? Date.parse(snapshot.quirk.respondAt) - P28_INSTANT_REPLY_MIN_TYPING_MS
            : 0,
        ),
      );
      await tx.db
        .update(replyPlans)
        .set({
          status: 'sending',
          resultCiphertext,
          dueAt,
          leaseId: null,
          leaseUntil: null,
          careUntil: inCare ? new Date(this.clock.nowMs() + 30 * 60000) : null,
        })
        .where(eq(replyPlans.id, row.id));
      if (fallbackReason)
        await this.audit.record(
          {
            module: 'ai_runtime',
            action: 'care.fallback',
            actorType: 'system',
            actorId: row.userId,
            targetType: 'character',
            targetId: row.characterId,
            details: { planId: row.id, reason: fallbackReason },
          },
          tx,
        );
      await this.store.schedule(tx, row.id, dueAt);
    });
  }
  /** 交给网关的消息：去掉只给自己用的 blindContent。 */
  private async imageReply(
    row: ReplyPlan,
    snapshot: ReplySnapshot,
    gw: ModelGatewayPort,
    facts: { highRisk: boolean; careActive: boolean; suspected: boolean },
    privateCare: boolean,
  ) {
    const input = {
      ...this.input(row, snapshot, 'reply'),
      ...(privateCare ? { purpose: 'safety_followup' as const } : {}),
    };
    const first = await callModelForCare(gw, input, facts, this.platform);
    if (
      !this.imageSearch ||
      facts.highRisk ||
      facts.careActive ||
      snapshot.trial ||
      row.kind !== 'message'
    )
      return first;
    return this.imageSearch.refine(
      input,
      first,
      (next) => gw.generateText(next),
      async () => {
        const conversation = await this.context.chat.getConversation(row.conversationId);
        if (
          conversation?.contentScope !== 'normal' ||
          (await this.context.currentEpoch(row, snapshot)) !== snapshot.epoch
        )
          return false;
        for (const slot of snapshot.imageSlots) {
          if (!slot.messageId || slot.ownerUserId !== row.userId) return false;
          const message = await this.context.chat.getMessage(slot.messageId, ['normal']);
          if (!publicImageSource(message, row.conversationId)) return false;
        }
        return this.store.db.transaction(
          async (tx) =>
            (await this.context.memory.revision(
              tx,
              row.userId,
              row.characterId,
              row.conversationId,
            )) === snapshot.memoryRevision,
        );
      },
    );
  }

  private wire(messages: ReplySnapshot['messages']): GenerateTextInput['messages'] {
    return messages.map(({ blindContent: _blind, ...m }) => {
      void _blind;
      return m;
    });
  }
  /**
   * H3：存图片描述。认出的人只留认人名单里的；日常范围的描述过一遍违禁词规则（不留露骨描写）。
   * 存档失败不影响回复（下次再发同一张图会重新看）。
   */
  private async saveCaptions(
    row: ReplyPlan,
    snapshot: ReplySnapshot,
    captions: (ImageCaption | null)[],
    modelKey: string | null,
  ): Promise<void> {
    if (!this.captions) return;
    for (const [index, slot] of snapshot.imageSlots.entries()) {
      let caption = captions[index];
      if (!caption) continue;
      caption = filterPeople(caption, snapshot.allowedNames ?? []);
      if (
        snapshot.scope === 'normal' &&
        !outputAllowed(captionPhrase(caption), snapshot.policy, false)
      )
        caption = { ...caption, description: '画面含不适合日常聊天的内容', textInImage: '' };
      await this.captions
        .save({
          userId: row.userId,
          mediaId: slot.mediaId,
          scope: snapshot.scope,
          messageId: slot.messageId,
          conversationId: row.conversationId,
          caption,
          modelKey,
        })
        .catch(() => undefined);
    }
  }
  private input(row: ReplyPlan, snapshot: ReplySnapshot, suffix: string): GenerateTextInput {
    return {
      userId: row.userId,
      characterId: row.characterId,
      conversationId: row.conversationId,
      purpose: 'chat_reply',
      billingOwner: 'user',
      modelRole: snapshot.scope === 'adult' ? 'adult' : 'chat',
      messages: this.wire(snapshot.messages),
      deadlineAt: snapshot.deadlineAt,
      responseFormat: 'text',
      // 聊天由网关按当前模型核准的总输出能力分配，包含思考与图片描述，不再统一截成 600/900。
      idempotencyKey: `ai:${row.id}:${row.retryEpoch}:${suffix}`,
      meta: {
        personaVersion: snapshot.personaVersion,
        promptTemplateVersion: snapshot.promptTemplateVersion,
        conversationKind: 'direct',
        scenarioMode: snapshot.scenarioMode,
        ...(snapshot.stablePrefixChars > 0
          ? { stablePrefixChars: snapshot.stablePrefixChars }
          : {}),
      },
    };
  }
  private async saveInput(row: ReplyPlan, snapshot: ReplySnapshot): Promise<boolean> {
    if (row.inputCiphertext) return true;
    const proposed = await this.quirks
      .choose(row, snapshot)
      .catch(() => ({ kind: 'none' as const, respondAt: null, typingCycles: 0 }));
    return this.store.db.transaction(async (tx) => {
      if (!(await this.store.lock(tx, row.userId, row.conversationId))) return false;
      const [current] = await tx.db
        .select()
        .from(replyPlans)
        .where(eq(replyPlans.id, row.id))
        .for('update');
      if (!current || current.status !== 'generating' || current.leaseId !== row.leaseId)
        return false;
      snapshot.quirk = await this.quirks.reserve(tx, row, proposed, snapshot.timeZone);
      // T-20261103e：模型临时不可用、稍后由巡检恢复的回复已经晚了，沿用同一句「有意稍等了一会儿」。
      if (
        snapshot.quirk.kind === 'read_delay' ||
        lateRecoveryHint({
          kind: row.kind,
          retryEpoch: row.retryEpoch,
          failure: row.failure,
          createdAt: row.createdAt,
          nowMs: this.clock.nowMs(),
          sensitive:
            snapshot.highRisk ||
            snapshot.careActive ||
            snapshot.suspected ||
            snapshot.healthUsed ||
            snapshot.trial === true ||
            snapshot.effectiveStyle === 'treehole' ||
            seriousQuirkContext(snapshot.userText),
        })
      )
        snapshot.messages.push({ role: 'system', content: DELIBERATE_WAIT_HINT });
      const cipher = await this.store.seal(tx, row, 'input', snapshot);
      const saved = await tx.db
        .update(replyPlans)
        .set({ inputCiphertext: cipher })
        .where(and(eq(replyPlans.id, row.id), eq(replyPlans.leaseId, row.leaseId!)))
        .returning();
      return saved.length > 0;
    });
  }
  private async wait(row: ReplyPlan, reason: string): Promise<void> {
    // T-20261103e：due_at 记下次巡检最早什么时候再试（按已恢复次数退避）；只有可重试的失败会被巡检捡起。
    await this.store.db.db
      .update(replyPlans)
      .set({
        status: 'waiting',
        failure: reason,
        leaseId: null,
        leaseUntil: null,
        dueAt: new Date(this.clock.nowMs() + waitRetryDelayMs(row.retryEpoch)),
      })
      .where(and(eq(replyPlans.id, row.id), eq(replyPlans.leaseId, row.leaseId!)));
  }
  private async emit(row: ReplyPlan): Promise<void> {
    const result = Result.parse(await this.store.open(row, 'result'));
    // T-20261103e：上线前已生成、还没开始发的旧结果也按同一规则封顶（发出第一条时连同结果重新加密保存）。
    if (row.nextBubble === 0 && result.contents) {
      const fitted = fitReplyContents(result.contents, fixedPrefix(result.snapshot.quirk.kind));
      if (fitted) result.contents = fitted;
      else {
        delete result.contents;
        if (['recall', 'typo'].includes(result.snapshot.quirk.kind))
          result.snapshot.quirk.kind = 'none';
      }
    }
    // 已经发到总上限的计划：多出的不再发，直接收尾（next_bubble 永远不超过 P-02 总上限）。
    if (row.nextBubble >= deliveryCount(result)) {
      await this.store.db.db
        .update(replyPlans)
        .set({ status: 'done', inputCiphertext: null, resultCiphertext: null })
        .where(
          and(
            eq(replyPlans.id, row.id),
            eq(replyPlans.status, 'sending'),
            eq(replyPlans.nextBubble, row.nextBubble),
          ),
        );
      return;
    }
    const contact = await this.context.contacts.getActiveContact(row.userId, row.characterId);
    const conversation =
      contact?.conversationId === row.conversationId ||
      (result.snapshot.trial &&
        (await this.context.currentEpoch(row, result.snapshot)) === result.snapshot.epoch)
        ? await this.context.chat.getConversation(row.conversationId)
        : null;
    const policy = conversation
      ? await this.context.policy.getCharacterPolicy(row.userId, row.characterId)
      : null;
    if (result.care && conversation && policy) {
      if (conversation.contentScope === 'adult' && !policy.adultModeEligible) {
        const safe = await this.context.admin.setContentScope({
          conversationId: row.conversationId,
          scope: 'normal',
        });
        if (!safe.ok) {
          await this.store.cancel(row.id);
          return;
        }
        conversation.contentScope = 'normal';
      }
      result.snapshot.scope = conversation.contentScope;
      if (!result.bubbles.every((b) => outputAllowed(b, policy, false))) {
        const safe = careFallback(undefined, result.snapshot.careVariant, null);
        result.bubbles = Array.from(
          { length: Math.max(2, result.bubbles.length) },
          (_, i) => safe[i === 0 ? 0 : 1]!,
        );
      }
      await this.store.db.transaction(async (tx) => {
        if (!(await this.store.lock(tx, row.userId, row.conversationId))) return;
        const cipher = await this.store.seal(tx, row, 'result', result);
        await tx.db
          .update(replyPlans)
          .set({ resultCiphertext: cipher })
          .where(and(eq(replyPlans.id, row.id), eq(replyPlans.status, 'sending')));
        row.resultCiphertext = cipher;
      });
    }
    if (
      (await this.context.currentEpoch(row, result.snapshot)) !== result.snapshot.epoch ||
      !conversation ||
      !policy ||
      conversation.contentScope !== result.snapshot.scope ||
      !result.bubbles.every((b) => outputAllowed(b, policy, result.snapshot.scope === 'adult'))
    ) {
      await this.store.cancel(row.id);
      return;
    }
    await this.writer.markRead({
      conversationId: row.conversationId,
      participantId: result.snapshot.participantId,
      readSeq: result.snapshot.lastUserSeq,
    });
    if (!result.care) {
      if (
        row.nextBubble === 0 &&
        result.snapshot.quirk.kind === 'shy_typing' &&
        (await this.quirks.consumeTyping(row))
      ) {
        for (let i = 0; i < result.snapshot.quirk.typingCycles; i++) {
          await this.writer.setTyping({
            conversationId: row.conversationId,
            participantId: result.snapshot.participantId,
            state: 'start',
          });
          await new Promise<void>((resolve) => setTimeout(resolve, 300));
          await this.writer.setTyping({
            conversationId: row.conversationId,
            participantId: result.snapshot.participantId,
            state: 'stop',
          });
          await new Promise<void>((resolve) => setTimeout(resolve, 200));
        }
      }
      await this.writer.setTyping({
        conversationId: row.conversationId,
        participantId: result.snapshot.participantId,
        state: 'start',
      });
      await new Promise<void>((resolve) => setTimeout(resolve, P28_INSTANT_REPLY_MIN_TYPING_MS));
    }
    /** T-20261103g：这次发出的是分享的素材照片时记下消息 ID，事务提交后存档（失败不影响已发出的消息）。 */
    const sharedPhoto = { messageId: null as string | null };
    try {
      const current = await this.store.get(row.id);
      if (
        current?.status !== 'sending' ||
        (await this.context.currentEpoch(row, result.snapshot)) !== result.snapshot.epoch
      )
        return;
      if (
        !result.care &&
        row.nextBubble === 1 &&
        result.snapshot.quirk.kind === 'recall' &&
        result.quirkDraftMessageId
      ) {
        const recalled = await this.writer.recall({
          conversationId: row.conversationId,
          participantId: result.snapshot.participantId,
          messageId: result.quirkDraftMessageId,
        });
        if (!recalled.ok && recalled.error === 'not_sender') {
          await this.store.cancel(row.id);
          return;
        }
      }
      await this.store.db.transaction(async (tx) => {
        if (!(await this.store.lock(tx, row.userId, row.conversationId))) return;
        const [pending] = await tx.db
          .select()
          .from(replyPlans)
          .where(eq(replyPlans.id, row.id))
          .for('update');
        if (
          !pending ||
          pending.status !== 'sending' ||
          pending.nextBubble !== row.nextBubble ||
          (await this.context.currentEpoch(row, result.snapshot, tx)) !== result.snapshot.epoch ||
          (await this.context.memory.revision(
            tx,
            row.userId,
            row.characterId,
            row.conversationId,
          )) !== result.snapshot.memoryRevision
        )
          return;
        const posted = await this.writer.postMessage(
          {
            conversationId: row.conversationId,
            senderParticipantId: result.snapshot.participantId,
            content: result.contents?.[row.nextBubble] ?? {
              type: 'text',
              text: result.bubbles[row.nextBubble]!,
            },
            idempotencyKey: `reply:${row.triggerId}:${row.nextBubble}`,
            expectedScope: result.snapshot.scope,
            ...(result.charge &&
            row.nextBubble === (result.snapshot.quirk.kind === 'recall' && !result.care ? 1 : 0)
              ? { charge: result.charge }
              : {}),
            ...(result.snapshot.trial
              ? { labels: ['trial'] }
              : result.snapshot.healthUsed
                ? { labels: [HEALTH_LABEL] }
                : row.nextBubble === 0 && result.snapshot.quirk.kind === 'recall'
                  ? { labels: ['quirk_draft'] }
                  : {}),
          },
          tx,
        );
        if (!posted.ok) {
          await tx.db
            .update(replyPlans)
            .set({ status: 'cancelled', inputCiphertext: null, resultCiphertext: null })
            .where(eq(replyPlans.id, row.id));
          return;
        }
        if (
          posted.value.content?.type === 'image' &&
          posted.value.content.mediaId === result.snapshot.photoOffer?.mediaId
        )
          sharedPhoto.messageId = posted.value.messageId;
        // T-071：角色发出语音 → 成就第 11 号（ai_runtime.milestone voice_message_sent）。
        if (posted.value.content?.type === 'voice')
          await this.outbox.publish(tx, 'ai_runtime.milestone', 'ai_runtime', {
            userId: row.userId,
            characterId: row.characterId,
            kind: 'voice_message_sent',
            refId: posted.value.messageId,
          });
        const nextBubble = row.nextBubble + 1;
        if (row.nextBubble === 0 && result.snapshot.quirk.kind === 'recall')
          result.quirkDraftMessageId = posted.value.messageId;
        const done = nextBubble >= deliveryCount(result);
        const dueAt = new Date(
          this.clock.nowMs() + (result.care ? 0 : P02_SPLIT_BUBBLES.minIntervalMs),
        );
        await tx.db
          .update(replyPlans)
          .set({
            nextBubble,
            status: done ? 'done' : 'sending',
            dueAt,
            inputCiphertext: done ? null : row.inputCiphertext,
            resultCiphertext: done ? null : await this.store.seal(tx, row, 'result', result),
          })
          .where(
            and(
              eq(replyPlans.id, row.id),
              eq(replyPlans.nextBubble, row.nextBubble),
              eq(replyPlans.status, 'sending'),
            ),
          );
        if (!done) await this.store.schedule(tx, row.id, dueAt);
      });
      // 照片存档：之后的上下文里看得到发的是哪条微博的图，这个用户也不会再收到同一张。
      // 存档会核对消息确实已发出（事务回滚时什么也不写）。
      if (sharedPhoto.messageId && result.snapshot.photoOffer)
        await this.mediaAi.rememberPhoto({
          userId: row.userId,
          conversationId: row.conversationId,
          messageId: sharedPhoto.messageId,
          offer: result.snapshot.photoOffer,
        });
    } finally {
      await this.writer.setTyping({
        conversationId: row.conversationId,
        participantId: result.snapshot.participantId,
        state: 'stop',
      });
    }
  }
}

/** 这次回复一共发几条：有 contents 按 contents，否则按文字气泡；无论如何不超过 P-02 总上限（reply_plan_counters）。 */
function deliveryCount(result: z.infer<typeof Result>): number {
  return Math.min(
    P02_SPLIT_BUBBLES.maxTotalBubbles,
    result.contents?.length ?? result.bubbles.length,
  );
}

/** v3.3：包一层网关，累计成功调用的扣费；回复类调用（reply / guard / names）的用量记录 ID 记为这次回复的调用。 */
function trackCharges(
  gateway: ModelGatewayPort,
  sink: { usageRecordId: string | null; chargedMicros: number },
): ModelGatewayPort {
  return new Proxy(gateway, {
    get(target, prop, receiver) {
      if (prop === 'generateText')
        return async (input: GenerateTextInput) => {
          const result = await target.generateText(input);
          if (result.ok) {
            sink.chargedMicros += Math.max(0, result.value.chargedMicros);
            if (/:(reply|reply-blind|guard|names)$/.test(input.idempotencyKey))
              sink.usageRecordId = result.value.usageRecordId;
          }
          return result;
        };
      const value: unknown = Reflect.get(target, prop, receiver);
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}
