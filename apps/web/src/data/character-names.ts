import { useEffect, useMemo, useState } from 'react';
import { CharacterEndpoints } from '@weiban/contracts';
import { api } from './client.js';
import { useAuth } from '../app/auth.js';
import { loadCharacterProfile } from './character-profile.js';
/**
 * U8：内存里已有的角色资料（含启动页从本机库 prime 进来的）先把名字给出来：
 * 通讯录首帧就能按名字排好序，不再先空着、名字陆续到了再整列表跳一次。
 */
function memoryNames(ids: string[]): Record<string, string> {
  const names: Record<string, string> = {};
  for (const characterId of ids) {
    const hit = api.peek(
      CharacterEndpoints.getProfile,
      { params: { characterId } },
      { allowStale: true },
    );
    if (hit) names[characterId] = hit.value.name;
  }
  return names;
}
export function useCharacterNames(ids: string[]) {
  const { session } = useAuth();
  const userId = session?.user.userId;
  const sessionId = session?.session.sessionId;
  const ownerKey = `${userId}:${sessionId}`;
  const [state, setState] = useState<{ ownerKey: string; names: Record<string, string> }>({
    ownerKey,
    names: {},
  });
  const signature = JSON.stringify([...new Set(ids)].sort());
  useEffect(() => {
    let active = true;
    if (!userId || !sessionId) return;
    const owner = { userId, sessionId };
    const remember = (id: string, name: string) =>
      setState((previous) => ({
        ownerKey,
        names: { ...(previous.ownerKey === ownerKey ? previous.names : {}), [id]: name },
      }));
    const targets = JSON.parse(signature) as string[];
    void (async () => {
      for (let offset = 0; offset < targets.length; offset += 4) {
        if (!active) return;
        await Promise.all(
          targets.slice(offset, offset + 4).map(async (characterId) => {
            try {
              const cached = await api
                .cached(CharacterEndpoints.getProfile, {
                  params: { characterId },
                })
                .catch(() => undefined);
              if (!active || !api.owns(owner)) return;
              if (cached) remember(characterId, cached.name);
              const profile = await loadCharacterProfile(characterId, owner);
              if (active && api.owns(owner)) remember(characterId, profile.name);
            } catch {
              /* 离线或已不可见的角色仍保留通讯录入口。 */
            }
          }),
        );
      }
    })();
    return () => {
      active = false;
    };
  }, [signature, userId, sessionId, ownerKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- signature 已涵盖 ids 的内容
  const seeded = useMemo(() => memoryNames(JSON.parse(signature) as string[]), [signature, ownerKey]);
  return state.ownerKey === ownerKey ? { ...seeded, ...state.names } : seeded;
}
