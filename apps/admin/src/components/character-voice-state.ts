import type { AdminVoice } from '@weiban/contracts';

export interface CharacterVoiceBinding {
  voiceId: string | null;
  voiceName: string | null;
}

/** 两份独立数据：目录失败不能抹掉已经读到的角色绑定；失败也不等于未设置。 */
export async function loadCharacterVoiceState(
  list: () => Promise<{ items: AdminVoice[] }>,
  current: () => Promise<CharacterVoiceBinding>,
) {
  const [catalog, binding] = await Promise.allSettled([list(), current()]);
  return {
    voices: catalog.status === 'fulfilled' ? catalog.value.items : [],
    binding: binding.status === 'fulfilled' ? binding.value : null,
    catalogError: catalog.status === 'rejected' ? { cause: catalog.reason as unknown } : null,
    bindingError: binding.status === 'rejected' ? { cause: binding.reason as unknown } : null,
    ready: catalog.status === 'fulfilled' && binding.status === 'fulfilled',
  };
}
