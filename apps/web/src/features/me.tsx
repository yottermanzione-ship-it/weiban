import { Link } from 'react-router-dom';
import { CaretRight, Gear, Images, Smiley, Star, Wallet } from '@phosphor-icons/react';
import { BillingEndpoints, IdentityEndpoints, ModelAccessEndpoints } from '@weiban/contracts';
import { formatMoney } from '@weiban/client-core';
import { useAuth } from '../app/auth.js';
import { ProfileAvatar } from './profile-avatar.js';
import { useRemote } from '../data/use-remote.js';
import { useAchievementsDot, useCardsDot } from './cards.js';
import { PlayServiceCards } from './play.js';

export function MePage() {
  const { session } = useAuth();
  const profile = useRemote(IdentityEndpoints.getProfile);
  const wallet = useRemote(BillingEndpoints.getWallet);
  const lowBalance =
    wallet.data != null && wallet.data.availableMicros <= wallet.data.lowBalanceThresholdMicros;

  return (
    <main>
      <h1 className="page-title">我</h1>
      <Link className="panel profile-row" to="/profile">
        <ProfileAvatar profile={profile.data} />
        <div>
          <h2>{profile.data?.nickname ?? '填写你的昵称'}</h2>
          <p>微伴号：{session?.user.username}</p>
        </div>
        <CaretRight />
      </Link>
      <div className="panel rows">
        <Link to="/services">
          <Wallet size={24} />
          服务
          {lowBalance && <span className="red-dot" aria-label="余额不足" />}
          <CaretRight />
        </Link>
        <Link to="/me/favorites">
          <Star size={24} />
          收藏
          <CaretRight />
        </Link>
        <Link to="/me/moments">
          <Images size={24} />
          朋友圈
          <CaretRight />
        </Link>
        <Link to="/me/stickers">
          <Smiley size={24} />
          表情
          <CaretRight />
        </Link>
        <Link to="/settings">
          <Gear size={24} />
          设置
          <CaretRight />
        </Link>
      </div>
      {profile.error && <p role="alert">{profile.error}</p>}
    </main>
  );
}

export function ServicesPage() {
  const wallet = useRemote(BillingEndpoints.getWallet);
  const selection = useRemote(ModelAccessEndpoints.getSelection);
  const cards = useCardsDot();
  const achievements = useAchievementsDot();
  const lowBalance =
    wallet.data != null && wallet.data.availableMicros <= wallet.data.lowBalanceThresholdMicros;

  return (
    <main>
      <h1 className="page-title">服务</h1>

      {/* 顶部卡片：余额 + 当前聊天模型 */}
      <div className="panel service-top-card">
        <Link to="/wallet" className="service-top-item">
          <p className="hint">余额</p>
          <strong className={lowBalance ? 'error' : ''}>
            {wallet.data ? formatMoney(wallet.data.balanceMicros) : '—'}
            {lowBalance && <span className="hint"> 余额不足</span>}
          </strong>
        </Link>
        <Link to="/models" className="service-top-item">
          <p className="hint">聊天模型</p>
          <strong>{selection.data?.chat?.modelKey?.split('/')[1] ?? '平台默认'}</strong>
        </Link>
      </div>

      {/* 模型与花费 */}
      <section>
        <h2 className="section-label">模型与花费</h2>
        <div className="service-grid">
          <Link to="/ledger" className="service-card">
            余额明细<span>每笔扣费明细</span>
          </Link>
          <Link to="/prices" className="service-card">
            价目表<span>各模型单价</span>
          </Link>
          <Link to="/leaderboard" className="service-card">
            模型排行榜<span>哪个效果好</span>
          </Link>
          <Link to="/usage" className="service-card">
            花费统计<span>按天/角色/用途</span>
          </Link>
        </div>
      </section>

      {/* 陪伴 */}
      <section>
        <h2 className="section-label">陪伴</h2>
        <div className="service-grid">
          <Link to="/services/cards" className="service-card">
            卡册
            {cards.any && <span className="red-dot" aria-label="有新卡片" />}
            <span>和每个 TA 的纪念</span>
          </Link>
          <Link to="/services/achievements" className="service-card">
            成就
            {achievements.any && <span className="red-dot" aria-label="有新成就" />}
            <span>一起经历过的事</span>
          </Link>
          <Link to="/services/familiarity" className="service-card">
            熟悉度<span>和每个 TA 有多熟</span>
          </Link>
        </div>
      </section>

      {/* 互动偏好 */}
      <section>
        <h2 className="section-label">互动偏好</h2>
        <div className="service-grid">
          <Link to="/services/proactive" className="service-card">
            主动消息<span>开关与免打扰</span>
          </Link>
        </div>
      </section>

      {/* 互动玩法 */}
      <section>
        <h2 className="section-label">互动玩法</h2>
        <div className="service-grid">
          <Link to="/services/pets" className="service-card">
            宠物<span>和 TA 一起养一只小家伙</span>
          </Link>
          <Link to="/services/period" className="service-card">
            经期日记<span>加密保存，只有你授权的角色知道</span>
          </Link>
          <PlayServiceCards />
        </div>
      </section>
    </main>
  );
}
