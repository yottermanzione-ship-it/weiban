import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { CharacterCard } from '@weiban/contracts';
import { customToAdminWrite, voiceIdOf, type CustomCharacterPayload } from './custom-card.js';

const voice = '00000000-0000-4000-8000-000000000001';
const preset = CharacterCard.parse(
  JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, '../../../../../../docs/ai/samples/S-01-cheng-che.md'),
      'utf8',
    ).match(/```json\s*([\s\S]*?)```/)![1]!,
  ).card,
);
const payload: CustomCharacterPayload = {
  name: '旧复制品',
  description: '保留已复制的人设',
  classification: {
    basis: 'original',
    realPersonKind: null,
    ageSetting: 'adult',
    childAppearance: false,
  },
  birthday: null,
  catchphrase: null,
  exampleDialogue: null,
  tags: [],
  avatarMediaId: null,
  presetCard: preset,
};
it('旧卡里的示例音色代号不冒充库ID；旧复制品的真实库ID可以继承', () => {
  expect(preset.data.social.voiceId).toBe('voice_young_m_02');
  expect(voiceIdOf(payload)).toBeNull();
  const withLibrary = {
    ...payload,
    presetCard: {
      ...preset,
      data: { ...preset.data, social: { ...preset.data.social, voiceId: voice } },
    },
  };
  expect(voiceIdOf(withLibrary)).toBe(voice);
  expect(customToAdminWrite(withLibrary).card.data.social?.voiceId).toBe(voice);
});
it('明确清空优先于预设快照；重新选音色同时覆盖快照和运行时卡', () => {
  const copy = {
    ...payload,
    presetCard: {
      ...preset,
      data: { ...preset.data, social: { ...preset.data.social, voiceId: voice } },
    },
  };
  expect(voiceIdOf({ ...copy, voiceId: null })).toBeNull();
  expect(customToAdminWrite({ ...copy, voiceId: null }).card.data.social?.voiceId).toBeUndefined();
  const selected = '00000000-0000-4000-8000-000000000002';
  expect(customToAdminWrite({ ...copy, voiceId: selected }).card.data.social?.voiceId).toBe(
    selected,
  );
});
