import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { and, eq, lte } from 'drizzle-orm';
import {
  UserCustomCharacterWrite,
  CharacterClassificationInput,
  type CharacterTrialReadPort,
  type CharacterTrialCleanupPort,
  type ChatAdminPort,
  type Tx,
  type UserCustomTrialWrite,
} from '@weiban/contracts';
import {
  AppError,
  CLOCK,
  DATABASE,
  JOB_QUEUE,
  asDbTx,
  type Clock,
  type Database,
  type JobQueue,
} from '../../../platform/index.js';
import { CHAT_ADMIN_PORT } from '../../chat/index.js';
import { CHARACTER_TRIAL_CLEANUP_PORT } from '../tokens.js';
import { characters, trialSessions } from '../infra/db/schema.js';
import { CustomCharacterService } from './custom-character.js';
import { classificationCanChange, compareClassification } from '../../policy/index.js';

@Injectable()
export class CharacterTrialService implements CharacterTrialReadPort, OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(CustomCharacterService) private readonly custom: CustomCharacterService,
    @Inject(CHAT_ADMIN_PORT) private readonly chat: ChatAdminPort,
    @Optional()
    @Inject(CHARACTER_TRIAL_CLEANUP_PORT)
    private readonly cleanup?: CharacterTrialCleanupPort,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.jobs.work('characters.expire_trials', () => this.expire());
    await this.jobs.schedule('characters.expire_trials', '*/5 * * * *');
  }

  async draft(
    userId: string,
    body: UserCustomTrialWrite,
    source?: {
      characterId: string;
      revision: number;
      childFeaturesDetected: boolean;
      reuse?: boolean;
    },
  ) {
    if (body.sourceCharacterId && !source) {
      const [row] = await this.db.db
        .select()
        .from(characters)
        .where(and(eq(characters.id, body.sourceCharacterId), eq(characters.ownerId, userId)));
      if (!row || row.isTrial || row.kind !== 'custom')
        throw new AppError('not_found', '角色不存在');
      const classification = CharacterClassificationInput.parse(row);
      if (
        !classificationCanChange(classification, body.classification, 'custom') ||
        (row.originKind === 'plaza_copy' &&
          compareClassification(
            {
              ...classification,
              childFeaturesDetected: row.childFeaturesDetected,
              everPrivatePerson: row.everPrivatePerson,
            },
            {
              ...body.classification,
              childFeaturesDetected: row.childFeaturesDetected,
              everPrivatePerson: row.everPrivatePerson,
            },
          ) === 'looser')
      )
        throw new AppError('classification_change_forbidden', '角色分类不能向更宽松方向修改');
      source = {
        characterId: row.id,
        revision: row.revision,
        childFeaturesDetected: row.childFeaturesDetected,
      };
    }
    const role = await this.custom.create(
      userId,
      body,
      source
        ? {
            sourceCharacterId: source.characterId,
            sourceRevision: source.revision,
            childFeaturesDetected: source.childFeaturesDetected,
            reuse: source.reuse,
          }
        : {},
    );
    const [session] = await this.db.db
      .select()
      .from(trialSessions)
      .where(eq(trialSessions.characterId, role.characterId));
    if (!session) throw new Error('Trial session missing after creation');
    return {
      characterId: role.characterId,
      conversationId: session.conversationId,
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  async start(userId: string, characterId: string) {
    const [source] = await this.db.db
      .select()
      .from(characters)
      .where(and(eq(characters.id, characterId), eq(characters.ownerId, userId)));
    if (!source || source.isTrial || source.kind !== 'custom')
      throw new AppError('not_found', '角色不存在');
    const role = await this.custom.get(userId, characterId);
    const result = await this.draft(
      userId,
      UserCustomCharacterWrite.parse({
        name: role.name,
        description: role.description,
        classification: role.classification,
        birthday: role.birthday,
        catchphrases: role.catchphrases,
        catchphrase: role.catchphrase ?? undefined,
        speechStyle: role.speechStyle ?? undefined,
        exampleDialogue: role.exampleDialogue ?? undefined,
        tags: role.tags,
      }),
      {
        characterId,
        revision: source.revision,
        childFeaturesDetected: source.childFeaturesDetected,
        reuse: true,
      },
    );
    return { conversationId: result.conversationId };
  }

  async getTrial(input: { userId: string; characterId: string; conversationId: string }, tx?: Tx) {
    const [session] = await (tx ? asDbTx(tx).db : this.db.db)
      .select()
      .from(trialSessions)
      .where(
        and(
          eq(trialSessions.userId, input.userId),
          eq(trialSessions.characterId, input.characterId),
          eq(trialSessions.conversationId, input.conversationId),
        ),
      );
    if (!session || session.expiresAt <= this.clock.now()) return null;
    if (session.sourceCharacterId) {
      const [source] = await (tx ? asDbTx(tx).db : this.db.db)
        .select({ revision: characters.revision })
        .from(characters)
        .where(eq(characters.id, session.sourceCharacterId));
      if (!source || source.revision !== session.sourceRevision) return null;
    }
    return { epoch: session.conversationId, expiresAt: session.expiresAt.toISOString() };
  }

  async end(userId: string, conversationId: string): Promise<{ ended: true }> {
    await this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('ai_runtime:user:' || $1,0))", [
        userId,
      ]);
      await tx.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('ai_runtime:conversation:' || $1,0))",
        [conversationId],
      );
      const [session] = await tx.db
        .select()
        .from(trialSessions)
        .where(eq(trialSessions.conversationId, conversationId))
        .for('update');
      if (!session) return;
      if (session.userId !== userId) throw new AppError('not_found', '试聊不存在');
      if (!this.cleanup) throw new Error('Trial cleanup port is not bound');
      await this.cleanup.purgeTrial(tx, {
        userId,
        characterId: session.characterId,
        conversationId,
      });
      await this.chat.purgeDirectConversation(tx, { userId, characterId: session.characterId });
      await tx.db
        .delete(characters)
        .where(and(eq(characters.id, session.characterId), eq(characters.isTrial, true)));
    });
    return { ended: true };
  }

  async expire(): Promise<void> {
    const sessions = await this.db.db
      .select()
      .from(trialSessions)
      .where(lte(trialSessions.expiresAt, this.clock.now()))
      .limit(100);
    const failures: unknown[] = [];
    for (const session of sessions) {
      try {
        await this.end(session.userId, session.conversationId);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Trial expiry cleanup failed');
  }
}
