import type { CallAgentPort } from '@weiban/contracts';

/** 契约 CallSessionPort（ai-runtime 发起来电、查进行中的通话）。 */
export const CALL_SESSION_PORT = Symbol('weiban.calls.session');
/**
 * 契约 CallAgentPort：ai-runtime 实现（T-072），由装配入口（app.module.ts）绑定；calls 不 import ai-runtime。
 * 未绑定时通话视为未开通（availability = service_disabled）。
 */
export const CALL_AGENT_PORT = Symbol('weiban.calls.agent');
export type { CallAgentPort };
/**
 * 平台语音服务是否开通（MED-06 第 11 条）。由装配入口绑定到模型网关 ModelGatewayMediaPort.isServiceEnabled
 * （语音识别与语音合成都开通才可通话）。未绑定时只看 CALL_AGENT_PORT 是否存在。
 */
export const CALL_SERVICE_STATUS = Symbol('weiban.calls.service-status');
export interface CallServiceStatus {
  isVoiceCallEnabled(): Promise<boolean>;
  /**
   * V2（2026-10-28）：这个用户给这个角色打实时语音 / Omni 电话时有没有声音可用（没有绑定、没有样本或复刻失败、
   * 也没有模型默认音色）。返回给用户看的说明；null = 可以打（含级联通话）。可选：未绑定时按可以打处理。
   * 装配入口绑定到模型网关；拨打前检查，避免接通后才失败、只显示「网络中断」。
   */
  voiceCallBlocker?(userId: string, characterId: string): Promise<string | null>;
}
