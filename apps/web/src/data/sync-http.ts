import { z } from 'zod';
import {
  ChatEndpoints,
  ContactsEndpoints,
  IdentityEndpoints,
  ModelAccessEndpoints,
  BillingEndpoints,
  CompanionEndpoints,
  type ClientSyncOperation,
} from '@weiban/contracts';
import {
  ApiFailure,
  type ApiClient,
  type FullSyncSnapshot,
  type SyncEffect,
} from '@weiban/client-core';
export async function syncHttp(
  api: ApiClient,
  effect: SyncEffect,
  signal: AbortSignal,
): Promise<ClientSyncOperation[]> {
  const options = { networkOnly: true, signal };
  switch (effect.type) {
    case 'send':
      try {
        const ack = await api.call(ChatEndpoints.sendMessage, {
          ...options,
          params: { conversationId: effect.conversationId },
          body: effect.body,
        });
        return [{ type: 'ack', ack, now: Date.now() }];
      } catch (error) {
        if (signal.aborted) return [];
        return [
          {
            type: 'send.failed',
            conversationId: effect.conversationId,
            clientMsgId: effect.body.clientMsgId,
            httpStatus: error instanceof ApiFailure && error.status >= 400 ? error.status : null,
            now: Date.now(),
          },
        ];
      }
    case 'updates':
      try {
        const page = await api.call(SyncEndpoints.getUpdates, {
          ...options,
          query: { since: effect.since, limit: effect.limit },
        });
        return [{ type: 'updates.page', page, now: Date.now() }];
      } catch (error) {
        if (error instanceof ApiFailure && error.code === 'sync_cursor_expired')
          return [{ type: 'cursor.expired' }];
        throw error;
      }
    case 'state': {
      const state = await api.call(SyncEndpoints.getState, options);
      return [{ type: 'rebuild.state', latestUpdateSeq: state.latestUpdateSeq }];
    }
    case 'snapshot':
      return [
        { type: 'snapshot', startSeq: effect.startSeq, snapshot: await snapshot(api, signal) },
      ];
    case 'messages': {
      const page = await api.call(ChatEndpoints.listMessages, {
        ...options,
        params: { conversationId: effect.conversationId },
        query: { afterSeq: effect.afterSeq, limit: effect.limit },
      });
      return [{ type: 'messages.page', conversationId: effect.conversationId, page }];
    }
    case 'settings':
      await refreshSetting(api, effect.section, effect.characterId, signal);
      if (!signal.aborted) window.dispatchEvent(new Event('weiban:settings-updated'));
      return [];
    case 'model-status':
      if (!signal.aborted) window.dispatchEvent(new Event('weiban:settings-updated'));
      return [];
  }
}
import { SyncEndpoints } from '@weiban/contracts';
async function snapshot(api: ApiClient, signal: AbortSignal): Promise<FullSyncSnapshot> {
  const options = { networkOnly: true, signal };
  const [conversations, contacts, profile, notification, preferences, selection, wallet] =
    await Promise.all([
      api.call(ChatEndpoints.listConversations, options),
      api.call(ContactsEndpoints.list, options),
      api.call(IdentityEndpoints.getProfile, options),
      api.call(IdentityEndpoints.getNotificationSettings, options),
      api.call(IdentityEndpoints.getPreferences, options),
      api.call(ModelAccessEndpoints.getSelection, options),
      api.call(BillingEndpoints.getWallet, options),
    ]);
  const result: FullSyncSnapshot = {
    conversations: conversations.items,
    contacts: contacts.items,
    messages: [],
    coverages: [],
    settings: z
      .record(z.string(), z.json())
      .parse({ profile, notification, preferences, model_selection: selection, wallet }),
  };
  // 限制并发，所有会话覆盖范围必须保留，不能只保留可见消息的最大seq。
  for (let offset = 0; offset < conversations.items.length; offset += 4) {
    const pages = await Promise.all(
      conversations.items.slice(offset, offset + 4).map(async (conversation) => ({
        conversationId: conversation.conversationId,
        page: await api.call(ChatEndpoints.listMessages, {
          ...options,
          params: { conversationId: conversation.conversationId },
          query: { limit: 50 },
        }),
      })),
    );
    for (const { conversationId, page } of pages) {
      result.messages.push(...page.items);
      if (page.coverage) result.coverages.push({ conversationId, coverage: page.coverage });
    }
  }
  for (const contact of contacts.items) {
    if (contact.status !== 'active') continue;
    const settings = await api.call(CompanionEndpoints.getForCharacter, {
      ...options,
      params: { characterId: contact.characterId },
    });
    result.settings[`companion:${contact.characterId}`] = z.json().parse(settings);
  }
  return result;
}
async function refreshSetting(
  api: ApiClient,
  section: string,
  characterId: string | null,
  signal: AbortSignal,
) {
  const options = { networkOnly: true, signal };
  switch (section) {
    case 'profile':
      return api.call(IdentityEndpoints.getProfile, options);
    case 'notification':
      return api.call(IdentityEndpoints.getNotificationSettings, options);
    case 'preferences':
      return api.call(IdentityEndpoints.getPreferences, options);
    case 'wallet':
      return api.call(BillingEndpoints.getWallet, options);
    case 'companion':
      return characterId
        ? api.call(CompanionEndpoints.getForCharacter, { ...options, params: { characterId } })
        : undefined;
    case 'model_selection':
      return characterId
        ? api.call(ModelAccessEndpoints.getCharacterOverride, {
            ...options,
            params: { characterId },
          })
        : api.call(ModelAccessEndpoints.getSelection, options);
    default:
      return undefined;
  }
}
