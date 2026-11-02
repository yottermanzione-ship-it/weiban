import { describe, expect, it } from 'vitest';
import { detectFormSuppressions } from './chat-form-suppression.js';

describe('会话压制：只认明确说出来的话，只压说的那一种', () => {
  it('「别发表情包了」只压表情包', () => {
    const { suppressed } = detectFormSuppressions(['别发表情包了']);
    expect([...suppressed]).toEqual(['sticker']);
  });
  it('「不要发语音」只压语音，「别拍我」只压拍一拍', () => {
    expect([...detectFormSuppressions(['不要发语音']).suppressed]).toEqual(['voice']);
    expect([...detectFormSuppressions(['别拍我']).suppressed]).toEqual(['nudge']);
  });
  it('含糊的话不猜：不想说话、今天好累都不压制', () => {
    expect(detectFormSuppressions(['今天不想说话']).suppressed.size).toBe(0);
    expect(detectFormSuppressions(['好累，不想理人']).suppressed.size).toBe(0);
    expect(detectFormSuppressions(['表情包好丑']).suppressed.size).toBe(0);
  });
  it('后来明确要了就恢复，只恢复那一种', () => {
    const { suppressed } = detectFormSuppressions(['别发表情包了', '不要发语音', '发个表情包']);
    expect([...suppressed]).toEqual(['voice']);
  });
  it('「别发语音，发个表情包」各管各的：语音压着，表情包不压', () => {
    const { suppressed } = detectFormSuppressions(['别发语音，发个表情包']);
    expect([...suppressed]).toEqual(['voice']);
  });
  it('「别发语音」这句话本身不因含有「发语音」而恢复', () => {
    expect([...detectFormSuppressions(['别发语音']).suppressed]).toEqual(['voice']);
  });
  it('压制可检查：返回触发原话与位置', () => {
    const { reasons } = detectFormSuppressions(['你好', '别拍我了', '哈哈']);
    expect(reasons).toEqual([{ form: 'nudge', text: '别拍我了', index: 1 }]);
  });
  it('拍一拍请求恢复压制', () => {
    const { suppressed } = detectFormSuppressions(['别拍我', '拍拍我']);
    expect(suppressed.size).toBe(0);
  });
});
