import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type {
  ChatAdminPort,
  Contact,
  ContactsReadPort,
  MediaSystemPort,
  MediaTranscriptPort,
  Message,
} from '@weiban/contracts';
import { MediaAiService } from '../src/modules/ai-runtime/testing.js';
import { CHAT_ADMIN_PORT } from '../src/modules/chat/index.js';
import { CONTACTS_READ_PORT } from '../src/modules/contacts/index.js';
import { GrowthService } from '../src/modules/growth/index.js';
import { MEDIA_SYSTEM_PORT, MEDIA_TRANSCRIPT_PORT } from '../src/modules/media/index.js';
import { MEDIA_STORAGE, type ObjectStorage } from '../src/modules/media/testing.js';
import { MODEL_GATEWAY_MEDIA_PORT } from '../src/modules/model-access/index.js';
import { JOB_QUEUE, newId, type JobQueue } from '../src/platform/index.js';
import { describeDb } from './support/db.js';
import { makeIsolatedApp } from './support/isolated-app.js';

describeDb('用户语音：真实任务、媒体加密存储和熟悉度补计', () => {
  let f: Awaited<ReturnType<typeof makeIsolatedApp>>;
  let ai: MediaAiService,
    growth: GrowthService,
    counter = 0;
  const recognize = vi.fn(async () => ({
    ok: true as boolean,
    value: { text: '本机合成识别结果' },
    error: 'provider_unavailable',
  }));
  const objects = new Map<string, Buffer>();
  const storage: ObjectStorage = {
    async put(key, value) {
      objects.set(key, Buffer.from(value));
    },
    async get(key) {
      const value = objects.get(key);
      if (!value) throw new Error('Synthetic object absent');
      return value;
    },
    async delete(key) {
      objects.delete(key);
    },
  };
  const contacts = new Map<string, Contact>();
  const wav = Buffer.alloc(32044);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(32036, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(32000, 40);

  beforeAll(async () => {
    f = await makeIsolatedApp([
      { token: MEDIA_STORAGE, value: storage },
      {
        token: MODEL_GATEWAY_MEDIA_PORT,
        value: { isServiceEnabled: async () => true, transcribeSpeech: recognize },
      },
    ]);
    ai = f.app.get(MediaAiService);
    growth = f.app.get(GrowthService);
    const port = f.app.get<ContactsReadPort>(CONTACTS_READ_PORT);
    vi.spyOn(port, 'listActiveContacts').mockImplementation(async (userId) =>
      contacts.has(userId) ? [contacts.get(userId)!] : [],
    );
    vi.spyOn(port, 'getActiveContact').mockImplementation(async (userId, characterId) =>
      contacts.get(userId)?.characterId === characterId ? contacts.get(userId)! : null,
    );
  }, 120_000);
  afterAll(async () => {
    await f?.close();
    objects.clear();
  });

  async function voice() {
    const user = await f.user(`voice_growth_${++counter}`),
      characterId = newId();
    const conversation = await f.db.transaction((tx) =>
      f.app
        .get<ChatAdminPort>(CHAT_ADMIN_PORT)
        .ensureDirectConversation(tx, { userId: user.id, characterId, restoreHistory: true }),
    );
    const conversationId = conversation.conversationId;
    contacts.set(user.id, {
      characterId,
      conversationId,
      status: 'active',
      remark: null,
      customAvatarMediaId: null,
      addressAs: null,
      knownSince: '2026-11-04',
      addedAt: f.clock.now().toISOString(),
    });
    const media = await f.app.get<MediaSystemPort>(MEDIA_SYSTEM_PORT).putObject({
      ownerUserId: user.id,
      purpose: 'chat_voice',
      bytes: wav,
      mimeType: 'audio/wav',
      durationMs: 1000,
    });
    const sent = await f.http(user.token, `/conversations/${conversationId}/messages`, 'POST', {
      clientMsgId: newId(),
      content: { type: 'voice', mediaId: media.mediaId, durationMs: 1000, transcript: null },
    });
    expect(sent.status).toBe(200);
    const message = sent.data.message as Message;
    const ctx = { userId: user.id, characterId, conversationId, sourceMessage: message };
    const points = async () =>
      Number(
        (
          await f.db.query<{ points: number }>(
            "SELECT COALESCE(sum(points),0) AS points FROM growth.familiarity_events WHERE user_id=$1 AND character_id=$2 AND event_type='user_message'",
            [user.id, characterId],
          )
        ).rows[0]?.points ?? 0,
      );
    return { user, characterId, conversationId, mediaId: media.mediaId, message, ctx, points };
  }

  it('原语音任务成功识别后加四点，重复补计和并发重试不再调用识别或多加分', async () => {
    const v = await voice();
    expect(await v.points()).toBe(0);
    const before = recognize.mock.calls.length;
    await f.app.get<JobQueue>(JOB_QUEUE).send('ai.transcribe_voice', {
      userId: v.user.id,
      messageId: v.message.messageId,
      conversationId: v.conversationId,
    });
    await vi.waitFor(async () => expect(await v.points()).toBe(4), {
      timeout: 15_000,
      interval: 100,
    });
    expect(recognize.mock.calls.length - before).toBe(1);
    await Promise.all([ai.transcribe(v.ctx, v.mediaId), ai.transcribe(v.ctx, v.mediaId)]);
    expect(await v.points()).toBe(4);
    expect(recognize.mock.calls.length - before).toBe(1);
    const stored = await f.db.query<{ transcript_ciphertext: Buffer }>(
      'SELECT transcript_ciphertext FROM media.objects WHERE id=$1',
      [v.mediaId],
    );
    expect(stored.rows[0]?.transcript_ciphertext.includes(Buffer.from('本机合成识别结果'))).toBe(
      false,
    );
  });

  it('识别失败不加分，稍后成功补计；已转写后计分失败再试不重复识别', async () => {
    const v = await voice();
    recognize.mockResolvedValueOnce({
      ok: false,
      value: { text: '' },
      error: 'provider_unavailable',
    });
    expect(await ai.transcribe(v.ctx, v.mediaId)).toBeNull();
    expect(await v.points()).toBe(0);
    const realAward = growth.awardUserVoice.bind(growth);
    const award = vi
      .spyOn(growth, 'awardUserVoice')
      .mockRejectedValueOnce(new Error('Synthetic commit failure'));
    await expect(ai.transcribe(v.ctx, v.mediaId)).rejects.toThrow('Synthetic commit failure');
    expect(await v.points()).toBe(0);
    award.mockImplementation(realAward);
    const calls = recognize.mock.calls.length;
    await ai.transcribe(v.ctx, v.mediaId);
    expect(recognize.mock.calls.length).toBe(calls);
    expect(await v.points()).toBe(4);
    award.mockRestore();
  });

  it('撤回、冒用他人消息和转发项目不补分；事务内媒体状态读取保持一致', async () => {
    const v = await voice(),
      other = await f.user(`voice_other_${counter}`);
    expect(
      (
        await f.http(
          v.user.token,
          `/conversations/${v.conversationId}/messages/${v.message.messageId}/recall`,
          'POST',
          {},
        )
      ).status,
    ).toBe(200);
    await ai.transcribe(v.ctx, v.mediaId);
    expect(await v.points()).toBe(0);
    expect(await growth.awardUserVoice(other.id, v.message)).toBe(0);
    expect(
      await growth.awardUserVoice(v.user.id, {
        ...v.message,
        messageId: `${v.message.messageId}:0`,
      }),
    ).toBe(0);
    const transcripts = f.app.get<MediaTranscriptPort>(MEDIA_TRANSCRIPT_PORT);
    await expect(
      f.db.transaction(async (tx) => {
        await tx.query("UPDATE media.objects SET transcript_status='pending' WHERE id=$1", [
          v.mediaId,
        ]);
        expect((await transcripts.getTranscript(v.mediaId, tx)).status).toBe('pending');
        throw new Error('Rollback synthetic change');
      }),
    ).rejects.toThrow('Rollback synthetic change');
    expect((await transcripts.getTranscript(v.mediaId)).status).toBe('ready');
  });
});
