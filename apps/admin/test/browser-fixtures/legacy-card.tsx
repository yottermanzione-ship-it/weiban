/** 旧卡编辑器真实组件 + 显式 API 夹具；不是生产联调，也不写任何真实数据。 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App, ConfigProvider } from 'antd';
import {
  AdminLegacyCharacterDetail,
  AdminLegacyCharacterPatch,
  CharacterAdminEndpoints,
  MediaAdminEndpoints,
  MediaObject,
  type AdminLegacyCharacterDetail as Detail,
  type AdminLegacyClearableField,
} from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import '../../../../docs/design/tokens.css';
import '../../src/app/styles.css';
import { LegacyCharacterEditor } from '../../src/components/legacy-card-editor.js';
import { api } from '../../src/data/client.js';
import { adminTheme } from '../../src/app/theme.js';

const CHARACTER_ID = '11111111-2222-7333-8444-555555555555';
const AVATAR_MEDIA = '01a16dd0-04d5-770f-acbb-3c94e4960a61';
const NEW_AVATAR = '01a16dd0-9999-7777-8888-000000000001';
const params = new URLSearchParams(window.location.search);
const brokenAvatar = params.has('broken');
const conflict = params.has('conflict');
const avatarToken = brokenAvatar ? 'broken' : 'tok';

function mediaUrl(mediaId: string, token: string) {
  return `http://103.231.58.124/api/v1/media/${mediaId}/content?token=${token}`;
}

function baseDetail(): Detail {
  return {
    characterId: CHARACTER_ID,
    status: 'published',
    revision: 7,
    updatedAt: '2026-10-25T02:00:00.000Z',
    name: '吴云飞',
    avatar: {
      image: { mediaId: AVATAR_MEDIA, url: mediaUrl(AVATAR_MEDIA, avatarToken) },
      display: { supportColors: [], avatarText: null, avatarPattern: 'none', themeColor: null },
    },
    fields: {
      displayName: '吴云飞',
      nickname: '小云',
      aliases: ['云飞'],
      signature: '签名示例',
      corePersona: '核心人设原文',
      speakingStyle: '说话风格原文',
      relationshipMode: '',
      momentProfile: { tone: '自然' },
      groupChat: { talkativeness: 40 },
      openingMessages: ['开场白一'],
    },
    preserved: {
      raw_json: '{"legacy":true}',
      voice_json: { provider: 'qwen' },
      weibo_nickname: '云飞',
    },
    lorebook: [
      {
        id: 'lb-1',
        payload: {
          id: 'lb-1',
          title: '旧标题',
          trigger_keys_json: '["关键词"]',
          content: '世界书内容',
          priority: 5,
          constant: false,
          enabled: true,
        },
      },
    ],
    examples: [
      {
        id: 'ex-1',
        sortOrder: 0,
        payload: {
          id: 'ex-1',
          scene: '日常',
          user_text: '你好',
          assistant_text: '嗨',
          sort_order: 0,
        },
      },
    ],
    history: [],
  };
}

const CLEARED: Record<AdminLegacyClearableField, unknown> = {
  nickname: '',
  aliases: [],
  signature: '',
  speakingStyle: '',
  relationshipMode: '',
  momentProfile: null,
  groupChat: null,
  openingMessages: [],
};

/** 夹具里模拟服务端的局部合并，用来验证「保存后读回」。 */
function applyPatch(current: Detail, body: AdminLegacyCharacterPatch): Detail {
  const fields: Record<string, unknown> = { ...current.fields, ...(body.fields ?? {}) };
  for (const key of body.clear ?? []) fields[key] = CLEARED[key];
  let lorebook = [...current.lorebook];
  let nextId = lorebook.length + 1;
  for (const item of body.lorebook?.upsert ?? []) {
    if (item.id) {
      lorebook = lorebook.map((entry) =>
        entry.id === item.id ? { ...entry, payload: { ...entry.payload, ...item.payload } } : entry,
      );
    } else {
      const id = `lb-new-${nextId++}`;
      lorebook.push({ id, payload: { ...item.payload, id } });
    }
  }
  lorebook = lorebook.filter((entry) => !(body.lorebook?.delete ?? []).includes(entry.id));
  let examples = [...current.examples];
  for (const item of body.examples?.upsert ?? []) {
    if (item.id) {
      examples = examples.map((entry) =>
        entry.id === item.id
          ? {
              ...entry,
              sortOrder: item.sortOrder ?? entry.sortOrder,
              payload: { ...entry.payload, ...item.payload },
            }
          : entry,
      );
    } else {
      const id = `ex-new-${nextId++}`;
      examples.push({
        id,
        sortOrder: item.sortOrder ?? examples.length,
        payload: { ...item.payload, id, sort_order: item.sortOrder ?? examples.length },
      });
    }
  }
  examples = examples.filter((entry) => !(body.examples?.delete ?? []).includes(entry.id));
  const avatarMediaId =
    body.avatarMediaId === undefined ? (current.avatar.image?.mediaId ?? null) : body.avatarMediaId;
  const changed = [
    ...Object.keys(body.fields ?? {}),
    ...(body.clear ?? []),
    ...(body.lorebook ? ['lorebook'] : []),
    ...(body.examples ? ['examples'] : []),
    ...(body.avatarMediaId !== undefined ? ['avatar'] : []),
  ];
  return {
    ...current,
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
    fields: fields as unknown as Detail['fields'],
    lorebook,
    examples,
    avatar: {
      ...current.avatar,
      image: avatarMediaId ? { mediaId: avatarMediaId, url: mediaUrl(avatarMediaId, 'new') } : null,
    },
    history: [
      {
        revision: current.revision,
        at: new Date().toISOString(),
        source: 'save',
        operatorUserId: null,
        operatorName: '夹具管理员',
        name: current.name,
        aliases: current.fields.aliases,
        signature: current.fields.signature,
        changedFields: changed,
        note: body.note ?? null,
      },
      ...current.history,
    ],
  };
}

let current = baseDetail();
const saved: unknown[] = [];
Object.assign(window, { legacySaved: saved, legacyDetail: () => current });

const eligibility = {
  characterId: CHARACTER_ID,
  name: '吴云飞',
  kind: 'preset',
  auto: {
    basis: 'real_person',
    realPersonKind: 'celebrity',
    ageSetting: 'adult',
    childAppearance: false,
    childFeaturesDetected: false,
  },
  override: null,
  effective: {
    basis: 'real_person',
    realPersonKind: 'celebrity',
    ageSetting: 'adult',
    childAppearance: false,
    childFeaturesDetected: false,
    derived: {
      isMinor: false,
      adultModeEligible: false,
      romanceAllowed: true,
      portraitPolicy: 'forbidden',
      publicStatementGuard: true,
    },
  },
  history: [],
};

Object.assign(api, {
  cached: async () => undefined,
  call: async (
    endpoint: unknown,
    options: { body?: unknown; query?: { purpose?: string } } = {},
  ) => {
    if (endpoint === CharacterAdminEndpoints.legacyDetail)
      return AdminLegacyCharacterDetail.parse(current);
    if (endpoint === CharacterAdminEndpoints.legacyUpdate) {
      const body = AdminLegacyCharacterPatch.parse(options.body);
      if (conflict)
        throw new ApiFailure('conflict', '角色已被其他人修改（当前版本 8），请刷新后重试', 409);
      saved.push(body);
      current = applyPatch(current, body);
      return AdminLegacyCharacterDetail.parse(current);
    }
    if (endpoint === CharacterAdminEndpoints.getEligibility) return eligibility;
    if (endpoint === MediaAdminEndpoints.adminUpload)
      return MediaObject.parse({
        mediaId: NEW_AVATAR,
        purpose: 'character_avatar',
        mimeType: 'image/webp',
        sizeBytes: 1024,
        width: 480,
        height: 480,
        url: mediaUrl(NEW_AVATAR, 'new'),
        urlExpiresAt: new Date(Date.now() + 300_000).toISOString(),
        createdAt: new Date().toISOString(),
        thumbnailUrl: null,
        durationMs: null,
      });
    throw new Error(`夹具没有实现该接口：${String(endpoint)}`);
  },
});

function Fixture() {
  const [result, setResult] = useState('');
  return (
    <div style={{ padding: 24, background: '#f4f5f7' }}>
      <LegacyCharacterEditor characterId={CHARACTER_ID} onSaved={(text) => setResult(text)} />
      <output aria-label="保存结果" style={{ position: 'fixed', top: 0, left: 0 }}>
        {result}
      </output>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <ConfigProvider theme={adminTheme}>
    <App>
      <Fixture />
    </App>
  </ConfigProvider>,
);
