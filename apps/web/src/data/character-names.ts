import { useEffect, useState } from 'react';
import { CharacterEndpoints } from '@weiban/contracts';
import { api } from './client.js';
export function useCharacterNames(ids: string[]) {
  const [names, setNames] = useState<Record<string, string>>({});
  const signature = JSON.stringify([...new Set(ids)].sort());
  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    const targets = JSON.parse(signature) as string[];
    void (async () => {
      for (let offset = 0; offset < targets.length; offset += 4) {
        if (!active) return;
        await Promise.all(
          targets.slice(offset, offset + 4).map(async (characterId) => {
            try {
              const profile = await api.call(CharacterEndpoints.getProfile, {
                params: { characterId },
                signal: abort.signal,
              });
              if (active) setNames((previous) => ({ ...previous, [characterId]: profile.name }));
            } catch {
              /* 离线或已不可见的角色仍保留通讯录入口。 */
            }
          }),
        );
      }
    })();
    return () => {
      active = false;
      abort.abort();
    };
  }, [signature]);
  return names;
}
