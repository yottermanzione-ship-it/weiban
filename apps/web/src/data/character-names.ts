import { useEffect, useState } from 'react';
import { CharacterEndpoints } from '@weiban/contracts';
import { api } from './client.js';
import { useAuth } from '../app/auth.js';
import { loadCharacterProfile } from './character-profile.js';
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
  return state.ownerKey === ownerKey ? state.names : {};
}
