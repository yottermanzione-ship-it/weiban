/**
 * 契约 PlayReadPort / PlayAgentPort 的实现（提供方 play，调用方 ai-runtime）。
 * 每个玩法的实现放在各自服务里，这里只做转发；尚未交付的玩法（T-092～T-095）先返回安全的默认值，
 * 交付时把对应方法改为转发到新服务即可（端口签名不变）。
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  FocusSession,
  PlayAgentPort,
  PlayReadPort,
  PortResult,
  Reminder,
  WishlistItem,
} from '@weiban/contracts';
import { DailyQuestionService } from './daily-question.service.js';
import { LettersService } from './letters.service.js';
import { WishlistService } from './wishlist.service.js';

type PendingReply = Awaited<ReturnType<PlayReadPort['listPendingLetterReplies']>>[number];

@Injectable()
export class PlayPortsService implements PlayReadPort, PlayAgentPort {
  constructor(
    @Inject(DailyQuestionService) private readonly daily: DailyQuestionService,
    @Inject(WishlistService) private readonly wishlist: WishlistService,
    @Inject(LettersService) private readonly letters: LettersService,
  ) {}

  // ---------- PlayReadPort ----------

  /** T-094 交付前：没有进行中的专注。 */
  async getActiveFocus(_userId: string): Promise<FocusSession | null> {
    return null;
  }

  listWishlist(userId: string, characterId: string): Promise<WishlistItem[]> {
    return this.wishlist.listForRuntime(userId, characterId);
  }

  /** T-095 交付前：没有提醒。 */
  async getReminder(_reminderId: string): Promise<Reminder | null> {
    return null;
  }

  listPendingLetterReplies(userId: string): Promise<PendingReply[]> {
    return this.letters.listPendingReplies(userId);
  }

  getLetterBody(letterId: string): Promise<string | null> {
    return this.letters.getBody(letterId);
  }

  // ---------- PlayAgentPort ----------

  setDailyCharacterAnswer(input: {
    answerId: string;
    answer: string;
  }): Promise<PortResult<void, 'not_found'>> {
    return this.daily.setCharacterAnswer(input);
  }

  createWishlistProposal(input: {
    userId: string;
    characterId: string;
    text: string;
    idempotencyKey: string;
  }): Promise<PortResult<{ proposalId: string }, 'weekly_limit' | 'list_full'>> {
    return this.wishlist.createProposal(input);
  }

  deliverLetterReply(input: {
    letterId: string;
    body: string;
    idempotencyKey: string;
  }): Promise<PortResult<{ messageId: string }, 'not_found' | 'contact_inactive'>> {
    return this.letters.deliverReply(input);
  }

  sendCharacterLetter(input: {
    userId: string;
    characterId: string;
    body: string;
    idempotencyKey: string;
  }): Promise<PortResult<{ letterId: string }, 'contact_inactive'>> {
    return this.letters.sendCharacterLetter(input);
  }

  async setReminderPhrasings(_input: {
    reminderId: string;
    phrasings: string[];
  }): Promise<PortResult<void, 'not_found'>> {
    return { ok: false, error: 'not_found', message: '提醒尚未开放（T-095）' };
  }
}
