/*
 * 我（docs/refactor/06-old-ui-spec.md 4.9）：没有顶栏，白色头卡从状态栏下开始；
 * 分组菜单用透明底彩色线图。服务页改为纯菜单列表（不做宫格）。
 */
import { Link } from 'react-router-dom';
import {
  BillingEndpoints,
  IdentityEndpoints,
  MembershipEndpoints,
  ModelAccessEndpoints,
} from '@weiban/contracts';
import { useAuth } from '../app/auth.js';
import { ProfileAvatar } from './profile-avatar.js';
import { useRemote } from '../data/use-remote.js';
import { OldImage } from './old-icons.js';
import { ComingSoonRow, Chevron, GroupHeader, MenuGroup, MenuRow, NavBar } from './shell-kit.js';
import { useAnnouncementUnread } from './release.js';
import { pointsText } from './points.js';
import { MyStatusChip } from './user-status.js';

export function MePage() {
  const { session } = useAuth();
  const profile = useRemote(IdentityEndpoints.getProfile);
  const alias = useRemote(IdentityEndpoints.getAlias);
  const wallet = useRemote(BillingEndpoints.getWallet);
  const announcements = useAnnouncementUnread();
  const lowBalance =
    wallet.data != null &&
    (wallet.data.availablePoints ?? 0) <= (wallet.data.lowBalanceThresholdPoints ?? 0);

  return (
    <main className="me-page">
      {/* F1-4：整张头卡点开资料；状态胶囊是卡上独立的按钮（参照微信「我」页）。 */}
      <div className="me-head">
        <Link className="me-head-cover" to="/profile" aria-label="我的资料" />
        <ProfileAvatar profile={profile.data} />
        <span className="me-head-text">
          <h2>{profile.data ? (profile.data.nickname ?? '填写你的昵称') : ' '}</h2>
          <p>微伴号：{alias.data?.username ?? session?.user.username}</p>
          <span className="me-head-chips">
            <MyStatusChip />
            {wallet.data && (
              <span className="points-chip">
                <OldImage name="wechat/membership.webp" size={14} />
                {pointsText(wallet.data.balancePoints)}
              </span>
            )}
          </span>
        </span>
        <Chevron />
      </div>
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
  const membership = useRemote(MembershipEndpoints.get);
  const scenarios = useRemote(ModelAccessEndpoints.getScenarioConfig, { networkOnly: true });
  const models = useRemote(ModelAccessEndpoints.listModels);
  const lowBalance =
    wallet.data != null &&
    (wallet.data.availablePoints ?? 0) <= (wallet.data.lowBalanceThresholdPoints ?? 0);
  const chatModel = scenarios.data?.scenarios.find((s) => s.scenario === 'chat')?.selection
    ?.modelKey;

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
        <MenuRow to="/wallet/recharge" icon="wechat/transfer" tint="gold" label="充值" />
        <MenuRow
          to="/membership"
          icon="wechat/star"
          tint="orange"
          label="PRO+ 会员"
          value={membership.data?.tier === 'pro_plus' ? 'PRO+' : '免费'}
        />
      </MenuGroup>
      <GroupHeader>消费记录</GroupHeader>
      <MenuGroup>
        <MenuRow to="/ledger" icon="wechat/note" tint="orange" label="积分明细" />
        <MenuRow to="/usage" icon="wechat/bell" tint="cyan" label="用量" />
      </MenuGroup>
      <GroupHeader>模型</GroupHeader>
      <MenuGroup>
        <MenuRow
          to="/models"
          icon="wechat/grid"
          tint="blue"
          label="模型配置"
          dot={scenarios.data?.needsSetup === true}
          value={
            chatModel
              ? (models.data?.items.find((m) => m.modelKey === chatModel)?.displayName ??
                chatModel.split('/').pop())
              : '未配置'
          }
        />
        <MenuRow to="/prices" icon="wechat/tag" tint="green" label="AI 模型价格" />
        <MenuRow to="/leaderboard" icon="wechat/star" tint="gold" label="模型排行榜" />
      </MenuGroup>
      <GroupHeader>偏好</GroupHeader>
      <MenuGroup>
        <MenuRow to="/services/ecology" icon="wechat/star" tint="green" label="角色生态" />
        <MenuRow to="/settings/plugins" icon="wechat/grid" tint="indigo" label="插件" />
        <MenuRow to="/services/familiarity" icon="wechat/heart" tint="red" label="好感度总览" />
      </MenuGroup>
      <p className="hint page-note center">卡册、宠物、每日一问等玩法在「发现 › 小程序」</p>
    </main>
  );
}
