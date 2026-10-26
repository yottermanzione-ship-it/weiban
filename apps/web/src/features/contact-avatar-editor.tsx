import { useState } from 'react';
import { ContactsEndpoints } from '@weiban/contracts';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { friendlyError } from '../data/use-remote.js';
import { AvatarEditor } from './avatar-editor.js';
import { showToast } from './toast.js';
export function ContactAvatarEditor({
  characterId,
  titled = true,
  prominentPicker = false,
  sheet = false,
  onClose,
}: {
  characterId: string;
  /** 弹层标题已是「设置头像」时不再重复小标题。 */
  titled?: boolean;
  /** 角色资料「设置头像」弹层：把整行选择头像放大居中；备注头像页保持原样。 */
  prominentPicker?: boolean;
  /** U2：直接弹出头像来源 Action Sheet（角色资料点头像）；结果用 Toast 提示。 */
  sheet?: boolean;
  onClose?(): void;
}) {
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
    if (sheet) showToast(mediaId ? '已设置，只有你能看到' : '已恢复默认头像', 2000, 'success');
    else setMessage(mediaId ? '已设置，只有你能看到' : '已恢复默认头像');
  }
  async function restore() {
    setPending(true);
    setError('');
    setMessage('');
    try {
      await update(null);
    } catch (failure) {
      if (sheet) showToast(friendlyError(failure), 2500, 'error');
      else setError(friendlyError(failure));
    } finally {
      setPending(false);
    }
  }
  if (!contact) return null;
  if (sheet)
    return (
      <AvatarEditor
        sheet
        onClose={onClose}
        purpose="contact_avatar"
        onSaved={update}
        onRestore={contact.customAvatarMediaId ? () => void restore() : undefined}
      />
    );
  return (
    <section className="panel stack" aria-label="设置角色头像">
      {titled && <h2>设置头像</h2>}
      <fieldset disabled={pending}>
        <AvatarEditor
          purpose="contact_avatar"
          prominentPicker={prominentPicker}
          onSaved={update}
          onPendingChange={setPending}
          onRestore={contact.customAvatarMediaId ? () => void restore() : undefined}
        />
      </fieldset>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
