import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  CHARACTER_PURGE_REGISTRY,
  CLOCK,
  DATABASE,
  USER_DATA_REGISTRY,
  type CharacterPurgeRegistry,
  type Clock,
  type Database,
  type DbTx,
  type UserDataRegistry,
} from '../../../platform/index.js';
@Injectable()
export class ChatLifecycle implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(USER_DATA_REGISTRY) private readonly registry: UserDataRegistry,
    @Inject(CHARACTER_PURGE_REGISTRY) private readonly purgeRegistry: CharacterPurgeRegistry,
  ) {}
  onModuleInit(): void {
    this.registry.register({
      module: 'chat',
      purgeUser: (id) => this.purgeUser(id),
      countUserData: (id) => this.countUserData(id),
    });
    this.purgeRegistry.register({
      module: 'chat',
      count: (characterId, tx) => this.countCharacterData(characterId, tx),
      purge: (tx, characterId) => this.purgeCharacter(tx, characterId),
    });
  }

  /** 后台彻底删除角色：只统计会被物理删除的私聊会话与消息；群聊只移除成员关系。 */
  async countCharacterData(
    characterId: string,
    tx?: DbTx,
  ): Promise<{ conversations: number; messages: number }> {
    const { rows } = await (tx ?? this.db).query<{
      conversations: number;
      messages: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM chat.conversations
           WHERE character_id = $1 AND type = 'direct') AS conversations,
         (SELECT count(*)::int FROM chat.messages m
            JOIN chat.conversations c ON c.id = m.conversation_id
           WHERE c.character_id = $1 AND c.type = 'direct') AS messages`,
      [characterId],
    );
    return { conversations: rows[0]?.conversations ?? 0, messages: rows[0]?.messages ?? 0 };
  }

  async purgeCharacter(tx: DbTx, characterId: string): Promise<void> {
    // 群聊不随角色删除：把角色标记为退出，保留其它成员和聊天记录。
    await tx.query(
      'UPDATE chat.conversations SET created_by_character_id = NULL WHERE created_by_character_id = $1',
      [characterId],
    );
    await tx.query(
      `UPDATE chat.participants
          SET left_at = $2
        WHERE kind = 'character' AND ref_id = $1 AND left_at IS NULL`,
      [characterId, this.clock.now()],
    );
    // 私聊会话连同消息、参与者、每用户状态、转发回执一起级联删除。
    await tx.query("DELETE FROM chat.conversations WHERE character_id = $1 AND type = 'direct'", [
      characterId,
    ]);
  }
  async purgeUser(userId: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      const result = await tx.query<{ n: string }>(
        `SELECT
        (SELECT count(*) FROM chat.conversations WHERE owner_user_id=$1)+
        (SELECT count(*) FROM chat.participants p JOIN chat.conversations c ON c.id=p.conversation_id WHERE c.owner_user_id=$1)+
        (SELECT count(*) FROM chat.messages m JOIN chat.conversations c ON c.id=m.conversation_id WHERE c.owner_user_id=$1)+
        (SELECT count(*) FROM chat.user_conversation_states WHERE user_id=$1)+
        (SELECT count(*) FROM chat.hidden_messages WHERE user_id=$1)+
        (SELECT count(*) FROM chat.forward_receipts WHERE user_id=$1) AS n`,
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
      (SELECT count(*) FROM chat.hidden_messages WHERE user_id=$1)+
      (SELECT count(*) FROM chat.forward_receipts WHERE user_id=$1) AS n`,
      [userId],
    );
    return Number(result.rows[0]!.n);
  }
}
