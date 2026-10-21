/*
 * 角色资料的编辑页（10-21 G2）：「设置备注和头像」从底部抽屉改成整页推入的二级页面。
 * 路由：/characters/:characterId/remark。
 * 3.27（H1，总经理 10-21）：「关系类型」页已删除——有好感度机制就不要关系选择，恋爱表达只随好感度阶段。
 */
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ContactsEndpoints } from '@weiban/contracts';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { friendlyError } from '../data/use-remote.js';
import { ContactAvatarEditor } from './contact-avatar-editor.js';
import { ClearInput, EditPage, useDraft } from './edit-page.js';
import { NavBar, SyncPendingState, useBack } from './shell-kit.js';

type ContactBody = { remark?: string | null };

function useContactSave(characterId: string, fallback: string) {
  const { assertOwner, synchronize } = useChat();
  const back = useBack(fallback);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function save(body: ContactBody) {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      assertOwner();
      await api.call(ContactsEndpoints.update, { params: { characterId }, body });
      await synchronize();
      back();
    } catch (e) {
      setError(friendlyError(e));
      setPending(false);
    }
  }
  return { pending, error, save };
}

function Missing({ title, fallback }: { title: string; fallback: string }) {
  const { state } = useChat();
  return (
    <main className="edit-page">
      <NavBar title={title} fallback={fallback} />
      {state.initialized ? (
        <p className="empty">TA 不在通讯录里</p>
      ) : (
        <SyncPendingState label="正在读取…" />
      )}
    </main>
  );
}

export function CharacterRemarkPage() {
  const { characterId = '' } = useParams();
  const { state } = useChat();
  const contact = state.contacts.find((item) => item.characterId === characterId);
  const fallback = `/characters/${characterId}`;
  if (!contact) return <Missing title="设置备注和头像" fallback={fallback} />;
  return (
    <RemarkEditor characterId={characterId} initial={contact.remark ?? ''} fallback={fallback} />
  );
}
function RemarkEditor({
  characterId,
  initial,
  fallback,
}: {
  characterId: string;
  initial: string;
  fallback: string;
}) {
  const draft = useDraft(initial);
  const { pending, error, save } = useContactSave(characterId, fallback);
  // 备注可以清空（恢复显示角色原名），所以只看有没有改动
  const submit = () => {
    if (draft.changed) void save({ remark: draft.value.trim() || null });
  };
  return (
    <EditPage
      title="设置备注和头像"
      canSave={draft.changed}
      pending={pending}
      onSave={submit}
      fallback={fallback}
    >
      <h2 className="edit-section">备注名</h2>
      <ClearInput
        label="备注名"
        value={draft.value}
        maxLength={20}
        placeholder="添加备注名"
        disabled={pending}
        onChange={draft.setValue}
        onEnter={submit}
      />
      {error && (
        <p role="alert" className="error page-note">
          {error}
        </p>
      )}
      <h2 className="edit-section">头像</h2>
      <div className="edit-group edit-avatar">
        {/* 头像选好裁剪后立即生效，不需要再点「完成」 */}
        <ContactAvatarEditor characterId={characterId} titled={false} />
      </div>
    </EditPage>
  );
}
