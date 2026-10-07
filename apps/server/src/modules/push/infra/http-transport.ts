import { Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { Agent, request } from 'node:https';
import { isPublicPushAddress } from './endpoint-policy.js';

export const PUSH_HTTP = Symbol('weiban.push.http');
export interface PushHttpRequest {
  url: URL;
  headers: Record<string, string | number>;
  body: string | Buffer;
}
export interface PushHttpPort {
  post(input: PushHttpRequest): Promise<{ status: number; body: string }>;
}

/** 固定 HTTPS 主机、公共地址、TLS 主机校验；无重定向，DNS与回包共用1.5秒预算。 */
@Injectable()
export class PushHttpTransport implements PushHttpPort {
  async post(input: PushHttpRequest): Promise<{ status: number; body: string }> {
    if (input.url.protocol !== 'https:') throw new Error('push_https_required');
    const started = performance.now();
    let dnsTimer: ReturnType<typeof setTimeout> | undefined;
    const addresses = await Promise.race([
      lookup(input.url.hostname, { all: true }),
      new Promise<never>((_resolve, reject) => {
        dnsTimer = setTimeout(() => reject(new Error('push_dns_timeout')), 1000);
      }),
    ]).finally(() => clearTimeout(dnsTimer));
    if (!addresses.length || addresses.some((a) => !isPublicPushAddress(a.address)))
      throw new Error('push_private_address');
    const address = addresses[0]!;
    const agent = new Agent({
      keepAlive: false,
      lookup: (_host, _options, callback) => callback(null, address.address, address.family),
    });
    try {
      return await new Promise((resolve, reject) => {
        const req = request(
          input.url,
          { method: 'POST', headers: input.headers, agent, family: address.family },
          (response) => {
            const chunks: Buffer[] = [];
            let length = 0;
            response.on('data', (chunk: Buffer) => {
              length += chunk.length;
              if (length > 4096) req.destroy(new Error('push_response_too_large'));
              else chunks.push(chunk);
            });
            response.on('error', reject);
            response.on('aborted', () => reject(new Error('push_response_aborted')));
            response.on('end', () =>
              resolve({
                status: response.statusCode ?? 0,
                body: Buffer.concat(chunks).toString('utf8'),
              }),
            );
          },
        );
        const timer = setTimeout(
          () => req.destroy(new Error('push_request_timeout')),
          Math.max(1, 1500 - (performance.now() - started)),
        );
        req.on('error', reject);
        req.on('close', () => clearTimeout(timer));
        req.end(input.body);
      });
    } finally {
      agent.destroy();
    }
  }
}
