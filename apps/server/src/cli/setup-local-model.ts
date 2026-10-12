/**
 * 本机部署一键开聊（说明见 docs/backend/local-model-setup.md）。可重复执行。
 *
 *   开发：pnpm setup:local-model [-- --admin <管理员用户名>] [--probe]
 *   生产镜像：node dist/setup-local-model.js [--admin <管理员用户名>] [--probe]
 *
 * 以已有管理员为操作人，走 billing / model-access 服务层：
 * 1. 价目表：当前生效版本若没有 MiMo 价格，复制其全部价格 + MiMo 暂定价，发布为新版本（旧版自动停用）。
 * 2. 模型目录：登记 / 更新 xiaomi/mimo-v2.6-flash（指向名为 mimo 的上游），设为 chat/background/vision/planner 默认。
 * 3. 余额：给每个正常状态的普通用户加 50 元（固定幂等键，重复执行只加一次；写审计）。
 * 4. --probe：用第一个普通用户经模型网关真实调用一次（chat_reply，极少费用）；失败时直连上游取原始错误（不输出密钥）。
 * 不创建账号，不打印密钥。
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { ModelGatewayPort } from '@weiban/contracts';
import { AppModule } from '../app.module.js';
import { BillingAdminService, PriceService } from '../modules/billing/index.js';
import { IdentityCommands } from '../modules/identity/index.js';
import {
  CatalogService,
  MODEL_GATEWAY_PORT,
  UpstreamService,
} from '../modules/model-access/index.js';
import { loadLocalEnv } from '../platform/config/local-env.js';
import { NestPinoLogger } from '../platform/logging/nest-logger.js';
import { createLogger, loadConfig, newId } from '../platform/index.js';

const MODEL_KEY = 'xiaomi/mimo-v2.6-flash';
const UPSTREAM_MODEL_ID = 'mimo-v2.6-flash';
const UPSTREAM_NAME = 'mimo';
const PRICE_LABEL = 'local-mimo-v1';
/** 暂定价（元 / 百万 token），售价 = 成本，取 model-catalog.md 4.1 便宜档 deepseek-flash 高峰价；后台可改。 */
const PRICE = { input: 2, cached: 2, output: 8 };
const GRANT_MICROS = 50_000_000;
const GRANT_KEY = 'local-setup-grant-50-v1';

const yuan = (n: number) => Math.round(n * 1_000_000);
const out = (line: string) => process.stdout.write(`${line}\n`);

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const adminIndex = args.indexOf('--admin');
  const adminName = adminIndex >= 0 ? args[adminIndex + 1] : undefined;
  loadLocalEnv();
  const config = loadConfig();
  const logger = createLogger({ level: 'warn' });
  const app = await NestFactory.createApplicationContext(
    AppModule.forRoot({ config, logger, background: false }),
    { logger: new NestPinoLogger(logger) },
  );
  try {
    const identity = app.get(IdentityCommands, { strict: false });
    const prices = app.get(PriceService, { strict: false });
    const catalog = app.get(CatalogService, { strict: false });
    const upstreamService = app.get(UpstreamService, { strict: false });
    const billingAdmin = app.get(BillingAdminService, { strict: false });
    const adminId = await identity.findAdminId(adminName);

    // 1. 上游
    const upstream = (await upstreamService.list()).find((u) => u.name === UPSTREAM_NAME);
    if (!upstream) throw new Error(`找不到名为 ${UPSTREAM_NAME} 的上游，请先在管理后台录入`);
    out(`上游：${upstream.name} ${upstream.upstreamId}（${upstream.status}）`);

    // 2. 价目表
    const versions = await prices.list();
    const active = versions.find((v) => v.status === 'active');
    if (active?.items.some((i) => i.modelKey === MODEL_KEY)) {
      out(`价目表：生效版本 ${active.versionLabel} 已含 ${MODEL_KEY}，跳过`);
    } else {
      const items = [
        ...(active?.items ?? []).map((i) => ({
          modelKey: i.modelKey,
          unit: i.unit,
          priceMicros: i.priceMicros,
          costMicros: i.costMicros,
          band: i.band ?? null,
        })),
        ...(
          [
            ['input_tokens_per_million', PRICE.input],
            ['cached_input_tokens_per_million', PRICE.cached],
            ['output_tokens_per_million', PRICE.output],
          ] as const
        ).map(([unit, p]) => ({
          modelKey: MODEL_KEY,
          unit,
          priceMicros: yuan(p),
          costMicros: yuan(p),
          band: null,
        })),
      ];
      const note = `MiMo V2.6 Flash 暂定价（便宜档参考价，未核实），基于 ${active?.versionLabel ?? '空'}`;
      const draft = versions.find((v) => v.versionLabel === PRICE_LABEL && v.status === 'draft');
      const version = draft
        ? await prices.updateDraft(adminId, draft.priceVersionId, { note, items })
        : await prices.createDraft(adminId, { versionLabel: PRICE_LABEL, note, items });
      await prices.activate(adminId, version.priceVersionId, null);
      out(`价目表：已发布 ${PRICE_LABEL}（${items.length} 条价格）`);
    }

    // 3. 模型目录
    const existing = (await catalog.adminList()).find((m) => m.modelKey === MODEL_KEY);
    await catalog.upsert(adminId, MODEL_KEY, {
      modelKey: MODEL_KEY,
      displayName: 'MiMo V2.6 Flash',
      vendorName: '小米',
      upstreamId: upstream.upstreamId,
      upstreamModelId: UPSTREAM_MODEL_ID,
      capabilities: ['vision'],
      tags: existing?.tags ?? [],
      leaderboardRank: existing?.leaderboardRank ?? null,
      sortOrder: existing?.sortOrder ?? 0,
      defaultFor: ['chat', 'background', 'vision', 'planner'],
      enabled: true,
    });
    out(
      `模型目录：${existing ? '已更新' : '已登记'} ${MODEL_KEY}（启用，默认 chat/background/vision/planner）`,
    );

    // 4. 余额
    const regular = await identity.listActiveRegularUsers();
    if (regular.length === 0) out('余额：没有正常状态的普通用户');
    for (const u of regular) {
      const entry = await billingAdmin.adjust(adminId, u.id, {
        direction: 'grant',
        amountMicros: GRANT_MICROS,
        reason: '本机部署开聊：初始体验余额 50 元',
        idempotencyKey: GRANT_KEY,
      });
      out(`余额：${u.username} +50 元（流水 ${entry.entryId}，重复执行不重复加）`);
    }

    // 5. 真实调用
    if (args.includes('--probe')) {
      const user = regular[0];
      if (!user) throw new Error('没有普通用户，无法做真实调用');
      const gateway = app.get<ModelGatewayPort>(MODEL_GATEWAY_PORT, { strict: false });
      const result = await gateway.generateText({
        userId: user.id,
        purpose: 'chat_reply',
        billingOwner: 'user',
        modelRole: 'chat',
        messages: [{ role: 'user', content: '你好，用一句话介绍你自己。' }],
        maxOutputTokens: 200,
        idempotencyKey: `local-setup-probe-${newId()}`,
      });
      if (result.ok) {
        out(
          `真实调用：成功（${result.value.modelKey}，${result.value.latencyMs}ms，输入 ${result.value.usage.inputTokens} / 输出 ${result.value.usage.outputTokens} token，扣 ${result.value.chargedMicros} 微元，用户 ${user.username}）`,
        );
        out(`回复：${result.value.text.slice(0, 200)}`);
      } else {
        out(`真实调用：网关返回 ${result.error}，直连上游取原始错误……`);
        const raw = await upstreamService.withApiKey(upstream.upstreamId, async (key) => {
          const res = await fetch(`${upstream.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: UPSTREAM_MODEL_ID,
              messages: [{ role: 'user', content: '你好' }],
              max_tokens: 20,
            }),
            signal: AbortSignal.timeout(30000),
          });
          return `HTTP ${res.status} ${(await res.text()).slice(0, 800)}`;
        });
        out(`上游原始响应：${raw.split(upstream.upstreamId).join('[id]')}`);
        process.exitCode = 3;
      }
    }
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `本机开聊设置失败：${error instanceof Error ? error.message : '未知错误'}\n`,
  );
  process.exitCode = 1;
});
