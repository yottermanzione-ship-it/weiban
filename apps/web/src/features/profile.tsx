import { showToast } from './toast.js';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { IdentityEndpoints } from '@weiban/contracts';
import { useRemote, friendlyError } from '../data/use-remote.js';
import { api } from '../data/client.js';
import { AvatarEditor } from './avatar-editor.js';
import { ProfileAvatar } from './profile-avatar.js';
import { useAuth } from '../app/auth.js';
import { AliasRow } from './profile-edit.js';
import { GroupHeader, MenuGroup, MenuRow, NavBar, Sheet } from './shell-kit.js';
import { REGION_GROUPS } from '../data/regions.js';
function OnboardingProfilePage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const firstUse = !auth.session?.user.profileCompleted;
  const remote = useRemote(IdentityEndpoints.getProfile);
  const [form, setForm] = useState({
    nickname: '',
    birthday: '',
    gender: 'unspecified',
    city: '',
    about: '',
  });
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (remote.data) {
      setForm({
        nickname: remote.data.nickname ?? '',
        birthday: remote.data.birthday ?? '',
        gender: remote.data.gender,
        city: remote.data.city ?? '',
        about: remote.data.about ?? '',
      });
      setLoaded(true);
    }
  }, [remote.data]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage('');
    try {
      const owner = {
        userId: auth.session!.user.userId,
        sessionId: auth.session!.session.sessionId,
      };
      if (!api.owns(owner)) throw new Error('会话已改变，请重新打开微伴');
      await api.call(IdentityEndpoints.updateProfile, {
        body: {
          nickname: form.nickname,
          birthday: form.birthday || null,
          gender: form.gender as 'female' | 'male' | 'other' | 'unspecified',
          city: form.city || null,
          about: form.about || null,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      });
      setMessage('已保存');
      if (!api.owns(owner)) throw new Error('会话已改变，请重新打开微伴');
      await auth.refreshUser();
      if (!api.owns(owner)) return;
      if (firstUse) navigate('/discover?onboarding=1', { replace: true });
      else remote.refresh();
    } catch (e) {
      setMessage(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="profile-edit">
      <NavBar
        title={firstUse ? 'TA 该怎么称呼你？' : '我的资料'}
        back={!firstUse}
        fallback="/me"
        left={
          firstUse ? (
            <button
              type="button"
              className="text-button text-action"
              onClick={() => void auth.logout()}
            >
              返回登录
            </button>
          ) : undefined
        }
        right={
          !firstUse && (
            <button
              type="submit"
              form="profile-form"
              className="text-button text-action"
              disabled={!loaded || pending || remote.loading}
            >
              保存
            </button>
          )
        }
      />
      <form id="profile-form" className="profile-form" onSubmit={(e) => void submit(e)}>
        <div className="avatar-block">
          <ProfileAvatar profile={remote.data} />
          <span className="hint">头像会显示在聊天和朋友圈里</span>
        </div>
        <MenuGroup className="avatar-editor-group">
          <AvatarEditor
            onSaved={async (mediaId) => {
              await api.call(IdentityEndpoints.updateProfile, {
                body: { avatarMediaId: mediaId },
              });
              remote.refresh();
              setMessage('头像已保存');
            }}
          />
        </MenuGroup>
        <div className="field-rows">
          <label className="field-row">
            <span>昵称</span>
            <input
              disabled={!loaded}
              value={form.nickname}
              onChange={(e) => setForm({ ...form, nickname: e.target.value })}
              required
              maxLength={20}
              placeholder="TA 会这样称呼你"
            />
          </label>
        </div>
        <GroupHeader>{firstUse ? '补充更多资料（可选）' : '更多资料'}</GroupHeader>
        <div className="field-rows">
          <label className="field-row">
            <span>生日</span>
            <input
              disabled={!loaded}
              type="date"
              value={form.birthday}
              onChange={(e) => setForm({ ...form, birthday: e.target.value })}
            />
          </label>
          <label className="field-row">
            <span>性别</span>
            <select
              disabled={!loaded}
              value={form.gender}
              onChange={(e) => setForm({ ...form, gender: e.target.value })}
            >
              <option value="unspecified">不填写</option>
              <option value="female">女</option>
              <option value="male">男</option>
              <option value="other">其他</option>
            </select>
          </label>
          <label className="field-row">
            <span>地区</span>
            <select
              disabled={!loaded}
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            >
              <option value="">不填写</option>
              {form.city && !REGION_GROUPS.some((g) => g.items.includes(form.city)) && (
                <option value={form.city}>{form.city}</option>
              )}
              {REGION_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.items.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="field-row top">
            <span>关于我</span>
            <textarea
              disabled={!loaded}
              value={form.about}
              onChange={(e) => setForm({ ...form, about: e.target.value })}
              maxLength={500}
              rows={3}
              placeholder="说说你自己"
            />
            <small className="field-count">{form.about.length}/500</small>
          </label>
        </div>
        <p className="hint page-note">这些信息所有角色都会知道。</p>
        {firstUse && (
          <div className="page-bottom">
            <button className="primary full" disabled={!loaded || pending || remote.loading}>
              下一步
            </button>
          </div>
        )}
        {(message || remote.error) && (
          <p role="status" className="hint page-note center">
            {message || remote.error}
          </p>
        )}
      </form>
    </main>
  );
}

export function ProfilePage() {
  const auth = useAuth();
  return auth.session?.user.profileCompleted ? <ProfileDetails /> : <OnboardingProfilePage />;
}
function ProfileDetails() {
  const remote = useRemote(IdentityEndpoints.getProfile);
  // 10-21 G2：昵称、性别、生日、地区、个性签名、微伴号改成整页推入的二级页面（profile-edit.tsx）；头像仍用原弹层。
  const [editingAvatar, setEditingAvatar] = useState(false);
  const [pending, setPending] = useState(false);
  const auth = useAuth();
  const genders = { female: '女', male: '男', other: '其他', unspecified: '未填写' };
  const profile = remote.data;
  return (
    <main>
      <NavBar title="个人信息" fallback="/me" />
      <MenuGroup>
        <MenuRow
          label="头像"
          right={<ProfileAvatar profile={profile} size={40} />}
          onClick={() => setEditingAvatar(true)}
        />
        <MenuRow label="昵称" value={profile?.nickname ?? '未填写'} to="/profile/nickname" />
        <AliasRow />
        <MenuRow
          label="二维码名片"
          right={<QrPlaceholder />}
          onClick={() => showToast('暂未开放', 2000, 'info')}
        />
        <MenuRow
          label="性别"
          value={profile ? genders[profile.gender] : '—'}
          to="/profile/gender"
        />
        <MenuRow label="生日" value={profile?.birthday || '未填写'} to="/profile/birthday" />
        <MenuRow label="地区" value={profile?.city || '未填写'} to="/profile/region" />
        <MenuRow label="个性签名" value={profile?.about || '未填写'} to="/profile/about" />
      </MenuGroup>
      {remote.error && (
        <p role="alert" className="notice-bar">
          {remote.error}
        </p>
      )}
      {editingAvatar && (
        <Sheet
          title="头像"
          onClose={() => {
            if (!pending) setEditingAvatar(false);
          }}
          closeLabel="取消"
        >
          <AvatarEditor
            onPendingChange={setPending}
            onSaved={async (mediaId) => {
              await api.call(IdentityEndpoints.updateProfile, { body: { avatarMediaId: mediaId } });
              remote.refresh();
              await auth.refreshUser();
              setEditingAvatar(false);
            }}
          />
        </Sheet>
      )}
    </main>
  );
}
function QrPlaceholder() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-label="二维码占位，暂未开放" role="img">
      <path
        d="M3 9V3h6 M17 3h6v6 M3 17v6h6 M17 23h6v-6"
        stroke="currentColor"
        fill="none"
        strokeWidth="2"
      />
      <text x="13" y="17" textAnchor="middle" fontSize="12" fill="currentColor">
        ?
      </text>
    </svg>
  );
}
