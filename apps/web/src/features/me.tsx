import { Link } from 'react-router-dom';
import { CaretRight, Gear, Wallet } from '@phosphor-icons/react';
import { IdentityEndpoints } from '@weiban/contracts';
import { useAuth } from '../app/auth.js';
import { ProfileAvatar } from './profile-avatar.js';
import { useRemote } from '../data/use-remote.js';
export function MePage() {
  const { session } = useAuth();
  const profile = useRemote(IdentityEndpoints.getProfile);
  return (
    <main>
      <h1 className="page-title">我</h1>
      <Link className="panel profile-row" to="/profile">
        <ProfileAvatar mediaId={profile.data?.avatarMediaId} />
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
  return (
    <main>
      <h1 className="page-title">服务</h1>
      <div className="service-grid">
        <Link to="/wallet" className="service-card">
          余额<span>查看余额与明细</span>
        </Link>
        <Link to="/models" className="service-card">
          模型<span>选择聊天与后台模型</span>
        </Link>
      </div>
      <div className="panel rows">
        <Link to="/ledger">
          余额明细
          <CaretRight />
        </Link>
        <Link to="/prices">
          价目表
          <CaretRight />
        </Link>
      </div>
    </main>
  );
}
