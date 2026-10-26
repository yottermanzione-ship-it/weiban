/**
 * 角色库：官方角色的列表与人设编辑。上架前需要通过三项检查。
 * 人设内容仍由 WB-Card schema 驱动（components/card-editor），只换了外观。
 */
import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, DatePicker, Input, Select, Space, Upload } from 'antd';
import { PlusOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  AdminCharacterWrite,
  AgeSetting,
  AvatarPattern,
  CharacterAdminEndpoints,
  CharacterBasis,
  MediaAdminEndpoints,
  RealPersonKind,
  type AdminCharacter,
  type AdminCharacterPurgeImpact,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { ApiFailure } from '@weiban/client-core';
import { errorText, useRemote } from '../data/hooks.js';
import { DataTable, type ProColumns } from '../ui/table.js';
import { DrawerActions, RecordDrawer } from '../ui/drawer.js';
import { Page, SectionCard, StatusTag, useDangerConfirm, useToast } from '../ui/page.js';
import {
  BatchBar,
  BatchFailureAlert,
  BatchOperationModal,
  type BatchFailure,
} from '../ui/batch-operation.js';
import { formatDateTime } from '../ui/format.js';
import { CardEditor } from '../components/card-editor.js';
import { LegacyCharacterDrawer } from '../components/legacy-card-editor.js';
import { EligibilityCard, EligibilityLookupDrawer, factsText } from './character-eligibility.js';
import {
  applyEligibilityPatch,
  canConfirmPurge,
  type EligibilityBatchPatch,
} from './batch-helpers.js';

const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  pending_check: '待检测',
  published: '已上架',
  unpublished: '已下架',
  disabled: '已禁用',
};

const BASIS_LABELS: Record<string, string> = {
  real_person: '真人',
  fictional: '虚构',
  original: '原创',
};

const REAL_PERSON_LABELS: Record<string, string> = {
  celebrity: '公众人物',
  historical: '历史人物',
  private_person: '身边真人',
};

type BatchKind = 'publish' | 'unpublish' | 'eligibility' | 'purge';

interface EligibilityForm {
  basis: '' | CharacterBasis;
  realPersonKind: '' | RealPersonKind;
  ageSetting: '' | AgeSetting;
  childAppearance: '' | 'true' | 'false';
  childFeaturesDetected: '' | 'true' | 'false';
  reason: string;
}

const EMPTY_ELIGIBILITY_FORM: EligibilityForm = {
  basis: '',
  realPersonKind: '',
  ageSetting: '',
  childAppearance: '',
  childFeaturesDetected: '',
  reason: '',
};

function eligibilityPatchOf(form: EligibilityForm): EligibilityBatchPatch {
  const patch: EligibilityBatchPatch = {};
  if (form.basis) {
    patch.basis = form.basis;
    patch.realPersonKind =
      form.basis === 'real_person'
        ? form.realPersonKind
          ? RealPersonKind.parse(form.realPersonKind)
          : undefined
        : null;
  }
  if (form.ageSetting) patch.ageSetting = AgeSetting.parse(form.ageSetting);
  if (form.childAppearance) patch.childAppearance = form.childAppearance === 'true';
  if (form.childFeaturesDetected)
    patch.childFeaturesDetected = form.childFeaturesDetected === 'true';
  return patch;
}

function blank(): AdminCharacterWrite {
  return {
    name: '',
    aliases: [],
    works: [],
    tagline: '',
    intro: '',
    tags: [],
    categoryId: null,
    birthday: null,
    fanName: null,
    fallbackGreetings: [],
    avatar: {
      imageMediaId: null,
      display: { supportColors: [], avatarText: null, avatarPattern: 'star', themeColor: null },
    },
    classification: {
      basis: 'original',
      realPersonKind: null,
      ageSetting: 'adult',
      childAppearance: false,
    },
    card: { cardSchemaVersion: 1, data: {} },
  };
}

function draftOf(row: AdminCharacter): AdminCharacterWrite {
  return {
    name: row.name,
    aliases: row.aliases,
    works: row.works,
    tagline: row.tagline,
    intro: row.intro,
    tags: row.tags,
    categoryId: row.categoryId,
    birthday: row.birthday,
    fanName: row.fanName,
    classification: {
      basis: row.classification.basis,
      realPersonKind: row.classification.realPersonKind,
      ageSetting: row.classification.ageSetting,
      childAppearance: row.classification.childAppearance,
    },
    avatar: { imageMediaId: row.avatar.image?.mediaId ?? null, display: row.avatar.display },
    fallbackGreetings: row.fallbackGreetings,
    card: row.card,
  };
}

export function CharactersPage() {
  const toast = useToast();
  const confirm = useDangerConfirm();
  const list = useRemote(CharacterAdminEndpoints.list);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<AdminCharacter | 'new' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lookup, setLookup] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [failures, setFailures] = useState<BatchFailure[]>([]);
  const [batch, setBatch] = useState<{ kind: BatchKind; rows: AdminCharacter[] } | null>(null);
  const [eligibilityForm, setEligibilityForm] = useState<EligibilityForm>(EMPTY_ELIGIBILITY_FORM);
  const [purgeImpacts, setPurgeImpacts] = useState<Record<string, AdminCharacterPurgeImpact>>({});
  const [purgeImpactErrors, setPurgeImpactErrors] = useState<Record<string, string>>({});
  const [purgeImpactLoading, setPurgeImpactLoading] = useState(false);
  const [purgeAcknowledged, setPurgeAcknowledged] = useState(false);
  const [purgeConfirmText, setPurgeConfirmText] = useState('');

  // 选择只对当前页 / 当前筛选有效：换关键词或状态时清空。
  useEffect(() => {
    setSelected([]);
  }, [query, status]);

  const rows = (list.data?.items ?? []).filter(
    (row) =>
      (!status || row.status === status) &&
      (!query.trim() ||
        `${row.name} ${row.aliases.join(' ')} ${row.works.join(' ')}`.includes(query.trim())),
  );
  const selectedRows = rows.filter((row) => selected.includes(row.characterId));

  function openBatch(kind: BatchKind) {
    if (!selectedRows.length) return;
    setEligibilityForm(EMPTY_ELIGIBILITY_FORM);
    setPurgeImpacts({});
    setPurgeImpactErrors({});
    setPurgeAcknowledged(false);
    setPurgeConfirmText('');
    setBatch({ kind, rows: [...selectedRows] });
  }

  // 彻底删除必须先查每个角色的影响面；查询失败的角色不允许确认。
  useEffect(() => {
    if (batch?.kind !== 'purge') return;
    let active = true;
    setPurgeImpactLoading(true);
    setPurgeImpacts({});
    setPurgeImpactErrors({});
    void Promise.all(
      batch.rows.map(async (row) => {
        try {
          const impact = await api.call(CharacterAdminEndpoints.purgeImpact, {
            params: { characterId: row.characterId },
          });
          return { characterId: row.characterId, impact } as const;
        } catch (error) {
          return { characterId: row.characterId, error: errorText(error) } as const;
        }
      }),
    ).then((results) => {
      if (!active) return;
      const impacts: Record<string, AdminCharacterPurgeImpact> = {};
      const errors: Record<string, string> = {};
      for (const result of results) {
        if ('impact' in result && result.impact) impacts[result.characterId] = result.impact;
        else errors[result.characterId] = result.error;
      }
      setPurgeImpacts(impacts);
      setPurgeImpactErrors(errors);
      setPurgeImpactLoading(false);
    });
    return () => {
      active = false;
    };
  }, [batch]);

  const eligibilityPatch = eligibilityPatchOf(eligibilityForm);
  const eligibilityHasChange =
    eligibilityForm.basis !== '' ||
    eligibilityForm.ageSetting !== '' ||
    eligibilityForm.childAppearance !== '' ||
    eligibilityForm.childFeaturesDetected !== '';

  async function runBatch(row: AdminCharacter): Promise<string> {
    if (!batch) return '';
    if (batch.kind === 'purge') {
      const result = await api.call(CharacterAdminEndpoints.purge, {
        params: { characterId: row.characterId },
        query: { purge: 'true' },
      });
      const { contacts, conversations, messages, moments } = result.counts;
      return `已彻底删除：联系人 ${contacts}、会话 ${conversations}、消息 ${messages}、朋友圈 ${moments}`;
    }
    if (batch.kind === 'publish') {
      // 旧卡没有 WB-Card 密文，后台不能重新上架；保持原发布状态，不假装成功。
      if (row.format === 'legacy')
        throw new ApiFailure(
          'bad_request',
          '旧卡不支持在后台重新上架（旧卡保持原有发布状态）',
          422,
        );
      await api.call(CharacterAdminEndpoints.publish, {
        params: { characterId: row.characterId },
      });
      return '已上架';
    }
    if (batch.kind === 'unpublish') {
      if (row.status === 'unpublished') return '本来就是已下架';
      await api.call(CharacterAdminEndpoints.unpublish, {
        params: { characterId: row.characterId },
      });
      return '已下架（软删）';
    }
    const current = await api.call(CharacterAdminEndpoints.getEligibility, {
      params: { characterId: row.characterId },
    });
    const override = applyEligibilityPatch(current.override ?? current.auto, eligibilityPatch);
    await api.call(CharacterAdminEndpoints.setEligibility, {
      params: { characterId: row.characterId },
      body: { override, reason: eligibilityForm.reason.trim() },
    });
    return `已标注：${factsText(override)}`;
  }

  const batchTitle =
    batch?.kind === 'publish'
      ? `上架选中的 ${batch.rows.length} 个角色？`
      : batch?.kind === 'unpublish'
        ? `下架选中的 ${batch.rows.length} 个角色？`
        : batch?.kind === 'purge'
          ? `彻底删除选中的 ${batch.rows.length} 个角色？`
          : `批量修改 ${batch?.rows.length ?? 0} 个角色的资格标注？`;
  const batchIntro =
    batch?.kind === 'publish' ? (
      <>
        将影响 {batch.rows.length}{' '}
        项。只会上架已通过检查的角色；没通过检查或人设未检测的会失败并逐条列出，
        不会自动改人设或跳过检查。
      </>
    ) : batch?.kind === 'unpublish' ? (
      <>
        将影响 {batch.rows.length}{' '}
        项。下架是软删：角色从广场和用户端选择列表消失，已添加为好友的用户不受影响，
        数据保留，随时可以重新上架；如果确实要真正删除，请用「批量彻底删除」。
      </>
    ) : batch?.kind === 'purge' ? (
      <>
        将永久删除 {batch.rows.length} 个角色及其关联数据，<strong>不可恢复</strong>
        。下面逐项列出影响面，请核对后勾选并输入确认文字。
      </>
    ) : (
      <>
        将影响 {batch?.rows.length ?? 0}{' '}
        项。会逐条读取每个角色当前的事实（人工标注优先，没有就按自动结果），
        只覆盖下面选择的字段，其余保持不变；原因会写进每个角色的修改记录。
      </>
    );
  const purgeImpactReady =
    batch?.kind === 'purge' &&
    !purgeImpactLoading &&
    batch.rows.every((row) => purgeImpacts[row.characterId]) &&
    Object.keys(purgeImpactErrors).length === 0;
  const purgeConfirmReady =
    batch?.kind === 'purge' &&
    canConfirmPurge(
      batch.rows.map((row) => row.name),
      purgeAcknowledged,
      purgeConfirmText,
    );

  async function togglePublish(row: AdminCharacter) {
    const publish = row.status !== 'published';
    const run = async () => {
      setBusy(row.characterId);
      try {
        await api.call(
          publish ? CharacterAdminEndpoints.publish : CharacterAdminEndpoints.unpublish,
          { params: { characterId: row.characterId } },
        );
        toast.success(publish ? '已上架' : '已下架');
        list.refresh();
      } catch (e) {
        toast.error(errorText(e));
        list.refresh();
      } finally {
        setBusy(null);
      }
    };
    if (publish) await run();
    else
      confirm({
        title: `下架「${row.name}」？`,
        content: '下架后用户端不再显示这个角色；已经加为好友的用户不受影响。',
        okText: '下架',
        onOk: run,
      });
  }

  const columns: ProColumns<AdminCharacter>[] = [
    {
      title: '角色',
      fixed: 'left',
      width: 240,
      render: (_, row) => (
        <div className="cell-main">
          <span className="cell-title">{row.name}</span>
          <span className="cell-sub">{row.tagline || '—'}</span>
        </div>
      ),
    },
    {
      title: '状态',
      width: 100,
      render: (_, row) => (
        <StatusTag
          tone={
            row.status === 'published'
              ? 'success'
              : row.status === 'draft'
                ? 'default'
                : row.status === 'disabled'
                  ? 'error'
                  : 'warning'
          }
        >
          {STATUS_LABELS[row.status] ?? row.status}
        </StatusTag>
      ),
    },
    {
      title: '人设版本',
      width: 90,
      render: (_, row) => `v${row.personaVersion}`,
    },
    {
      title: '上架检查',
      width: 230,
      render: (_, row) => {
        // 旧卡没有 WB-Card，不适用「必填结构 / 人设稳定 / 边界检测」；显示旧格式说明，不假装缺 12 项。
        if (row.format === 'legacy')
          return <StatusTag tone="default">旧卡 · 旧字段运行，不适用 WB-Card 检查</StatusTag>;
        const checks = [
          ['结构', row.publishChecks.requiredFieldsComplete],
          ['稳定', row.publishChecks.personaStabilityPassed],
          ['边界', row.publishChecks.hardBoundaryCasesPassed],
          ['开场白', row.publishChecks.hasFallbackGreeting],
        ] as const;
        return (
          <Space size={4} wrap>
            {checks.map(([label, pass]) => (
              <StatusTag key={label} tone={pass ? 'success' : 'default'}>
                {label}
                {pass ? ' ✓' : ' ✗'}
              </StatusTag>
            ))}
          </Space>
        );
      },
    },
    {
      title: '最近更新',
      width: 150,
      render: (_, row) => formatDateTime(row.updatedAt),
    },
    {
      title: '操作',
      width: 130,
      fixed: 'right',
      render: (_, row) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => setEditing(row)}>
            编辑
          </Button>
          {row.format === 'legacy' ? (
            row.status === 'published' ? (
              <Button
                type="link"
                size="small"
                danger
                loading={busy === row.characterId}
                onClick={() => void togglePublish(row)}
              >
                下架
              </Button>
            ) : null
          ) : (
            <Button
              type="link"
              size="small"
              danger={row.status === 'published'}
              loading={busy === row.characterId}
              onClick={() => void togglePublish(row)}
            >
              {row.status === 'published' ? '下架' : '上架'}
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Page
      title="角色库"
      desc="官方角色。上架前要过「必填结构 / 人设稳定 / 边界检测」三项检查；点一行编辑人设。勾选后可批量上架 / 下架（软删）、批量彻底删除（硬删，不可恢复）或批量修改资格标注。"
      extra={
        <Space>
          <Button onClick={() => list.refresh()}>刷新</Button>
          <Button onClick={() => setLookup(true)}>按角色 ID 标注资格</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
            新建角色
          </Button>
        </Space>
      }
    >
      {failures.length > 0 && (
        <BatchFailureAlert failures={failures} onDismiss={() => setFailures([])} />
      )}
      <DataTable<AdminCharacter>
        rowKey="characterId"
        columns={columns}
        data={rows}
        loading={list.loading}
        error={list.error}
        onRefresh={list.refresh}
        onRowClick={(row) => setEditing(row)}
        selectedKeys={selected}
        onSelectionChange={(keys) => setSelected(keys.map(String))}
        preserveSelection={false}
        selectionHint="表头勾选只覆盖当前页；换页或改筛选会清空"
        onPageChange={() => setSelected([])}
        batchActions={() => (
          <BatchBar count={selectedRows.length}>
            <Button
              size="small"
              disabled={!selectedRows.length}
              onClick={() => openBatch('publish')}
            >
              批量上架
            </Button>
            <Button
              size="small"
              danger
              disabled={!selectedRows.length}
              onClick={() => openBatch('unpublish')}
            >
              批量下架（软删）
            </Button>
            <Button
              size="small"
              danger
              type="primary"
              disabled={!selectedRows.length}
              onClick={() => openBatch('purge')}
            >
              批量彻底删除（硬删）
            </Button>
            <Button
              size="small"
              disabled={!selectedRows.length}
              onClick={() => openBatch('eligibility')}
            >
              批量改资格
            </Button>
            <Button
              size="small"
              type="text"
              disabled={!selectedRows.length}
              onClick={() => setSelected([])}
            >
              清空选择
            </Button>
          </BatchBar>
        )}
        filters={
          <>
            <Input.Search
              allowClear
              placeholder="搜索名字、别名、作品"
              style={{ width: 260 }}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Select
              style={{ width: 130 }}
              value={status}
              onChange={setStatus}
              options={[
                { value: '', label: '全部状态' },
                ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
              ]}
            />
          </>
        }
        emptyTitle="还没有角色"
        emptyHint="点右上角「新建角色」，填好名字、人设和至少一条备用开场白，再上架。"
        emptyAction={
          <Button type="primary" onClick={() => setEditing('new')}>
            新建第一个角色
          </Button>
        }
      />
      {batch && (
        <BatchOperationModal
          title={batchTitle}
          intro={batchIntro}
          targets={batch.rows}
          keyOf={(row) => row.characterId}
          labelOf={(row) => `${row.name}（${STATUS_LABELS[row.status] ?? row.status}）`}
          confirmText={
            batch.kind === 'publish'
              ? '批量上架'
              : batch.kind === 'unpublish'
                ? '批量下架'
                : batch.kind === 'purge'
                  ? '彻底删除'
                  : '批量保存'
          }
          danger={batch.kind === 'unpublish' || batch.kind === 'purge'}
          confirmDisabled={
            batch.kind === 'purge'
              ? !purgeImpactReady || !purgeConfirmReady
              : batch.kind === 'eligibility' &&
                (!eligibilityHasChange || eligibilityForm.reason.trim().length < 2)
          }
          run={runBatch}
          onCancel={() => setBatch(null)}
          onFinished={(failed) => {
            setFailures(failed);
            setSelected(failed.map((item) => item.key));
            setBatch(null);
            list.refresh();
          }}
        >
          {batch.kind === 'purge' && (
            <>
              <Alert
                type="error"
                showIcon
                message="彻底删除不可恢复"
                description="角色、联系人、私聊会话与消息、朋友圈等关联数据会被物理删除；财务流水和客服记录按合规要求保留历史引用。"
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {batch.rows.map((row) => {
                  const impact = purgeImpacts[row.characterId];
                  const error = purgeImpactErrors[row.characterId];
                  return (
                    <div
                      key={row.characterId}
                      style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}
                    >
                      <strong>{row.name}</strong>
                      {error ? (
                        <span className="cell-sub" style={{ color: '#cf1322' }}>
                          影响面查询失败：{error}
                        </span>
                      ) : impact ? (
                        <span>
                          将删除：联系人 {impact.counts.contacts}、会话{' '}
                          {impact.counts.conversations}、消息 {impact.counts.messages}、朋友圈{' '}
                          {impact.counts.moments}
                        </span>
                      ) : (
                        <span className="cell-sub">正在计算影响面…</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <Checkbox
                checked={purgeAcknowledged}
                onChange={(e) => setPurgeAcknowledged(e.target.checked)}
              >
                我已了解此操作不可恢复，确认彻底删除
              </Checkbox>
              <div className="field-line">
                <span className="field-label">
                  确认文字
                  <span className="field-label-hint">
                    {batch.rows.length === 1
                      ? `输入角色名「${batch.rows[0]?.name ?? ''}」或「彻底删除」`
                      : '批量删除请输入「彻底删除」'}
                  </span>
                </span>
                <Input
                  value={purgeConfirmText}
                  placeholder={batch.rows.length === 1 ? (batch.rows[0]?.name ?? '') : '彻底删除'}
                  onChange={(e) => setPurgeConfirmText(e.target.value)}
                  disabled={purgeImpactLoading}
                />
              </div>
            </>
          )}
          {batch.kind === 'eligibility' && (
            <>
              <div className="form-two">
                <div className="field-line">
                  <span className="field-label">
                    角色原型
                    <span className="field-label-hint">只改选中的字段</span>
                  </span>
                  <Select
                    style={{ width: '100%' }}
                    value={eligibilityForm.basis}
                    onChange={(value) =>
                      setEligibilityForm((current) => ({
                        ...current,
                        basis: value as EligibilityForm['basis'],
                        realPersonKind: value === 'real_person' ? current.realPersonKind : '',
                      }))
                    }
                    options={[
                      { value: '', label: '保持不变' },
                      ...CharacterBasis.options.map((value) => ({
                        value,
                        label: BASIS_LABELS[value] ?? value,
                      })),
                    ]}
                  />
                </div>
                {eligibilityForm.basis === 'real_person' && (
                  <div className="field-line">
                    <span className="field-label">真人类型</span>
                    <Select
                      style={{ width: '100%' }}
                      value={eligibilityForm.realPersonKind}
                      onChange={(value) =>
                        setEligibilityForm((current) => ({
                          ...current,
                          realPersonKind: value as EligibilityForm['realPersonKind'],
                        }))
                      }
                      options={[
                        { value: '', label: '保留原类型（没有则公众人物）' },
                        ...RealPersonKind.options.map((value) => ({
                          value,
                          label: REAL_PERSON_LABELS[value] ?? value,
                        })),
                      ]}
                    />
                  </div>
                )}
              </div>
              <div className="form-three">
                <div className="field-line">
                  <span className="field-label">年龄设定</span>
                  <Select
                    style={{ width: '100%' }}
                    value={eligibilityForm.ageSetting}
                    onChange={(value) =>
                      setEligibilityForm((current) => ({
                        ...current,
                        ageSetting: value as EligibilityForm['ageSetting'],
                      }))
                    }
                    options={[
                      { value: '', label: '保持不变' },
                      { value: 'adult', label: '成年' },
                      { value: 'minor', label: '未成年' },
                    ]}
                  />
                </div>
                <div className="field-line">
                  <span className="field-label">儿童外貌</span>
                  <Select
                    style={{ width: '100%' }}
                    value={eligibilityForm.childAppearance}
                    onChange={(value) =>
                      setEligibilityForm((current) => ({
                        ...current,
                        childAppearance: value as EligibilityForm['childAppearance'],
                      }))
                    }
                    options={[
                      { value: '', label: '保持不变' },
                      { value: 'true', label: '是' },
                      { value: 'false', label: '否' },
                    ]}
                  />
                </div>
                <div className="field-line">
                  <span className="field-label">检出儿童特征</span>
                  <Select
                    style={{ width: '100%' }}
                    value={eligibilityForm.childFeaturesDetected}
                    onChange={(value) =>
                      setEligibilityForm((current) => ({
                        ...current,
                        childFeaturesDetected: value as EligibilityForm['childFeaturesDetected'],
                      }))
                    }
                    options={[
                      { value: '', label: '保持不变' },
                      { value: 'true', label: '是' },
                      { value: 'false', label: '否' },
                    ]}
                  />
                </div>
              </div>
              <div className="field-line">
                <span className="field-label">
                  修改原因
                  <span className="field-label-hint">
                    必填，至少 2 个字，会写进每个角色的修改记录
                  </span>
                </span>
                <Input.TextArea
                  rows={2}
                  maxLength={200}
                  showCount
                  value={eligibilityForm.reason}
                  placeholder="例：人设写明 25 岁上班族，AI 误判为未成年 / 儿童特征"
                  onChange={(e) =>
                    setEligibilityForm((current) => ({ ...current, reason: e.target.value }))
                  }
                />
              </div>
            </>
          )}
        </BatchOperationModal>
      )}
      {lookup && <EligibilityLookupDrawer onClose={() => setLookup(false)} />}
      {editing && editing !== 'new' && editing.format === 'legacy' ? (
        <LegacyCharacterDrawer
          character={editing}
          onClose={() => setEditing(null)}
          onSaved={(text) => {
            toast.success(text);
            list.refresh();
          }}
        />
      ) : (
        editing && (
          <CharacterDrawer
            character={editing === 'new' ? null : editing}
            onClose={() => setEditing(null)}
            onSaved={(text) => {
              toast.success(text);
              list.refresh();
            }}
          />
        )
      )}
    </Page>
  );
}

function CharacterDrawer({
  character,
  onClose,
  onSaved,
}: {
  character: AdminCharacter | null;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const [draft, setDraft] = useState<AdminCharacterWrite>(() =>
    character ? draftOf(character) : blank(),
  );
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const patch = (value: Partial<AdminCharacterWrite>) =>
    setDraft((current) => ({ ...current, ...value }));

  async function save() {
    setSaving(true);
    setError('');
    try {
      const body = AdminCharacterWrite.parse(draft);
      if (character)
        await api.call(CharacterAdminEndpoints.update, {
          params: { characterId: character.characterId },
          body,
        });
      else await api.call(CharacterAdminEndpoints.create, { body });
      onSaved('已保存。改过人设后需要重新完成检测才能上架。');
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  async function uploadAvatar(file: File) {
    setUploading(true);
    setError('');
    try {
      const media = await api.call(MediaAdminEndpoints.adminUpload, {
        query: { purpose: 'character_avatar' },
        file,
      });
      patch({ avatar: { ...draft.avatar, imageMediaId: media.mediaId } });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setUploading(false);
    }
  }

  const listField = (
    key: 'aliases' | 'works' | 'tags' | 'fallbackGreetings',
    label: string,
    help: string,
    rows = 3,
  ) => (
    <div className="field-line">
      <span className="field-label">
        {label}
        <span className="field-label-hint">{help}</span>
      </span>
      <Input.TextArea
        autoSize={{ minRows: rows, maxRows: 8 }}
        value={draft[key].join('\n')}
        onChange={(e) => patch({ [key]: e.target.value.split('\n') })}
        onBlur={() => patch({ [key]: draft[key].filter((x) => x.trim()) })}
      />
    </div>
  );

  return (
    <RecordDrawer
      open
      onClose={onClose}
      draft={{
        key: `character:${character?.characterId ?? 'new'}`,
        value: draft,
        restore: (v: AdminCharacterWrite) => setDraft(v),
      }}
      title={character ? `编辑角色 · ${character.name}` : '新建角色'}
      subtitle="人设改动保存后需要重新检测才能上架"
      width={860}
      footer={
        <DrawerActions
          onCancel={onClose}
          onSubmit={() => void save()}
          saving={saving}
          submitText="保存"
        />
      }
    >
      {error && <Alert type="error" showIcon message={error} />}
      <SectionCard title="基本信息">
        <div className="form-two">
          <div className="field-line">
            <span className="field-label">角色名字</span>
            <Input
              maxLength={32}
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </div>
          <div className="field-line">
            <span className="field-label">一句话介绍</span>
            <Input
              maxLength={60}
              value={draft.tagline}
              onChange={(e) => patch({ tagline: e.target.value })}
            />
          </div>
        </div>
        <div className="form-three">
          <div className="field-line">
            <span className="field-label">
              分类编号
              <span className="field-label-hint">角色广场里的分类</span>
            </span>
            <Input
              value={draft.categoryId ?? ''}
              onChange={(e) => patch({ categoryId: e.target.value || null })}
            />
          </div>
          <div className="field-line">
            <span className="field-label">生日</span>
            <DatePicker
              style={{ width: '100%' }}
              value={draft.birthday ? dayjs(draft.birthday) : null}
              onChange={(value) => patch({ birthday: value ? value.format('YYYY-MM-DD') : null })}
            />
          </div>
          <div className="field-line">
            <span className="field-label">粉丝称呼</span>
            <Input
              maxLength={20}
              value={draft.fanName ?? ''}
              onChange={(e) => patch({ fanName: e.target.value || null })}
            />
          </div>
        </div>
        <div className="field-line">
          <span className="field-label">详细介绍</span>
          <Input.TextArea
            autoSize={{ minRows: 3, maxRows: 8 }}
            maxLength={1000}
            showCount
            value={draft.intro}
            onChange={(e) => patch({ intro: e.target.value })}
          />
        </div>
        {listField('aliases', '别名', '每行一个')}
        {listField('works', '作品', '每行一个')}
        {listField('tags', '展示标签', '每行一个，最多 10 个')}
        {listField('fallbackGreetings', '备用开场白', '每行一条，至少一条；没配模型时用它', 2)}
      </SectionCard>

      <SectionCard
        title="分类事实"
        desc="资料里写的分类；AI 判断不准时在下面「资格标注」里人工纠正"
      >
        <div className="form-three">
          <div className="field-line">
            <span className="field-label">
              角色原型
              <span className="field-label-hint">真人角色只能用本人公开形象</span>
            </span>
            <Select
              style={{ width: '100%' }}
              value={draft.classification.basis}
              onChange={(value) => {
                const basis = CharacterBasis.parse(value);
                patch({
                  classification: {
                    ...draft.classification,
                    basis,
                    realPersonKind: basis === 'real_person' ? 'celebrity' : null,
                  },
                });
              }}
              options={CharacterBasis.options.map((value) => ({
                value,
                label: BASIS_LABELS[value] ?? value,
              }))}
            />
          </div>
          {draft.classification.basis === 'real_person' && (
            <div className="field-line">
              <span className="field-label">真人类型</span>
              <Select
                style={{ width: '100%' }}
                value={draft.classification.realPersonKind ?? 'celebrity'}
                onChange={(value) =>
                  patch({
                    classification: {
                      ...draft.classification,
                      realPersonKind: RealPersonKind.parse(value),
                    },
                  })
                }
                options={RealPersonKind.options.map((value) => ({
                  value,
                  label: REAL_PERSON_LABELS[value] ?? value,
                }))}
              />
            </div>
          )}
          <div className="field-line">
            <span className="field-label">年龄设定</span>
            <Select
              style={{ width: '100%' }}
              value={draft.classification.ageSetting}
              onChange={(value) =>
                patch({
                  classification: {
                    ...draft.classification,
                    ageSetting: AgeSetting.parse(value),
                  },
                })
              }
              options={[
                { value: 'adult', label: '成年' },
                { value: 'minor', label: '未成年' },
              ]}
            />
          </div>
        </div>
        <Checkbox
          checked={draft.classification.childAppearance}
          onChange={(e) =>
            patch({
              classification: { ...draft.classification, childAppearance: e.target.checked },
            })
          }
        >
          儿童外观
        </Checkbox>
      </SectionCard>

      {character && <EligibilityCard characterId={character.characterId} />}

      <SectionCard title="头像">
        <div className="avatar-row">
          <div
            className="avatar-preview"
            style={{ background: draft.avatar.display.themeColor ?? '#07C160' }}
          >
            {draft.avatar.display.avatarText || draft.name.slice(0, 1) || '伴'}
          </div>
          <div className="avatar-actions">
            <Space>
              <Upload
                accept="image/jpeg,image/png,image/webp,image/gif"
                showUploadList={false}
                beforeUpload={(file) => {
                  void uploadAvatar(file);
                  return false;
                }}
              >
                <Button icon={<UploadOutlined />} loading={uploading}>
                  上传角色图片
                </Button>
              </Upload>
              <Button
                disabled={!draft.avatar.imageMediaId}
                onClick={() => patch({ avatar: { ...draft.avatar, imageMediaId: null } })}
              >
                使用默认头像
              </Button>
            </Space>
            <div className="field-help">
              {draft.avatar.imageMediaId
                ? '已设置角色图片，保存后生效。'
                : '当前使用默认头像（文字 + 图案 + 主题色）。'}
            </div>
          </div>
        </div>
        <div className="form-three">
          <div className="field-line">
            <span className="field-label">头像字</span>
            <Input
              maxLength={2}
              value={draft.avatar.display.avatarText ?? ''}
              onChange={(e) =>
                patch({
                  avatar: {
                    ...draft.avatar,
                    display: { ...draft.avatar.display, avatarText: e.target.value || null },
                  },
                })
              }
            />
          </div>
          <div className="field-line">
            <span className="field-label">头像图案</span>
            <Select
              style={{ width: '100%' }}
              value={draft.avatar.display.avatarPattern}
              onChange={(value) =>
                patch({
                  avatar: {
                    ...draft.avatar,
                    display: {
                      ...draft.avatar.display,
                      avatarPattern: AvatarPattern.parse(value),
                    },
                  },
                })
              }
              options={AvatarPattern.options.map((value) => ({ value, label: value }))}
            />
          </div>
          <div className="field-line">
            <span className="field-label">主题色</span>
            <Input
              type="color"
              value={draft.avatar.display.themeColor ?? '#07c160'}
              onChange={(e) =>
                patch({
                  avatar: {
                    ...draft.avatar,
                    display: { ...draft.avatar.display, themeColor: e.target.value },
                  },
                })
              }
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="人设卡" desc="内容很多，按板块填；只有必填项完整才能上架">
        <CardEditor card={draft.card} onChange={(card) => patch({ card })} />
      </SectionCard>
      <div className="detail-muted">
        上架前系统会自动检查：必填结构、人设稳定、边界检测、备用开场白。
      </div>
    </RecordDrawer>
  );
}
