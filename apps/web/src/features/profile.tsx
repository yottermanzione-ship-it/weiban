import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { IdentityEndpoints } from '@weiban/contracts';
import { useRemote, friendlyError } from '../data/use-remote.js';
import { api } from '../data/client.js';
import { AvatarEditor } from './avatar-editor.js';
import { ProfileAvatar } from './profile-avatar.js';
import { useAuth } from '../app/auth.js';
export function ProfilePage() {
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
    <main>
      <h1 className="page-title">{firstUse ? 'TA 该怎么称呼你？' : '我的资料'}</h1>
      <form className="panel stack" onSubmit={(e) => void submit(e)}>
        <label>
          昵称
          <input
            disabled={!loaded}
            value={form.nickname}
            onChange={(e) => setForm({ ...form, nickname: e.target.value })}
            required
            maxLength={20}
          />
        </label>
        <details open={firstUse ? undefined : true}>
          <summary>补充更多资料（可选）</summary>
          <div className="stack">
            <ProfileAvatar profile={remote.data} />
            <AvatarEditor
              onSaved={async (mediaId) => {
                await api.call(IdentityEndpoints.updateProfile, {
                  body: { avatarMediaId: mediaId },
                });
                remote.refresh();
                setMessage('头像已保存');
              }}
            />
            <label>
              生日
              <input
                disabled={!loaded}
                type="date"
                value={form.birthday}
                onChange={(e) => setForm({ ...form, birthday: e.target.value })}
              />
            </label>
            <label>
              性别
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
            <label>
              所在城市
              <input
                disabled={!loaded}
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                maxLength={32}
              />
            </label>
            <label>
              关于我
              <textarea
                disabled={!loaded}
                value={form.about}
                onChange={(e) => setForm({ ...form, about: e.target.value })}
                maxLength={500}
              />
            </label>
            <p className="hint">这些信息所有角色都会知道。</p>
          </div>
        </details>
        <button className="primary" disabled={!loaded || pending || remote.loading}>
          {firstUse ? '下一步' : '保存'}
        </button>
        <p role="status">{message || remote.error}</p>
      </form>
    </main>
  );
}
