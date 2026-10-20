import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  GenerateError,
  GenerateTextOutput,
  PortResult,
  GenerateTextInput,
  ModelGatewayPort,
  ModelGatewayPlatformPort,
} from '@weiban/contracts';
import { MODEL_GATEWAY_PORT, MODEL_PLATFORM_GATEWAY_PORT } from '../../model-access/index.js';

/**
 * 私密模式（成人范围）的模型调用入口。
 *
 * 3.25（10-21 试用反馈第三轮 G1-1，docs/refactor/11 C13「10-21 私密模式最终」）：去掉原来的「成人内容检查」
 * 模型调用（回复前后各请一次平台内部模型判断是否涉及未成年人 / 真人）和「检查模型必须走 OpenRouter」的限制。
 * 底线不变，改由零成本的规则保证：
 * - 角色资格（policy：真人、未成年设定 / 儿童外貌 / 检出儿童特征的角色没有私密模式资格；后台可人工标注纠正）；
 * - 私密模式提示词里的两条底线（domain/persona.ts MODES.adult：不涉及未成年人、不涉及真实存在的人）；
 * - 违禁词规则（domain/reply-rules.ts outputAllowed）、仅单角色、私密内容不外流、私密模型需「允许成人内容」标记、
 *   安全关怀优先（关怀中不走私密模式）。
 * 类名保留，调用方（私聊、群聊、主动消息、通话）不用改。
 */
@Injectable()
export class AdultBoundaryService {
  constructor(
    @Inject(MODEL_GATEWAY_PORT) private readonly gateway: ModelGatewayPort,
    @Optional()
    @Inject(MODEL_PLATFORM_GATEWAY_PORT)
    private readonly platform?: ModelGatewayPlatformPort,
  ) {}

  async generate(
    input: GenerateTextInput,
    adult: boolean,
  ): Promise<PortResult<GenerateTextOutput, GenerateError>> {
    void adult;
    if (input.purpose === 'safety_followup')
      return this.platform
        ? this.platform.generatePlatformText({ ...input, purpose: 'safety_followup' })
        : { ok: false, error: 'not_configured' };
    return this.gateway.generateText(input);
  }
}
