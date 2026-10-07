import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  DATABASE,
  USER_DATA_REGISTRY,
  type Database,
  type UserDataRegistry,
} from '../../../platform/index.js';
@Injectable()
export class ChatLifecycle implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(USER_DATA_REGISTRY) private readonly registry: UserDataRegistry,
  ) {}
  onModuleInit(): void {
    this.registry.register({
      module: 'chat',
      purgeUser: (id) => this.purgeUser(id),
      countUserData: (id) => this.countUserData(id),
    });
  }
  async purgeUser(userId: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      const result = await tx.query<{ n: string }>(
        `SELECT
        (SELECT count(*) FROM chat.conversations WHERE owner_user_id=$1)+
        (SELECT count(*) FROM chat.participants p JOIN chat.conversations c ON c.id=p.conversation_id WHERE c.owner_user_id=$1)+
        (SELECT count(*) FROM chat.messages m JOIN chat.conversations c ON c.id=m.conversation_id WHERE c.owner_user_id=$1)+
        (SELECT count(*) FROM chat.user_conversation_states WHERE user_id=$1)+
        (SELECT count(*) FROM chat.hidden_messages WHERE user_id=$1) AS n`,
        [userId],
      );
      // 所有子表都是本schema内外键，随所属会话物理删除；不保留可恢复的账号残留。
      await tx.query('DELETE FROM chat.conversations WHERE owner_user_id=$1', [userId]);
      return Number(result.rows[0]!.n);
    });
  }
  async countUserData(userId: string): Promise<number> {
    const result = await this.db.query<{ n: string }>(
      `SELECT
      (SELECT count(*) FROM chat.conversations WHERE owner_user_id=$1)+
      (SELECT count(*) FROM chat.participants WHERE kind='user' AND ref_id=$1)+
      (SELECT count(*) FROM chat.messages m JOIN chat.conversations c ON c.id=m.conversation_id WHERE c.owner_user_id=$1)+
      (SELECT count(*) FROM chat.user_conversation_states WHERE user_id=$1)+
      (SELECT count(*) FROM chat.hidden_messages WHERE user_id=$1) AS n`,
      [userId],
    );
    return Number(result.rows[0]!.n);
  }
}
