/**
 * 角色广场管理：作品、微伴角色评论、举报、发布权限（停权）。
 * 所有写操作服务器会记审计并通知相关用户。
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Tabs,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { z } from 'zod';
import {
  AdminPlazaOfficialComment,
  AdminPlazaReport,
  AdminPlazaWork,
  CharacterAdminEndpoints,
  PlazaAdminEndpoints,
  PlazaOfficialAdminEndpoints,
  type PlazaSnapshot,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { DataTable, type ProColumns } from '../ui/table.js';
import { DrawerActions, RecordDrawer } from '../ui/drawer.js';
import { FieldHelp, FormSection, Page, SectionCard, StatusTag, useToast } from '../ui/page.js';
import { formatDateTime } from '../ui/format.js';
import { useFormFeedback } from '../data/form-feedback.js';

type Work = z.infer<typeof AdminPlazaWork>;
type Report = z.infer<typeof AdminPlazaReport>;
type OfficialComment = z.infer<typeof AdminPlazaOfficialComment>;
type Ban = z.infer<typeof PlazaAdminEndpoints.listBans.response>['items'][number];

const WORK_STATUS: Record<string, string> = {
  listed: '展示中',
  unlisted_by_author: '作者下架',
  removed_by_admin: '管理员下架',
  author_banned: '作者停权',
};

const REASON_LABELS: Record<string, string> = {
  rights: '侵犯他人权益',
  hard_boundary: '违反底线规则',
  inappropriate: '不适宜的内容',
  other: '其他',
};

const BASIS_LABELS: Record<string, string> = {
  original: '原创',
  fictional: '虚构',
  real_person: '真人',
};

const REAL_KIND_LABELS: Record<string, string> = {
  celebrity: '公众人物',
  historical: '历史人物',
  private_person: '身边真人',
};

interface Facts {
  basis: string;
  realPersonKind: string | null;
  ageSetting: string;
  childAppearance: boolean;
}

function classText(facts: Facts): string {
  const head =
    facts.basis === 'real_person'
      ? `真人 · ${REAL_KIND_LABELS[facts.realPersonKind ?? ''] ?? ''}`
      : `${BASIS_LABELS[facts.basis] ?? ''} · ${facts.ageSetting === 'minor' ? '未满 18 岁' : '已满 18 岁'}`;
  return facts.childAppearance ? `${head} · 儿童外貌` : head;
}

/** 与服务器同一规则：只能改得更严格。 */
function looser(prev: Facts, next: Facts): boolean {
  return (
    (prev.basis === 'real_person' &&
      (next.basis !== 'real_person' || prev.realPersonKind !== next.realPersonKind)) ||
    (prev.basis !== 'real_person' && next.basis !== 'real_person' && prev.basis !== next.basis) ||
    (prev.ageSetting === 'minor' && next.ageSetting !== 'minor') ||
    (prev.childAppearance && !next.childAppearance)
  );
}

export function PlazaAdminPage({ initialTab }: { initialTab?: 'works' | 'reports' }) {
  const [tab, setTab] = useState<'works' | 'official' | 'reports' | 'bans'>(initialTab ?? 'works');
  return (
    <Page
      title={initialTab === 'reports' ? '举报处理' : '角色广场'}
      desc="用户发布的自定义角色作品、评论与举报。下架、删除评论、停权都会记入审计并通知用户。"
    >
      <div className="page-tabs">
        <Tabs
          activeKey={tab}
          onChange={(key) => setTab(key as typeof tab)}
          items={[
            { key: 'works', label: '作品' },
            { key: 'official', label: '微伴角色评论' },
            { key: 'reports', label: '举报' },
            { key: 'bans', label: '发布权限' },
          ]}
        />
        {tab === 'works' && <WorksTab />}
        {tab === 'official' && <OfficialCommentsTab />}
        {tab === 'reports' && <ReportsTab />}
        {tab === 'bans' && <BansTab />}
      </div>
    </Page>
  );
}

function SnapshotView({ snapshot }: { snapshot: PlazaSnapshot }) {
  return (
    <Collapse
      ghost
      size="small"
      items={[
        {
          key: 'snapshot',
          label: '查看完整内容（JSON）',
          children: <pre className="json-view">{JSON.stringify(snapshot, null, 2)}</pre>,
        },
      ]}
    />
  );
}

function WorksTab() {
  const [authorUserId, setAuthorUserId] = useState('');
  const [status, setStatus] = useState('');
  const [minReports, setMinReports] = useState<number | null>(null);
  const [items, setItems] = useState<Work[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<Work | null>(null);

  async function load(after?: string) {
    setLoading(true);
    setError('');
    try {
      const page = await api.call(PlazaAdminEndpoints.listWorks, {
        query: {
          authorUserId: authorUserId.trim() || undefined,
          status: (status || undefined) as 'listed' | undefined,
          minReports: minReports ?? undefined,
          cursor: after,
        },
      });
      setItems((prev) => (after ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const columns: ProColumns<Work>[] = [
    {
      title: '作品',
      fixed: 'left',
      width: 220,
      render: (_, row) => (
        <div className="cell-main">
          <span className="cell-title">{row.name}</span>
          <span className="cell-sub">{row.settings.tagline}</span>
        </div>
      ),
    },
    {
      title: '作者',
      width: 130,
      render: (_, row) => (row.author.deleted ? '已注销用户' : row.author.nickname),
    },
    {
      title: '类型',
      width: 150,
      render: (_, row) =>
        row.kind === 'preset_variant' ? `预设改版 · ${row.basedOnPresetName ?? ''}` : '自定义角色',
    },
    {
      title: '分类',
      width: 190,
      render: (_, row) =>
        row.snapshot.kind === 'custom_character'
          ? classText(row.snapshot.classification)
          : '沿用预设',
    },
    {
      title: '状态',
      width: 110,
      render: (_, row) => (
        <StatusTag
          tone={
            row.status === 'listed'
              ? 'success'
              : row.status === 'removed_by_admin'
                ? 'error'
                : row.status === 'author_banned'
                  ? 'warning'
                  : 'default'
          }
        >
          {WORK_STATUS[row.status] ?? row.status}
        </StatusTag>
      ),
    },
    { title: '赞', width: 70, render: (_, row) => row.likeCount },
    { title: '添加', width: 70, render: (_, row) => row.adoptCount },
    {
      title: '举报',
      width: 80,
      render: (_, row) =>
        row.reportCount > 0 ? <span className="warn-text">{row.reportCount}</span> : 0,
    },
    {
      title: '发布时间',
      width: 150,
      render: (_, row) => formatDateTime(row.publishedAt),
    },
  ];

  return (
    <div className="tab-body">
      <DataTable<Work>
        rowKey="workId"
        columns={columns}
        data={items}
        loading={loading}
        error={error}
        onRefresh={() => void load()}
        onRowClick={(row) => setDetail(row)}
        filters={
          <>
            <Input.Search
              allowClear
              placeholder="按作者用户 ID"
              style={{ width: 220 }}
              value={authorUserId}
              onChange={(e) => setAuthorUserId(e.target.value)}
              onSearch={() => void load()}
            />
            <Select
              allowClear
              style={{ width: 150 }}
              placeholder="全部状态"
              value={status || undefined}
              onChange={(value) => setStatus(value ?? '')}
              options={Object.entries(WORK_STATUS).map(([value, label]) => ({ value, label }))}
            />
            <InputNumber
              min={0}
              style={{ width: 150 }}
              placeholder="被举报次数 ≥"
              value={minReports}
              onChange={(value) => setMinReports(value)}
            />
            <Button type="primary" onClick={() => void load()}>
              查询
            </Button>
          </>
        }
        emptyTitle="广场还没有作品"
        emptyHint="用户在网页端发布自定义角色后会出现在这里；被举报的作品也在这里处理。"
        footer={
          cursor ? (
            <Button size="small" loading={loading} onClick={() => void load(cursor)}>
              加载更多
            </Button>
          ) : undefined
        }
      />
      {detail && (
        <WorkDrawer
          work={detail}
          onClose={() => setDetail(null)}
          onChanged={(next) => {
            setDetail(next);
            setItems((prev) => prev.map((x) => (x.workId === next.workId ? next : x)));
          }}
        />
      )}
    </div>
  );
}

function WorkDrawer({
  work,
  onClose,
  onChanged,
}: {
  work: Work;
  onClose: () => void;
  onChanged: (work: Work) => void;
}) {
  const toast = useToast();
  const [action, setAction] = useState<'remove' | 'restore' | 'tighten' | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [openVersion, setOpenVersion] = useState<number | null>(null);
  const [version, setVersion] = useState<{ snapshot: PlazaSnapshot } | null>(null);
  const current: Facts | null =
    work.snapshot.kind === 'custom_character' ? work.snapshot.classification : null;
  const [next, setNext] = useState<Facts | null>(current);

  useEffect(() => {
    if (openVersion === null) return;
    let active = true;
    setVersion(null);
    void api
      .call(PlazaAdminEndpoints.getWorkVersion, {
        params: { workId: work.workId, version: openVersion },
      })
      .then((value) => active && setVersion(value))
      .catch((e: unknown) => active && setError(errorText(e)));
    return () => {
      active = false;
    };
  }, [openVersion, work.workId]);

  async function run() {
    setSaving(true);
    setError('');
    try {
      if (action === 'tighten' && next) {
        const result = await api.call(PlazaAdminEndpoints.tightenClassification, {
          params: { workId: work.workId },
          body: {
            basis: next.basis as 'original',
            realPersonKind:
              next.basis === 'real_person' ? (next.realPersonKind as 'celebrity') : null,
            ageSetting: next.ageSetting as 'adult',
            childAppearance: next.childAppearance,
            reason: reason.trim(),
          },
        });
        onChanged(result.work);
        toast.success(`已更正，影响 ${result.affectedCharacterCount} 个角色`);
      } else {
        const endpoint =
          action === 'remove' ? PlazaAdminEndpoints.removeWork : PlazaAdminEndpoints.restoreWork;
        const result = await api.call(endpoint, {
          params: { workId: work.workId },
          body: { reason: reason.trim() },
        });
        onChanged(result);
        toast.success(action === 'remove' ? '已下架' : '已恢复上架');
      }
      setAction(null);
      setReason('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  const tightenInvalid =
    !current || !next || looser(current, next) || JSON.stringify(current) === JSON.stringify(next);

  return (
    <RecordDrawer
      open
      onClose={onClose}
      title={`《${work.name}》`}
      subtitle={`${work.author.deleted ? '已注销用户' : work.author.nickname} · 版本 ${work.currentVersion}`}
      width={760}
      footer={
        <DrawerActions
          onCancel={onClose}
          extra={
            <>
              {work.status === 'removed_by_admin' ? (
                <Button onClick={() => setAction('restore')}>恢复上架</Button>
              ) : (
                <Button danger onClick={() => setAction('remove')}>
                  下架
                </Button>
              )}
              {current && <Button onClick={() => setAction('tighten')}>更正分类</Button>}
            </>
          }
        />
      }
    >
      {error && <Alert type="error" showIcon message={error} />}
      <div className="detail-grid">
        <div>
          <span className="detail-label">状态</span>
          <StatusTag tone={work.status === 'listed' ? 'success' : 'default'}>
            {WORK_STATUS[work.status] ?? work.status}
          </StatusTag>
        </div>
        <div>
          <span className="detail-label">分类</span>
          <span>{current ? classText(current) : '沿用预设'}</span>
        </div>
        <div>
          <span className="detail-label">一句话介绍</span>
          <span>{work.settings.tagline || '—'}</span>
        </div>
        <div>
          <span className="detail-label">发布说明</span>
          <span>{work.settings.publishNote || '—'}</span>
        </div>
        <div>
          <span className="detail-label">互动</span>
          <span>
            赞 {work.likeCount} · 添加 {work.adoptCount} · 举报 {work.reportCount}
          </span>
        </div>
        <div>
          <span className="detail-label">设置</span>
          <span>
            {work.settings.allowRemix ? '允许改编' : '不允许改编'} ·{' '}
            {work.settings.commentsOpen ? '开放评论' : '关闭评论'}
          </span>
        </div>
        {work.removedReason && (
          <div>
            <span className="detail-label">下架原因</span>
            <span className="warn-text">{work.removedReason}</span>
          </div>
        )}
      </div>
      <SectionCard title="版本">
        <div className="version-list">
          {[...work.versions]
            .sort((a, b) => b.version - a.version)
            .map((v) => (
              <div className="version-row" key={v.version}>
                <span>版本 {v.version}</span>
                <span className="cell-sub">{formatDateTime(v.createdAt)}</span>
                <span className="cell-sub">{v.changeNote ?? '—'}</span>
                <Button
                  size="small"
                  type="link"
                  onClick={() => setOpenVersion(openVersion === v.version ? null : v.version)}
                >
                  {openVersion === v.version ? '收起' : '查看内容'}
                </Button>
              </div>
            ))}
        </div>
        {openVersion !== null && (
          <div className="json-panel">
            {version ? (
              <SnapshotView snapshot={version.snapshot} />
            ) : (
              <span className="detail-muted">正在读取…</span>
            )}
          </div>
        )}
      </SectionCard>
      <Modal
        open={action !== null}
        title={
          action === 'remove' ? '下架这个作品？' : action === 'restore' ? '恢复上架？' : '更正分类'
        }
        onCancel={() => setAction(null)}
        onOk={() => void run()}
        okText={action === 'restore' ? '恢复上架' : '确认'}
        cancelText="取消"
        confirmLoading={saving}
        okButtonProps={{
          danger: action !== 'restore',
          disabled: !reason.trim() || (action === 'tighten' && tightenInvalid),
        }}
        destroyOnHidden
      >
        <Form layout="vertical">
          {action === 'remove' && <p>作者会收到通知，并且不能自行重新上架。</p>}
          {action === 'restore' && <p>恢复后作品会重新出现在广场。</p>}
          {action === 'tighten' && current && next && (
            <>
              <p>当前分类：{classText(current)}</p>
              <div className="form-two">
                <Form.Item label="类型">
                  <Select
                    value={next.basis}
                    onChange={(value) =>
                      setNext({
                        ...next,
                        basis: value,
                        realPersonKind:
                          value === 'real_person' ? (next.realPersonKind ?? 'celebrity') : null,
                      })
                    }
                    options={(['original', 'fictional', 'real_person'] as const).map((value) => ({
                      value,
                      label: BASIS_LABELS[value],
                      disabled: looser(current, {
                        ...next,
                        basis: value,
                        realPersonKind:
                          value === 'real_person' ? (current.realPersonKind ?? 'celebrity') : null,
                      }),
                    }))}
                  />
                </Form.Item>
                {next.basis === 'real_person' && (
                  <Form.Item label="真人类型">
                    <Select
                      value={next.realPersonKind ?? 'celebrity'}
                      onChange={(value) => setNext({ ...next, realPersonKind: value })}
                      options={(['celebrity', 'historical', 'private_person'] as const).map(
                        (value) => ({
                          value,
                          label: REAL_KIND_LABELS[value],
                          disabled: looser(current, { ...next, realPersonKind: value }),
                        }),
                      )}
                    />
                  </Form.Item>
                )}
                <Form.Item label="年龄设定">
                  <Select
                    value={next.ageSetting}
                    onChange={(value) => setNext({ ...next, ageSetting: value })}
                    options={[
                      {
                        value: 'adult',
                        label: '已满 18 岁',
                        disabled: current.ageSetting === 'minor',
                      },
                      { value: 'minor', label: '未满 18 岁' },
                    ]}
                  />
                </Form.Item>
              </div>
              <Checkbox
                checked={next.childAppearance}
                disabled={current.childAppearance}
                onChange={(e) => setNext({ ...next, childAppearance: e.target.checked })}
              >
                儿童外貌
              </Checkbox>
              {looser(current, next) && <div className="warn-text">只能改得更严格</div>}
              <div className="detail-muted" style={{ marginTop: 8 }}>
                所有由这个作品复制或应用出去的角色都会一起改，正在进行的成人模式会立即退出。
              </div>
            </>
          )}
          <Form.Item label="原因（必填）" style={{ marginTop: 12 }}>
            <Input.TextArea
              rows={3}
              maxLength={200}
              showCount
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Form.Item>
          <div className="detail-muted">此操作会记入审计记录。</div>
        </Form>
      </Modal>
    </RecordDrawer>
  );
}

function OfficialCommentsTab() {
  const toast = useToast();
  const characters = useRemote(CharacterAdminEndpoints.list);
  const [characterId, setCharacterId] = useState('');
  const [items, setItems] = useState<OfficialComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [target, setTarget] = useState<OfficialComment | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  async function load(after?: string) {
    setLoading(true);
    setError('');
    try {
      const page = await api.call(PlazaOfficialAdminEndpoints.listComments, {
        query: { characterId: characterId || undefined, cursor: after },
      });
      setItems((prev) => (after ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);

  const nameOf = (id: string) =>
    (characters.data?.items ?? []).find((c) => c.characterId === id)?.name ?? id.slice(0, 8);

  async function remove() {
    if (!target) return;
    setSaving(true);
    setError('');
    try {
      await api.call(PlazaAdminEndpoints.deleteComment, {
        params: { commentId: target.commentId },
        body: { reason: reason.trim() },
      });
      setItems((prev) => prev.filter((c) => c.commentId !== target.commentId));
      setTarget(null);
      setReason('');
      toast.success('评论已删除');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  const columns: ProColumns<OfficialComment>[] = [
    { title: '角色', width: 140, render: (_, row) => nameOf(row.characterId) },
    {
      title: '评论者',
      width: 150,
      render: (_, row) => (
        <div className="cell-main">
          <span>{row.authorNickname ?? '已注销用户'}</span>
          <span className="cell-sub mono">{row.authorUserId.slice(0, 8)}…</span>
        </div>
      ),
    },
    { title: '内容', render: (_, row) => <span className="pre-wrap">{row.text}</span> },
    { title: '时间', width: 150, render: (_, row) => formatDateTime(row.createdAt) },
    {
      title: '操作',
      width: 80,
      fixed: 'right',
      render: (_, row) => (
        <Button type="link" size="small" danger onClick={() => setTarget(row)}>
          删除
        </Button>
      ),
    },
  ];

  return (
    <div className="tab-body">
      <DataTable<OfficialComment>
        rowKey="commentId"
        columns={columns}
        data={items}
        loading={loading}
        error={error}
        onRefresh={() => void load()}
        filters={
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: 220 }}
            placeholder="全部微伴角色"
            value={characterId || undefined}
            onChange={(value) => setCharacterId(value ?? '')}
            options={(characters.data?.items ?? [])
              .filter((c) => c.status === 'published')
              .map((c) => ({ value: c.characterId, label: c.name }))}
          />
        }
        emptyTitle="还没有评论"
        emptyHint="用户在「微伴角色」下评论后会出现在这里；删除需要写原因。"
        footer={
          cursor ? (
            <Button size="small" loading={loading} onClick={() => void load(cursor)}>
              加载更多
            </Button>
          ) : undefined
        }
      />
      <Modal
        open={target !== null}
        title="删除这条评论？"
        onCancel={() => setTarget(null)}
        onOk={() => void remove()}
        okText="删除"
        cancelText="取消"
        confirmLoading={saving}
        okButtonProps={{ danger: true, disabled: !reason.trim() }}
        destroyOnHidden
      >
        <p className="pre-wrap">「{target?.text}」</p>
        <Form layout="vertical">
          <Form.Item label="原因（必填）" extra={<FieldHelp>会写进审计记录。</FieldHelp>}>
            <Input.TextArea
              rows={2}
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function ReportsTab() {
  const toast = useToast();
  const [status, setStatus] = useState<'pending' | 'dismissed' | 'actioned' | ''>('pending');
  const [items, setItems] = useState<Report[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<Report | null>(null);

  async function load(after?: string) {
    setLoading(true);
    setError('');
    try {
      const page = await api.call(PlazaAdminEndpoints.listReports, {
        query: { status: status || undefined, cursor: after },
      });
      setItems((prev) => (after ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const columns: ProColumns<Report>[] = [
    { title: '举报时间', width: 150, render: (_, row) => formatDateTime(row.createdAt) },
    {
      title: '对象',
      width: 90,
      render: (_, row) => (row.target.kind === 'work' ? '作品' : '评论'),
    },
    { title: '原因', width: 140, render: (_, row) => REASON_LABELS[row.reason] ?? '其他' },
    { title: '补充说明', render: (_, row) => <span className="cell-sub">{row.note ?? '—'}</span> },
    {
      title: '举报人',
      width: 120,
      render: (_, row) => <span className="mono">{row.reporterUserId.slice(0, 8)}…</span>,
    },
    {
      title: '状态',
      width: 100,
      render: (_, row) => (
        <StatusTag
          tone={
            row.status === 'pending'
              ? 'warning'
              : row.status === 'dismissed'
                ? 'default'
                : 'success'
          }
        >
          {row.status === 'pending' ? '待处理' : row.status === 'dismissed' ? '已驳回' : '已处理'}
        </StatusTag>
      ),
    },
  ];

  return (
    <div className="tab-body">
      <DataTable<Report>
        rowKey="reportId"
        columns={columns}
        data={items}
        loading={loading}
        error={error}
        onRefresh={() => void load()}
        onRowClick={(row) => setDetail(row)}
        filters={
          <Select
            style={{ width: 140 }}
            value={status}
            onChange={(value) => setStatus(value)}
            options={[
              { value: 'pending', label: '待处理' },
              { value: 'dismissed', label: '已驳回' },
              { value: 'actioned', label: '已处理' },
              { value: '', label: '全部' },
            ]}
          />
        }
        emptyTitle={status === 'pending' ? '没有待处理的举报' : '没有举报记录'}
        emptyHint="用户在广场举报作品或评论后会出现在这里。"
        footer={
          cursor ? (
            <Button size="small" loading={loading} onClick={() => void load(cursor)}>
              加载更多
            </Button>
          ) : undefined
        }
      />
      {detail && (
        <ReportDrawer
          report={detail}
          onClose={() => setDetail(null)}
          onResolved={(next) => {
            setDetail(null);
            setItems((prev) =>
              status === 'pending'
                ? prev.filter((r) => r.reportId !== next.reportId)
                : prev.map((r) => (r.reportId === next.reportId ? next : r)),
            );
            toast.success('已处理，已通知举报人');
          }}
        />
      )}
    </div>
  );
}

function ReportDrawer({
  report,
  onClose,
  onResolved,
}: {
  report: Report;
  onClose: () => void;
  onResolved: (report: Report) => void;
}) {
  const [action, setAction] = useState<'dismiss' | 'remove_work' | 'delete_comment' | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [work, setWork] = useState<Work | null>(null);

  useEffect(() => {
    if (report.target.kind !== 'work') return;
    let active = true;
    void api
      .call(PlazaAdminEndpoints.getWork, { params: { workId: report.target.workId } })
      .then((value) => active && setWork(value))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [report]);

  async function resolve() {
    if (!action) return;
    setSaving(true);
    setError('');
    try {
      const result = await api.call(PlazaAdminEndpoints.resolveReport, {
        params: { reportId: report.reportId },
        body: { action, reason: reason.trim() },
      });
      onResolved(result);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <RecordDrawer
      open
      onClose={onClose}
      title="举报详情"
      subtitle={`${report.target.kind === 'work' ? '作品' : '评论'} · ${REASON_LABELS[report.reason] ?? '其他'}`}
      width={640}
      footer={
        report.status === 'pending' ? (
          <div className="drawer-actions">
            <Button onClick={() => setAction('dismiss')}>驳回</Button>
            <Button
              danger
              onClick={() =>
                setAction(report.target.kind === 'work' ? 'remove_work' : 'delete_comment')
              }
            >
              {report.target.kind === 'work' ? '下架作品' : '删除评论'}
            </Button>
          </div>
        ) : undefined
      }
    >
      {error && <Alert type="error" showIcon message={error} />}
      <div className="detail-grid">
        <div>
          <span className="detail-label">原因</span>
          <span>{REASON_LABELS[report.reason] ?? '其他'}</span>
        </div>
        <div>
          <span className="detail-label">举报人</span>
          <span className="mono">{report.reporterUserId.slice(0, 12)}…</span>
        </div>
        <div>
          <span className="detail-label">补充说明</span>
          <span className="pre-wrap">{report.note ?? '—'}</span>
        </div>
        <div>
          <span className="detail-label">时间</span>
          <span>{formatDateTime(report.createdAt)}</span>
        </div>
      </div>
      <SectionCard title="被举报内容">
        {report.target.kind === 'comment' ? (
          <blockquote className="quote-block">{report.target.text}</blockquote>
        ) : work ? (
          <div className="cell-main">
            <span className="cell-title">《{work.name}》</span>
            <span className="cell-sub">{work.settings.tagline}</span>
            <SnapshotView snapshot={work.snapshot} />
          </div>
        ) : (
          <span className="detail-muted">作品 ID {report.target.workId}</span>
        )}
      </SectionCard>
      <Modal
        open={action !== null}
        title={
          action === 'dismiss'
            ? '驳回举报？'
            : action === 'remove_work'
              ? '下架作品？'
              : '删除评论？'
        }
        onCancel={() => setAction(null)}
        onOk={() => void resolve()}
        okText="确认"
        cancelText="取消"
        confirmLoading={saving}
        okButtonProps={{ danger: action !== 'dismiss', disabled: !reason.trim() }}
        destroyOnHidden
      >
        <p>处理后会自动通知举报人。</p>
        <Form layout="vertical">
          <Form.Item label="原因（必填）">
            <Input.TextArea
              rows={3}
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Form.Item>
        </Form>
      </Modal>
    </RecordDrawer>
  );
}

function BansTab() {
  const toast = useToast();
  const [items, setItems] = useState<Ban[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ userId: string; period: string; reason: string }>();
  const feedback = useFormFeedback(form);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const page = await api.call(PlazaAdminEndpoints.listBans, { query: { limit: 50 } });
      setItems(page.items);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function ban() {
    const values = await feedback.validate();
    if (!values) return;
    setSaving(true);
    setError('');
    try {
      await api.call(PlazaAdminEndpoints.banAuthor, {
        params: { userId: values.userId.trim() },
        body: {
          until:
            values.period === 'permanent'
              ? 'permanent'
              : new Date(Date.now() + Number(values.period) * 86_400_000).toISOString(),
          reason: values.reason.trim(),
        },
      });
      toast.success('已停止该用户的发布和评论权限');
      setOpen(false);
      form.resetFields();
      void load();
    } catch (e) {
      setError(feedback.report(e));
    } finally {
      setSaving(false);
    }
  }

  async function unban(userId: string) {
    setError('');
    try {
      await api.call(PlazaAdminEndpoints.unbanAuthor, {
        params: { userId },
        body: { reason: '管理员手动恢复' },
      });
      toast.success('已恢复该用户的权限');
      void load();
    } catch (e) {
      setError(errorText(e));
    }
  }

  const columns: ProColumns<Ban>[] = [
    {
      title: '用户',
      render: (_, row) => (
        <div className="cell-main">
          <span>{row.nickname ?? '未设置昵称'}</span>
          <span className="cell-sub mono">{row.userId}</span>
        </div>
      ),
    },
    {
      title: '截止',
      width: 180,
      render: (_, row) => (row.until === 'permanent' ? '永久' : formatDateTime(row.until)),
    },
    { title: '原因', width: 260, render: (_, row) => row.reason },
    {
      title: '操作',
      width: 100,
      render: (_, row) => (
        <Button type="link" size="small" onClick={() => void unban(row.userId)}>
          恢复权限
        </Button>
      ),
    },
  ];

  return (
    <div className="tab-body">
      <DataTable<Ban>
        rowKey="userId"
        columns={columns}
        data={items}
        loading={loading}
        error={error}
        onRefresh={() => void load()}
        emptyTitle="没有停权中的用户"
        emptyHint="用户发布违规内容时，可以用右上角「停止发布和评论」；停权期间 TA 的全部作品不展示。"
        toolbarExtra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            停止发布和评论
          </Button>
        }
      />
      <RecordDrawer
        form={form}
        draftKey={'plaza-ban:new'}
        open={open}
        onClose={() => setOpen(false)}
        title="停止发布和评论"
        subtitle="停权期间该用户不能发布作品、不能评论"
        width={520}
        footer={
          <DrawerActions
            onCancel={() => setOpen(false)}
            onSubmit={() => void ban()}
            saving={saving}
          />
        }
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ period: '7', reason: '' }}
          style={{ background: '#fff', padding: 16, borderRadius: 8 }}
        >
          <FormSection title="停权对象" />
          <Form.Item
            name="userId"
            label="用户 ID"
            rules={[{ required: true, message: '填写用户 ID' }]}
            extra={<FieldHelp>可以在「作品」抽屉里看到作者的用户 ID。</FieldHelp>}
          >
            <Input placeholder="粘贴用户 ID" />
          </Form.Item>
          <Form.Item name="period" label="期限">
            <Radio.Group>
              <Radio.Button value="7">7 天</Radio.Button>
              <Radio.Button value="30">30 天</Radio.Button>
              <Radio.Button value="permanent">永久</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item
            name="reason"
            label="原因（必填）"
            rules={[{ required: true, message: '填写原因' }]}
            extra={<FieldHelp>会写进审计记录，并展示在停权列表里。</FieldHelp>}
          >
            <Input.TextArea rows={3} maxLength={200} showCount />
          </Form.Item>
        </Form>
      </RecordDrawer>
    </div>
  );
}
