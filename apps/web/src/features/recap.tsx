/**
 * 年度回忆自动展示（10-25 会员 v6，PRO+ 权益）。
 *
 * 产品边界：只在 App 外壳挂这一个组件。登录后在后台问服务器「有没有已经生成、我还没看过的那一份」，
 * 有就直接弹出**完整**回顾（可关闭）。关掉即确认看过，之后不再自动弹。
 *
 * 刻意没有：独立页面 / 路由、「我 · 服务 · 记忆」入口、年度列表、按年份查询、手动生成按钮。
 * 服务端 12-31 22:00 才生成，客户端改日期也提前拿不到（只认服务器写过的行）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { RecapEndpoints, type AnnualRecap } from '@weiban/contracts';
import { api } from '../data/client.js';
import { useUpdates } from '../data/updates.js';
import { Dialog } from './toast.js';

export function RecapAutoShow() {
  const [recap, setRecap] = useState<AnnualRecap | null>(null);
  // 已经弹过 / 已确认的那一份不再重复弹（同一会话里实时更新可能再来一次）。
  const consumed = useRef(new Set<string>());

  const load = useCallback(() => {
    void api
      .call(RecapEndpoints.pending, { networkOnly: true })
      .then((result) => {
        if (!result.recap || consumed.current.has(result.recap.recapId)) return;
        setRecap(result.recap);
      })
      // 未登录 / 网络失败都安静跳过：年度回忆不该打扰聊天。
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useUpdates((update) => {
    if (update.type !== 'data.changed') return;
    const section = (update.data as { section?: string } | undefined)?.section;
    if (section === 'recap') load();
  });

  if (!recap) return null;

  function close() {
    if (!recap) return;
    consumed.current.add(recap.recapId);
    setRecap(null);
    // 确认看过：失败也不弹错误（下次打开还会看到，不会丢）。
    void api.call(RecapEndpoints.markSeen).catch(() => undefined);
  }

  return (
    <Dialog
      title={`${recap.year} 年度回忆`}
      actions={[{ label: '收下', tone: 'primary', onClick: close }]}
    >
      <div style={{ maxHeight: '52vh', overflowY: 'auto', textAlign: 'left' }}>
        {recap.lines.map((line, index) => (
          // 文案是服务端确定性生成的，可能有重复句式，用下标做 key 更稳。
          <p key={`${index}-${line}`}>{line}</p>
        ))}
        <small className="hint">{recap.cutoffNote}</small>
        {recap.caveat && <small className="hint">{recap.caveat}</small>}
      </div>
    </Dialog>
  );
}
