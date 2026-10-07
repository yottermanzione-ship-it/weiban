import { expect, it } from 'vitest';
import cases from './fixtures/avatars.json' with { type: 'json' };
import { avatarLetters, avatarPaletteIndex, avatarForeground } from '../src/index.js';
it.each(cases.names)('头像同源规则：$name → $text / 盘 $paletteIndex', (sample) => {
  expect(avatarLetters(sample.name, sample.override)).toBe(sample.text);
  expect(avatarPaletteIndex(sample.characterId)).toBe(sample.paletteIndex);
});
it.each(cases.colors)('应援色 $background 选高对比字色 $foreground', (sample) => {
  expect(avatarForeground(sample.background)).toBe(sample.foreground);
});
it('非法应援色不参与绘制', () => {
  expect(() => avatarForeground('red')).toThrow('Invalid avatar color');
});
