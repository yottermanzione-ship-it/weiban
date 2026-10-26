/**
 * 组合通话模型的运维入口（ADR-20261024）：配置 `model_access.settings.voice_call_pipeline`，
 * 可选登记目录条目 `voice/cascade-call`（标签 `pipeline:call`）。只走服务层，不开 HTTP，不打印密钥。
 *
 *   pnpm --filter @weiban/server exec tsx src/cli/voice-call-pipeline.ts --show
 *   pnpm --filter @weiban/server exec tsx src/cli/voice-call-pipeline.ts --set \
 *     --operator-id <管理员用户 ID> --asr asr/sensevoice \
 *     --text deepseek/deepseek-v4.1-flash --tts tts/mimo [--create-entry]
 *
 * 生产（构建后）：node dist/voice-call-pipeline.js --show / --set …
 *
 * --set 在第一次写入之前校验：三个组件都在目录里且启用，上游账号存在（未删除）且不是本机 loopback；
 * 任一不满足就整体失败并列出全部原因，不写入任何设置。--create-entry 只能和 --set 一起用：
 * 组合条目自身不调用上游、没有 token 单价（catalog 对带 pipeline:call 的条目豁免价格检查），
 * 主上游字段镜像文本组件，只为满足目录结构；运行时从设置里取三个组件。
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { AdminCatalogEntry, Upstream } from '@weiban/contracts';
import { AppModule } from '../app.module.js';
import { isActiveMaintenanceAdmin } from '../modules/identity/index.js';
import {
  CatalogService,
  isVoiceCallComposite,
  UpstreamService,
  VOICE_CALL_CASCADE_MODEL_KEY,
  type ModelFacts,
  type VoiceCallPipeline,
} from '../modules/model-access/index.js';
import { loadLocalEnv } from '../platform/config/local-env.js';
import { NestPinoLogger } from '../platform/logging/nest-logger.js';
import { createLogger, DATABASE, loadConfig, type Database } from '../platform/index.js';
import {
  assessVoiceCallPipeline,
  compositeEntryNotes,
  compositeEntryWrite,
  parseVoiceCallPipelineCommand,
  type VoiceCallExistingCompositeEntry,
  type VoiceCallPreparation,
  type VoiceCallSetCommand,
} from './voice-call-pipeline-options.js';

/** 输出 / 退出码约定与 import-legacy-upstreams 一致：成功一行 JSON，失败 {ok:false, code, message}。 */
class VoiceCallPipelineCliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'VoiceCallPipelineCliError';
  }
}

const out = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);

/** 入口读同一次目录事实做前置校验；--show 与 --set 共用。 */
async function prepare(
  catalog: CatalogService,
  upstreams: readonly Upstream[],
  pipeline: VoiceCallPipeline,
): Promise<VoiceCallPreparation> {
  const facts = await catalog.facts([
    pipeline.asrModelKey,
    pipeline.textModelKey,
    pipeline.ttsModelKey,
  ]);
  return assessVoiceCallPipeline({ pipeline, facts, upstreams });
}

/** 非敏感摘要：模型键、显示名、启用状态、标签、场景；不含密钥或上游密文。 */
function entrySummary(entry: {
  modelKey: string;
  displayName: string;
  vendorName: string;
  enabled: boolean;
  scenarios?: readonly string[];
  tags: readonly string[];
}) {
  return {
    modelKey: entry.modelKey,
    displayName: entry.displayName,
    vendorName: entry.vendorName,
    enabled: entry.enabled,
    scenarios: entry.scenarios ?? [],
    tags: entry.tags,
    isComposite: isVoiceCallComposite(entry),
  };
}

function existingFrom(facts: ModelFacts): VoiceCallExistingCompositeEntry | null {
  return facts.entry
    ? {
        tags: facts.entry.tags,
        leaderboardRank: facts.entry.leaderboardRank,
        sortOrder: facts.entry.sortOrder,
      }
    : null;
}

async function show(catalog: CatalogService, upstreams: readonly Upstream[]): Promise<void> {
  const pipeline = await catalog.voiceCallPipeline();
  const composite = await catalog.fact(VOICE_CALL_CASCADE_MODEL_KEY);
  const prepared = pipeline ? await prepare(catalog, upstreams, pipeline) : null;
  const entry = composite.entry;
  // 生产可用 = 设置有效 + 三个组件就绪 + 组合条目已登记、带组合标签且启用；不可用时逐条说明。
  const problems = [...(prepared?.problems ?? [])];
  if (!pipeline) problems.push('voice_call_pipeline 未配置：先执行 --set');
  if (!entry) problems.push('组合条目 voice/cascade-call 未登记：--set 时加 --create-entry');
  else if (!entry.enabled) problems.push('组合条目 voice/cascade-call 已停用');
  else if (!isVoiceCallComposite(entry)) problems.push('组合条目缺少 pipeline:call 标签');
  out({
    ok: true,
    pipeline,
    compositeEntry: entry ? entrySummary(entry) : null,
    components: prepared?.components ?? [],
    problems,
    warnings: prepared?.warnings ?? [],
    notes: entry ? compositeEntryNotes() : [],
    ready: problems.length === 0,
  });
}

async function apply(
  catalog: CatalogService,
  database: Database,
  upstreams: readonly Upstream[],
  command: VoiceCallSetCommand,
): Promise<void> {
  if (!(await isActiveMaintenanceAdmin(database, command.operatorId)))
    throw new VoiceCallPipelineCliError(
      'ACTIVE_ADMIN_REQUIRED',
      '--operator-id 必须是启用状态的管理员用户 ID（写审计用，命令不代建账号）',
    );
  const prepared = await prepare(catalog, upstreams, command.pipeline);
  if (!prepared.ok)
    throw new VoiceCallPipelineCliError(
      'COMPONENTS_UNAVAILABLE',
      '三个组件没有全部就绪，未写入任何设置',
      { problems: prepared.problems },
    );
  const pipeline = await catalog.setVoiceCallPipeline(command.operatorId, command.pipeline);
  let entry: AdminCatalogEntry | null = null;
  if (command.createEntry) {
    // 组合条目没有自己的上游：主上游字段镜像文本组件（运行时只用三个组件，不读这个字段）。
    const textEntry = (await catalog.fact(pipeline.textModelKey)).entry;
    if (!textEntry)
      throw new VoiceCallPipelineCliError(
        'COMPONENTS_UNAVAILABLE',
        '文本组件已不存在，未创建组合条目',
      );
    entry = await catalog.upsert(
      command.operatorId,
      VOICE_CALL_CASCADE_MODEL_KEY,
      compositeEntryWrite({
        upstreamId: textEntry.upstreamId,
        upstreamModelId: textEntry.upstreamModelId,
        existing: existingFrom(await catalog.fact(VOICE_CALL_CASCADE_MODEL_KEY)),
      }),
    );
  }
  out({
    ok: true,
    pipeline,
    compositeEntry: entry ? entrySummary(entry) : null,
    components: prepared.components,
    warnings: prepared.warnings,
    notes: entry ? compositeEntryNotes() : [],
  });
}

async function main(): Promise<void> {
  const parsed = parseVoiceCallPipelineCommand(process.argv.slice(2));
  if (!parsed.ok) throw new VoiceCallPipelineCliError(parsed.code, parsed.message);
  loadLocalEnv();
  const config = loadConfig();
  const logger = createLogger({ level: 'warn' });
  const app = await NestFactory.createApplicationContext(
    AppModule.forRoot({ config, logger, background: false }),
    { logger: new NestPinoLogger(logger) },
  );
  try {
    const catalog = app.get(CatalogService, { strict: false });
    const upstreams = await app.get(UpstreamService, { strict: false }).list();
    if (parsed.command.kind === 'show') {
      await show(catalog, upstreams);
      return;
    }
    await apply(catalog, app.get<Database>(DATABASE, { strict: false }), upstreams, parsed.command);
  } finally {
    await app.close();
  }
}

/** 只打印非敏感信息：错误码 + 给人看的原因；不输出密钥、密钥掩码或上游密文。 */
main().catch((error: unknown) => {
  const payload =
    error instanceof VoiceCallPipelineCliError
      ? { ok: false, code: error.code, message: error.message, ...error.details }
      : {
          ok: false,
          code: 'VOICE_CALL_PIPELINE_FAILED',
          message: error instanceof Error ? error.message : '未知错误',
        };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = 1;
});
