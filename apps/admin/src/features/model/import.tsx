/**
 * 一键导入模型配置：读本地 JSON 文件 → 预览表格（选上游账号、勾选模型、改默认值）→ 逐个调用 upsertModel。
 * 不改后端、不改契约。已存在同键模型只更新价格（售价 / 成本 / 展示倍率），不改线路和计费上限。
 *
 * 文件格式（每个 models[] 项）：
 *   model → 上游模型名；vendor → 厂商；retail_prices_cny_per_mtok → 售价；
 *   supplier_lowest_prices_cny_per_mtok → 成本；public_display_official_multiplier → 展示倍率（手填）；
 *   arena_overall_rank → 手填榜单名次 / 排序；arena_model → 榜单对应名称（3.24，自动获取榜单时按它匹配）。
 *   价格里可带 cache_write_5m / cache_write_1h（3.24，缓存写入价；也认 cache_write = 5 分钟档），没有 = 按输入价计。
 *   中转站的分档价格（按用量档位）目前只取基础档（文件里 input / output / cache 那一组），其余字段忽略。
 * 3.24：去掉「资料来源链接」（price_source 不再使用）与核对日期；不再有「图片识别」场景，识图默认勾上
 * （总经理的聊天模型都是多模态；文本聊天 / 私密模式模型需要识图能力）。
 * 3.26（G3）：读入文件后按模型名批量查 models.dev，预填上下文长度、最大输出、识图；文件没写缓存价 / 缓存写入价时
 * 按官方「缓存价 ÷ 输入价」的比例 × 文件里的输入价预填（查不到才按输入价 10%）。模型键不再显示给管理员填，
 * 按「厂商 / 上游模型名」自动生成（与已有模型同键 = 更新价格）。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  App,
  Button,
  Checkbox,
  Input,
  InputNumber,
  Modal,
  Progress,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { z } from 'zod';
import {
  ModelAccessAdminEndpoints,
  type AdminModel,
  type ModelRates,
  type ModelsDevMatch,
  type Upstream,
} from '@weiban/contracts';
import { api } from '../../data/client.js';
import { errorText } from '../../data/hooks.js';
import { HelpTip } from '../../ui/page.js';
import {
  DEFAULT_CONTEXT_TOKENS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_VISION_IMAGES,
  formToBounds,
} from './billing-bounds.js';
import { MODEL_KEY_HINT, autoModelKey, isValidModelKey, prettyModelName } from './model-key.js';
import { PLATFORM_MAX_OUTPUT } from './models-dev.js';
import { UPSTREAM_STATE_LABELS, toWrite, upstreamState } from './shared.js';

const PriceTriple = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cache: z.number().nonnegative().optional().nullable(),
  // 3.24：缓存写入价（可选）
  cache_write: z.number().nonnegative().optional().nullable(),
  cache_write_5m: z.number().nonnegative().optional().nullable(),
  cache_write_1h: z.number().nonnegative().optional().nullable(),
});

const ImportFile = z.object({
  version: z.string().optional(),
  models: z
    .array(
      z.object({
        model: z.string().trim().min(1),
        vendor: z.string().trim().min(1),
        retail_prices_cny_per_mtok: PriceTriple,
        supplier_lowest_prices_cny_per_mtok: PriceTriple.optional().nullable(),
        public_display_official_multiplier: z.number().nonnegative().optional().nullable(),
        price_source: z.string().optional().nullable(),
        arena_overall_rank: z.number().optional().nullable(),
        arena_model: z.string().optional().nullable(),
        supplier_lowest_model: z.string().optional().nullable(),
        needs_validation: z.boolean().optional().nullable(),
      }),
    )
    .min(1),
});

interface Triple {
  input: number | null;
  output: number | null;
  cache: number | null;
  /** 3.24：缓存写入价（null = 按输入价计）。 */
  cacheWrite5m: number | null;
  cacheWrite1h: number | null;
}

function writes(t: z.infer<typeof PriceTriple>) {
  const w5 = t.cache_write_5m ?? t.cache_write ?? null;
  return {
    cacheWrite5m: w5 == null ? null : round(w5, 4),
    cacheWrite1h: t.cache_write_1h == null ? null : round(t.cache_write_1h, 4),
  };
}

interface ImportRow {
  id: string;
  modelKey: string;
  displayName: string;
  vendorName: string;
  upstreamModelId: string;
  price: Triple;
  priceCacheGuessed: boolean;
  cost: Triple | null;
  costCacheGuessed: boolean;
  multiplier: number | null;
  /** 3.24：榜单对应名称（文件 arena_model）。 */
  arenaModel: string | null;
  contextTokens: number | null;
  maxOutputTokens: number | null;
  vision: boolean;
  rank: number | null;
  supplierModel: string | null;
  needsValidation: boolean;
  /** 3.26：models.dev 匹配结果（undefined = 还在查）。 */
  dev?: { match: ModelsDevMatch | null; noData: boolean };
  /** 3.26：缓存价 / 缓存写入价是按 models.dev 比例预填的（不是文件里的）。 */
  priceCacheFromDev?: boolean;
  costCacheFromDev?: boolean;
  /** 文件里原本有没有这几项（决定能不能用 models.dev 预填）。 */
  fileHas: { priceCache: boolean; priceWrite: boolean; costCache: boolean; costWrite: boolean };
  result?: { ok: boolean; text: string };
}

type RowErrors = Partial<Record<keyof ImportRow | 'priceInput' | 'priceOutput', string>>;

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

function rowsFromFile(raw: z.infer<typeof ImportFile>): ImportRow[] {
  return raw.models.map((m, index) => {
    const retail = m.retail_prices_cny_per_mtok;
    const supplier = m.supplier_lowest_prices_cny_per_mtok ?? null;
    const rank =
      typeof m.arena_overall_rank === 'number' && Number.isInteger(m.arena_overall_rank) && m.arena_overall_rank > 0
        ? m.arena_overall_rank
        : null;
    return {
      id: String(index),
      modelKey: autoModelKey(m.vendor, m.model),
      displayName: prettyModelName(m.model),
      vendorName: m.vendor.slice(0, 40),
      upstreamModelId: m.model,
      price: {
        input: round(retail.input, 4),
        output: round(retail.output, 4),
        cache: round(retail.cache ?? retail.input * 0.1, 4),
        ...writes(retail),
      },
      priceCacheGuessed: retail.cache == null,
      cost: supplier
        ? {
            input: round(supplier.input, 4),
            output: round(supplier.output, 4),
            cache: round(supplier.cache ?? supplier.input * 0.1, 4),
            ...writes(supplier),
          }
        : null,
      costCacheGuessed: supplier ? supplier.cache == null : false,
      multiplier:
        m.public_display_official_multiplier == null ? null : round(m.public_display_official_multiplier, 2),
      arenaModel: m.arena_model?.trim().slice(0, 120) || null,
      contextTokens: DEFAULT_CONTEXT_TOKENS,
      maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
      vision: true,
      rank,
      supplierModel: m.supplier_lowest_model?.trim() || null,
      needsValidation: m.needs_validation === true,
      fileHas: {
        priceCache: retail.cache != null,
        priceWrite: retail.cache_write_5m != null || retail.cache_write != null,
        costCache: supplier?.cache != null,
        costWrite: supplier?.cache_write_5m != null || supplier?.cache_write != null,
      },
    };
  });
}

/** 3.26：按官方「缓存价 ÷ 输入价」的比例，换算成文件里这个价位的缓存价。 */
function ratioOf(official: number | null, officialInput: number | null, input: number | null) {
  if (official == null || !officialInput || input == null) return null;
  return round((input * official) / officialInput, 4);
}

/** 3.26：把 models.dev 匹配结果用到一行上（只填文件里没有的项；上下文、最大输出、识图按官方数据）。 */
function withModelsDev(row: ImportRow, match: ModelsDevMatch | null, noData: boolean): ImportRow {
  const next: ImportRow = { ...row, dev: { match, noData } };
  if (!match) return next;
  const usd = match.priceUsd;
  const fill = (triple: Triple, hasCache: boolean, hasWrite: boolean) => {
    const cache = hasCache ? null : ratioOf(usd.cacheRead, usd.input, triple.input);
    const write = hasWrite ? null : ratioOf(usd.cacheWrite, usd.input, triple.input);
    return {
      triple: {
        ...triple,
        ...(cache != null ? { cache } : {}),
        ...(write != null ? { cacheWrite5m: write } : {}),
      },
      fromDev: cache != null,
    };
  };
  const price = fill(row.price, row.fileHas.priceCache, row.fileHas.priceWrite);
  next.price = price.triple;
  if (price.fromDev) {
    next.priceCacheGuessed = false;
    next.priceCacheFromDev = true;
  }
  if (row.cost) {
    const cost = fill(row.cost, row.fileHas.costCache, row.fileHas.costWrite);
    next.cost = cost.triple;
    if (cost.fromDev) {
      next.costCacheGuessed = false;
      next.costCacheFromDev = true;
    }
  }
  if (match.contextTokens != null) next.contextTokens = Math.min(10_000_000, match.contextTokens);
  if (match.maxOutputTokens != null)
    next.maxOutputTokens = Math.min(PLATFORM_MAX_OUTPUT, match.maxOutputTokens);
  if (match.supportsImage != null) next.vision = match.supportsImage;
  return next;
}

function isInt(value: number | null, min: number, max: number): value is number {
  return value != null && Number.isInteger(value) && value >= min && value <= max;
}

function rowErrors(row: ImportRow, existing: AdminModel | undefined, duplicate: boolean): RowErrors {
  const errors: RowErrors = {};
  if (!isValidModelKey(row.modelKey.trim())) errors.modelKey = MODEL_KEY_HINT;
  else if (duplicate) errors.modelKey = '和表里另一行是同一个模型（厂商和上游模型名都一样），只勾一行';
  if (row.price.input == null) errors.priceInput = '填写输入售价';
  if (row.price.output == null) errors.priceOutput = '填写输出售价';
  if (existing) return errors;
  const name = row.displayName.trim();
  if (!name || name.length > 60) errors.displayName = '显示名要填 1 到 60 个字';
  const vendor = row.vendorName.trim();
  if (!vendor || vendor.length > 40) errors.vendorName = '厂商要填 1 到 40 个字';
  const model = row.upstreamModelId.trim();
  if (!model || model.length > 128) errors.upstreamModelId = '上游模型名要填 1 到 128 个字符';
  if (!isInt(row.contextTokens, 1, 10_000_000)) errors.contextTokens = '填 1 到 10000000 的整数';
  if (!isInt(row.maxOutputTokens, 1, 32_000)) errors.maxOutputTokens = '填 1 到 32000 的整数';
  return errors;
}

function ratesOf(t: Triple): ModelRates {
  return {
    input: t.input ?? 0,
    output: t.output ?? 0,
    cache: t.cache ?? 0,
    cacheWrite5m: t.cacheWrite5m,
    cacheWrite1h: t.cacheWrite1h,
  };
}

function fieldLabelOf(key: string): string {
  const labels: Record<string, string> = {
    modelKey: '模型键',
    displayName: '显示名',
    vendorName: '厂商',
    upstreamModelId: '上游模型名',
    contextTokens: '上下文长度',
    maxOutputTokens: '最大输出',
    priceInput: '输入售价',
    priceOutput: '输出售价',
  };
  return labels[key] ?? key;
}

export function ImportModelsButton({
  models,
  upstreams,
  onDone,
  icon,
}: {
  models: AdminModel[];
  upstreams: Upstream[];
  onDone: () => void;
  icon?: ReactNode;
}) {
  const { message } = App.useApp();
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ImportRow[] | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch {
      void message.error('这个文件不是有效的 JSON，请确认选的是模型配置文件');
      return;
    }
    const parsed = ImportFile.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue?.path
        .map((p) => (typeof p === 'number' ? `第 ${p + 1} 个` : String(p)))
        .join(' › ');
      void message.error({
        content: `文件格式不对${where ? `：${where}` : ''}。需要 models 列表，每项有 model、vendor、retail_prices_cny_per_mtok（input / output）`,
        duration: 8,
      });
      return;
    }
    setFileName(file.name);
    setRows(rowsFromFile(parsed.data));
  }

  return (
    <>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <Tooltip title="从本地 JSON 文件批量添加 / 更新模型，导入前会先预览">
        <Button icon={icon} onClick={() => fileInput.current?.click()}>
          导入配置
        </Button>
      </Tooltip>
      {rows && (
        <ImportPreview
          fileName={fileName}
          initialRows={rows}
          models={models}
          upstreams={upstreams}
          onClose={() => setRows(null)}
          onDone={onDone}
        />
      )}
    </>
  );
}

function ImportPreview({
  fileName,
  initialRows,
  models,
  upstreams,
  onClose,
  onDone,
}: {
  fileName: string;
  initialRows: ImportRow[];
  models: AdminModel[];
  upstreams: Upstream[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { message } = App.useApp();
  const [rows, setRows] = useState(initialRows);
  const [selected, setSelected] = useState<string[]>(initialRows.map((r) => r.id));
  const [upstreamId, setUpstreamId] = useState<string | undefined>(
    upstreams.length === 1 ? upstreams[0]?.upstreamId : undefined,
  );
  const [enableNew, setEnableNew] = useState(true);
  const [showErrors, setShowErrors] = useState(false);
  const [upstreamError, setUpstreamError] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState('');
  const [devError, setDevError] = useState('');

  // 3.26：打开预览时按模型名批量查 models.dev（每次最多 200 个）
  useEffect(() => {
    let active = true;
    void (async () => {
      const list = initialRows;
      const results = new Map<string, { match: ModelsDevMatch | null; noData: boolean }>();
      try {
        for (let i = 0; i < list.length; i += 200) {
          const chunk = list.slice(i, i + 200);
          const res = await api.call(ModelAccessAdminEndpoints.lookupModelsDev, {
            body: {
              items: chunk.map((r) => ({
                name: r.upstreamModelId.slice(0, 200),
                vendor: r.vendorName.slice(0, 60),
              })),
            },
          });
          chunk.forEach((r, k) =>
            results.set(r.id, { match: res.items[k]?.match ?? null, noData: !res.fetchedAt }),
          );
        }
      } catch (e) {
        if (active) setDevError(errorText(e));
        return;
      }
      if (!active) return;
      setRows((current) =>
        current.map((r) => {
          const hit = results.get(r.id);
          return hit && !r.result ? withModelsDev(r, hit.match, hit.noData) : r;
        }),
      );
    })();
    return () => {
      active = false;
    };
  }, [initialRows]);

  const existingOf = (row: ImportRow) => models.find((m) => m.modelKey === row.modelKey.trim());
  const keyCount = new Map<string, number>();
  for (const r of rows) {
    if (!selected.includes(r.id)) continue;
    const k = r.modelKey.trim();
    keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
  }
  const errorsOf = (row: ImportRow) =>
    rowErrors(row, existingOf(row), (keyCount.get(row.modelKey.trim()) ?? 0) > 1);

  const update = (id: string, patch: Partial<ImportRow>) =>
    setRows((list) =>
      list.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, ...patch, result: undefined };
        // 3.26：模型键跟着厂商 / 上游模型名自动变（管理员看不到也不用填）
        if ('vendorName' in patch || 'upstreamModelId' in patch)
          next.modelKey = autoModelKey(next.vendorName, next.upstreamModelId);
        return next;
      }),
    );

  const cellError = (row: ImportRow, key: keyof RowErrors) => {
    if (!showErrors || !selected.includes(row.id)) return null;
    const text = errorsOf(row)[key];
    return text ? <span className="cell-error">{text}</span> : null;
  };
  const status = (row: ImportRow, key: keyof RowErrors) =>
    showErrors && selected.includes(row.id) && errorsOf(row)[key] ? ('error' as const) : undefined;

  const selectedRows = rows.filter((r) => selected.includes(r.id));
  const newCount = selectedRows.filter((r) => !existingOf(r)).length;
  const updateCount = selectedRows.length - newCount;

  async function run() {
    setShowErrors(true);
    setSummary('');
    if (!selectedRows.length) {
      void message.error('先勾选要导入的模型');
      return;
    }
    if (newCount > 0 && !upstreamId) {
      setUpstreamError('选择新模型挂到哪个上游账号');
      void message.error('先在上面选择「挂到哪个上游账号」');
      return;
    }
    const firstBad = selectedRows.find((r) => Object.keys(errorsOf(r)).length);
    if (firstBad) {
      const [key, text] = Object.entries(errorsOf(firstBad))[0] ?? [];
      const line = rows.indexOf(firstBad) + 1;
      void message.error({
        content: `第 ${line} 行（${firstBad.upstreamModelId}）${key ? fieldLabelOf(key) : ''}：${text ?? '请检查'}`,
        duration: 6,
      });
      document
        .querySelector(`[data-row-key="${firstBad.id}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    let ok = 0;
    const failed: string[] = [];
    setProgress({ done: 0, total: selectedRows.length });
    for (const [index, row] of selectedRows.entries()) {
      const key = row.modelKey.trim();
      const existing = existingOf(row);
      const rates = ratesOf(row.price);
      const costRates = row.cost ? ratesOf(row.cost) : undefined;
      try {
        if (existing) {
          await api.call(ModelAccessAdminEndpoints.upsertModel, {
            params: { modelKey: key },
            body: {
              ...toWrite(existing),
              rates,
              costRates: costRates ?? existing.costRates,
              displayMultiplierManual: row.multiplier,
              // 3.24：文件带榜单对应名称时一并更新
              ...(row.arenaModel ? { arenaModelName: row.arenaModel } : {}),
            },
          });
        } else {
          const bounds = formToBounds(
            {
              contextTokens: row.contextTokens,
              maxOutputTokens: row.maxOutputTokens,
              outputParameter: 'max_tokens',
              maxImages: row.vision ? DEFAULT_VISION_IMAGES : 0,
            },
            null,
          );
          const upstreamModelId = row.upstreamModelId.trim();
          await api.call(ModelAccessAdminEndpoints.upsertModel, {
            params: { modelKey: key },
            body: {
              modelKey: key,
              displayName: row.displayName.trim(),
              vendorName: row.vendorName.trim(),
              upstreamId: upstreamId!,
              upstreamModelId,
              billingBounds: bounds,
              capabilities: row.vision ? ['vision'] : [],
              tags: [],
              leaderboardRank: row.rank,
              arenaModelName: row.arenaModel,
              sortOrder: row.rank ?? index + 1,
              defaultFor: [],
              // 3.22：导入的都是文字模型：默认可用于文本聊天、语音通话、私密模式（3.24 起图片随文本聊天模型）。
              scenarios: ['chat', 'voice_call', 'private'],
              enabled: enableNew,
              rates,
              costRates,
              displayMultiplierManual: row.multiplier,
              routes: [
                {
                  upstreamId: upstreamId!,
                  upstreamModelId,
                  priority: 1,
                  weight: 100,
                  enabled: true,
                  billingBounds: bounds,
                },
              ],
            },
          });
        }
        ok += 1;
        setRows((list) =>
          list.map((r) =>
            r.id === row.id ? { ...r, result: { ok: true, text: existing ? '已更新价格' : '已添加' } } : r,
          ),
        );
      } catch (e) {
        const text = errorText(e);
        failed.push(row.id);
        setRows((list) => list.map((r) => (r.id === row.id ? { ...r, result: { ok: false, text } } : r)));
      }
      setProgress({ done: index + 1, total: selectedRows.length });
    }
    setProgress(null);
    onDone();
    if (!failed.length) {
      void message.success(`已导入 ${ok} 个模型，价目表已自动更新`);
      onClose();
      return;
    }
    setSelected(failed);
    setSummary(`成功 ${ok} 个，失败 ${failed.length} 个。失败的行已保留勾选，看「结果」列的原因，改好后再点导入。`);
    void message.warning(`有 ${failed.length} 个模型没导入成功，原因写在表格「结果」列`);
  }

  const priceCell = (
    row: ImportRow,
    group: 'price' | 'cost',
    part: keyof Triple,
    errorKey?: keyof RowErrors,
  ) => {
    const triple = row[group];
    if (!triple) return <span className="cell-sub">与售价相同</span>;
    const guessed = part === 'cache' && (group === 'price' ? row.priceCacheGuessed : row.costCacheGuessed);
    const input = (
      <InputNumber
        size="small"
        min={0}
        max={100_000}
        step={0.01}
        value={triple[part]}
        status={errorKey ? status(row, errorKey) : undefined}
        className={guessed ? 'cell-guessed' : undefined}
        style={{ width: '100%' }}
        onChange={(v) =>
          update(row.id, {
            [group]: { ...triple, [part]: v },
            ...(part === 'cache'
              ? group === 'price'
                ? { priceCacheGuessed: false }
                : { costCacheGuessed: false }
              : {}),
          } as Partial<ImportRow>)
        }
      />
    );
    return (
      <>
        {guessed ? (
          <Tooltip title="文件里没有缓存价，models.dev 也查不到，按输入价的 10% 预填，可以改">{input}</Tooltip>
        ) : part === 'cache' && (group === 'price' ? row.priceCacheFromDev : row.costCacheFromDev) ? (
          <Tooltip title="文件里没有缓存价：按 models.dev 官方「缓存价 ÷ 输入价」的比例换算，可以改">
            <span className="cell-from-dev">{input}</span>
          </Tooltip>
        ) : (
          input
        )}
        {errorKey ? cellError(row, errorKey) : null}
      </>
    );
  };

  const columns: ColumnsType<ImportRow> = [
    {
      title: '结果 / 状态',
      width: 130,
      fixed: 'left',
      render: (_, row) => {
        if (row.result)
          return (
            <Space direction="vertical" size={2}>
              <Tag color={row.result.ok ? 'green' : 'red'} bordered={false}>
                {row.result.ok ? '成功' : '失败'}
              </Tag>
              <span className={row.result.ok ? 'cell-sub' : 'cell-error'}>{row.result.text}</span>
            </Space>
          );
        const existing = existingOf(row);
        return (
          <Space direction="vertical" size={2}>
            {existing ? (
              <Tooltip title="已有同键模型：只更新售价、成本和展示倍率，不改线路和计费上限">
                <Tag color="blue" bordered={false}>
                  更新价格
                </Tag>
              </Tooltip>
            ) : (
              <Tag color="green" bordered={false}>
                新增
              </Tag>
            )}
            {existing?.hasTimeBands && <span className="cell-error">有分时价，导入后变全天统一价</span>}
            {row.needsValidation && (
              <Tooltip title="文件里标了 needs_validation：价格或线路还需要人工核实">
                <Tag color="orange" bordered={false}>
                  待核实
                </Tag>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
    {
      title: (
        <span>
          models.dev
          <HelpTip text="按上游模型名在 models.dev 公开数据里查到的官方条目：上下文长度、最大输出、识图已按它预填，文件没写的缓存价也按官方比例预填。没找到的请手动核对这几项。" />
        </span>
      ),
      width: 170,
      fixed: 'left',
      render: (_, row) => {
        const keyError = cellError(row, 'modelKey');
        const dev = row.dev;
        return (
          <Space direction="vertical" size={2}>
            {!dev ? (
              <span className="cell-sub">查询中…</span>
            ) : dev.match ? (
              <Tooltip
                title={`${dev.match.providerName} · ${dev.match.modelId}${dev.match.exact ? '' : '（近似匹配，请核对）'}`}
              >
                <Tag color={dev.match.exact ? 'green' : 'orange'} bordered={false}>
                  {dev.match.exact ? '已匹配' : '近似匹配'} · {dev.match.providerId}
                </Tag>
              </Tooltip>
            ) : (
              <Tooltip title="models.dev 里没找到这个模型名：上下文长度、最大输出、识图请手动核对">
                <Tag color="orange" bordered={false}>
                  {dev.noData ? '还没有数据' : '没找到，请手填'}
                </Tag>
              </Tooltip>
            )}
            {keyError}
          </Space>
        );
      },
    },
    {
      title: '显示名',
      width: 170,
      render: (_, row) =>
        existingOf(row) ? (
          <span className="cell-sub">{existingOf(row)?.displayName}</span>
        ) : (
          <>
            <Input
              size="small"
              value={row.displayName}
              status={status(row, 'displayName')}
              onChange={(e) => update(row.id, { displayName: e.target.value })}
            />
            {cellError(row, 'displayName')}
          </>
        ),
    },
    {
      title: '厂商',
      width: 120,
      render: (_, row) =>
        existingOf(row) ? (
          <span className="cell-sub">{existingOf(row)?.vendorName}</span>
        ) : (
          <>
            <Input
              size="small"
              value={row.vendorName}
              status={status(row, 'vendorName')}
              onChange={(e) => update(row.id, { vendorName: e.target.value })}
            />
            {cellError(row, 'vendorName')}
          </>
        ),
    },
    {
      title: (
        <span>
          上游模型名
          <HelpTip text="上游账号那边的模型名。文件里的 model 字段；如果供应商那边叫法不同（灰字提示），请改成供应商的叫法。" />
        </span>
      ),
      width: 200,
      render: (_, row) =>
        existingOf(row) ? (
          <span className="cell-sub">不改线路</span>
        ) : (
          <>
            <Input
              size="small"
              className="mono"
              value={row.upstreamModelId}
              status={status(row, 'upstreamModelId')}
              onChange={(e) => update(row.id, { upstreamModelId: e.target.value })}
            />
            {row.supplierModel && row.supplierModel !== row.upstreamModelId && (
              <Tooltip title="点一下改用这个名字">
                <span
                  className="cell-sub tag-link"
                  role="button"
                  tabIndex={0}
                  onClick={() => update(row.id, { upstreamModelId: row.supplierModel ?? row.upstreamModelId })}
                >
                  供应商里叫 {row.supplierModel}
                </span>
              </Tooltip>
            )}
            {cellError(row, 'upstreamModelId')}
          </>
        ),
    },
    { title: '售价·入', width: 96, render: (_, row) => priceCell(row, 'price', 'input', 'priceInput') },
    { title: '售价·出', width: 96, render: (_, row) => priceCell(row, 'price', 'output', 'priceOutput') },
    { title: '售价·缓存', width: 96, render: (_, row) => priceCell(row, 'price', 'cache') },
    {
      title: (
        <span>
          缓存写入
          <HelpTip text="文件里的 cache_write_5m / cache_write_1h（元 / 百万 token）。没有 = 按输入价计；只有 Anthropic 协议的线路会报告缓存写入。" />
        </span>
      ),
      width: 110,
      render: (_, row) =>
        row.price.cacheWrite5m == null && row.price.cacheWrite1h == null ? (
          <span className="cell-sub">同输入价</span>
        ) : (
          <span className="cell-sub">
            5 分钟 {row.price.cacheWrite5m ?? '同输入'}
            {row.price.cacheWrite1h != null ? ` · 1 小时 ${row.price.cacheWrite1h}` : ''}
          </span>
        ),
    },
    { title: '成本·入', width: 90, render: (_, row) => priceCell(row, 'cost', 'input') },
    { title: '成本·出', width: 90, render: (_, row) => priceCell(row, 'cost', 'output') },
    { title: '成本·缓存', width: 90, render: (_, row) => priceCell(row, 'cost', 'cache') },
    {
      title: (
        <span>
          展示倍率
          <HelpTip text="用户看到的「×倍率」，只展示不扣费。空着 = 按基准模型自动算。" />
        </span>
      ),
      width: 90,
      render: (_, row) => (
        <InputNumber
          size="small"
          min={0}
          max={1000}
          step={0.01}
          precision={2}
          placeholder="自动"
          value={row.multiplier}
          style={{ width: '100%' }}
          onChange={(v) => update(row.id, { multiplier: v })}
        />
      ),
    },
    {
      title: (
        <span>
          上下文长度
          <HelpTip text="计费上限：模型一次最多能读多少 token。不确定填 128000。" />
        </span>
      ),
      width: 120,
      render: (_, row) =>
        existingOf(row) ? (
          <span className="cell-sub">不改</span>
        ) : (
          <>
            <InputNumber
              size="small"
              min={1}
              max={10_000_000}
              precision={0}
              step={1000}
              value={row.contextTokens}
              status={status(row, 'contextTokens')}
              style={{ width: '100%' }}
              onChange={(v) => update(row.id, { contextTokens: v })}
            />
            {cellError(row, 'contextTokens')}
          </>
        ),
    },
    {
      title: (
        <span>
          最大输出
          <HelpTip text="计费上限：模型一次最多写多少 token（含思考），最多 32000。不确定填 8192。" />
        </span>
      ),
      width: 100,
      render: (_, row) =>
        existingOf(row) ? (
          <span className="cell-sub">不改</span>
        ) : (
          <>
            <InputNumber
              size="small"
              min={1}
              max={32_000}
              precision={0}
              step={512}
              value={row.maxOutputTokens}
              status={status(row, 'maxOutputTokens')}
              style={{ width: '100%' }}
              onChange={(v) => update(row.id, { maxOutputTokens: v })}
            />
            {cellError(row, 'maxOutputTokens')}
          </>
        ),
    },
    {
      title: (
        <span>
          榜单对应名称
          <HelpTip text="榜单上这个模型叫什么（文件里的 arena_model），自动获取榜单时按它匹配名次。" />
        </span>
      ),
      width: 180,
      render: (_, row) => (
        <Input
          size="small"
          className="mono"
          value={row.arenaModel ?? ''}
          placeholder="不上榜"
          onChange={(e) => update(row.id, { arenaModel: e.target.value.slice(0, 120) || null })}
        />
      ),
    },
    {
      title: (
        <span>
          识图
          <HelpTip text="勾上 = 这个模型能看图（最多 4 张）。用户发的图片随文本聊天 / 私密模式模型发送，聊天模型都应勾上。" />
        </span>
      ),
      width: 60,
      render: (_, row) =>
        existingOf(row) ? (
          <span className="cell-sub">—</span>
        ) : (
          <Checkbox checked={row.vision} onChange={(e) => update(row.id, { vision: e.target.checked })} />
        ),
    },
  ];

  return (
    <Modal
      open
      width={1280}
      title={`导入模型配置 · ${fileName}`}
      onCancel={progress ? undefined : onClose}
      maskClosable={false}
      closable={!progress}
      footer={
        <Space>
          <span className="cell-sub">
            已选 {selectedRows.length} 个：新增 {newCount}，更新价格 {updateCount}
          </span>
          <Button onClick={onClose} disabled={!!progress}>
            取消
          </Button>
          <Button type="primary" loading={!!progress} onClick={() => void run()}>
            {progress ? `正在导入 ${progress.done}/${progress.total}` : `导入 ${selectedRows.length} 个模型`}
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        message="导入前请核对：新模型会挂到下面选的上游账号；已有同键模型只更新价格，不改线路。"
        description="上下文长度、最大输出、识图按 models.dev 官方数据预填（查不到时默认 128000 / 8192）；蓝色格子 = 文件没写、按官方比例预填的缓存价，黄色格子 = 查不到、按输入价 10% 预填。输出参数名一律 max_tokens，导入后都可以在模型抽屉里再改。"
      />
      {devError && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 8 }}
          message={`查不了 models.dev（${devError}），这次按默认值预填，请手动核对上下文长度、最大输出和识图。`}
        />
      )}
      <div className="import-toolbar">
        <Space>
          <span>挂到哪个上游账号</span>
          <Select
            style={{ width: 280 }}
            placeholder="选择上游账号"
            value={upstreamId}
            status={upstreamError ? 'error' : undefined}
            onChange={(v: string) => {
              setUpstreamId(v);
              setUpstreamError('');
            }}
            options={upstreams.map((u) => ({
              value: u.upstreamId,
              label: `${u.name}${
                upstreamState(u) === 'normal' ? '' : `（${UPSTREAM_STATE_LABELS[upstreamState(u)]}）`
              }`,
            }))}
          />
          {upstreamError && <span className="cell-error">{upstreamError}</span>}
        </Space>
        <Checkbox checked={enableNew} onChange={(e) => setEnableNew(e.target.checked)}>
          新模型导入后直接上架
        </Checkbox>
      </div>
      {progress && (
        <Progress
          percent={Math.round((progress.done / progress.total) * 100)}
          size="small"
          style={{ marginBottom: 8 }}
        />
      )}
      {summary && <Alert type="warning" showIcon message={summary} style={{ marginBottom: 8 }} />}
      <Table<ImportRow>
        className="import-table"
        rowKey="id"
        size="small"
        pagination={false}
        scroll={{ x: 2100, y: 460 }}
        columns={columns}
        dataSource={rows}
        rowSelection={{
          selectedRowKeys: selected,
          onChange: (keys) => setSelected(keys.map(String)),
          getCheckboxProps: () => ({ disabled: !!progress }),
        }}
      />
    </Modal>
  );
}
