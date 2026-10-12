import { Link } from 'react-router-dom';
import {
  CaretRight,
  ChartBar,
  CurrencyCny,
  Gauge,
  Gear,
  Images,
  Moon,
  Plus,
  QrCode,
  Receipt,
  Smiley,
  Star,
  Trophy,
  Wallet,
} from '@phosphor-icons/react';
import { BillingEndpoints, IdentityEndpoints, ModelAccessEndpoints } from '@weiban/contracts';
import { formatMoney } from '@weiban/client-core';
import { useAuth } from '../app/auth.js';
import { ProfileAvatar } from './profile-avatar.js';
import { useRemote } from '../data/use-remote.js';
import { ComingSoonRow, MenuGroup, MenuRow, NavBar, comingSoonPath } from './shell-kit.js';
import { useAnnouncementUnread } from './release.js';

/** 我（docs/refactor/02a 第 4 节）。二维码名片、状态、视频号、卡包按总经理要求放上，点进去是「暂未开放」。 */
export function MePage() {
  const { session } = useAuth();
  const profile = useRemote(IdentityEndpoints.getProfile);
  const wallet = useRemote(BillingEndpoints.getWallet);
  const announcements = useAnnouncementUnread();
  const lowBalance =
    wallet.data != null && wallet.data.availableMicros <= wallet.data.lowBalanceThresholdMicros;

  return (
    <main>
      <div className="me-head">
        <Link to="/profile" aria-label="我的资料">
          <ProfileAvatar profile={profile.data} />
        </Link>
        <div>
          <Link to="/profile">
            <h2>{profile.data?.nickname ?? '填写你的昵称'}</h2>
          </Link>
          <p>微伴号：{session?.user.username}</p>
          <Link className="status-chip" to={comingSoonPath('status')}>
            <Plus size={12} aria-hidden /> 状态
          </Link>
        </div>
        <span className="me-head-actions">
          <Link to={comingSoonPath('qrcode')} aria-label="二维码名片">
            <QrCode size={20} />
          </Link>
          <Link to="/profile" aria-label="我的资料">
            <CaretRight size={20} />
          </Link>
        </span>
      </div>
      <MenuGroup>
        <MenuRow to="/services" icon={Wallet} tint="brand" label="服务" dot={lowBalance} />
      </MenuGroup>
      <MenuGroup>
        <MenuRow to="/me/favorites" icon={Star} tint="gold" label="收藏" />
        <MenuRow to="/me/moments" icon={Images} tint="blue" label="朋友圈" />
        <ComingSoonRow id="channels" />
        <ComingSoonRow id="cards" />
        <MenuRow to="/me/stickers" icon={Smiley} tint="gold" label="表情" />
      </MenuGroup>
      <MenuGroup>
        <MenuRow to="/settings" icon={Gear} tint="blue" label="设置" dot={announcements > 0} />
      </MenuGroup>
      {profile.error && <p role="alert">{profile.error}</p>}
    </main>
  );
}

/**
 * 我 › 服务（瘦身后：钱包卡 + 模型与花费 + 偏好，docs/refactor/02 第 3.5 节）。
 * 卡册、成就、宠物、玩法、经期日记都搬进了小程序（发现 › 小程序）。
 */
export function ServicesPage() {
  const wallet = useRemote(BillingEndpoints.getWallet);
  const selection = useRemote(ModelAccessEndpoints.getSelection);
  const models = useRemote(ModelAccessEndpoints.listModels);
  const lowBalance =
    wallet.data != null && wallet.data.availableMicros <= wallet.data.lowBalanceThresholdMicros;
  const chatModel = selection.data?.chat?.modelKey;

  return (
    <main>
      <NavBar title="服务" fallback="/me" />
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
          <strong>
            {chatModel
              ? (models.data?.items.find((m) => m.modelKey === chatModel)?.displayName ??
                chatModel.split('/').pop())
              : '平台默认'}
          </strong>
        </Link>
      </div>
      <h2 className="section-label">模型与花费</h2>
      <MenuGroup>
        <MenuRow to="/ledger" icon={Receipt} tint="teal" label="余额明细" value="每笔扣费" />
        <MenuRow to="/prices" icon={CurrencyCny} tint="gold" label="价目表" value="各模型单价" />
        <MenuRow to="/leaderboard" icon={Trophy} tint="orange" label="模型排行榜" />
        <MenuRow
          to="/usage"
          icon={ChartBar}
          tint="blue"
          label="花费统计"
          value="按天 / 角色 / 用途"
        />
      </MenuGroup>
      <h2 className="section-label">偏好</h2>
      <MenuGroup>
        <MenuRow to="/services/proactive" icon={Moon} tint="lilac" label="主动消息与免打扰" />
        <MenuRow to="/services/familiarity" icon={Gauge} tint="pink" label="熟悉度总览" />
      </MenuGroup>
      <p className="hint center">卡册、宠物、每日一问等玩法在「发现 › 小程序」</p>
    </main>
  );
}
