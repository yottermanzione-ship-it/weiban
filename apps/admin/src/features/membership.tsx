/**
 * 会员与订单：目前没有真实支付，所以没有订单列表；这里按用户 ID 查改会员档位。
 */
import { useState } from 'react';
import { Alert, Button, Form, Input, Space } from 'antd';
import { MembershipAdminEndpoints } from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText } from '../data/hooks.js';
import {
  FieldHelp,
  Page,
  SectionCard,
  StatusTag,
  useDangerConfirm,
  useToast,
} from '../ui/page.js';
import { formatDateTime } from '../ui/format.js';

interface Loaded {
  userId: string;
  tier: string;
  expiresAt: string | null;
}

export function MembershipPage() {
  const toast = useToast();
  const confirm = useDangerConfirm();
  const [userId, setUserId] = useState('');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [expiry, setExpiry] = useState('');

  async function load() {
    const id = userId.trim();
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const result = await api.call(MembershipAdminEndpoints.get, { params: { userId: id } });
      setLoaded({ userId: id, tier: result.tier, expiresAt: result.expiresAt });
    } catch (e) {
      setLoaded(null);
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  async function save(revoke: boolean) {
    if (!loaded) return;
    setSaving(true);
    setError('');
    try {
      const result = await api.call(MembershipAdminEndpoints.set, {
        params: { userId: loaded.userId },
        body: { expiresAt: revoke ? null : new Date(`${expiry}T23:59:59+08:00`).toISOString() },
      });
      setLoaded({ userId: loaded.userId, tier: result.tier, expiresAt: result.expiresAt });
      toast.success(revoke ? '已撤销 PRO+' : '已保存');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Page
      title="会员与订单"
      desc="目前没有接真实支付，所以还没有订单。这里只用来给某个用户开通或撤销 PRO+。"
    >
      <Alert
        type="info"
        showIcon
        message="支付未开放"
        description="用户端「充值」按钮显示「联系管理员充值」。管理员收到钱后，到「用户列表」里给用户加积分即可；会员档位在本页设置。"
      />
      <SectionCard title="按用户 ID 查询" desc="用户 ID 可以在「用户列表」里点开一行看到">
        <Space.Compact style={{ width: 520 }}>
          <Input
            placeholder="粘贴用户 ID"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            onPressEnter={() => void load()}
            allowClear
          />
          <Button type="primary" loading={loading} onClick={() => void load()}>
            查询
          </Button>
        </Space.Compact>
        {error && <Alert type="error" showIcon message={error} style={{ marginTop: 12 }} />}
      </SectionCard>

      {loaded && (
        <SectionCard title="会员档位" desc={`用户 ${loaded.userId}`}>
          <div className="detail-grid">
            <div>
              <span className="detail-label">当前档位</span>
              <StatusTag tone={loaded.tier === 'pro_plus' ? 'success' : 'default'}>
                {loaded.tier === 'pro_plus' ? 'PRO+' : '免费'}
              </StatusTag>
            </div>
            <div>
              <span className="detail-label">到期时间</span>
              <span>{loaded.expiresAt ? formatDateTime(loaded.expiresAt) : '无'}</span>
            </div>
          </div>
          <div style={{ height: 14 }} />
          <Form layout="vertical">
            <Form.Item
              label="PRO+ 到期日期"
              extra={<FieldHelp>到期当天 23:59 失效。撤销不会改变积分余额。</FieldHelp>}
            >
              <Input
                type="date"
                style={{ width: 240 }}
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
              />
            </Form.Item>
          </Form>
          <Space>
            <Button type="primary" loading={saving} disabled={!expiry} onClick={() => void save(false)}>
              授予 / 更新
            </Button>
            <Button
              danger
              disabled={loaded.tier !== 'pro_plus' || saving}
              onClick={() =>
                confirm({
                  title: '撤销 PRO+？',
                  content: '撤销后用户立即回到免费档位，不会改变积分余额。',
                  okText: '撤销',
                  onOk: () => save(true),
                })
              }
            >
              撤销 PRO+
            </Button>
          </Space>
        </SectionCard>
      )}
    </Page>
  );
}
