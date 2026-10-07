/** 无网络/界面副作用的同步状态机；驱动在单个本地事务持久化state后才执行effects。 */
import {
  Message,
  MessageAck,
  UserUpdate,
  SendMessageRequest,
  SyncEndpoints,
  MessagePage,
  Id,
  ClientSyncOperation,
  type Conversation,
} from '@weiban/contracts';
import { LocalSyncState, FullSyncSnapshot, freshSyncState, type SyncEffect } from './sync-state.js';
export class SyncEngine {
  private value: LocalSyncState;
  get state(): LocalSyncState {
    return structuredClone(this.value);
  }
  private online = false;
  private pulling = false;
  private rebuilding = false;
  private rebuildStart: number | null = null;
  private readonly activeMessagePulls = new Map<string, number>();
  private effects: SyncEffect[] = [];
  constructor(state: unknown = freshSyncState()) {
    this.value = LocalSyncState.parse(state);
    // 未收到确认的发送在重启后仍用原ID，先补同步再发送。
    for (const item of this.value.outbox) if (item.state === 'sending') item.state = 'pending';
  }
  apply(input: unknown): void {
    const operation = ClientSyncOperation.parse(input);
    const saved = {
      value: structuredClone(this.value),
      effects: [...this.effects],
      online: this.online,
      pulling: this.pulling,
      rebuilding: this.rebuilding,
      start: this.rebuildStart,
      pulls: new Map(this.activeMessagePulls),
    };
    try {
      switch (operation.type) {
        case 'offline':
          this.offline();
          break;
        case 'reconnect':
          this.reconnect(operation.latestUpdateSeq, operation.now);
          break;
        case 'enqueue':
          this.enqueue(operation.conversationId, operation.body, operation.now);
          break;
        case 'ack':
          this.ack(operation.ack, operation.now);
          break;
        case 'send.failed':
          this.failed(
            operation.conversationId,
            operation.clientMsgId,
            operation.httpStatus,
            operation.now,
          );
          break;
        case 'retry':
          this.retry(operation.conversationId, operation.clientMsgId, operation.now);
          break;
        case 'tick':
          this.tick(operation.now);
          break;
        case 'update':
          this.receive(operation.update);
          break;
        case 'updates.page':
          this.updatesPage(operation.page, operation.now);
          break;
        case 'cursor.expired':
          this.cursorExpired();
          break;
        case 'rebuild.state':
          this.rebuildState(operation.latestUpdateSeq);
          break;
        case 'snapshot':
          if (operation.startSeq !== this.rebuildStart) throw new Error('过期快照');
          this.commitSnapshot(operation.snapshot);
          break;
        case 'inspect':
          this.inspectConversation(operation.conversationId);
          break;
        case 'messages.page':
          this.messagesPage(operation.conversationId, operation.page);
          break;
        case 'restart':
          this.offline();
          this.effects = [];
          this.value = LocalSyncState.parse(JSON.parse(JSON.stringify(this.value)));
          break;
        case 'account.reset':
          this.value = freshSyncState();
          this.effects = [];
          this.online = false;
          this.pulling = false;
          this.rebuilding = false;
          this.rebuildStart = null;
          this.activeMessagePulls.clear();
          break;
      }
    } catch (error) {
      this.value = saved.value;
      this.effects = saved.effects;
      this.online = saved.online;
      this.pulling = saved.pulling;
      this.rebuilding = saved.rebuilding;
      this.rebuildStart = saved.start;
      this.activeMessagePulls.clear();
      for (const [key, value] of saved.pulls) this.activeMessagePulls.set(key, value);
      throw error;
    }
  }
  drainEffects(): SyncEffect[] {
    const effects = this.effects;
    this.effects = [];
    return effects;
  }
  /** HTTP clear confirmation is durable immediately; its update cursor is still pulled normally. */
  clearHistory(conversationId: string, throughSeq: number): void {
    Id.parse(conversationId);
    if (!Number.isSafeInteger(throughSeq) || throughSeq < 0) throw new Error('无效清空范围');
    const conversation = this.value.conversations.find(
      (item) => item.conversationId === conversationId,
    );
    if (!conversation) throw new Error('未知会话');
    const through = Math.max(
      throughSeq,
      conversation.state.clearedThroughSeq,
      this.localClear(conversationId),
    );
    if (through > 0) {
      this.value.excluded = this.value.excluded.filter(
        (item) =>
          !(
            item.conversationId === conversationId &&
            item.range.reason === 'cleared' &&
            item.range.fromSeq === 1
          ),
      );
      this.value.excluded.push({
        conversationId,
        range: { fromSeq: 1, throughSeq: through, reason: 'cleared' },
      });
    }
    const cleared = this.cleanConversation(conversation);
    cleared.state.markedUnread = false;
    this.value.conversations = this.value.conversations.map((item) =>
      item.conversationId === conversationId ? cleared : item,
    );
    this.value.messages = this.value.messages.filter(
      (item) => item.conversationId !== conversationId || item.seq > through,
    );
    for (const message of this.value.messages)
      if (
        message.conversationId === conversationId &&
        message.quote &&
        message.quote.seq <= through
      )
        message.quote.preview = null;
  }

  private localClear(id: string): number {
    return this.value.excluded.reduce(
      (through, item) =>
        item.conversationId === id && item.range.reason === 'cleared' && item.range.fromSeq === 1
          ? Math.max(through, item.range.throughSeq)
          : through,
      0,
    );
  }

  private cleanConversation(input: Conversation): Conversation {
    const conversation = structuredClone(input);
    const through = Math.max(
      conversation.state.clearedThroughSeq,
      this.localClear(conversation.conversationId),
    );
    conversation.state.clearedThroughSeq = through;
    if (conversation.lastSeq <= through) {
      conversation.lastMessage = null;
      conversation.unreadCount = 0;
    }
    return conversation;
  }
  /** 用户向上加载历史，独立于afterSeq补拉，不改变进行中的补拉起点。 */
  history(conversationId: string, beforeSeq: number, value: unknown): void {
    Id.parse(conversationId);
    if (!Number.isSafeInteger(beforeSeq) || beforeSeq <= 0) throw new Error('无效历史起点');
    const page = MessagePage.parse(value);
    if (!this.value.conversations.some((item) => item.conversationId === conversationId))
      throw new Error('未知会话');
    if (page.coverage && page.coverage.throughSeq >= beforeSeq) throw new Error('历史范围越界');
    for (const message of page.items)
      if (message.conversationId !== conversationId || message.seq >= beforeSeq)
        throw new Error('历史消息越界');
    const previous = this.state;
    try {
      for (const message of page.items) this.upsertMessage(message);
      if (page.coverage) this.coverage(conversationId, page.coverage);
    } catch (error) {
      this.value = previous;
      throw error;
    }
  }
  private offline(): void {
    this.online = false;
    this.pulling = false;
    this.rebuilding = false;
    this.rebuildStart = null;
    this.activeMessagePulls.clear();
    for (const item of this.value.outbox) if (item.state === 'sending') item.state = 'pending';
  }
  private reconnect(latestUpdateSeq: number, now: number): void {
    this.online = true;
    if (!this.value.initialized) {
      this.cursorExpired();
      return;
    }
    if (latestUpdateSeq < this.value.lastUpdateSeq) throw new Error('服务器更新序号不能倒退');
    if (latestUpdateSeq > this.value.lastUpdateSeq || this.value.pendingUpdates.length)
      this.pullUpdates();
    else this.flush(now);
  }
  private enqueue(conversationId: string, body: unknown, now: number): void {
    const request = SendMessageRequest.parse(body);
    Id.parse(conversationId);
    const duplicate = this.value.outbox.find(
      (item) => item.body.clientMsgId === request.clientMsgId,
    );
    if (duplicate) {
      if (
        JSON.stringify(duplicate.body) !== JSON.stringify(request) ||
        duplicate.conversationId !== conversationId
      )
        throw new Error('同一消息ID不能改写内容或会话');
      return;
    }
    if (this.value.messages.some((message) => message.clientMsgId === request.clientMsgId)) return;
    this.value.outbox.push({
      conversationId,
      body: request,
      state: 'pending',
      failures: 0,
      retryAt: now,
    });
    this.flush(now);
  }
  private ack(value: unknown, now: number): void {
    const ack = MessageAck.parse(value);
    if (ack.clientMsgId !== ack.message.clientMsgId) throw new Error('确认ID与消息不一致');
    const pending = this.value.outbox.find((item) => item.body.clientMsgId === ack.clientMsgId);
    if (
      !pending &&
      !this.value.messages.some(
        (m) => m.clientMsgId === ack.clientMsgId && m.conversationId === ack.message.conversationId,
      )
    )
      return;
    if (pending && pending.conversationId !== ack.message.conversationId)
      throw new Error('确认会话不一致');
    this.upsertMessage(ack.message);
    this.flush(now);
  }
  private failed(
    conversationId: string,
    clientMsgId: string,
    httpStatus: number | null,
    now: number,
  ): void {
    const item = this.value.outbox.find(
      (item) => item.body.clientMsgId === clientMsgId && item.conversationId === conversationId,
    );
    if (!item) return;
    item.state = 'pending';
    if (httpStatus !== null && httpStatus >= 400 && httpStatus < 500) {
      item.state = 'failed';
      return;
    }
    if (!this.online) return;
    item.failures++;
    if (item.failures >= 5) {
      item.state = 'failed';
      return;
    }
    item.retryAt = now + Math.min(30_000, 1000 * 2 ** (item.failures - 1));
    this.flush(now);
  }
  private retry(conversationId: string, clientMsgId: string, now: number): void {
    const item = this.value.outbox.find(
      (item) => item.conversationId === conversationId && item.body.clientMsgId === clientMsgId,
    );
    if (item) {
      item.state = 'pending';
      item.failures = 0;
      item.retryAt = now;
      this.flush(now);
    }
  }
  private tick(now: number): void {
    this.flush(now);
  }
  private receive(value: unknown): void {
    const update = UserUpdate.parse(value);
    if (update.updateSeq <= this.value.lastUpdateSeq) return;
    if (!this.value.pendingUpdates.some((item) => item.updateSeq === update.updateSeq))
      this.value.pendingUpdates.push(update);
    if (this.rebuilding || this.pulling) return;
    this.applyPending();
    if (this.value.pendingUpdates.length) this.pullUpdates();
  }
  private updatesPage(value: unknown, now: number): void {
    const page = SyncEndpoints.getUpdates.response.parse(value);
    if (!this.pulling || this.rebuilding) throw new Error('没有正在进行的补拉');
    const before = this.value.lastUpdateSeq;
    let prior = -1;
    for (const update of page.items) {
      if (update.updateSeq <= prior) throw new Error('补拉必须严格升序');
      prior = update.updateSeq;
      if (
        update.updateSeq > this.value.lastUpdateSeq &&
        !this.value.pendingUpdates.some((item) => item.updateSeq === update.updateSeq)
      )
        this.value.pendingUpdates.push(update);
    }
    // 分页完成前只应用已连续的项目，缓存的实时帧也必须遵守序号。
    this.applyPending(
      page.hasMore ? Math.max(before, ...page.items.map((item) => item.updateSeq)) : undefined,
    );
    this.pulling = false;
    if (page.hasMore) {
      if (this.value.lastUpdateSeq === before) throw new Error('分页没有推进游标');
      this.pullUpdates();
      return;
    }
    if (this.value.lastUpdateSeq < page.latestUpdateSeq || this.value.pendingUpdates.length) {
      if (this.value.lastUpdateSeq === before) throw new Error('补拉缺少连续更新');
      this.pullUpdates();
      return;
    }
    this.flush(now);
  }
  private cursorExpired(): void {
    this.pulling = false;
    this.rebuilding = true;
    this.rebuildStart = null;
    this.effects.push({ type: 'state' });
  }
  private rebuildState(latestUpdateSeq: number): void {
    if (!this.rebuilding || this.rebuildStart !== null) throw new Error('重建状态顺序错误');
    if (!Number.isSafeInteger(latestUpdateSeq) || latestUpdateSeq < 0)
      throw new Error('无效重建起点');
    this.rebuildStart = latestUpdateSeq;
    this.effects.push({ type: 'snapshot', startSeq: latestUpdateSeq });
  }
  private commitSnapshot(value: unknown): void {
    if (!this.rebuilding || this.rebuildStart === null) throw new Error('必须先获取重建起点');
    const snapshot = FullSyncSnapshot.parse(value);
    const outbox = this.value.outbox,
      pendingUpdates = this.value.pendingUpdates.filter(
        (item) => item.updateSeq > this.rebuildStart!,
      );
    this.value = {
      ...freshSyncState(),
      initialized: true,
      lastUpdateSeq: this.rebuildStart,
      conversations: snapshot.conversations.map((conversation) =>
        this.cleanConversation(conversation),
      ),
      contacts: snapshot.contacts,
      outbox,
      pendingUpdates,
      settings: snapshot.settings,
      excluded: this.value.excluded.filter(
        (item) => item.range.reason === 'cleared' && item.range.fromSeq === 1,
      ),
    };
    for (const message of snapshot.messages) this.upsertMessage(message);
    for (const { conversationId, coverage } of snapshot.coverages)
      this.coverage(conversationId, coverage);
    this.rebuilding = false;
    this.rebuildStart = null;
    this.pullUpdates();
  }
  private inspectConversation(conversationId: string): void {
    const conversation = this.value.conversations.find(
      (item) => item.conversationId === conversationId,
    );
    if (
      !conversation ||
      !this.online ||
      this.rebuilding ||
      this.activeMessagePulls.has(conversationId)
    )
      return;
    let contiguous = conversation.state.clearedThroughSeq;
    const messages = new Set(
      this.value.messages
        .filter((item) => item.conversationId === conversationId)
        .map((item) => item.seq),
    );
    // 最新50条快照之前的历史只在上滑时拉取；已扫描边界是可靠锚点。
    contiguous = Math.max(contiguous, this.value.scannedThrough[conversationId] ?? 0);
    while (contiguous < conversation.lastSeq) {
      const next = contiguous + 1;
      if (messages.has(next) || this.isExcluded(conversationId, next)) contiguous = next;
      else break;
    }
    if (contiguous < conversation.lastSeq) {
      this.activeMessagePulls.set(conversationId, contiguous);
      this.effects.push({ type: 'messages', conversationId, afterSeq: contiguous, limit: 200 });
    }
  }
  private messagesPage(conversationId: string, value: unknown): void {
    const page = MessagePage.parse(value);
    const afterSeq = this.activeMessagePulls.get(conversationId);
    if (afterSeq === undefined) throw new Error('没有对应会话补拉');
    if (page.coverage && page.coverage.fromSeq !== 0 && page.coverage.fromSeq !== afterSeq + 1)
      throw new Error('扫描范围与补拉起点不一致');
    this.activeMessagePulls.delete(conversationId);
    for (const message of page.items) {
      if (message.conversationId !== conversationId || message.seq <= afterSeq)
        throw new Error('会话消息越界');
      this.upsertMessage(message);
    }
    if (page.coverage) this.coverage(conversationId, page.coverage);
    const through =
      page.coverage?.throughSeq ?? Math.max(afterSeq, ...page.items.map((item) => item.seq));
    const conversation = this.value.conversations.find(
      (item) => item.conversationId === conversationId,
    );
    if (through <= afterSeq && (page.hasMore || (conversation && conversation.lastSeq > afterSeq)))
      throw new Error('消息补拉没有进展，不能把未知缺号当作已删除');
    if (page.hasMore) {
      this.activeMessagePulls.set(conversationId, through);
      this.effects.push({ type: 'messages', conversationId, afterSeq: through, limit: 200 });
    } else this.inspectConversation(conversationId);
  }
  private pullUpdates(): void {
    if (!this.online || this.pulling || this.rebuilding) return;
    this.pulling = true;
    this.effects.push({ type: 'updates', since: this.value.lastUpdateSeq, limit: 500 });
  }
  private flush(now: number): void {
    if (!this.online || this.pulling || this.rebuilding) return;
    const blocked = new Set<string>();
    for (const item of this.value.outbox) {
      if (blocked.has(item.conversationId)) continue;
      blocked.add(item.conversationId);
      if (item.state === 'pending' && item.retryAt <= now) {
        item.state = 'sending';
        this.effects.push({ type: 'send', conversationId: item.conversationId, body: item.body });
      }
    }
  }
  private applyPending(maxSeq = Number.MAX_SAFE_INTEGER): void {
    this.value.pendingUpdates.sort((a, b) => a.updateSeq - b.updateSeq);
    while (
      this.value.pendingUpdates[0]?.updateSeq === this.value.lastUpdateSeq + 1 &&
      this.value.pendingUpdates[0].updateSeq <= maxSeq
    ) {
      const update = this.value.pendingUpdates.shift()!;
      this.applyUpdate(update);
      this.value.lastUpdateSeq = update.updateSeq;
    }
    this.value.pendingUpdates = this.value.pendingUpdates.filter(
      (item) => item.updateSeq > this.value.lastUpdateSeq,
    );
  }
  private applyUpdate(update: UserUpdate): void {
    switch (update.type) {
      case 'message.created':
        this.upsertMessage(update.data.message);
        break;
      case 'message.recalled': {
        this.value.recalled = this.value.recalled.filter(
          (item) => item.messageId !== update.data.messageId,
        );
        this.value.recalled.push({
          messageId: update.data.messageId,
          recalledAt: update.data.recalledAt,
        });
        for (const message of this.value.messages) {
          if (message.messageId === update.data.messageId) {
            message.content = null;
            message.status = 'recalled';
            message.recalledAt = update.data.recalledAt;
          }
          if (message.quote?.messageId === update.data.messageId) message.quote.preview = null;
        }
        const conversation = this.value.conversations.find(
          (item) => item.conversationId === update.data.conversationId,
        );
        if (conversation?.lastMessage?.messageId === update.data.messageId)
          conversation.lastMessage.text = '[消息已撤回]';
        break;
      }
      case 'message.hidden': {
        const message = this.value.messages.find(
          (item) => item.messageId === update.data.messageId,
        );
        if (message)
          this.value.excluded.push({
            conversationId: update.data.conversationId,
            range: { fromSeq: message.seq, throughSeq: message.seq, reason: 'hidden' },
          });
        this.value.messages = this.value.messages.filter(
          (item) => item.messageId !== update.data.messageId,
        );
        for (const message of this.value.messages)
          if (message.quote?.messageId === update.data.messageId) message.quote.preview = null;
        const conversation = this.value.conversations.find(
          (c) => c.conversationId === update.data.conversationId,
        );
        if (conversation?.lastMessage?.messageId === update.data.messageId)
          conversation.lastMessage = null;
        break;
      }
      case 'conversation.created':
      case 'conversation.updated': {
        const conversation = this.cleanConversation(update.data.conversation);
        this.value.conversations = this.value.conversations.filter(
          (item) => item.conversationId !== conversation.conversationId,
        );
        this.value.conversations.push(conversation);
        break;
      }
      case 'conversation.state_updated': {
        const conversation = this.value.conversations.find(
          (item) => item.conversationId === update.data.conversationId,
        );
        if (conversation) {
          conversation.state = {
            ...update.data.state,
            clearedThroughSeq: Math.max(
              update.data.state.clearedThroughSeq,
              this.localClear(conversation.conversationId),
            ),
          };
          conversation.unreadCount =
            conversation.lastSeq <= conversation.state.clearedThroughSeq
              ? 0
              : update.data.unreadCount;
          this.value.messages = this.value.messages.filter(
            (item) =>
              item.conversationId !== conversation.conversationId ||
              item.seq > conversation.state.clearedThroughSeq,
          );
          for (const message of this.value.messages)
            if (
              message.conversationId === conversation.conversationId &&
              message.quote &&
              message.quote.seq <= conversation.state.clearedThroughSeq
            )
              message.quote.preview = null;
          if (
            conversation.lastMessage &&
            conversation.lastSeq <= conversation.state.clearedThroughSeq
          )
            conversation.lastMessage = null;
        }
        break;
      }
      case 'conversation.peer_read_updated': {
        const conversation = this.value.conversations.find(
          (item) => item.conversationId === update.data.conversationId,
        );
        if (conversation) conversation.peerReadSeq = update.data.peerReadSeq;
        break;
      }
      case 'contact.upserted':
        this.value.contacts = this.value.contacts.filter(
          (item) => item.characterId !== update.data.contact.characterId,
        );
        this.value.contacts.push(update.data.contact);
        break;
      case 'contact.removed':
        this.value.contacts = this.value.contacts.filter(
          (item) => item.characterId !== update.data.characterId,
        );
        break;
      case 'settings.updated':
        if (update.data.section !== 'unsupported')
          this.effects.push({
            type: 'settings',
            section: update.data.section,
            characterId: update.data.characterId,
          });
        break;
      case 'model.status_updated':
        this.effects.push({ type: 'model-status', status: update.data.status });
        break;
      case 'unsupported':
        break;
    }
  }
  private isExcluded(conversationId: string, seq: number): boolean {
    return this.value.excluded.some(
      (item) =>
        item.conversationId === conversationId &&
        item.range.fromSeq <= seq &&
        item.range.throughSeq >= seq,
    );
  }
  private upsertMessage(value: Message): void {
    const message = Message.parse(value);
    const recalled = this.value.recalled.find((item) => item.messageId === message.messageId);
    if (recalled) {
      message.status = 'recalled';
      message.recalledAt = recalled.recalledAt;
    }
    if (message.status === 'recalled') {
      message.content = null;
      if (message.recalledAt && !recalled)
        this.value.recalled.push({ messageId: message.messageId, recalledAt: message.recalledAt });
    }
    if (
      (message.quote &&
        this.value.messages.some(
          (m) => m.messageId === message.quote!.messageId && m.status === 'recalled',
        )) ||
      (message.quote &&
        this.value.recalled.some((item) => item.messageId === message.quote!.messageId))
    )
      message.quote.preview = null;
    this.value.outbox = this.value.outbox.filter(
      (item) =>
        item.body.clientMsgId !== message.clientMsgId ||
        item.conversationId !== message.conversationId,
    );
    if (this.isExcluded(message.conversationId, message.seq)) return;
    const conversation = this.value.conversations.find(
      (item) => item.conversationId === message.conversationId,
    );
    if (conversation && message.seq <= conversation.state.clearedThroughSeq) return;
    if (
      message.quote &&
      (message.quote.seq <= (conversation?.state.clearedThroughSeq ?? 0) ||
        this.isExcluded(message.conversationId, message.quote.seq))
    )
      message.quote.preview = null;
    if (conversation) conversation.lastSeq = Math.max(conversation.lastSeq, message.seq);
    const before = this.value.messages.find((item) => item.messageId === message.messageId);
    // 撤回是单向状态；后到的旧快照不能复原正文。
    if (before?.status === 'recalled' && message.status === 'normal') return;
    this.value.messages = this.value.messages.filter(
      (item) => item.messageId !== message.messageId,
    );
    this.value.messages.push(message);
    this.value.messages.sort(
      (a, b) => a.conversationId.localeCompare(b.conversationId) || a.seq - b.seq,
    );
  }
  private coverage(conversationId: string, value: NonNullable<MessagePage['coverage']>): void {
    const known = new Set(
      this.value.messages
        .filter((item) => item.conversationId === conversationId)
        .map((item) => item.seq),
    );
    for (const range of value.excludedRanges)
      if (
        !this.value.excluded.some(
          (item) =>
            item.conversationId === conversationId &&
            JSON.stringify(item.range) === JSON.stringify(range),
        )
      )
        this.value.excluded.push({ conversationId, range });
    // Coverage不能无条件跳过缺消息：每个扫描seq必须存在或被明确排除。
    for (let seq = value.fromSeq; seq > 0 && seq <= value.throughSeq; seq++)
      if (!known.has(seq) && !this.isExcluded(conversationId, seq))
        throw new Error('扫描范围包含未解释的缺消息');
    this.value.scannedThrough[conversationId] = Math.max(
      this.value.scannedThrough[conversationId] ?? 0,
      value.throughSeq,
    );
    this.value.messages = this.value.messages.filter(
      (message) => !this.isExcluded(message.conversationId, message.seq),
    );
    for (const message of this.value.messages)
      if (message.quote && this.isExcluded(message.conversationId, message.quote.seq))
        message.quote.preview = null;
  }
}
