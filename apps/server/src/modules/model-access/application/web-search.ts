/** 所有联网搜索走真实搜索协议，不让文本模型编造网页结果。 */
import { Inject, Injectable } from '@nestjs/common';
import type { GatewayWebSearchInput, ModelGatewayMediaPort } from '@weiban/contracts';
import { ModelGatewayMedia } from './media-gateway.js';

export type WebSearchProvider = Pick<ModelGatewayMediaPort, 'webSearch'>;
@Injectable()
export class GatewayWebSearchProvider implements WebSearchProvider {
  constructor(@Inject(ModelGatewayMedia) private readonly media: ModelGatewayMedia) {}
  webSearch(input: GatewayWebSearchInput) {
    return this.media.webSearch(input);
  }
}
