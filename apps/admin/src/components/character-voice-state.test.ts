import { expect, it } from 'vitest';
import { loadCharacterVoiceState } from './character-voice-state.js';

const bound = { voiceId: '11111111-1111-4111-8111-111111111111', voiceName: '已有测试声音' };

it('目录失败仍保留成功读取的默认绑定，禁止把错误当未指定', async () => {
  const error = new Error('目录第376项名称超限');
  const state = await loadCharacterVoiceState(
    () => Promise.reject(error),
    () => Promise.resolve(bound),
  );
  expect(state.binding).toEqual(bound);
  expect(state.catalogError?.cause).toBe(error);
  expect(state.bindingError).toBeNull();
  expect(state.ready).toBe(false);
});

it('绑定读取失败不伪造未设置，也不允许保存或清除', async () => {
  const state = await loadCharacterVoiceState(
    () => Promise.resolve({ items: [] }),
    () => Promise.reject(new Error('读取失败')),
  );
  expect(state.binding).toBeNull();
  expect(state.bindingError).not.toBeNull();
  expect(state.ready).toBe(false);
});

it('只有成功读取真实空绑定时才显示未指定并允许操作', async () => {
  const state = await loadCharacterVoiceState(
    () => Promise.resolve({ items: [] }),
    () => Promise.resolve({ voiceId: null, voiceName: null }),
  );
  expect(state.binding).toEqual({ voiceId: null, voiceName: null });
  expect(state.catalogError).toBeNull();
  expect(state.bindingError).toBeNull();
  expect(state.ready).toBe(true);
});
