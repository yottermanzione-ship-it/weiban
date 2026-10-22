/**
 * 症状标签：经期记录里可选的症状。只能维护标签，后台看不到任何用户的经期记录。
 */
import { useState } from 'react';
import { Alert, Button, Input, Space, Switch, Tag } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, PlusOutlined } from '@ant-design/icons';
import { HealthTagAdminEndpoints } from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { Page, SectionCard, useToast } from '../ui/page.js';

interface Row {
  tagId?: string;
  name: string;
  enabled: boolean;
}

export function SymptomTagsPage() {
  const toast = useToast();
  const remote = useRemote(HealthTagAdminEndpoints.listSymptomTags);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const current: Row[] =
    rows ??
    [...(remote.data?.items ?? [])]
      .sort((a, b) => a.order - b.order)
      .map(({ tagId, name: n, enabled }) => ({ tagId, name: n, enabled }));

  const change = (next: Row[]) => setRows(next);

  function move(index: number, delta: number) {
    const next = [...current];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    change(next);
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      const result = await api.call(HealthTagAdminEndpoints.putSymptomTags, {
        body: {
          items: current.map((row, order) => ({
            ...(row.tagId ? { tagId: row.tagId } : {}),
            name: row.name,
            order,
            enabled: row.enabled,
          })),
        },
      });
      setRows(
        [...result.items]
          .sort((a, b) => a.order - b.order)
          .map(({ tagId, name: n, enabled }) => ({ tagId, name: n, enabled })),
      );
      toast.success('已保存');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Page
      title="症状标签"
      desc="用户记录经期时能选的症状。这里只能维护标签，任何人的经期记录在后台都看不到。"
      extra={
        <Button
          type="primary"
          loading={saving}
          disabled={rows === null}
          onClick={() => void save()}
        >
          保存
        </Button>
      }
    >
      {error && <Alert type="error" showIcon message={error} />}
      {remote.error && <Alert type="error" showIcon message={remote.error} />}
      <SectionCard title="标签列表" desc="顺序就是用户看到的顺序">
        <Space.Compact style={{ width: 360, marginBottom: 14 }}>
          <Input
            maxLength={6}
            placeholder="标签名，最多 6 个字"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onPressEnter={() => {
              const value = name.trim();
              if (!value || current.some((r) => r.name === value)) return;
              change([...current, { name: value, enabled: true }]);
              setName('');
            }}
          />
          <Button
            icon={<PlusOutlined />}
            disabled={!name.trim() || current.length >= 50}
            onClick={() => {
              const value = name.trim();
              if (!value || current.some((r) => r.name === value)) return;
              change([...current, { name: value, enabled: true }]);
              setName('');
            }}
          >
            新建标签
          </Button>
        </Space.Compact>
        <div className="simple-list">
          {current.map((row, index) => (
            <div className="simple-row" key={row.tagId ?? `new-${row.name}`}>
              <span className="simple-main">{row.name}</span>
              <Tag color={row.enabled ? 'green' : 'default'} bordered={false}>
                {row.enabled ? '已上架' : '已下架'}
              </Tag>
              <Space size={4}>
                <Button
                  size="small"
                  type="text"
                  icon={<ArrowUpOutlined />}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                />
                <Button
                  size="small"
                  type="text"
                  icon={<ArrowDownOutlined />}
                  disabled={index === current.length - 1}
                  onClick={() => move(index, 1)}
                />
                <Switch
                  size="small"
                  checked={row.enabled}
                  onChange={(checked) =>
                    change(current.map((r, i) => (i === index ? { ...r, enabled: checked } : r)))
                  }
                />
                {!row.tagId && (
                  <Button
                    size="small"
                    type="link"
                    danger
                    onClick={() => change(current.filter((_, i) => i !== index))}
                  >
                    移除
                  </Button>
                )}
              </Space>
            </div>
          ))}
          {current.length === 0 && (
            <div className="detail-muted">还没有标签。在上面输入名字，点「新建标签」。</div>
          )}
        </div>
        <div className="field-note" style={{ marginTop: 12 }}>
          下架的标签：已记录过的用户仍能在自己的历史记录里看到，新记录不能再选。
        </div>
      </SectionCard>
    </Page>
  );
}
