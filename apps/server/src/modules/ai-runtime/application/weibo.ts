import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type {
  CharacterReadPort,
  ContactsReadPort,
  MomentsCharacterPort,
  SharedWebSearchPort,
  WeiboPublicationPort,
  BillingReadPort,
  IdentityAccountStatusPort,
} from '@weiban/contracts';
import {
  DATABASE,
  CLOCK,
  JOB_QUEUE,
  newId,
  type Database,
  type Clock,
  type DbTx,
  type JobQueue,
} from '../../../platform/index.js';
import { SHARED_WEB_SEARCH_PORT } from '../../model-access/index.js';
import { WEIBO_PUBLICATION_PORT } from '../../characters/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { MOMENTS_CHARACTER_PORT } from '../../moments/index.js';
import { BILLING_READ_PORT } from '../../billing/index.js';
import { IDENTITY_ACCOUNT_STATUS_PORT } from '../../identity/index.js';
import { AI_CHARACTER_READ } from './supplemented-character-read.js';
import { characterView, roleWeiboMarker } from './character-view.js';
import { EcologySettingsService } from './ecology-settings.js';
import { localDate } from '../../../platform/time/local-time.js';
import {
  WEIBO_MAX_DAILY_SEARCHES,
  WEIBO_MIN_INTERVAL_MS,
  weiboCandidates,
} from '../domain/weibo.js';
type State = {
  lease_token: string;
  lease_until: Date;
  next_allowed_at: Date;
  day: string;
  attempts: number;
  pending_key: string | null;
  last_success_at: Date | null;
};
@Injectable()
export class WeiboSyncService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(EcologySettingsService) private readonly settings: EcologySettingsService,
    @Inject(AI_CHARACTER_READ) private readonly characters: CharacterReadPort,
    @Inject(CONTACTS_READ_PORT) private readonly contacts: ContactsReadPort,
    @Inject(SHARED_WEB_SEARCH_PORT) private readonly search: SharedWebSearchPort,
    @Inject(WEIBO_PUBLICATION_PORT) private readonly publication: WeiboPublicationPort,
    @Inject(MOMENTS_CHARACTER_PORT) private readonly moments: MomentsCharacterPort,
    @Inject(BILLING_READ_PORT) private readonly billing: BillingReadPort,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) private readonly identity: IdentityAccountStatusPort,
  ) {}
  async onModuleInit() {
    await this.jobs.work('ai.weibo_recover', () => this.recover());
    // Recovery only closes already-requested work; it never creates a new synchronization decision.
    await this.jobs.schedule('ai.weibo_recover', '*/2 * * * *');
  }
  async recover() {
    const rows = await this.db.query<{ character_id: string }>(
      'SELECT character_id FROM ai_runtime.weibo_sync_states WHERE pending_key IS NOT NULL AND lease_until<=$1 ORDER BY lease_until LIMIT 20',
      [this.clock.now()],
    );
    for (const row of rows.rows) {
      const [owner] = await this.participants(row.character_id);
      if (owner) await this.run(owner.userId, row.character_id);
    }
  }
  private async role(userId: string, characterId: string) {
    const role = await this.characters.getForRuntime(userId, characterId);
    // 旧卡没有新卡的微博标记，按没有处理（旧卡身份字段不猜微博）。
    const marker = role ? roleWeiboMarker(characterView(role)) : null;
    if (
      !role ||
      role.profile.kind !== 'preset' ||
      role.classification.realPersonKind === 'private_person' ||
      !marker ||
      new URL(marker.avatarUrl).protocol !== 'https:'
    )
      return null;
    return marker;
  }
  async offer(userId: string, characterId: string) {
    if (!(await this.role(userId, characterId))) return false;
    const row = (
      await this.db.query<State>(
        'SELECT * FROM ai_runtime.weibo_sync_states WHERE character_id=$1',
        [characterId],
      )
    ).rows[0];
    const day = localDate(this.clock.now(), 'Asia/Shanghai');
    return (
      !row ||
      (row.lease_until <= this.clock.now() &&
        (!!row.pending_key ||
          (row.next_allowed_at <= this.clock.now() &&
            (row.day !== day || row.attempts < WEIBO_MAX_DAILY_SEARCHES))))
    );
  }
  private async participants(characterId: string) {
    const result: { userId: string; epoch: string }[] = [];
    for (const userId of (await this.settings.enabledUserIds()).sort()) {
      if (!(await this.settings.isActive(userId, characterId, 'weibo_sync'))) continue;
      if ((await this.billing.getSpendStatus(userId)).insufficient) continue;
      const epoch = await this.contacts.getActiveContactEpoch(userId, characterId);
      if (epoch) result.push({ userId, epoch: epoch.version });
    }
    return result;
  }
  /**
   * 共享联网检索「结算前重核资格」（给 billing 的 shared-search 用）：
   * 传回检索当时记下的 {userId, epoch}，返回现在仍然符合条件的同一批。
   * 资格 = 生态里仍启用微博同步、余额不欠、与该角色的关系 epoch 未变；刚关掉生态或删了角色的人不会仍被收款。
   */
  async recheckParticipants(
    characterId: string,
    expected: readonly { userId: string; epoch: string }[],
  ): Promise<{ userId: string; epoch: string }[]> {
    const current = new Map(
      (await this.participants(characterId)).map((row) => [row.userId, row.epoch]),
    );
    return expected.filter((row) => current.get(row.userId) === row.epoch);
  }
  private async claim(characterId: string) {
    return this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('weibo-sync:' || $1,0))", [
        characterId,
      ]);
      const row = (
        await tx.query<State>('SELECT * FROM ai_runtime.weibo_sync_states WHERE character_id=$1', [
          characterId,
        ])
      ).rows[0];
      const now = this.clock.now(),
        day = localDate(now, 'Asia/Shanghai');
      if (
        row &&
        (row.lease_until > now ||
          (!row.pending_key &&
            (row.next_allowed_at > now ||
              (row.day === day && row.attempts >= WEIBO_MAX_DAILY_SEARCHES))))
      )
        return null;
      const token = newId(),
        key = row?.pending_key ?? `weibo-sync:${newId()}`,
        attempts = (row?.day === day ? row.attempts : 0) + (row?.pending_key ? 0 : 1);
      await tx.query(
        `INSERT INTO ai_runtime.weibo_sync_states(character_id,lease_token,lease_until,next_allowed_at,day,attempts,pending_key) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(character_id) DO UPDATE SET lease_token=EXCLUDED.lease_token,lease_until=EXCLUDED.lease_until,next_allowed_at=EXCLUDED.next_allowed_at,day=EXCLUDED.day,attempts=EXCLUDED.attempts,pending_key=EXCLUDED.pending_key`,
        [
          characterId,
          token,
          new Date(this.clock.nowMs() + 120000),
          new Date(this.clock.nowMs() + WEIBO_MIN_INTERVAL_MS),
          day,
          attempts,
          key,
        ],
      );
      return { token, key };
    });
  }
  async run(userId: string, characterId: string) {
    const marker = await this.role(userId, characterId);
    if (!marker || !(await this.settings.isActive(userId, characterId, 'weibo_sync')))
      return { ok: false, chargedMicros: 0, reason: 'not_eligible' };
    const recipients = await this.participants(characterId);
    if (!recipients.length) return { ok: false, chargedMicros: 0, reason: 'no_participants' };
    const claim = await this.claim(characterId);
    if (!claim) return { ok: false, chargedMicros: 0, reason: 'cooldown' };
    const today = localDate(this.clock.now(), 'Asia/Shanghai');
    const result = await this.search.search({
      characterId,
      requesterUserId: userId,
      userIds: recipients.map((r) => r.userId),
      query: `site:weibo.com "${marker.nickname.replace(/["\\]/gu, '')}" 微博 after:${new Date(this.clock.nowMs() - 7 * 86400000).toISOString().slice(0, 10)}`,
      key: claim.key,
      eligibleUserIds: async () =>
        (await this.recheckParticipants(characterId, recipients)).map((r) => r.userId),
    });
    if (!result.ok) {
      await this.db.query(
        'UPDATE ai_runtime.weibo_sync_states SET pending_key=NULL,lease_until=$3 WHERE character_id=$1 AND lease_token=$2',
        [characterId, claim.token, this.clock.now()],
      );
      return { ok: false, chargedMicros: 0, reason: 'search_unavailable' };
    }
    const items = weiboCandidates(result.items, marker.nickname, today, marker.userId);
    const deliveryRecipients: typeof recipients = [];
    for (const r of recipients)
      if (await this.settings.isActive(r.userId, characterId, 'weibo_sync'))
        deliveryRecipients.push(r);
    let delivered = 0;
    try {
      await this.db.transaction(async (tx) => {
        const state = (
          await tx.query<State>(
            'SELECT * FROM ai_runtime.weibo_sync_states WHERE character_id=$1 FOR UPDATE',
            [characterId],
          )
        ).rows[0];
        if (state?.lease_token !== claim.token) return;
        for (const item of items) {
          const prior = (
            await tx.query<{
              id: string;
              content: string;
              source_url: string;
              published_on: string;
            }>(
              'SELECT * FROM ai_runtime.weibo_items WHERE character_id=$1 AND (source_key=$2 OR content_key=$3)',
              [characterId, item.sourceKey, item.contentKey],
            )
          ).rows[0];
          const material = prior
            ? {
                content: prior.content,
                sourceUrl: prior.source_url,
                publishedOn: prior.published_on,
              }
            : item;
          const updateId = await this.publication.publish(tx, {
            characterId,
            ...material,
            nickname: marker.nickname,
            weiboUserId: marker.userId,
          });
          if (!updateId) continue;
          const itemId = prior?.id ?? newId();
          if (!prior)
            await tx.query(
              `INSERT INTO ai_runtime.weibo_items(id,character_id,source_key,content_key,public_update_id,source_url,content,published_on,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [
                itemId,
                characterId,
                item.sourceKey,
                item.contentKey,
                updateId,
                item.sourceUrl,
                item.content,
                item.publishedOn,
                this.clock.now(),
              ],
            );
          for (const r of deliveryRecipients)
            if (await this.deliver(tx, r, characterId, itemId, updateId, material)) delivered++;
        }
        await tx.query(
          'UPDATE ai_runtime.weibo_sync_states SET pending_key=NULL,lease_until=$2,last_success_at=$2 WHERE character_id=$1',
          [characterId, this.clock.now()],
        );
      });
    } catch {
      return { ok: false, chargedMicros: result.requesterChargeMicros, reason: 'delivery_pending' };
    }
    // Only this user's already-settled share belongs in their ecology run total.
    return {
      ok: delivered > 0,
      chargedMicros: result.requesterChargeMicros,
      reason: delivered ? 'sent' : 'no_new_public_posts',
    };
  }
  private async deliver(
    tx: DbTx,
    r: { userId: string; epoch: string },
    characterId: string,
    itemId: string,
    updateId: string,
    item: { content: string; sourceUrl: string },
  ) {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('ecology-settings:' || $1,0))", [
      r.userId,
    ]);
    // Identity/contact locks precede per-user runtime rows, matching account deletion.
    const epoch = await this.contacts.getActiveContactEpoch(r.userId, characterId, tx);
    if (epoch?.version !== r.epoch) return;
    if (await this.identity.isBanned?.(r.userId, tx)) return;
    const settings = (
      await tx.query<{
        enabled: boolean;
        paused_reason: string | null;
        disabled_actions: string[];
      }>(
        'SELECT enabled,paused_reason,disabled_actions FROM ai_runtime.ecology_settings WHERE user_id=$1 FOR SHARE',
        [r.userId],
      )
    ).rows[0];
    const character = (
      await tx.query<{ enabled: boolean }>(
        'SELECT enabled FROM ai_runtime.ecology_character_settings WHERE user_id=$1 AND character_id=$2 FOR SHARE',
        [r.userId, characterId],
      )
    ).rows[0];
    if (
      !settings?.enabled ||
      settings.paused_reason ||
      settings.disabled_actions.includes('weibo_sync') ||
      character?.enabled === false
    )
      return;
    if (
      (
        await tx.query(
          'SELECT 1 FROM ai_runtime.weibo_deliveries WHERE item_id=$1 AND user_id=$2',
          [itemId, r.userId],
        )
      ).rows.length
    )
      return;
    const post = await this.moments.createPost(tx, {
      ownerUserId: r.userId,
      characterId,
      text: `微博公开动态\n${item.content}\n来源：${item.sourceUrl}`,
      imageMediaIds: [],
      link: null,
      sourceRef: { kind: 'public_update', id: updateId },
      idempotencyKey: `weibo:${itemId}`,
    });
    if (post.ok)
      await tx.query(
        'INSERT INTO ai_runtime.weibo_deliveries(item_id,user_id,post_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [itemId, r.userId, post.value.postId],
      );
    return post.ok;
  }
}
