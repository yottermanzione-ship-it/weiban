/** H3（契约 3.29）：私密模式的安全关怀——平台付费，但仍用该用户的私密模式模型。 */
import { describe, expect, it, vi } from 'vitest';
import { ModelGateway } from './gateway.js';
import { ModelResolver } from './resolver.js';
import type { CatalogService } from './catalog.js';
import type { ScenarioService } from './scenarios.js';
import type { ModelPolicy } from '../tokens.js';

const USER = '00000000-0000-4000-8000-000000000001';
const CHAR = '00000000-0000-4000-8000-000000000002';
const CONV = '00000000-0000-4000-8000-000000000003';
const base = {
  userId: USER,
  characterId: CHAR,
  conversationId: CONV,
  messages: [{ role: 'user' as const, content: '…' }],
  idempotencyKey: 'k',
};

describe('平台端口：私密关怀', () => {
  function gateway() {
    const gw = Object.create(ModelGateway.prototype) as ModelGateway;
    const generateText = vi.fn().mockResolvedValue({ ok: false, error: 'not_configured' });
    Object.assign(gw, { generateText });
    return { gw, generateText };
  }

  it('safety_check / safety_followup + adult：平台付费、保留私密模型角色、可信平台调用', async () => {
    const { gw, generateText } = gateway();
    await gw.generatePlatformText({
      ...base,
      purpose: 'safety_followup',
      modelRole: 'adult',
      maxOutputTokens: 900,
    });
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        billingOwner: 'platform',
        modelRole: 'adult',
        purpose: 'safety_followup',
        maxOutputTokens: 400,
      }),
      { trustedPlatform: true },
    );
  });

  it('其它用途或缺会话不允许借私密模型；普通安全检查仍用平台内部模型', async () => {
    const { gw, generateText } = gateway();
    expect(
      await gw.generatePlatformText({ ...base, purpose: 'small_v', modelRole: 'adult' }),
    ).toEqual({ ok: false, error: 'bad_request' });
    const { conversationId: _c, ...noConversation } = base;
    void _c;
    expect(
      await gw.generatePlatformText({
        ...noConversation,
        purpose: 'safety_check',
        modelRole: 'adult',
      }),
    ).toEqual({ ok: false, error: 'bad_request' });
    await gw.generatePlatformText({ ...base, purpose: 'safety_check', modelRole: 'chat' });
    expect(generateText).toHaveBeenCalledOnce();
    expect(generateText.mock.calls[0]![0]).toMatchObject({ modelRole: 'background' });
  });
});

describe('解析：私密关怀按用户的「私密模式」场景选模型', () => {
  const entry = {
    modelKey: 'private-model',
    upstreamId: 'u1',
    upstreamModelId: 'm1',
    enabled: true,
    capabilities: ['vision', 'adult_content'],
    systemMessageMode: 'system',
  };
  function resolver(allowed = true) {
    const pick = vi.fn().mockResolvedValue({
      facts: { modelKey: 'private-model', entry, upstreamStatus: 'active' },
      source: 'user',
    });
    const internalModel = vi.fn();
    const checkModelForCharacter = vi.fn().mockResolvedValue({ allowed });
    const r = new ModelResolver(
      { internalModel } as unknown as CatalogService,
      { pick } as unknown as ScenarioService,
      { checkModelForCharacter } as unknown as ModelPolicy,
    );
    return { r, pick, internalModel, checkModelForCharacter };
  }

  it('平台任务 + adult + 安全用途：用私密模式场景的模型（允许成人模型，仍过角色资格）', async () => {
    const { r, pick, internalModel, checkModelForCharacter } = resolver();
    const out = await r.resolve({
      userId: USER,
      characterId: CHAR,
      modelRole: 'adult',
      purpose: 'safety_followup',
      platformTask: true,
    });
    expect(out).toMatchObject({ ok: true, value: { modelKey: 'private-model' } });
    expect(pick).toHaveBeenCalledWith(USER, 'private', CHAR);
    expect(internalModel).not.toHaveBeenCalled();
    expect(checkModelForCharacter).toHaveBeenCalled();
  });

  it('角色没有私密资格时拒绝', async () => {
    const { r } = resolver(false);
    expect(
      await r.resolve({
        userId: USER,
        characterId: CHAR,
        modelRole: 'adult',
        purpose: 'safety_check',
        platformTask: true,
      }),
    ).toEqual({ ok: false, error: 'model_not_allowed' });
  });
});
