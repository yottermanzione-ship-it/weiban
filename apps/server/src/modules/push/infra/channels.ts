import { Inject, Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import webpush from 'web-push';
import { RegisterPushDeviceRequest, type NotificationEnvelope } from '@weiban/contracts';
import { APP_CONFIG, AppError, ConfigError, type AppConfig } from '../../../platform/index.js';
import { notificationTopic } from '../domain/notification-rules.js';
import { validateWebPushEndpoint } from './endpoint-policy.js';
import { PUSH_HTTP, type PushHttpPort } from './http-transport.js';

const credentialSchema = z.object({
  webpush: z
    .object({
      subject: z.string().regex(/^(mailto:|https:\/\/)/),
      publicKey: z.string(),
      privateKey: z.string(),
    })
    .optional(),
  jpush: z.object({ appKey: z.string().min(1), masterSecret: z.string().min(1) }).optional(),
});
export type PushEnvelope = NotificationEnvelope;
export type ChannelResult =
  | 'accepted'
  | 'invalid_device'
  | 'temporary_failure'
  | 'unconfigured'
  | { status: 'accepted'; providerMessageId: string };
export interface PushChannelOptions {
  previousMessageId?: string;
}
export const PUSH_CHANNELS = Symbol('weiban.push.channels');
export interface PushChannelPort {
  publicKey(): string | null;
  validate(device: RegisterPushDeviceRequest): void;
  send(
    device: RegisterPushDeviceRequest,
    envelope: PushEnvelope,
    options?: PushChannelOptions,
  ): Promise<ChannelResult>;
}

@Injectable()
export class PushChannels implements PushChannelPort {
  private readonly credentials: z.infer<typeof credentialSchema>;
  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(PUSH_HTTP) private readonly http: PushHttpPort,
  ) {
    try {
      this.credentials = config.push.credentialsFile
        ? credentialSchema.parse(JSON.parse(readFileSync(config.push.credentialsFile, 'utf8')))
        : {};
      if (this.credentials.webpush) {
        const v = this.credentials.webpush;
        // 用库做密钥检查，不修改全局VAPID状态；不向外发请求。
        webpush.getVapidHeaders(
          'https://fcm.googleapis.com',
          v.subject,
          v.publicKey,
          v.privateKey,
          'aes128gcm',
        );
      }
    } catch {
      throw new ConfigError(['PUSH_CREDENTIALS_FILE：推送凭据文件无效']);
    }
  }
  publicKey() {
    return this.credentials.webpush?.publicKey ?? null;
  }
  validate(device: RegisterPushDeviceRequest): void {
    if (device.kind === 'webpush') {
      validateWebPushEndpoint(device.subscription.endpoint);
      const { p256dh, auth } = device.subscription.keys;
      if (
        !/^[A-Za-z0-9_-]+={0,2}$/.test(p256dh) ||
        !/^[A-Za-z0-9_-]+={0,2}$/.test(auth) ||
        Buffer.from(p256dh, 'base64url').length !== 65 ||
        Buffer.from(auth, 'base64url').length !== 16
      )
        throw new AppError('bad_request', '无效浏览器推送凭证');
      if (!this.credentials.webpush) throw new AppError('service_unavailable', '网页推送尚未配置');
      try {
        webpush.generateRequestDetails(device.subscription, '', {
          vapidDetails: this.credentials.webpush,
        });
      } catch {
        throw new AppError('bad_request', '无效浏览器推送凭证');
      }
    } else if (device.provider !== 'jpush' || !this.credentials.jpush) {
      throw new AppError('service_unavailable', '该安卓推送通道尚未配置');
    }
  }
  async send(
    device: RegisterPushDeviceRequest,
    envelope: PushEnvelope,
    options: PushChannelOptions = {},
  ): Promise<ChannelResult> {
    try {
      if (device.kind === 'webpush') return await this.sendWeb(device, envelope);
      if (device.provider !== 'jpush' || !this.credentials.jpush) return 'unconfigured';
      const credentials = this.credentials.jpush;
      // 厂商离线系统通知可能在退出后到达：系统层固定通用文案，正文只放受owner校验的extras。
      const response = await this.http.post({
        url: new URL('https://api.jpush.cn/v3/push'),
        headers: {
          'content-type': 'application/json',
          authorization: `Basic ${Buffer.from(`${credentials.appKey}:${credentials.masterSecret}`).toString('base64')}`,
        },
        body: jpushBody(
          {
            platform: ['android'],
            audience: { registration_id: [device.token] },
            notification: {
              android: {
                alert: '你有新的微伴消息',
                title: '微伴',
                alert_type: envelope.sound ? 7 : 0,
                extras: { weiban: envelope },
              },
            },
            options: { time_to_live: 60 },
          },
          options.previousMessageId,
        ),
      });
      if (response.status >= 200 && response.status < 300) {
        // 按原始十进制读取厂商long，避免JSON.parse的浮点精度损失。
        const id = /"msg_id"\s*:\s*(?:"([0-9]{1,19})"|([0-9]{1,19})(?=\s*[,}]))/.exec(
          response.body,
        );
        const value = id?.[1] ?? id?.[2];
        return value && validMessageId(value)
          ? { status: 'accepted', providerMessageId: value }
          : 'accepted';
      }
      // 不记录厂商回包；单个registration-ID无目标的错误码为1011。
      const body = JSON.parse(response.body) as { error?: { code?: number } };
      return body?.error?.code === 1011 ? 'invalid_device' : 'temporary_failure';
    } catch {
      return 'temporary_failure';
    }
  }
  private async sendWeb(
    device: Extract<RegisterPushDeviceRequest, { kind: 'webpush' }>,
    envelope: PushEnvelope,
  ): Promise<ChannelResult> {
    const vapid = this.credentials.webpush;
    if (!vapid) return 'unconfigured';
    const url = validateWebPushEndpoint(device.subscription.endpoint);
    const details = webpush.generateRequestDetails(device.subscription, JSON.stringify(envelope), {
      vapidDetails: vapid,
      TTL: 60,
      urgency: 'high',
      topic: notificationTopic(envelope.collapseKey),
    });
    const response = await this.http.post({ url, headers: details.headers, body: details.body });
    return response.status >= 200 && response.status < 300
      ? 'accepted'
      : response.status === 404 || response.status === 410
        ? 'invalid_device'
        : 'temporary_failure';
  }
}

function validMessageId(value: string): boolean {
  return /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
}
function jpushBody(
  value: { options: { time_to_live: number } } & Record<string, unknown>,
  previous?: string,
): string {
  if (!previous || !validMessageId(previous)) return JSON.stringify(value);
  // 官方override_msg_id为long；先验证再输出数值，不能转为JS number或发成字符串。
  return JSON.stringify({
    ...value,
    options: { ...value.options, override_msg_id: previous },
  }).replace(`"override_msg_id":"${previous}"`, `"override_msg_id":${previous}`);
}
