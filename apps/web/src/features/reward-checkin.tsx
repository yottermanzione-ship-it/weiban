import { useEffect, useRef, useState } from 'react';
import { BillingEndpoints } from '@weiban/contracts';
import { api } from '../data/client.js';
import { useRemote, friendlyError } from '../data/use-remote.js';
import { NavBar } from './shell-kit.js';
import './reward-checkin.css';

type Intent = { intentId: string; readyAt: string; expiresAt: string; points: number };
export function RewardCheckInPage({ standalone = false }: { standalone?: boolean } = {}) {
  const status = useRemote(BillingEndpoints.rewardStatus, { networkOnly: true });
  const wallet = useRemote(BillingEndpoints.getWallet, { networkOnly: true });
  const [intent, setIntent] = useState<Intent | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!intent) return;
    const tick = () =>
      setSeconds(Math.max(0, Math.ceil((Date.parse(intent.readyAt) - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [intent]);
  async function perform(run: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    setError('');
    setNotice('');
    try {
      await run();
      status.refresh();
      wallet.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : friendlyError(e));
    } finally {
      locked.current = false;
      setPending(false);
    }
  }
  const day = status.data;
  return (
    <main className="rewards-page">
      <NavBar title="每日签到" fallback="/wallet" back={!standalone} />
      <div className="rewards-body">
        {status.error && (
          <p role="alert">
            {status.error} <button onClick={status.refresh}>重试</button>
          </p>
        )}
        {!day ? (
          status.loading && <p role="status">正在读取今日进度…</p>
        ) : !day.available ? (
          <p>签到活动尚未开放。</p>
        ) : (
          <>
            <section className="rewards-card">
              <div className="rewards-date">{day.day} · 北京时间</div>
              <h2>{day.checkedIn ? '今天已签到' : '领取今天的签到积分'}</h2>
              <div className="rewards-amount">
                +{day.checkInPoints} <small>积分</small>
              </div>
              <button
                className="rewards-primary"
                disabled={pending || day.checkedIn}
                onClick={() =>
                  void perform(async () => {
                    await api.call(BillingEndpoints.checkIn);
                    setNotice('签到积分已存入钱包');
                  })
                }
              >
                {day.checkedIn ? '已领取' : '签到领取'}
              </button>
            </section>
            <section className="rewards-offer">
              <h2>看广告，再领 {day.adPoints} 积分</h2>
              <p>每天可自愿参加一次。完整观看后，奖励存入赠送积分余额。</p>
              {intent ? (
                <div className="rewards-player" aria-label="本地模拟广告">
                  <strong>本地模拟广告</strong>
                  <p>{seconds > 0 ? '体验倒计时 ' + seconds + ' 秒' : '体验完成，可以领取奖励'}</p>
                  <button
                    className="rewards-primary"
                    disabled={pending || seconds > 0}
                    onClick={() =>
                      void perform(async () => {
                        if (!import.meta.env.DEV || import.meta.env.MODE !== 'admin-preview')
                          throw new Error('当前环境没有配置广告平台');
                        const auth = await api.restore();
                        if (!auth) throw new Error('请先登录');
                        const res = await fetch(
                          '/api/v1/preview/rewards/' +
                            encodeURIComponent(intent.intentId) +
                            '/receipt',
                          {
                            method: 'POST',
                            headers: { Authorization: 'Bearer ' + auth.session.token },
                          },
                        );
                        if (!res.ok) throw new Error('领取失败，请刷新今日进度后重试');
                        setIntent(null);
                        setNotice('广告奖励已存入钱包');
                      })
                    }
                  >
                    领取 {intent.points} 积分
                  </button>
                  <button
                    className="rewards-link"
                    disabled={pending}
                    onClick={() =>
                      void perform(async () => {
                        await api.call(BillingEndpoints.cancelRewardAd, {
                          params: { intentId: intent.intentId },
                        });
                        setIntent(null);
                        setNotice('已退出，签到积分已保留');
                      })
                    }
                  >
                    退出体验
                  </button>
                </div>
              ) : (
                <button
                  className="rewards-secondary"
                  disabled={pending || !day.checkedIn || day.rewarded}
                  onClick={() =>
                    void perform(async () => {
                      const next = await api.call(BillingEndpoints.startRewardAd);
                      setSeconds(
                        Math.max(0, Math.ceil((Date.parse(next.readyAt) - Date.now()) / 1000)),
                      );
                      setIntent(next);
                    })
                  }
                >
                  {day.rewarded
                    ? '今日广告奖励已领取'
                    : !day.checkedIn
                      ? '签到后可参加'
                      : '观看模拟广告'}
                </button>
              )}
            </section>
            <div className="rewards-balance">
              <span>钱包赠送积分</span>
              <strong>{wallet.data?.bonusPoints?.toLocaleString('zh-CN') ?? '—'}</strong>
            </div>
          </>
        )}
        {notice && (
          <p role="status" className="rewards-notice">
            {notice}
          </p>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </main>
  );
}
