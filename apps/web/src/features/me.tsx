/*
 * 我（docs/refactor/06-old-ui-spec.md 4.9）：没有顶栏，白色头卡从状态栏下开始；
 * 分组菜单用透明底彩色线图。服务页改为纯菜单列表（不做宫格）。
 */
import { Link } from 'react-router-dom';
import { BillingEndpoints, IdentityEndpoints, ModelAccessEndpoints } from '@weiban/contracts';
import { useAuth } from '../app/auth.js';
import { ProfileAvatar } from './profile-avatar.js';
import { useRemote } from '../data/use-remote.js';
import { OldImage } from './old-icons.js';
import { ComingSoonRow, Chevron, GroupHeader, MenuGroup, MenuRow, NavBar } from './shell-kit.js';
import { useAnnouncementUnread } from './release.js';
import { pointsText } from './points.js';

export function MePage() {
  const { session } = useAuth();
  const profile = useRemote(IdentityEndpoints.getProfile);
  const wallet = useRemote(BillingEndpoints.getWallet);
  const announcements = useAnnouncementUnread();
  const lowBalance =
    wallet.data != null &&
    (wallet.data.availablePoints ?? 0) <= (wallet.data.lowBalanceThresholdPoints ?? 0);

  return (
    <main className="me-page">
      <Link className="me-head" to="/profile" aria-label="我的资料">
        <ProfileAvatar profile={profile.data} />
        <span className="me-head-text">
          <h2>{profile.data?.nickname ?? '填写你的昵称'}</h2>
          <p>微伴号：{session?.user.username}</p>
          {wallet.data && (
            <span className="points-chip">
              <OldImage name="wechat/membership.webp" size={14} />
              {pointsText(wallet.data.balancePoints)}
            </span>
          )}
        </span>
        <Chevron />
      </Link>
      <MenuGroup>
        <MenuRow
          to="/services"
          image="wechat/profile_service.webp"
          iconSize={23}
          label="服务"
          dot={lowBalance}
        />
      </MenuGroup>
      <MenuGroup>
        <MenuRow to="/me/favorites" image="color/color_favorites.svg" iconSize={23} label="收藏" />
        <MenuRow to="/moments" icon="wechat/picture" tint="blue" label="朋友圈" />
        <ComingSoonRow id="channels" />
        <ComingSoonRow id="cards" />
        <MenuRow to="/me/stickers" icon="wechat/smile" tint="gold" label="表情" />
      </MenuGroup>
      <MenuGroup>
        <MenuRow
          to="/settings"
          image="color/color_settings.svg"
          iconSize={23}
          label="设置"
          dot={announcements > 0}
        />
      </MenuGroup>
      {profile.error && <p role="alert">{profile.error}</p>}
    </main>
  );
}

/**
 * 我 › 服务（4.9）：纯菜单列表。
 * 卡册、成就、宠物、玩法、经期日记都在小程序（发现 › 小程序）。
 */
export function ServicesPage() {
  const wallet = useRemote(BillingEndpoints.getWallet);
  const selection = useRemote(ModelAccessEndpoints.getSelection);
  const models = useRemote(ModelAccessEndpoints.listModels);
  const lowBalance =
    wallet.data != null &&
    (wallet.data.availablePoints ?? 0) <= (wallet.data.lowBalanceThresholdPoints ?? 0);
  const chatModel = selection.data?.chat?.modelKey;

  return (
    <main>
      <NavBar title="服务" fallback="/me" />
      <GroupHeader>钱包</GroupHeader>
      <MenuGroup>
        <MenuRow
          to="/wallet"
          image="wechat/membership.webp"
          iconSize={23}
          label="积分"
          dot={lowBalance}
          value={wallet.data ? pointsText(wallet.data.balancePoints) : '—'}
        />
        <MenuRow
          to="/models"
          icon="wechat/grid"
          tint="blue"
          label="模型"
          value={
            chatModel
              ? (models.data?.items.find((m) => m.modelKey === chatModel)?.displayName ??
                chatModel.split('/').pop())
              : '平台默认'
          }
        />
      </MenuGroup>
      <GroupHeader>模型与花费</GroupHeader>
      <MenuGroup>
        <MenuRow to="/ledger" icon="wechat/note" tint="orange" label="积分明细" />
        <MenuRow to="/prices" icon="wechat/tag" tint="green" label="AI 模型价格" />
        <MenuRow to="/leaderboard" icon="wechat/star" tint="gold" label="模型排行榜" />
        <MenuRow to="/usage" icon="wechat/bell" tint="cyan" label="用量" />
      </MenuGroup>
      <GroupHeader>偏好</GroupHeader>
      <MenuGroup>
        <MenuRow
          to="/services/proactive"
          icon="wechat/chat"
          tint="green"
          label="主动消息与免打扰"
        />
        <MenuRow to="/services/familiarity" icon="wechat/heart" tint="red" label="熟悉度总览" />
      </MenuGroup>
      <p className="hint page-note center">卡册、宠物、每日一问等玩法在「发现 › 小程序」</p>
    </main>
  );
}
