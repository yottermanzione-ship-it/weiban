import { useCallback, useEffect, useRef, useState } from 'react';
import { ContactsEndpoints, type Contact } from '@weiban/contracts';
import { useAuth } from '../app/auth.js';
import { api } from '../data/client.js';
import { useCharacterNames } from '../data/character-names.js';
import { useContactOrganization } from '../data/stars.js';
import {
  LEGACY_STARS_KEY,
  legacyStarCandidates,
  type OrganizationOperation,
} from '../data/contact-organization.js';
import { AlertDialog, showToast } from './toast.js';
import { GroupHeader, MenuGroup, MenuRow, NavBar } from './shell-kit.js';
import { ClearInput, SubPageLayer } from './edit-page.js';
import './contact-organization.css';

export function OrganizationSyncNotice({ onSaved, onEdit }: { onSaved?(): void; onEdit?(): void }) {
  const org = useContactOrganization();
  if (org.loading && !org.snapshot)
    return (
      <p className="page-note" role="status">
        正在同步星标和标签…
      </p>
    );
  if (!org.error) return null;
  return (
    <div className="organization-notice" role="alert">
      <p>{org.error}</p>
      {org.pendingOperation && (org.problem === 'conflict' || org.problem === 'network') && (
        <button
          type="button"
          className="text-button"
          disabled={org.busy || org.loading}
          onClick={async () => {
            if (await org.controller?.retry()) onSaved?.();
          }}
        >
          {org.busy
            ? '正在保存…'
            : org.problem === 'conflict'
              ? '确认保存这次修改'
              : '重试这次保存'}
        </button>
      )}
      {!org.pendingOperation && (
        <button
          type="button"
          className="text-button"
          disabled={org.loading}
          onClick={() => void org.controller?.refresh()}
        >
          重试同步
        </button>
      )}
      {org.pendingOperation && !org.controller?.uncertain && (
        <button
          type="button"
          className="text-button"
          disabled={org.busy}
          onClick={() => {
            org.controller?.continueEditing();
            onEdit?.();
          }}
        >
          {onEdit ? '继续编辑' : '取消这次修改'}
        </button>
      )}
    </div>
  );
}
type Editor = {
  kind: 'stars' | 'tag';
  mode: 'create' | 'update';
  tagId: string;
  name: string;
  characterIds: string[];
  revision: number;
};
const readLegacy = () => {
  try {
    return localStorage.getItem(LEGACY_STARS_KEY);
  } catch {
    return null;
  }
};
export function ContactOrganizationPage() {
  const { session } = useAuth();
  const owner = session
    ? { userId: session.user.userId, sessionId: session.session.sessionId }
    : null;
  return owner && api.owns(owner) ? (
    <OwnedOrganization
      key={`${owner.userId}:${owner.sessionId}`}
      account={session!.user.username}
    />
  ) : (
    <main>
      <NavBar title="标签与星标" fallback="/contacts" />
      <p className="page-note">请登录后管理自己的标签与星标。</p>
    </main>
  );
}
function OwnedOrganization({ account }: { account: string }) {
  const org = useContactOrganization(),
    controller = org.controller;
  const [contacts, setContacts] = useState<Contact[]>([]),
    [contactsReady, setContactsReady] = useState(false),
    [contactsError, setContactsError] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null),
    [deleting, setDeleting] = useState<{ tagId: string; name: string; revision: number } | null>(
      null,
    );
  const [legacyRaw] = useState(readLegacy),
    [claim, setClaim] = useState<
      (ReturnType<typeof legacyStarCandidates> & { revision: number }) | null
    >(null),
    [claimBusy, setClaimBusy] = useState(false);
  const requests = useRef(new Set<AbortController>()),
    mounted = useRef(true);
  const activeIds = contacts.map((contact) => contact.characterId),
    names = useCharacterNames(activeIds);
  const label = (id: string) =>
    contacts.find((contact) => contact.characterId === id)?.remark ||
    names[id] ||
    '好友资料暂未读取';
  const loadContacts = useCallback(async () => {
    if (!controller?.isCurrent()) return null;
    const request = new AbortController();
    requests.current.add(request);
    setContactsError('');
    try {
      const result = await api.call(ContactsEndpoints.list, {
        networkOnly: true,
        signal: request.signal,
      });
      if (!mounted.current || request.signal.aborted || !controller.isCurrent()) return null;
      const active = result.items.filter((contact) => contact.status === 'active');
      setContacts(active);
      setContactsReady(true);
      return active;
    } catch {
      if (mounted.current && !request.signal.aborted && controller.isCurrent())
        setContactsError('好友列表暂未读取，请重试。');
      return null;
    } finally {
      requests.current.delete(request);
    }
  }, [controller]);
  useEffect(() => {
    mounted.current = true;
    void loadContacts();
    const pending = requests.current;
    return () => {
      mounted.current = false;
      for (const request of pending) request.abort();
      pending.clear();
    };
  }, [loadContacts]);
  const available = new Set(activeIds),
    unavailable = editor?.characterIds.filter((id) => !available.has(id)) ?? [];
  const locked = org.busy || !!org.pendingOperation;
  const completed = () => {
    if (!controller?.isCurrent()) return;
    setEditor(null);
    setDeleting(null);
    setClaim(null);
    showToast('已保存并同步', 2000, 'success');
  };
  async function saveEditor() {
    if (!editor || !org.ready || !contactsReady || unavailable.length || !controller) return;
    const operation: OrganizationOperation =
      editor.kind === 'stars'
        ? { type: 'replace-stars', characterIds: editor.characterIds }
        : {
            type: editor.mode === 'create' ? 'create-tag' : 'update-tag',
            tag: { tagId: editor.tagId, name: editor.name, characterIds: editor.characterIds },
          };
    if (await controller.change(operation, editor.revision)) completed();
  }
  async function previewClaim() {
    if (!controller?.isCurrent() || !org.ready || locked) return;
    setClaimBusy(true);
    const current = await loadContacts();
    await controller.refresh();
    const cloud = controller.snapshot().snapshot;
    if (controller.isCurrent() && mounted.current && current && cloud)
      setClaim({
        ...legacyStarCandidates(
          legacyRaw,
          current.map((item) => item.characterId),
        ),
        revision: cloud.revision,
      });
    if (controller.isCurrent() && mounted.current) setClaimBusy(false);
  }
  const snapshot = org.snapshot;
  const deletedWhileEditing =
    editor?.kind === 'tag' &&
    editor.mode === 'update' &&
    snapshot &&
    !snapshot.tags.some((tag) => tag.tagId === editor.tagId);
  return (
    <main className="organization-page">
      <NavBar title="标签与星标" fallback="/contacts" />
      <p className="page-note">星标和标签跟随当前账号同步到其他设备。</p>
      {!editor && <OrganizationSyncNotice onSaved={completed} />}
      {contactsError && (
        <div className="organization-notice" role="alert">
          <p>{contactsError}</p>
          <button className="text-button" onClick={() => void loadContacts()}>
            重试读取好友
          </button>
        </div>
      )}
      <GroupHeader>星标朋友</GroupHeader>
      <MenuGroup>
        <MenuRow
          label="管理星标朋友"
          subtitle={
            snapshot ? `已星标 ${snapshot.starredCharacterIds.length} 位朋友` : '正在读取云端记录'
          }
          disabled={!org.ready || !contactsReady || locked}
          onClick={() =>
            setEditor({
              kind: 'stars',
              mode: 'update',
              tagId: '',
              name: '',
              characterIds: [...snapshot!.starredCharacterIds],
              revision: snapshot!.revision,
            })
          }
        />
      </MenuGroup>
      <GroupHeader>我的标签</GroupHeader>
      <MenuGroup>
        {snapshot?.tags.map((tag) => (
          <MenuRow
            key={tag.tagId}
            label={tag.name}
            subtitle={tag.characterIds.length ? `${tag.characterIds.length} 位朋友` : '还没有成员'}
            disabled={!org.ready || !contactsReady || locked}
            onClick={() =>
              setEditor({
                kind: 'tag',
                mode: 'update',
                tagId: tag.tagId,
                name: tag.name,
                characterIds: [...tag.characterIds],
                revision: snapshot.revision,
              })
            }
          />
        ))}
        <MenuRow
          label="新建标签"
          disabled={!org.ready || !contactsReady || locked || (snapshot?.tags.length ?? 0) >= 100}
          onClick={() =>
            setEditor({
              kind: 'tag',
              mode: 'create',
              tagId: crypto.randomUUID(),
              name: '',
              characterIds: [],
              revision: snapshot!.revision,
            })
          }
        />
      </MenuGroup>
      {snapshot?.tags.length === 0 && (
        <p className="page-note">给朋友分个组，之后可以在通讯录按标签查看。</p>
      )}
      {legacyStarCandidates(legacyRaw, []).present && (
        <details className="organization-legacy">
          <summary>此设备有旧星标记录</summary>
          <p>旧记录没有标明所属账号。只有你确认属于当前账号后，才会导入。设备原记录不会删除。</p>
          <button
            type="button"
            className="text-button"
            disabled={!org.ready || locked || claimBusy}
            onClick={() => void previewClaim()}
          >
            {claimBusy ? '正在核对当前好友…' : '查看并确认归属'}
          </button>
        </details>
      )}
      {editor && (
        <SubPageLayer
          title={
            editor.kind === 'stars'
              ? '星标朋友'
              : editor.mode === 'create'
                ? '新建标签'
                : '编辑标签'
          }
          canSave={
            !locked &&
            contactsReady &&
            unavailable.length === 0 &&
            (editor.kind === 'stars' || editor.name.trim().length > 0)
          }
          pending={org.busy}
          onCancel={() => {
            setEditor(null);
            if (!controller?.uncertain) controller?.continueEditing();
          }}
          onSave={() => void saveEditor()}
        >
          <OrganizationSyncNotice
            onSaved={completed}
            onEdit={() => {
              setEditor((value) =>
                value ? { ...value, revision: snapshot?.revision ?? value.revision } : value,
              );
              void loadContacts();
            }}
          />
          {org.problem === 'conflict' && (
            <p className="page-note">
              {editor.kind === 'stars'
                ? `云端当前有 ${snapshot?.starredCharacterIds.length ?? 0} 位星标。确认后只替换星标，标签保持最新。`
                : '确认后只保存这个标签的编辑，其他标签和星标保持最新。'}
            </p>
          )}
          {deletedWhileEditing && (
            <div className="organization-notice">
              <p>这个标签已从云端移除。你的编辑仍在这里，可以另存为新标签。</p>
              <button
                className="text-button"
                disabled={org.busy || controller?.uncertain}
                onClick={() => {
                  controller?.continueEditing();
                  setEditor({
                    ...editor,
                    mode: 'create',
                    tagId: crypto.randomUUID(),
                    revision: snapshot!.revision,
                  });
                }}
              >
                另存为新标签
              </button>
            </div>
          )}
          {editor.kind === 'tag' && (
            <MenuGroup>
              <label className="menu-row organization-name">
                <span>标签名称</span>
                <ClearInput
                  label="标签名称"
                  value={editor.name}
                  maxLength={100}
                  disabled={locked}
                  onChange={(name) => setEditor({ ...editor, name })}
                />
              </label>
            </MenuGroup>
          )}
          <p className="page-note">
            已选择 {editor.characterIds.length} 位朋友
            {editor.kind === 'tag' ? '，可随时调整成员。' : '，保存后会同步到其他设备。'}
          </p>
          {unavailable.length > 0 && (
            <div className="organization-notice">
              <p>{unavailable.length} 位好友已不可用，保存前请移除这些选择。</p>
              <button
                className="text-button"
                disabled={locked}
                onClick={() =>
                  setEditor({
                    ...editor,
                    characterIds: editor.characterIds.filter((id) => available.has(id)),
                  })
                }
              >
                移除不可用的选择
              </button>
            </div>
          )}
          <MenuGroup>
            {contacts.map((contact) => (
              <label className="menu-row organization-member" key={contact.characterId}>
                <span>{label(contact.characterId)}</span>
                <input
                  type="checkbox"
                  className="select-box"
                  aria-label={label(contact.characterId)}
                  checked={editor.characterIds.includes(contact.characterId)}
                  disabled={locked}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      characterIds: event.target.checked
                        ? [...editor.characterIds, contact.characterId]
                        : editor.characterIds.filter((id) => id !== contact.characterId),
                    })
                  }
                />
              </label>
            ))}
          </MenuGroup>
          {contactsReady && contacts.length === 0 && (
            <p className="empty">暂时没有可选择的好友。</p>
          )}
          {editor.kind === 'tag' && editor.mode === 'update' && !deletedWhileEditing && (
            <MenuGroup>
              <MenuRow
                label="删除这个标签"
                danger
                disabled={locked}
                onClick={() =>
                  setDeleting({ tagId: editor.tagId, name: editor.name, revision: editor.revision })
                }
              />
            </MenuGroup>
          )}
        </SubPageLayer>
      )}
      {deleting && (
        <AlertDialog
          title="删除标签？"
          message={`只删除「${deleting.name}」这个标签，里面的朋友仍在通讯录。`}
          confirmLabel="删除标签"
          pending={org.busy}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            const value = deleting;
            setDeleting(null);
            if (
              await controller?.change({ type: 'delete-tag', tagId: value.tagId }, value.revision)
            )
              completed();
          }}
        />
      )}
      {claim && (
        <AlertDialog
          title="确认旧星标归当前账号？"
          confirmLabel={claim.characterIds.length ? '覆盖云端星标' : '返回'}
          pending={org.busy}
          onCancel={() => setClaim(null)}
          onConfirm={async () => {
            if (!claim.characterIds.length) {
              setClaim(null);
              return;
            }
            const selected = claim.characterIds;
            setClaim(null);
            if (
              await controller?.change(
                { type: 'replace-stars', characterIds: selected },
                claim.revision,
              )
            )
              completed();
          }}
          message={
            <>
              <p>
                当前账号：{account}。确认这些旧记录属于你后，将用以下 {claim.characterIds.length}{' '}
                位好友覆盖云端星标。云端标签和此设备原记录不会删除。
              </p>
              <p>{claim.unavailable} 条记录不可用，不会导入，也不会恢复已删除好友。</p>
              {claim.characterIds.length ? (
                <ul className="organization-claim-list">
                  {claim.characterIds.map((id) => (
                    <li key={id}>{label(id)}</li>
                  ))}
                </ul>
              ) : (
                <p>没有可导入的当前好友，云端星标保持原样。</p>
              )}
            </>
          }
        />
      )}
    </main>
  );
}
