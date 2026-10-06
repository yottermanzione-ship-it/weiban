import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, count, eq, lte, or } from 'drizzle-orm';
import {
  CLOCK,
  DATABASE,
  EVENT_BUS,
  JOB_QUEUE,
  USER_DATA_REGISTRY,
  type Clock,
  type Database,
  type EventBus,
  type JobQueue,
  type UserDataRegistry,
} from '../../../platform/index.js';
import { contacts } from '../infra/db/schema.js';
import {
  ACCEPT_CONTACT_JOB,
  PURGE_CONTACT_JOB,
  ContactsCommands,
  type ContactJob,
} from './commands.js';
@Injectable()
export class ContactsLifecycle implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(USER_DATA_REGISTRY) private readonly registry: UserDataRegistry,
    @Inject(ContactsCommands) private readonly commands: ContactsCommands,
  ) {}
  async onModuleInit(): Promise<void> {
    this.registry.register({
      module: 'contacts',
      purgeUser: (id) => this.purgeUser(id),
      countUserData: (id) => this.countUserData(id),
    });
    await this.jobs.work<ContactJob>(ACCEPT_CONTACT_JOB, (job) => this.commands.accept(job.data), {
      pollingIntervalSeconds: 0.5,
      localConcurrency: 4,
    });
    await this.jobs.work<ContactJob>(PURGE_CONTACT_JOB, (job) =>
      this.commands.purgeExpired(job.data),
    );
    await this.jobs.work('contacts.reconcile', () => this.reconcile());
    await this.jobs.schedule('contacts.reconcile', '* * * * *');
    this.bus.subscribe({
      consumer: 'contacts.clear_greeting_on_first_reply',
      eventType: 'chat.message_created',
      handle: async (event, tx) => {
        if (event.payload.senderKind !== 'character' || !event.payload.senderRefId) return;
        for (const userId of event.payload.userRecipientIds) {
          await tx.db
            .update(contacts)
            .set({ greetingCiphertext: null })
            .where(
              and(
                eq(contacts.userId, userId),
                eq(contacts.characterId, event.payload.senderRefId),
                eq(contacts.conversationId, event.payload.conversationId),
                eq(contacts.status, 'active'),
                lte(contacts.acceptAfter, new Date(event.occurredAt)),
              ),
            );
        }
      },
    });
  }
  async reconcile(): Promise<void> {
    const rows = await this.db.db
      .select()
      .from(contacts)
      .where(
        or(
          and(eq(contacts.status, 'pending'), lte(contacts.acceptAfter, this.clock.now())),
          and(eq(contacts.status, 'deleted'), lte(contacts.purgeAfter, this.clock.now())),
        ),
      )
      .orderBy(contacts.acceptAfter, contacts.id)
      .limit(200);
    for (const row of rows) {
      const data = { userId: row.userId, characterId: row.characterId, requestId: row.requestId };
      if (row.status === 'pending') await this.commands.accept(data);
      else await this.commands.purgeExpired(data);
    }
  }
  async purgeUser(userId: string): Promise<number> {
    return (
      await this.db.db
        .delete(contacts)
        .where(eq(contacts.userId, userId))
        .returning({ id: contacts.id })
    ).length;
  }
  async countUserData(userId: string): Promise<number> {
    const [row] = await this.db.db
      .select({ n: count() })
      .from(contacts)
      .where(eq(contacts.userId, userId));
    return row?.n ?? 0;
  }
}
