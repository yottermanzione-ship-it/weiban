import { useState } from 'react';
import { ContactsEndpoints } from '@weiban/contracts';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { friendlyError } from '../data/use-remote.js';
import { AvatarEditor } from './avatar-editor.js';
export function ContactAvatarEditor({ characterId }: { characterId: string }) {
  const { state, assertOwner, synchronize } = useChat();
  const contact = state.contacts.find((item) => item.characterId === characterId);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function update(mediaId: string | null) {
    assertOwner();
    await api.call(ContactsEndpoints.update, {
      params: { characterId },
      body: { customAvatarMediaId: mediaId },
    });
    await synchronize();
    setMessage(mediaId ? '已设置，只有你能看到' : '已恢复默认头像');
  }
  async function restore() {
    setPending(true);
    setError('');
    setMessage('');
    try {
      await update(null);
    } catch (failure) {
      setError(friendlyError(failure));
    } finally {
      setPending(false);
    }
  }
  if (!contact) return null;
  return (
    <section className="panel stack" aria-label="设置角色头像">
      <h2>设置头像</h2>
      <p>上传的头像只有你自己能看到，其他人看到的角色头像不会改变</p>
      <fieldset disabled={pending}>
        <AvatarEditor purpose="contact_avatar" onSaved={update} onPendingChange={setPending} />
      </fieldset>
      {contact.customAvatarMediaId && (
        <button disabled={pending} onClick={() => void restore()}>
          恢复默认头像
        </button>
      )}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
