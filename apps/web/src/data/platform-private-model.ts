/*
 * 平台固定私密模型（用户不可选）。
 *
 * 权威源只有一个：ModelAccessEndpoints.privateModel（GET /api/v1/model/private-model）。
 * 这里只做读取与类型透传，不读取用户的 adult / private 选择，也不再乘一次折扣：
 * 接口返回的 displayMultiplier 已经包含进行中的折扣，discountRate 只用于文案。
 */
import type { PrivateModelInfo } from '@weiban/contracts';
import { ModelAccessEndpoints } from '@weiban/contracts';
import { api } from './client.js';

export type PlatformPrivateModel = PrivateModelInfo;

/**
 * 读取平台固定私密模型；未配置时接口稳定返回 { model: null }。
 * 网络/解析失败时抛错，由调用方按「暂不可用」处理；不退回用户或角色自己的模型。
 */
export async function loadPlatformPrivateModel(): Promise<PlatformPrivateModel | null> {
  const { model } = await api.call(ModelAccessEndpoints.privateModel, { networkOnly: true });
  return model;
}
