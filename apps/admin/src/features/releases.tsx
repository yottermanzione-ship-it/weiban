/**
 * 公告、更新说明、版本策略（换壳 UI 批次；接口见 packages/contracts/src/http/announcements.ts，
 * 后端说明 docs/backend/announcements.md）。
 */
import { useState, type FormEvent } from 'react';
import {
  AnnouncementAdminEndpoints,
  ReleaseAdminEndpoints,
  type AdminAnnouncement,
  type AdminReleaseNote,
  type AppVersionPolicy,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { Feedback } from '../components/feedback.js';

type Platform = 'web' | 'android';
const platformLabel: Record<Platform, string> = { web: '网页', android: '安卓' };
const statusLabel: Record<string, string> = {
  draft: '草稿',
  published: '已发布',
  withdrawn: '已撤回',
};
const time = (value: string | null) =>
  value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '—';
/** datetime-local 输入框与 ISO 时间互转（按浏览器本地时区）。 */
const toLocalInput = (value: string | null) => {
  if (!value) return '';
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (value: FormDataEntryValue | null) =>
  value ? new Date(String(value)).toISOString() : null;

function useAction() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function run(work: () => Promise<unknown>, done: string) {
    setPending(true);
    setError('');
    setMessage('');
    try {
      await work();
      setMessage(done);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setPending(false);
    }
  }
  return { pending, message, error, run };
}

// ---------- 公告 ----------

export function AnnouncementsPage() {
  const list = useRemote(AnnouncementAdminEndpoints.listAnnouncements);
  const [editing, setEditing] = useState<AdminAnnouncement | 'new' | null>(null);
  const action = useAction();
  const call = (work: () => Promise<unknown>, done: string) =>
    void action.run(work, done).then((ok) => ok && list.refresh());
  return (
    <>
      <div className="page-head">
        <h1>公告管理</h1>
        <button className="primary" onClick={() => setEditing('new')}>
          新建公告
        </button>
      </div>
      <p className="hint">
        用户打开应用或回到前台时拉取。勾选「弹窗」的公告对未读用户自动弹出一次；已发布的公告要先撤回才能删除。
      </p>
      {editing && (
        <AnnouncementForm
          key={editing === 'new' ? 'new' : editing.announcementId}
          value={editing === 'new' ? null : editing}
          onDone={() => {
            setEditing(null);
            list.refresh();
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      <Feedback message={action.message} error={action.error || list.error} />
      <table>
        <thead>
          <tr>
            <th>标题</th>
            <th>状态</th>
            <th>平台</th>
            <th>生效期</th>
            <th>弹窗 / 置顶</th>
            <th>已读</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((item) => (
            <tr key={item.announcementId}>
              <td>{item.title}</td>
              <td>
                <span
                  className={`tag ${item.status === 'published' ? 'success' : item.status === 'withdrawn' ? 'warning' : ''}`}
                >
                  {statusLabel[item.status] ?? item.status}
                </span>
              </td>
              <td>
                {item.platforms.length === 0
                  ? '全部'
                  : item.platforms.map((p) => platformLabel[p]).join('、')}
              </td>
              <td>
                {time(item.startsAt ?? item.publishedAt)} 起
                <br />
                {item.endsAt ? `${time(item.endsAt)} 止` : '不限结束'}
              </td>
              <td>
                {item.popup ? '弹窗' : '—'} / {item.pinned ? '置顶' : '—'}
              </td>
              <td>{item.readCount}</td>
              <td>
                <div className="button-row">
                  {item.status !== 'withdrawn' && (
                    <button disabled={action.pending} onClick={() => setEditing(item)}>
                      编辑
                    </button>
                  )}
                  {item.status !== 'published' && (
                    <button
                      disabled={action.pending}
                      onClick={() =>
                        call(
                          () =>
                            api.call(AnnouncementAdminEndpoints.publishAnnouncement, {
                              params: { announcementId: item.announcementId },
                            }),
                          '已发布',
                        )
                      }
                    >
                      发布
                    </button>
                  )}
                  {item.status === 'published' && (
                    <button
                      disabled={action.pending}
                      onClick={() =>
                        window.confirm('撤回后用户端立即看不到这条公告，确定撤回？') &&
                        call(
                          () =>
                            api.call(AnnouncementAdminEndpoints.withdrawAnnouncement, {
                              params: { announcementId: item.announcementId },
                            }),
                          '已撤回',
                        )
                      }
                    >
                      撤回
                    </button>
                  )}
                  {item.status !== 'published' && (
                    <button
                      className="danger"
                      disabled={action.pending}
                      onClick={() =>
                        window.confirm('删除后无法恢复，确定删除？') &&
                        call(
                          () =>
                            api.call(AnnouncementAdminEndpoints.deleteAnnouncement, {
                              params: { announcementId: item.announcementId },
                            }),
                          '已删除',
                        )
                      }
                    >
                      删除
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.data?.items.length === 0 && <p className="hint">还没有公告</p>}
    </>
  );
}

function AnnouncementForm({
  value,
  onDone,
  onCancel,
}: {
  value: AdminAnnouncement | null;
  onDone(): void;
  onCancel(): void;
}) {
  const action = useAction();
  async function submit(event: FormEvent<HTMLFormElement>, publish: boolean) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const platforms = (['web', 'android'] as const).filter((p) => form.get(`platform-${p}`));
    const body = {
      title: String(form.get('title') ?? ''),
      body: String(form.get('body') ?? ''),
      platforms: platforms.length === 2 ? [] : platforms,
      startsAt: fromLocalInput(form.get('startsAt')),
      endsAt: fromLocalInput(form.get('endsAt')),
      popup: form.get('popup') === 'on',
      pinned: form.get('pinned') === 'on',
    };
    const ok = await action.run(
      () =>
        value
          ? api.call(AnnouncementAdminEndpoints.updateAnnouncement, {
              params: { announcementId: value.announcementId },
              body: { ...body, resetReads: form.get('resetReads') === 'on' },
            })
          : api.call(AnnouncementAdminEndpoints.createAnnouncement, {
              body: { ...body, publish },
            }),
      '已保存',
    );
    if (ok) onDone();
  }
  const all = !value || value.platforms.length === 0;
  return (
    <form
      className="panel form-grid"
      onSubmit={(e) => void submit(e, (e.nativeEvent as SubmitEvent).submitter?.id === 'publish')}
    >
      <h2>{value ? '编辑公告' : '新建公告'}</h2>
      <label>
        标题（最多 60 字）
        <input name="title" maxLength={60} required defaultValue={value?.title} />
      </label>
      <label>
        正文（纯文本，换行保留）
        <textarea name="body" rows={6} maxLength={4000} required defaultValue={value?.body} />
      </label>
      <fieldset>
        <legend>目标平台（都勾 = 全部平台）</legend>
        {(['web', 'android'] as const).map((p) => (
          <label className="check" key={p}>
            <input
              type="checkbox"
              name={`platform-${p}`}
              defaultChecked={all || value?.platforms.includes(p)}
            />
            {platformLabel[p]}
          </label>
        ))}
      </fieldset>
      <label>
        生效时间（留空 = 发布即生效）
        <input
          type="datetime-local"
          name="startsAt"
          defaultValue={toLocalInput(value?.startsAt ?? null)}
        />
      </label>
      <label>
        结束时间（留空 = 一直有效直到撤回）
        <input
          type="datetime-local"
          name="endsAt"
          defaultValue={toLocalInput(value?.endsAt ?? null)}
        />
      </label>
      <label className="check">
        <input type="checkbox" name="popup" defaultChecked={value?.popup ?? false} />
        未读用户打开应用时弹窗
      </label>
      <label className="check">
        <input type="checkbox" name="pinned" defaultChecked={value?.pinned ?? false} />
        置顶
      </label>
      {value?.status === 'published' && (
        <label className="check">
          <input type="checkbox" name="resetReads" />
          重新提醒所有人（清空已读，弹窗公告会再弹一次）
        </label>
      )}
      <div className="button-row">
        {value ? (
          <button className="primary" disabled={action.pending}>
            保存
          </button>
        ) : (
          <>
            <button id="publish" className="primary" disabled={action.pending}>
              保存并发布
            </button>
            <button id="draft" disabled={action.pending}>
              存为草稿
            </button>
          </>
        )}
        <button type="button" onClick={onCancel}>
          取消
        </button>
      </div>
      <Feedback message={action.message} error={action.error} />
    </form>
  );
}

// ---------- 更新说明 ----------

export function ReleaseNotesPage() {
  const [platform, setPlatform] = useState<Platform | ''>('');
  const list = useRemote(ReleaseAdminEndpoints.listReleaseNotes, {
    query: { platform: platform || undefined },
  });
  const [editing, setEditing] = useState<AdminReleaseNote | 'new' | null>(null);
  const action = useAction();
  return (
    <>
      <div className="page-head">
        <h1>更新说明</h1>
        <button className="primary" onClick={() => setEditing('new')}>
          新增版本说明
        </button>
      </div>
      <p className="hint">
        用户首次打开新版本时弹「本版新功能」，内容是他上次看过的版本之后的全部说明。网页版本号 =
        网页构建号（每次打包自动加一，见用户端「设置 › 关于微伴」）；安卓 = versionCode。
      </p>
      <label>
        平台
        <select value={platform} onChange={(e) => setPlatform(e.target.value as Platform | '')}>
          <option value="">全部</option>
          <option value="web">网页</option>
          <option value="android">安卓</option>
        </select>
      </label>
      {editing && (
        <ReleaseNoteForm
          key={editing === 'new' ? 'new' : editing.releaseNoteId}
          value={editing === 'new' ? null : editing}
          onDone={() => {
            setEditing(null);
            list.refresh();
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      <Feedback message={action.message} error={action.error || list.error} />
      <table>
        <thead>
          <tr>
            <th>平台</th>
            <th>版本</th>
            <th>版本号</th>
            <th>标题</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((item) => (
            <tr key={item.releaseNoteId}>
              <td>{platformLabel[item.platform]}</td>
              <td>{item.version}</td>
              <td>{item.versionCode}</td>
              <td className="ellipsis">{item.title || item.body.slice(0, 30)}</td>
              <td>
                <span className={`tag ${item.published ? 'success' : ''}`}>
                  {item.published ? '已发布' : '草稿'}
                </span>
              </td>
              <td>
                <div className="button-row">
                  <button disabled={action.pending} onClick={() => setEditing(item)}>
                    编辑
                  </button>
                  <button
                    className="danger"
                    disabled={action.pending}
                    onClick={() =>
                      window.confirm('确定删除这条更新说明？') &&
                      void action
                        .run(
                          () =>
                            api.call(ReleaseAdminEndpoints.deleteReleaseNote, {
                              params: { releaseNoteId: item.releaseNoteId },
                            }),
                          '已删除',
                        )
                        .then((ok) => ok && list.refresh())
                    }
                  >
                    删除
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.data?.items.length === 0 && <p className="hint">还没有更新说明</p>}
    </>
  );
}

function ReleaseNoteForm({
  value,
  onDone,
  onCancel,
}: {
  value: AdminReleaseNote | null;
  onDone(): void;
  onCancel(): void;
}) {
  const action = useAction();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const common = {
      version: String(form.get('version') ?? ''),
      title: String(form.get('title') ?? ''),
      body: String(form.get('body') ?? ''),
      published: form.get('published') === 'on',
    };
    const ok = await action.run(
      () =>
        value
          ? api.call(ReleaseAdminEndpoints.updateReleaseNote, {
              params: { releaseNoteId: value.releaseNoteId },
              body: common,
            })
          : api.call(ReleaseAdminEndpoints.createReleaseNote, {
              body: {
                ...common,
                platform: String(form.get('platform')) as Platform,
                versionCode: Number(form.get('versionCode')),
              },
            }),
      '已保存',
    );
    if (ok) onDone();
  }
  return (
    <form className="panel form-grid" onSubmit={(e) => void submit(e)}>
      <h2>{value ? `编辑 ${platformLabel[value.platform]} ${value.version}` : '新增版本说明'}</h2>
      {!value && (
        <>
          <label>
            平台
            <select name="platform" defaultValue="web">
              <option value="web">网页</option>
              <option value="android">安卓</option>
            </select>
          </label>
          <label>
            版本号（整数，平台与版本号保存后不可改）
            <input name="versionCode" type="number" min={1} required />
          </label>
        </>
      )}
      <label>
        版本名（例 1.4.0）
        <input name="version" maxLength={32} required defaultValue={value?.version} />
      </label>
      <label>
        标题（可留空）
        <input name="title" maxLength={60} defaultValue={value?.title} />
      </label>
      <label>
        本版新内容（纯文本，换行保留）
        <textarea name="body" rows={6} maxLength={4000} required defaultValue={value?.body} />
      </label>
      <label className="check">
        <input type="checkbox" name="published" defaultChecked={value?.published ?? true} />
        发布（不勾 = 草稿，用户端看不到）
      </label>
      <div className="button-row">
        <button className="primary" disabled={action.pending}>
          保存
        </button>
        <button type="button" onClick={onCancel}>
          取消
        </button>
      </div>
      <Feedback message={action.message} error={action.error} />
    </form>
  );
}

// ---------- 版本策略 ----------

export function VersionPoliciesPage() {
  const list = useRemote(ReleaseAdminEndpoints.listVersionPolicies);
  return (
    <>
      <h1>版本策略</h1>
      <p className="hint">
        「最低可用版本号」以下的客户端必须更新才能继续使用（网页 = 刷新页面，安卓 = 去下载）。
        最低可用版本不能高于最新版本号，防止把所有人锁死。
      </p>
      <Feedback error={list.error} />
      {list.data?.items.map((policy) => (
        <PolicyForm key={policy.platform} policy={policy} onDone={list.refresh} />
      ))}
    </>
  );
}

function PolicyForm({ policy, onDone }: { policy: AppVersionPolicy; onDone(): void }) {
  const action = useAction();
  const number = (value: FormDataEntryValue | null) => (value ? Number(value) : null);
  const text = (value: FormDataEntryValue | null) => (value ? String(value) : null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await action.run(
      () =>
        api.call(ReleaseAdminEndpoints.updateVersionPolicy, {
          params: { platform: policy.platform },
          body: {
            latestVersion: text(form.get('latestVersion')),
            latestVersionCode: number(form.get('latestVersionCode')),
            downloadUrl: policy.platform === 'android' ? text(form.get('downloadUrl')) : null,
            minSupportedVersionCode: number(form.get('minSupportedVersionCode')),
            forceUpdateMessage: text(form.get('forceUpdateMessage')),
          },
        }),
      '已保存',
    );
    if (ok) onDone();
  }
  return (
    <form className="panel form-grid" onSubmit={(e) => void submit(e)}>
      <h2>
        {platformLabel[policy.platform]}
        <small className="hint"> 上次修改：{time(policy.updatedAt)}</small>
      </h2>
      <label>
        最新版本名
        <input name="latestVersion" maxLength={32} defaultValue={policy.latestVersion ?? ''} />
      </label>
      <label>
        最新版本号
        <input
          name="latestVersionCode"
          type="number"
          min={1}
          defaultValue={policy.latestVersionCode ?? ''}
        />
      </label>
      {policy.platform === 'android' && (
        <label>
          安装包下载地址
          <input
            name="downloadUrl"
            type="url"
            maxLength={1000}
            defaultValue={policy.downloadUrl ?? ''}
          />
        </label>
      )}
      <label>
        最低可用版本号（留空 = 不限制）
        <input
          name="minSupportedVersionCode"
          type="number"
          min={1}
          defaultValue={policy.minSupportedVersionCode ?? ''}
        />
      </label>
      <label>
        强制更新说明（留空用默认文案）
        <input
          name="forceUpdateMessage"
          maxLength={200}
          defaultValue={policy.forceUpdateMessage ?? ''}
        />
      </label>
      <button className="primary" disabled={action.pending}>
        保存
      </button>
      <Feedback message={action.message} error={action.error} />
    </form>
  );
}
