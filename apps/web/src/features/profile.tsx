import { useEffect, useState, type FormEvent } from 'react';
import { IdentityEndpoints } from '@weiban/contracts';
import { useRemote, friendlyError } from '../data/use-remote.js';
import { api } from '../data/client.js';
import { AvatarEditor } from './avatar-editor.js';
import { ProfileAvatar } from './profile-avatar.js';
import { useAuth } from '../app/auth.js';
export function ProfilePage() {
  const auth = useAuth();
  const remote = useRemote(IdentityEndpoints.getProfile);
  const [form, setForm] = useState({
    nickname: '',
    birthday: '',
    gender: 'unspecified',
    city: '',
    about: '',
  });
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (remote.data)
      setForm({
        nickname: remote.data.nickname ?? '',
        birthday: remote.data.birthday ?? '',
        gender: remote.data.gender,
        city: remote.data.city ?? '',
        about: remote.data.about ?? '',
      });
  }, [remote.data]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage('');
    try {
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
      await auth.refreshUser();
      remote.refresh();
    } catch (e) {
      setMessage(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <main>
      <h1 className="page-title">我的资料</h1>
      <form className="panel stack" onSubmit={(e) => void submit(e)}>
        <ProfileAvatar mediaId={remote.data?.avatarMediaId} />
        <AvatarEditor
          onSaved={async (mediaId) => {
            await api.call(IdentityEndpoints.updateProfile, { body: { avatarMediaId: mediaId } });
            remote.refresh();
            setMessage('头像已保存');
          }}
        />
        <label>
          昵称
          <input
            value={form.nickname}
            onChange={(e) => setForm({ ...form, nickname: e.target.value })}
            required
            maxLength={20}
          />
        </label>
        <label>
          生日
          <input
            type="date"
            value={form.birthday}
            onChange={(e) => setForm({ ...form, birthday: e.target.value })}
          />
        </label>
        <label>
          性别
          <select
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
            value={form.city}
            onChange={(e) => setForm({ ...form, city: e.target.value })}
            maxLength={32}
          />
        </label>
        <label>
          关于我
          <textarea
            value={form.about}
            onChange={(e) => setForm({ ...form, about: e.target.value })}
            maxLength={500}
          />
        </label>
        <p className="hint">这些信息所有角色都会知道。</p>
        <button className="primary" disabled={pending || remote.loading}>
          保存
        </button>
        <p role="status">{message || remote.error}</p>
      </form>
    </main>
  );
}
