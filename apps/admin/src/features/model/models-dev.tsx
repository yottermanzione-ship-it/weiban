/**
 * 3.26（试用反馈第三轮 G3-1）：models.dev 公开模型数据。
 * - ModelsDevBar：模型页顶部一行——缓存了多少模型、什么时候更新、汇率（可改）、立即刷新；
 * - useModelsDevMatch：按「上游模型名 + 出品方」检索（停止输入 0.6 秒后查一次）；
 * - ModelsDevPanel：模型抽屉里的「models.dev 参考」——匹配到时列出官方价格 / 上下文 / 最大输出 / 识图，
 *   新建时自动预填（还没手改过的格子），编辑时点按钮才填；匹配不到时提示手填。
 * 价格原文是美元 / 百万 token，服务器按汇率换算成人民币。预填的是官方价，可以改。
 */
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, InputNumber, Space, Tag } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  ModelAccessAdminEndpoints,
  type ModelsDevMatch,
  type ModelsDevStatus,
} from '@weiban/contracts';
import { api } from '../../data/client.js';
import { errorText, useRemote } from '../../data/hooks.js';
import { HelpTip, useToast } from '../../ui/page.js';

/** 契约计费上限的最大输出上限（RouteBillingBounds.text.maxOutputTokens ≤ 32000）。 */
export const PLATFORM_MAX_OUTPUT = 32_000;

const fmt = (iso: string) => dayjs(iso).format('YYYY-MM-DD HH:mm');

export function ModelsDevBar() {
  const toast = useToast();
  const remote = useRemote(ModelAccessAdminEndpoints.getModelsDevStatus);
  const [status, setStatus] = useState<ModelsDevStatus | null>(null);
  const [rate, setRate] = useState<number | null>(null);
  const [busy, setBusy] = useState<'refresh' | 'rate' | null>(null);
  const [error, setError] = useState('');
  const current = status ?? remote.data ?? null;

  async function refresh() {
    setBusy('refresh');
    setError('');
    try {
      const next = await api.call(ModelAccessAdminEndpoints.refreshModelsDev, {});
      setStatus(next);
      if (next.lastError) setError(`刷新失败：${next.lastError}（保留上次数据）`);
      else toast.success(`已更新：${next.modelCount} 个模型`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function saveRate() {
    if (rate == null) return;
    setBusy('rate');
    setError('');
    try {
      setStatus(
        await api.call(ModelAccessAdminEndpoints.updateModelsDevSettings, {
          body: { usdCnyRate: rate },
        }),
      );
      setRate(null);
      toast.success('汇率已保存（只影响以后的预填）');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="filter-bar models-dev-bar">
      <Space wrap size={8}>
        <span>
          官方价格数据（models.dev）
          <HelpTip text="添加 / 编辑模型、导入配置时，按上游模型名从 models.dev 公开数据里查官方价格、上下文长度、最大输出、是否支持图片并预填（可以改）。服务器每天自动更新一次。" />
        </span>
        {current ? (
          current.fetchedAt ? (
            <Tag bordered={false} color="green">
              {current.modelCount} 个模型 · {fmt(current.fetchedAt)} 更新
            </Tag>
          ) : (
            <Tag bordered={false} color="orange">
              还没有数据
            </Tag>
          )
        ) : (
          <Tag bordered={false}>读取中…</Tag>
        )}
        <span className="cell-sub">1 美元 =</span>
        <InputNumber
          size="small"
          min={0.01}
          max={100}
          step={0.01}
          precision={4}
          style={{ width: 96 }}
          value={rate ?? current?.usdCnyRate ?? null}
          onChange={(v) => setRate(typeof v === 'number' ? v : null)}
        />
        <span className="cell-sub">元</span>
        <Button
          size="small"
          loading={busy === 'rate'}
          disabled={rate == null || rate === current?.usdCnyRate}
          onClick={() => void saveRate()}
        >
          保存汇率
        </Button>
        <Button
          size="small"
          icon={<ReloadOutlined />}
          loading={busy === 'refresh'}
          onClick={() => void refresh()}
        >
          立即刷新
        </Button>
      </Space>
      {(error || remote.error || (current?.lastError && !error)) && (
        <Alert
          type={error || remote.error ? 'error' : 'warning'}
          showIcon
          style={{ marginTop: 8 }}
          message={
            error ||
            remote.error ||
            `最近一次自动更新失败（${current?.lastAttemptAt ? fmt(current.lastAttemptAt) : ''}）：${current?.lastError ?? ''}${current?.fetchedAt ? '，正在使用上次的数据' : ''}`
          }
        />
      )}
    </div>
  );
}

export type MatchState =
  | { kind: 'idle' }
  | { kind: 'loading'; name: string }
  | { kind: 'found'; name: string; match: ModelsDevMatch; rate: number }
  | { kind: 'none'; name: string }
  | { kind: 'nodata'; name: string }
  | { kind: 'error'; name: string; text: string };

/** 按上游模型名 + 出品方检索（停止输入 600ms 后查；名字没变不重复查）。 */
export function useModelsDevMatch(
  name: string | undefined,
  vendor: string | undefined,
): MatchState {
  const [state, setState] = useState<MatchState>({ kind: 'idle' });
  const seq = useRef(0);
  const trimmed = (name ?? '').trim();
  const vendorText = (vendor ?? '').trim();
  useEffect(() => {
    if (!trimmed) {
      setState({ kind: 'idle' });
      return;
    }
    const id = ++seq.current;
    setState({ kind: 'loading', name: trimmed });
    const timer = window.setTimeout(() => {
      void api
        .call(ModelAccessAdminEndpoints.lookupModelsDev, {
          body: {
            items: [{ name: trimmed, ...(vendorText ? { vendor: vendorText.slice(0, 60) } : {}) }],
          },
        })
        .then((res) => {
          if (id !== seq.current) return;
          const match = res.items[0]?.match ?? null;
          if (!res.fetchedAt) setState({ kind: 'nodata', name: trimmed });
          else if (!match) setState({ kind: 'none', name: trimmed });
          else setState({ kind: 'found', name: trimmed, match, rate: res.usdCnyRate });
        })
        .catch((e: unknown) => {
          if (id === seq.current) setState({ kind: 'error', name: trimmed, text: errorText(e) });
        });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [trimmed, vendorText]);
  return state;
}

const money = (v: number | null, unit: string) => (v == null ? '—' : `${unit}${v}`);
const tokens = (v: number | null) => (v == null ? '—' : v.toLocaleString('en-US'));

/** 抽屉里的「models.dev 参考」块。onApply = 把匹配结果填进表单（编辑时由按钮触发）。 */
export function ModelsDevPanel({
  state,
  autoApplied,
  onApply,
}: {
  state: MatchState;
  /** 新建时已自动填入（显示「已自动预填」）。 */
  autoApplied: boolean;
  onApply: (match: ModelsDevMatch) => void;
}) {
  if (state.kind === 'idle') return null;
  if (state.kind === 'loading')
    return <div className="models-dev-panel field-note">正在 models.dev 里查「{state.name}」…</div>;
  if (state.kind === 'error')
    return (
      <Alert
        className="models-dev-panel"
        type="warning"
        showIcon
        message={`查不了 models.dev：${state.text}。请手动填写价格、上下文长度和最大输出。`}
      />
    );
  if (state.kind === 'nodata')
    return (
      <Alert
        className="models-dev-panel"
        type="warning"
        showIcon
        message="还没有 models.dev 数据（服务器抓取失败或还没抓过），请手动填写；也可以到「模型」页顶部点「立即刷新」。"
      />
    );
  if (state.kind === 'none')
    return (
      <Alert
        className="models-dev-panel"
        type="warning"
        showIcon
        message={`models.dev 里没找到「${state.name}」，请手动填写价格、上下文长度、最大输出和识图能力。`}
        description="中转站常给模型起别名：可以把上游模型名改成官方叫法（例 claude-opus-4-6）试试。"
      />
    );
  const { match, rate } = state;
  const capped = match.maxOutputTokens != null && match.maxOutputTokens > PLATFORM_MAX_OUTPUT;
  return (
    <div className="models-dev-panel models-dev-found">
      <div className="models-dev-head">
        <Space size={6} wrap>
          <strong>models.dev 参考</strong>
          <Tag bordered={false} color="blue">
            {match.providerName} · {match.modelId}
          </Tag>
          {!match.exact && (
            <Tag bordered={false} color="orange">
              近似匹配，请核对
            </Tag>
          )}
          {autoApplied && (
            <Tag bordered={false} color="green">
              已自动预填
            </Tag>
          )}
        </Space>
        <Button
          size="small"
          type={autoApplied ? 'default' : 'primary'}
          onClick={() => onApply(match)}
        >
          {autoApplied ? '重新填入' : '用这些数据填入'}
        </Button>
      </div>
      <div className="models-dev-grid">
        <span>官方价（元 / 百万 token）</span>
        <span>
          入 {money(match.priceCny.input, '')} · 出 {money(match.priceCny.output, '')} · 缓存读{' '}
          {money(match.priceCny.cacheRead, '')} · 缓存写 {money(match.priceCny.cacheWrite, '')}
        </span>
        <span>美元原价</span>
        <span className="cell-sub">
          入 {money(match.priceUsd.input, '$')} · 出 {money(match.priceUsd.output, '$')} · 缓存读{' '}
          {money(match.priceUsd.cacheRead, '$')} · 缓存写 {money(match.priceUsd.cacheWrite, '$')}
          （汇率 {rate}）
        </span>
        <span>上下文 / 最大输出</span>
        <span>
          {tokens(match.contextTokens)} / {tokens(match.maxOutputTokens)}
          {capped && <span className="cell-sub">（平台最大输出上限 32,000，按 32,000 填）</span>}
        </span>
        <span>识图</span>
        <span>
          {match.supportsImage == null ? '没写' : match.supportsImage ? '支持' : '不支持'}
        </span>
      </div>
      <div className="field-help">
        填入的是官方售价（售价可以按需加价或打折）；成本价请按你在中转站的实际进价填。上下文越大，每条回复预扣的积分越多（回复完按实际用量退回）。
      </div>
    </div>
  );
}
