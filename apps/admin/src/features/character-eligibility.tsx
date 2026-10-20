/**
 * 3.25（10-21 试用反馈第三轮 G1-2）：后台人工标注角色资格。
 * 「真人 / 未成年设定 / 儿童外貌 / 检出儿童特征」两个方向都能改（纠正 AI 误判）；预设角色在编辑抽屉里改，
 * 用户自建角色在角色库右上角「按角色 ID 标注资格」里改。每次修改必须写原因，服务器记下谁、何时改的。
 */
import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Input, Select, Space, Table } from 'antd';
import {
  CharacterAdminEndpoints,
  CharacterBasis,
  RealPersonKind,
  type CharacterEligibilityFacts,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { DrawerActions, RecordDrawer } from '../ui/drawer.js';
import { SectionCard, StatusTag, useToast } from '../ui/page.js';
import { formatDateTime } from '../ui/format.js';

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

/** 一行说清这组事实。 */
export function factsText(f: CharacterEligibilityFacts): string {
  const parts = [
    f.basis === 'real_person'
      ? `真人（${REAL_PERSON_LABELS[f.realPersonKind ?? ''] ?? '未选类型'}）`
      : (BASIS_LABELS[f.basis] ?? f.basis),
    f.ageSetting === 'minor' ? '未成年设定' : '成年',
  ];
  if (f.childAppearance) parts.push('儿童外貌');
  if (f.childFeaturesDetected) parts.push('检出儿童特征');
  return parts.join(' · ');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 资格标注卡片：显示自动结果 / 人工标注 / 生效结果，可修改或清除人工标注，下方是修改记录。 */
export function EligibilityCard({ characterId }: { characterId: string }) {
  const toast = useToast();
  const remote = useRemote(CharacterAdminEndpoints.getEligibility, { params: { characterId } });
  const [editing, setEditing] = useState(false);
  const [facts, setFacts] = useState<CharacterEligibilityFacts | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const data = remote.data;

  useEffect(() => {
    if (data) setFacts(data.override ?? data.auto);
  }, [data]);

  async function submit(override: CharacterEligibilityFacts | null) {
    if (reason.trim().length < 2) {
      setError('请写明修改原因（至少 2 个字）');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.call(CharacterAdminEndpoints.setEligibility, {
        params: { characterId },
        body: { override, reason: reason.trim() },
      });
      toast.success(override ? '已保存人工标注，立即生效' : '已清除人工标注，恢复自动结果');
      setEditing(false);
      setReason('');
      remote.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  if (remote.loading && !data) return <SectionCard title="资格标注">正在读取…</SectionCard>;
  if (!data)
    return (
      <SectionCard title="资格标注">
        <Alert type="error" showIcon message={remote.error || '读取失败'} />
      </SectionCard>
    );
  const d = data.effective.derived;
  const set = (value: Partial<CharacterEligibilityFacts>) =>
    setFacts((current) => (current ? { ...current, ...value } : current));

  return (
    <SectionCard
      title="资格标注（人工）"
      desc="决定能否开私密模式、能否恋爱；人工标注优先于资料分类和 AI 检出"
      extra={
        !editing && (
          <Space>
            {data.override && (
              <Button size="small" onClick={() => setEditing(true)}>
                清除人工标注
              </Button>
            )}
            <Button size="small" type="primary" onClick={() => setEditing(true)}>
              修改资格
            </Button>
          </Space>
        )
      }
    >
      <div className="detail-grid">
        <div>
          <span className="detail-label">自动结果（资料分类 + AI 检出）</span>
          <span>{factsText(data.auto)}</span>
        </div>
        <div>
          <span className="detail-label">人工标注</span>
          <span>{data.override ? factsText(data.override) : '没有（按自动结果）'}</span>
        </div>
        <div>
          <span className="detail-label">实际生效</span>
          <Space size={4} wrap>
            <StatusTag tone={d.adultModeEligible ? 'success' : 'default'}>
              私密模式{d.adultModeEligible ? '可用' : '不可用'}
            </StatusTag>
            <StatusTag tone={d.romanceAllowed ? 'success' : 'default'}>
              恋爱{d.romanceAllowed ? '可以' : '不可以'}
            </StatusTag>
            {d.isMinor && <StatusTag tone="warning">按未成年处理</StatusTag>}
            {data.effective.basis === 'real_person' && <StatusTag tone="warning">真人</StatusTag>}
          </Space>
        </div>
      </div>

      {editing && facts && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {error && <Alert type="error" showIcon message={error} />}
          <div className="form-three">
            <div className="field-line">
              <span className="field-label">角色原型</span>
              <Select
                style={{ width: '100%' }}
                value={facts.basis}
                onChange={(value) => {
                  const basis = CharacterBasis.parse(value);
                  set({ basis, realPersonKind: basis === 'real_person' ? 'celebrity' : null });
                }}
                options={CharacterBasis.options.map((value) => ({
                  value,
                  label: BASIS_LABELS[value] ?? value,
                }))}
              />
            </div>
            {facts.basis === 'real_person' && (
              <div className="field-line">
                <span className="field-label">真人类型</span>
                <Select
                  style={{ width: '100%' }}
                  value={facts.realPersonKind ?? 'celebrity'}
                  onChange={(value) => set({ realPersonKind: RealPersonKind.parse(value) })}
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
                value={facts.ageSetting}
                onChange={(value) => set({ ageSetting: value === 'minor' ? 'minor' : 'adult' })}
                options={[
                  { value: 'adult', label: '成年' },
                  { value: 'minor', label: '未成年' },
                ]}
              />
            </div>
          </div>
          <Space size={16} wrap>
            <Checkbox
              checked={facts.childAppearance}
              onChange={(e) => set({ childAppearance: e.target.checked })}
            >
              儿童外貌
            </Checkbox>
            <Checkbox
              checked={facts.childFeaturesDetected}
              onChange={(e) => set({ childFeaturesDetected: e.target.checked })}
            >
              检出儿童特征（AI 判断的结果，可纠正）
            </Checkbox>
          </Space>
          <div className="field-line">
            <span className="field-label">
              修改原因
              <span className="field-label-hint">必填，会记在修改记录里</span>
            </span>
            <Input.TextArea
              autoSize={{ minRows: 2, maxRows: 4 }}
              maxLength={200}
              showCount
              value={reason}
              placeholder="例：人设里写明 25 岁上班族，AI 误判为儿童特征"
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <Space>
            <Button
              type="primary"
              loading={saving}
              disabled={reason.trim().length < 2}
              onClick={() => void submit(facts)}
            >
              保存人工标注
            </Button>
            {data.override && (
              <Button
                loading={saving}
                disabled={reason.trim().length < 2}
                onClick={() => void submit(null)}
              >
                清除人工标注（恢复自动结果）
              </Button>
            )}
            <Button
              onClick={() => {
                setEditing(false);
                setError('');
                setFacts(data.override ?? data.auto);
              }}
            >
              取消
            </Button>
          </Space>
        </div>
      )}

      <Table
        style={{ marginTop: 12 }}
        size="small"
        rowKey={(row) => `${row.at}-${row.reason}`}
        pagination={false}
        dataSource={data.history}
        locale={{ emptyText: '还没有人工修改过' }}
        columns={[
          { title: '时间', width: 150, render: (_, row) => formatDateTime(row.at) },
          { title: '操作人', width: 110, render: (_, row) => row.operatorName || '—' },
          {
            title: '改成',
            render: (_, row) => (row.after ? factsText(row.after) : '清除人工标注'),
          },
          { title: '原因', dataIndex: 'reason' },
        ]}
      />
    </SectionCard>
  );
}

/** 用户自建角色没有出现在角色库列表里：按角色 ID 打开资格标注。 */
export function EligibilityLookupDrawer({ onClose }: { onClose: () => void }) {
  const [input, setInput] = useState('');
  const [characterId, setCharacterId] = useState<string | null>(null);
  const valid = UUID.test(input.trim());
  return (
    <RecordDrawer
      open
      onClose={onClose}
      title="按角色 ID 标注资格"
      subtitle="用于用户自建角色（AI 误判真人 / 儿童时纠正）"
      width={760}
      footer={<DrawerActions onCancel={onClose} />}
    >
      <Space.Compact style={{ width: '100%' }}>
        <Input
          placeholder="角色 ID（从用户反馈、聊天记录或用户详情里复制）"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={() => valid && setCharacterId(input.trim())}
        />
        <Button
          type="primary"
          disabled={!valid}
          onClick={() => setCharacterId(input.trim())}
        >
          查找
        </Button>
      </Space.Compact>
      {characterId && (
        <div style={{ marginTop: 12 }}>
          <EligibilityCard key={characterId} characterId={characterId} />
        </div>
      )}
    </RecordDrawer>
  );
}
