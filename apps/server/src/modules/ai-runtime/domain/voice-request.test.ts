import { expect, it } from 'vitest';
import { voiceIntent } from './voice-request.js';
import { detectFormSuppressions } from './chat-form-suppression.js';

it.each([
  '发一句语音说晚安',
  '给我来句语音吧',
  '请给我发段语音',
  '来一条语音',
  '可以用语音回答吗',
  '我想听你的声音',
  '语音回复我',
  '发个语音',
  '回我一条短语音',
  '回复我一句语音吧',
  '请发一条短语音',
  '发给我一段简短的语音',
  '来段短一点的语音',
])('recognizes an explicit voice request: %s', (text) => {
  expect(voiceIntent(text)).toBe('request');
});
it.each([
  '不要发一句语音',
  '别再发语音了',
  '不用语音，打字就好',
  '我不方便听语音',
  '不喜欢你发语音',
  '不要发语音，但发表情包可以',
  '不要回我一条短语音',
])('respects refusal: %s', (text) => {
  expect(voiceIntent(text)).toBe('avoid');
});
it.each([
  '我怎么发语音？',
  '教我发一句语音',
  '我要给你发条语音',
  '我发语音你能听见吗',
  '这里支持语音吗',
  '今天下雨了',
  '我要给你发一条短语音',
  '我给你回一句语音',
  '我回你一条短语音',
  '怎么让你回我一条语音？',
])('does not turn a feature question or self recording into synthesis: %s', (text) => {
  expect(voiceIntent(text)).toBeNull();
});
it('a later explicit request restores only voice; a tutorial does not restore it', () => {
  expect(detectFormSuppressions(['别发语音和照片', '我怎么发语音？']).suppressed.has('voice')).toBe(
    true,
  );
  const result = detectFormSuppressions(['别发语音', '别发照片', '给我来句语音吧']);
  expect([...result.suppressed]).toEqual(['photo']);
});
