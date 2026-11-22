/**
 * Compare successive prepared requests within one logical workload, never globally.
 * Only salted fingerprints live in this bounded, process-local cache. Persisted output
 * contains fixed categories/counts, not text, identifiers, credentials or fingerprints.
 * This observes request changes; it does not measure a provider's cached tokens.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { SYSTEM_MESSAGE_NOTE_OPEN } from './system-messages.js';

const markers = [
  ['platform', '\n\n【你正在使用的微伴】\n'],
  ['persona', '\n\n【你是谁】\n'],
  ['speech', '\n\n【说话方式】\n'],
  ['examples', '\n\n【说话示例】\n'],
  ['knowledge', '\n\n【公开资料】\n'],
  ['relationship', '\n\n【关系与设置】\n'],
  ['care', '\n\n【需要关怀或岔开话题时】\n'],
  ['scenario', '\n\n【当前情景补充】\n'],
  ['author_supplement', '\n\n【角色作者的写作要求】\n'],
  ['self_reports', '\n\n你曾经的自述（'],
  ['memory', '\n\n【记忆】\n'],
  ['episodes', '\n\n【最近一起经历的】\n'],
  ['date', '\n\n今天是'],
] as const;

type Section = (typeof markers)[number][0] | 'intro' | 'structure';
type FirstChange =
  | 'identical'
  | 'append_only'
  | 'head_changed'
  | 'history_window_advanced'
  | 'history_system_changed'
  | 'history_message_changed'
  | 'turn_or_dynamic_tail'
  | 'request_structure_changed';

export interface PromptCacheDiagnostic {
  version: 1;
  status: 'first_observation' | 'compared' | 'unscoped' | 'oversized';
  protocol: 'openai' | 'anthropic';
  firstChange: FirstChange | null;
  firstChangedSection: Section | null;
  firstChangedMessageIndex: number | null;
  matchingMessages: number;
  previousMessages: number | null;
  currentMessages: number;
  previousAgeMs: number | null;
  routeChanged: boolean | null;
  modelChanged: boolean | null;
  optionsChanged: boolean | null;
  cacheKeyChanged: boolean | null;
}

export interface PromptObservationContext {
  userId: string;
  characterId?: string;
  conversationId?: string;
  purpose: string;
  modelRole: string;
  conversationKind?: string;
  promptTemplateVersion?: string;
  /** Trusted pre-conversion length; identifies the system head inside no_system's merged user. */
  convertedSystemHeadChars?: number;
  modelKey: string;
  upstreamId: string;
  baseUrl: string;
  /** Hashed with a process-random secret; never retained or returned. */
  apiKey: string;
}

export interface PreparedPrompt {
  protocol: 'openai' | 'anthropic';
  body: Readonly<Record<string, unknown>>;
}

type MessageFingerprint = { hash: string; role: string };
type Fingerprint = {
  at: number;
  messages: MessageFingerprint[];
  sections: { category: Section; hash: string }[];
  headHash: string | null;
  lastUser: number;
  route: string;
  model: string;
  options: string;
  cacheKey: string;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  return Array.isArray(content)
    ? content
        .map((part) => object(part).text)
        .filter((text): text is string => typeof text === 'string')
        .join('\n')
    : '';
}

export class PromptCacheObserver {
  private readonly secret = randomBytes(32);
  private readonly previous = new Map<string, Fingerprint>();
  private messageCount = 0;
  constructor(
    private readonly options: {
      now: () => number;
      maxScopes?: number;
      maxMessageFingerprints?: number;
      maxMessagesPerScope?: number;
      ttlMs?: number;
    },
  ) {}

  private hash(value: unknown): string {
    return createHmac('sha256', this.secret)
      .update(JSON.stringify(value) ?? 'null')
      .digest('base64url');
  }
  private remove(key: string) {
    const old = this.previous.get(key);
    if (old) this.messageCount -= old.messages.length;
    this.previous.delete(key);
  }

  observe(context: PromptObservationContext, request: PreparedPrompt): PromptCacheDiagnostic {
    const at = this.options.now();
    const body = request.body;
    const messages = Array.isArray(body.messages) ? [...body.messages] : [];
    // Anthropic sends the leading system blocks separately; keep their wire order.
    if (request.protocol === 'anthropic' && body.system !== undefined)
      messages.unshift({ role: 'system', content: body.system });
    const diagnostic: PromptCacheDiagnostic = {
      version: 1,
      status: 'first_observation',
      protocol: request.protocol,
      firstChange: null,
      firstChangedSection: null,
      firstChangedMessageIndex: null,
      matchingMessages: 0,
      previousMessages: null,
      currentMessages: messages.length,
      previousAgeMs: null,
      routeChanged: null,
      modelChanged: null,
      optionsChanged: null,
      cacheKeyChanged: null,
    };
    // Different users, characters, conversations, purposes and templates never become pairs.
    if (!context.conversationId && !context.characterId)
      return { ...diagnostic, status: 'unscoped' };
    const scope = this.hash([
      context.userId,
      context.characterId,
      context.conversationId,
      context.purpose,
      context.modelRole,
      context.conversationKind,
      context.promptTemplateVersion,
    ]);
    const maximumMessages = this.options.maxMessageFingerprints ?? 50_000;
    if (
      messages.length > (this.options.maxMessagesPerScope ?? 2048) ||
      messages.length > maximumMessages
    ) {
      this.remove(scope);
      return { ...diagnostic, status: 'oversized' };
    }
    const ttl = this.options.ttlMs ?? 20 * 60_000;
    for (const [key, previous] of this.previous) {
      if (at - previous.at <= ttl) break;
      this.remove(key);
    }
    const head = object(messages[0]);
    const firstText = textOf(head.content);
    const convertedLength = context.convertedSystemHeadChars;
    const convertedHead =
      request.protocol === 'openai' &&
      head.role === 'user' &&
      convertedLength !== undefined &&
      Number.isSafeInteger(convertedLength) &&
      convertedLength >= 0 &&
      firstText.startsWith(SYSTEM_MESSAGE_NOTE_OPEN)
        ? firstText.slice(
            SYSTEM_MESSAGE_NOTE_OPEN.length,
            SYSTEM_MESSAGE_NOTE_OPEN.length + convertedLength,
          )
        : null;
    const headText = head.role === 'system' ? firstText : (convertedHead ?? '');
    const offsets: { category: Section; index: number }[] = [
      { category: 'intro', index: 0 },
      ...markers.flatMap(([category, marker]) => {
        const index = headText.indexOf(marker);
        return index < 0 ? [] : [{ category, index }];
      }),
    ];
    offsets.sort((a, b) => a.index - b.index);
    const current: Fingerprint = {
      at,
      messages: messages.map((message) => {
        const role = object(message).role;
        return {
          hash: this.hash(message),
          role: role === 'system' || role === 'user' || role === 'assistant' ? role : 'other',
        };
      }),
      sections: offsets.map((entry, i) => ({
        category: entry.category,
        hash: this.hash(headText.slice(entry.index, offsets[i + 1]?.index)),
      })),
      headHash:
        head.role === 'system'
          ? this.hash(head)
          : convertedHead !== null
            ? this.hash(convertedHead)
            : null,
      lastUser: messages.findLastIndex((message) => object(message).role === 'user'),
      route: this.hash([request.protocol, context.upstreamId, context.baseUrl, context.apiKey]),
      model: this.hash([context.modelKey, body.model]),
      options: this.hash(
        Object.fromEntries(
          Object.entries(body).filter(
            ([key]) =>
              !['model', 'messages', 'system', 'prompt_cache_key', 'user_id', 'metadata'].includes(
                key,
              ),
          ),
        ),
      ),
      cacheKey: this.hash([body.prompt_cache_key, body.user_id, object(body.metadata).user_id]),
    };
    const before = this.previous.get(scope);
    if (before) {
      diagnostic.status = 'compared';
      diagnostic.previousMessages = before.messages.length;
      diagnostic.previousAgeMs = Math.max(0, at - before.at);
      diagnostic.routeChanged = before.route !== current.route;
      diagnostic.modelChanged = before.model !== current.model;
      diagnostic.optionsChanged = before.options !== current.options;
      diagnostic.cacheKeyChanged = before.cacheKey !== current.cacheKey;
      let i = 0;
      while (
        i < before.messages.length &&
        i < current.messages.length &&
        before.messages[i]!.hash === current.messages[i]!.hash
      )
        i++;
      diagnostic.matchingMessages = i;
      if (i === before.messages.length && i === current.messages.length)
        diagnostic.firstChange = 'identical';
      else {
        diagnostic.firstChangedMessageIndex = i;
        if (i === before.messages.length) diagnostic.firstChange = 'append_only';
        else if (i === current.messages.length)
          diagnostic.firstChange = 'request_structure_changed';
        else if (i === 0 && before.headHash !== current.headHash) {
          diagnostic.firstChange = 'head_changed';
          diagnostic.firstChangedSection = 'structure';
          for (let s = 0; s < Math.max(before.sections.length, current.sections.length); s++) {
            const left = before.sections[s];
            const right = current.sections[s];
            if (left?.category !== right?.category || left?.hash !== right?.hash) {
              diagnostic.firstChangedSection = right?.category ?? left?.category ?? 'structure';
              break;
            }
          }
        } else if (before.lastUser >= 0 && i >= before.lastUser)
          diagnostic.firstChange = 'turn_or_dynamic_tail';
        else if (before.messages.slice(i + 1).some((m) => m.hash === current.messages[i]!.hash))
          diagnostic.firstChange = 'history_window_advanced';
        else if (before.messages[i]?.role === 'system' || current.messages[i]?.role === 'system')
          diagnostic.firstChange = 'history_system_changed';
        else diagnostic.firstChange = 'history_message_changed';
      }
    }
    this.remove(scope);
    this.previous.set(scope, current);
    this.messageCount += current.messages.length;
    while (
      this.previous.size > (this.options.maxScopes ?? 512) ||
      this.messageCount > maximumMessages
    ) {
      const oldest = this.previous.keys().next().value;
      if (oldest === undefined) break;
      this.remove(oldest);
    }
    return diagnostic;
  }
}
