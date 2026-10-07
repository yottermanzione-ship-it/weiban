import type { z } from 'zod';
import { useState, type FormEvent } from 'react';
import {
  BillingAdminEndpoints,
  ModelAccessAdminEndpoints,
  PriceUnit,
  AdminPriceVersion,
} from '@weiban/contracts';
import { formatMoney, yuanToMicros } from '@weiban/client-core';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { Feedback } from '../components/feedback.js';
type PriceVersion = z.infer<typeof AdminPriceVersion>;
type Row = {
  modelKey: string;
  unit: PriceUnit;
  price: string;
  cost: string;
  band: PriceVersion['items'][number]['band'];
};
const blank = (): Row => ({
  modelKey: '',
  unit: 'input_tokens_per_million',
  price: '0',
  cost: '0',
  band: null,
});
const labels: Record<PriceUnit, string> = {
  input_tokens_per_million: '输入 / 百万token',
  cached_input_tokens_per_million: '缓存输入 / 百万token',
  output_tokens_per_million: '输出 / 百万token',
  image: '每张图片',
  tts_10k_chars: '每万字语音',
  asr_minute: '每分钟识别',
  realtime_minute: '每分钟通话',
  search_call: '每次搜索',
};
export function PricesPage() {
  const list = useRemote(BillingAdminEndpoints.listPriceVersions);
  const catalog = useRemote(ModelAccessAdminEndpoints.listCatalog);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  function edit(version: PriceVersion, copy = false) {
    setDraftId(copy ? null : version.priceVersionId);
    setLabel(copy ? '' : version.versionLabel);
    setNote(version.note ?? '');
    setRows(
      version.items.map((r) => ({
        modelKey: r.modelKey,
        unit: r.unit,
        price: String(r.priceMicros / 1_000_000),
        cost: String(r.costMicros / 1_000_000),
        band: r.band,
      })),
    );
    setMessage(copy ? '已复制价格，请填写新版本名称后保存' : '正在编辑草稿');
  }
  function patch(index: number, value: Partial<Row>) {
    setRows((before) => before.map((r, i) => (i === index ? { ...r, ...value } : r)));
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      const items = rows.map((r) => ({
        modelKey: r.modelKey,
        unit: r.unit,
        priceMicros: yuanToMicros(r.price),
        costMicros: yuanToMicros(r.cost),
        band: r.band,
      }));
      const result = draftId
        ? await api.call(BillingAdminEndpoints.updatePriceDraft, {
            params: { priceVersionId: draftId },
            body: { note: note || null, items },
          })
        : await api.call(BillingAdminEndpoints.createPriceVersion, {
            body: { versionLabel: label, note: note || null, items },
          });
      setDraftId(result.priceVersionId);
      setMessage('价目草稿已保存');
      list.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }
  async function publish(version: PriceVersion) {
    setError('');
    if (!catalog.data) {
      setError('请先完成模型目录查询再发布');
      return;
    }
    const priced = new Set(version.items.map((p) => p.modelKey));
    const missing = catalog.data.items.filter((m) => m.enabled && !priced.has(m.modelKey));
    if (
      missing.length &&
      !window.confirm(
        `新版本未给以下启用模型定价：${missing.map((m) => `${m.displayName} (${m.modelKey})`).join('、')}。发布后这些模型将暂不可调用。确认发布？`,
      )
    )
      return;
    setPending(true);
    try {
      await api.call(BillingAdminEndpoints.activatePriceVersion, {
        params: { priceVersionId: version.priceVersionId },
        body: { effectiveFrom: null },
      });
      setMessage('新版本已立即生效，原版本已停用');
      if (draftId === version.priceVersionId) {
        setDraftId(null);
        setLabel('');
        setNote('');
        setRows([blank()]);
      }
      list.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <h1>价目表</h1>
      <form className="panel stack" onSubmit={(e) => void save(e)}>
        <h2>{draftId ? '编辑价格草稿' : '新建价格版本'}</h2>
        <div className="form-grid">
          <label>
            版本名称
            <input
              required
              maxLength={32}
              value={label}
              readOnly={!!draftId}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <label>
            备注
            <input maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>模型键</th>
                <th>单位</th>
                <th>售价（元）</th>
                <th>成本价（元）</th>
                <th>分时价</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <input
                      aria-label={`第${i + 1}行模型键`}
                      required
                      value={r.modelKey}
                      list="catalog-keys"
                      onChange={(e) => patch(i, { modelKey: e.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      aria-label={`第${i + 1}行单位`}
                      value={r.unit}
                      onChange={(e) => patch(i, { unit: PriceUnit.parse(e.target.value) })}
                    >
                      {PriceUnit.options.map((u) => (
                        <option key={u} value={u}>
                          {labels[u]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={`第${i + 1}行售价`}
                      required
                      inputMode="decimal"
                      value={r.price}
                      onChange={(e) => patch(i, { price: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`第${i + 1}行成本价`}
                      required
                      inputMode="decimal"
                      value={r.cost}
                      onChange={(e) => patch(i, { cost: e.target.value })}
                    />
                  </td>
                  <td>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={!!r.band}
                        onChange={(e) =>
                          patch(i, {
                            band: e.target.checked
                              ? {
                                  name: '分时段',
                                  weekdays: [1, 2, 3, 4, 5, 6, 7],
                                  start: '00:00',
                                  end: '08:00',
                                }
                              : null,
                          })
                        }
                      />
                      设置分时段
                    </label>
                    {r.band && (
                      <div className="stack">
                        <input
                          aria-label={`第${i + 1}行时段名称`}
                          maxLength={16}
                          value={r.band.name}
                          onChange={(e) => patch(i, { band: { ...r.band!, name: e.target.value } })}
                        />
                        <input
                          aria-label={`第${i + 1}行开始时间`}
                          type="time"
                          value={r.band.start}
                          onChange={(e) =>
                            patch(i, { band: { ...r.band!, start: e.target.value } })
                          }
                        />
                        <input
                          aria-label={`第${i + 1}行结束时间`}
                          type="time"
                          value={r.band.end}
                          onChange={(e) => patch(i, { band: { ...r.band!, end: e.target.value } })}
                        />
                        <fieldset>
                          <legend>生效星期</legend>
                          {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                            <label className="check" key={day}>
                              <input
                                type="checkbox"
                                checked={r.band!.weekdays.includes(day)}
                                onChange={(e) =>
                                  patch(i, {
                                    band: {
                                      ...r.band!,
                                      weekdays: e.target.checked
                                        ? [...r.band!.weekdays, day]
                                        : r.band!.weekdays.filter((d) => d !== day),
                                    },
                                  })
                                }
                              />
                              {day === 7 ? '日' : day}
                            </label>
                          ))}
                        </fieldset>
                      </div>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => setRows(rows.filter((_, index) => index !== i))}
                    >
                      移除行
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <datalist id="catalog-keys">
          {catalog.data?.items.map((m) => (
            <option key={m.modelKey} value={m.modelKey}>
              {m.displayName}
            </option>
          ))}
        </datalist>
        <div className="inline">
          <button type="button" onClick={() => setRows([...rows, blank()])}>
            添加价格行
          </button>
          <button className="primary" disabled={pending}>
            保存草稿
          </button>
          <button
            type="button"
            onClick={() => {
              setDraftId(null);
              setLabel('');
              setNote('');
              setRows([blank()]);
            }}
          >
            新建版本
          </button>
        </div>
      </form>
      <Feedback message={message} error={error || list.error || catalog.error} />
      <table>
        <thead>
          <tr>
            <th>版本</th>
            <th>状态</th>
            <th>模型与价格</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((v) => (
            <tr key={v.priceVersionId}>
              <td>{v.versionLabel}</td>
              <td>{{ draft: '草稿', active: '生效中', retired: '已停用' }[v.status]}</td>
              <td>
                {v.items.map((r, i) => (
                  <p key={i}>
                    {r.modelKey} · {labels[r.unit]} · 售价{formatMoney(r.priceMicros)} / 成本
                    {formatMoney(r.costMicros)}
                    {r.band ? `（${r.band.name}）` : ''}
                  </p>
                ))}
              </td>
              <td>
                {v.status === 'draft' ? (
                  <>
                    <button disabled={pending} onClick={() => edit(v)}>
                      编辑草稿
                    </button>
                    <button disabled={pending} onClick={() => void publish(v)}>
                      立即发布
                    </button>
                  </>
                ) : (
                  <button onClick={() => edit(v, true)}>复制调价</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
