/*
 * 角色资料页「TA 的人设」（2026-10-27 批 U4）：按人设板块配置渲染一张人设卡。
 * 数据来源（「角色资料」形状）：资料页基础信息；自建角色再取完整自定义字段；预设角色再取广场公开的基本人设。
 * 补充设定页的「TA 的原设定」用同一个 useCharacterPersona。
 */
import { useParams } from 'react-router-dom';
import {
  CharacterEndpoints,
  PlazaOfficialEndpoints,
  UserCustomEndpoints,
  VoiceEndpoints,
  type CharacterProfile,
} from '@weiban/contracts';
import type { PersonaSource } from '@weiban/client-core';
import { useRemote } from '../data/use-remote.js';
import { CharacterAvatar } from './character-avatar.js';
import { PersonaCard, VoiceSampleButton } from './persona-card.js';
import { EmptyState, NavBar } from './shell-kit.js';

export function useCharacterPersona(characterId: string): {
  profile: CharacterProfile | undefined;
  source: PersonaSource | null;
  voiceSample: string | null;
  error: string;
} {
  const profile = useRemote(CharacterEndpoints.getProfile, { params: { characterId } });
  const data = profile.data;
  const custom = data?.kind === 'custom';
  const mine = useRemote(UserCustomEndpoints.list, { networkOnly: true }, custom);
  const official = useRemote(
    PlazaOfficialEndpoints.get,
    { params: { characterId }, networkOnly: true },
    !!data && !custom,
  );
  const voices = useRemote(VoiceEndpoints.listVoices, { networkOnly: true }, custom);
  const own = custom ? mine.data?.items.find((c) => c.characterId === characterId) : undefined;
  const voice = own?.voiceId
    ? voices.data?.items.find((v) => v.voiceId === own.voiceId && v.enabled)
    : undefined;
  if (!data) return { profile: undefined, source: null, voiceSample: null, error: profile.error };
  return {
    profile: data,
    source: {
      kind: 'profile',
      data: {
        profile: { ...data, avatarUrl: data.avatar.image?.url ?? null },
        custom: own ?? null,
        // 广场公开的基本人设：没上架的预设角色读不到，按没有处理
        official: custom ? null : (official.data?.persona ?? null),
        voiceName: voice?.name ?? null,
      },
    },
    voiceSample: voice?.sampleUrl ?? null,
    error: '',
  };
}

export function CharacterPersonaPage() {
  const { characterId = '' } = useParams();
  const { profile, source, voiceSample, error } = useCharacterPersona(characterId);
  return (
    <main className="persona-page">
      <NavBar title="TA 的人设" fallback={`/characters/${characterId}`} />
      {!source ? (
        error ? (
          <EmptyState icon="wechat/info" title="读不到 TA 的资料" desc={error} />
        ) : (
          <p role="status" className="empty">
            正在读取…
          </p>
        )
      ) : (
        <>
          <PersonaCard
            source={source}
            avatar={<CharacterAvatar id={characterId} profile={profile} size={64} radius={8} />}
            asides={{ voice: <VoiceSampleButton url={voiceSample} name="音色" /> }}
          />
          {profile?.showPublicSourceNotice && (
            <p className="hint page-note">本角色根据公开资料创作，不代表本人</p>
          )}
        </>
      )}
    </main>
  );
}
