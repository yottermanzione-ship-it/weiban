import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ALL_SCENARIOS, CatalogService } from '../src/modules/model-access/testing.js';
import { ScenarioService } from '../src/modules/model-access/testing.js';
import { bestArenaRanks, parseLeaderboard } from '../src/modules/model-access/testing.js';

describe('web feedback catalog behavior', () => {
  it('keeps raw thinking variants on import and only merges matching ranks', () => {
    const entries = parseLeaderboard(
      'rank,model\n8,Example Pro (Low)\n2,Example Pro (High)\n5,Example Flash (High)',
    );
    expect(entries).toHaveLength(3);
    expect([...bestArenaRanks(entries)]).toEqual([
      ['example pro', 2],
      ['example flash', 5],
    ]);
  });
  it('uses the best current snapshot rank and keeps previous snapshot separate', async () => {
    const rank = await CatalogService.prototype.arenaRanks.call({
      leaderboardSnapshot: async () => ({
        entries: [
          { name: 'Model (High)', rank: 2 },
          { name: 'Model (Low)', rank: 30 },
        ],
        previousEntries: [{ name: 'Model (High)', rank: 8 }],
      }),
    } as never);
    expect(rank.rankOf('Model')).toBe(2);
    expect(rank.rankOf('Model Pro')).toBeNull();
    expect(rank.previousRankOf('Model')).toBe(8);
  });
  it('reports official publication date, not fetch date, alongside popularity', async () => {
    const popular = [{ modelKey: 'test/model', users: 3 }];
    const result = await CatalogService.prototype.leaderboardInfo.call({
      leaderboardSource: async () => ({
        label: 'Arena',
        url: 'https://arena.ai/leaderboard/chat/text',
        asOf: '2026-01-01',
      }),
      leaderboardSnapshot: async () => ({
        fetchedAt: '2026-10-22T10:00:00Z',
        publishedAt: '2026-10-20',
        method: 'fetch',
        entries: [{ name: 'Model', rank: 1 }],
      }),
      database: {
        db: {
          select: () => ({ from: () => ({ where: () => ({ groupBy: async () => popular }) }) }),
        },
      },
    } as never);
    expect(result.source?.asOf).toBe('2026-10-20');
    expect(result.fetchedAt).toBe('2026-10-22T10:00:00Z');
    expect(result.popular).toEqual(popular);
  });
  it('does not expose or route through a legacy photo model selection', async () => {
    expect(ALL_SCENARIOS).not.toContain('image_generation');
    expect(ALL_SCENARIOS).toContain('chat');
    const db = {
      db: {
        select: () => ({
          from: () => ({
            where: async () => [
              { scenario: 'image_generation', modelKey: 'test/old-image' },
              { scenario: 'chat', modelKey: 'test/chat' },
            ],
          }),
        }),
      },
    };
    const catalog = { fact: vi.fn(async () => ({ entry: { modelKey: 'test/chat' } })) };
    const service = new ScenarioService(
      db as never,
      {} as never,
      {} as never,
      catalog as never,
      {} as never,
    );
    expect(await service.pick('user', 'image_generation', null)).toBeNull();
    expect(await service.pick('user', 'chat', null)).not.toBeNull();
    await expect(
      service.updateConfig('user', { image_generation: { modelKey: 'test/old-image' } }),
    ).rejects.toThrow('已取消');
    await expect(
      service.updateCharacter('user', 'character', {
        image_generation: { modelKey: 'test/old-image' },
      }),
    ).rejects.toThrow('已取消');
  });
});
