/**
 * 外部能力的默认实现（在对应模块 / 契约方法就绪前使用，见 docs/backend/model-access.md 第 2 节）。
 */
import type { PolicyDecision } from '@weiban/contracts';
import type { ModelTextPrices } from '../domain/rules.js';
import type { ModelPolicy, ModelPriceSource } from '../tokens.js';

/**
 * policy 模块（D-L0-11）上线前的无审查模型闸门：**失败即拒绝**。
 * 不知道角色有没有成人资格，所以任何角色都不能用 adult_content 模型；普通模型放行。
 * policy 上线后换成真实实现（tokens.ts 的 MODEL_ACCESS_POLICY），不改调用方。
 */
export class FailClosedModelPolicy implements ModelPolicy {
  checkModelForCharacter(input: {
    userId: string;
    characterId: string;
    modelHasAdultContent: boolean;
  }): Promise<PolicyDecision> {
    return Promise.resolve(
      input.modelHasAdultContent
        ? { allowed: false, reason: 'model_not_allowed' }
        : { allowed: true },
    );
  }
}

/** billing 提供读价目表的端口方法之前：没有价格，档位显示「中等」。 */
export class EmptyPriceSource implements ModelPriceSource {
  textPrices(): Promise<Map<string, ModelTextPrices>> {
    return Promise.resolve(new Map());
  }
}
