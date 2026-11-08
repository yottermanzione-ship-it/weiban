import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_RECORD, guideSeen } from '../src/features/guide-triggers.js';
import { readGuideRecord, seenChapters, writeGuideRecord } from '../src/features/guide-record.js';

afterEach(() => vi.unstubAllGlobals());
describe('操作引导本机旧记录兼容与合并', () => {
  it('旧版中途关闭、已完成都导入为已见，不会因缺shown重新自动弹出', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ completed: ['scenario'], paused: 'miniapps' }),
    });
    const record = readGuideRecord('test');
    expect(seenChapters(record)).toEqual(['scenario', 'miniapps']);
    expect(guideSeen(record, 'miniapps')).toBe(true);
  });
  it('较早页面保存不会抹掉另一页面已看标记；重置学习进度也不重新开启自动提示', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key),
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const stale = readGuideRecord('a');
    writeGuideRecord('a', { ...EMPTY_RECORD, completed: ['scenario'], shown: ['miniapps'] });
    const saved = writeGuideRecord('a', { ...stale, shown: ['ecology'] });
    expect(saved.shown).toEqual(['scenario', 'miniapps', 'ecology']);
    const reset = writeGuideRecord('a', { ...saved, completed: [], paused: null });
    expect(reset.completed).toEqual([]);
    expect(reset.shown).toEqual(saved.shown);
    expect(readGuideRecord('b').shown).toEqual([]);
  });
  it('本机不可读写时仍保留当前会话记录，不阻塞手动学习', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('unavailable');
      },
      setItem: () => {
        throw new Error('unavailable');
      },
    });
    expect(writeGuideRecord('a', { ...EMPTY_RECORD, paused: 'ecology' }).shown).toEqual([
      'ecology',
    ]);
  });
});
