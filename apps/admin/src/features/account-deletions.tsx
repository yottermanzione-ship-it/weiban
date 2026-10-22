/**
 * 注销未完成：正在注销、但还有模块没删完的账号。
 * 只显示删除进度，不显示账号内容，也没有「取消注销」入口。
 */
import { useEffect, useState } from 'react';
import { Alert, Button, Space } from 'antd';
import { IdentityAdminEndpoints, type PendingAccountDeletion } from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText } from '../data/hooks.js';
import { DataTable, type ProColumns } from '../ui/table.js';
import { RecordDrawer } from '../ui/drawer.js';
import { Page, StatusTag, useDangerConfirm, useToast } from '../ui/page.js';
import { formatDateTime, relativeTime } from '../ui/format.js';

const MODULE_LABELS: Record<string, string> = {
  identity: '账号',
  billing: '积分与账本',
  chat: '聊天',
  contacts: '通讯录',
  characters: '角色',
  moments: '朋友圈',
  media: '图片与文件',
  pets: '宠物',
  growth: '成长与卡册',
  health: '经期',
  play: '玩法',
  support: '反馈',
  plaza: '广场',
  memory: '记忆',
};

export function AccountDeletionsPage() {
  const toast = useToast();
  const confirm = useDangerConfirm();
  const [items, setItems] = useState<PendingAccountDeletion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<PendingAccountDeletion | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const result = await api.call(IdentityAdminEndpoints.listPendingDeletions);
      setItems(result.items);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function retry(row: PendingAccountDeletion) {
    setBusy(row.userId);
    setError('');
    try {
      await api.call(IdentityAdminEndpoints.retryDeletion, { params: { userId: row.userId } });
      toast.success('已重新触发删除');
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  const pendingOf = (row: PendingAccountDeletion) => row.modules.filter((m) => !m.purged).length;

  const columns: ProColumns<PendingAccountDeletion>[] = [
    {
      title: '用户',
      width: 220,
      render: (_, row) => (
        <div className="cell-main">
          <span className="cell-title">{row.username}</span>
          <span className="cell-sub mono">{row.userId}</span>
        </div>
      ),
    },
    {
      title: '申请时间',
      width: 170,
      render: (_, row) => formatDateTime(row.requestedAt),
    },
    {
      title: '已等待',
      width: 110,
      render: (_, row) => relativeTime(row.requestedAt),
    },
    {
      title: '进度',
      width: 150,
      render: (_, row) => {
        const pending = pendingOf(row);
        return pending === 0 ? (
          <StatusTag tone="success">全部完成</StatusTag>
        ) : (
          <StatusTag tone="warning">
            {row.modules.length - pending} / {row.modules.length} 个模块
          </StatusTag>
        );
      },
    },
    {
      title: '最近重试',
      width: 150,
      render: (_, row) => (row.lastRetriggeredAt ? formatDateTime(row.lastRetriggeredAt) : '—'),
    },
    {
      title: '操作',
      width: 130,
      fixed: 'right',
      render: (_, row) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => setDetail(row)}>
            看进度
          </Button>
          <Button
            type="link"
            size="small"
            loading={busy === row.userId}
            onClick={() =>
              confirm({
                title: `重新触发「${row.username}」的删除？`,
                content: '会对还没回报完成的模块重新投递删除任务；已完成的部分不会重复删除。',
                okText: '重新触发',
                onOk: () => retry(row),
              })
            }
          >
            重试
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Page
      title="注销未完成"
      desc="用户申请注销后，各模块要把自己的数据删干净。这里看哪些账号还没删完。"
      extra={<Button onClick={() => void load()}>刷新</Button>}
    >
      {error && <Alert type="error" showIcon message={error} />}
      <DataTable<PendingAccountDeletion>
        rowKey="userId"
        columns={columns}
        data={items}
        loading={loading}
        onRefresh={() => void load()}
        pagination={false}
        onRowClick={(row) => setDetail(row)}
        emptyTitle="没有注销中的账号"
        emptyHint="用户申请注销并还在删除过程中时会出现在这里；全部删完后自动消失。"
      />
      {detail && (
        <RecordDrawer
          open
          onClose={() => setDetail(null)}
          title={`${detail.username} 的注销进度`}
          subtitle={`申请于 ${formatDateTime(detail.requestedAt)}`}
          width={560}
        >
          <div className="module-list">
            {detail.modules.map((module) => (
              <div className="module-row" key={module.module}>
                <span>{MODULE_LABELS[module.module] ?? '其他模块'}</span>
                {module.purged ? (
                  <StatusTag tone="success">
                    已删除{module.deletedRows != null ? ` ${module.deletedRows} 行` : ''}
                  </StatusTag>
                ) : (
                  <StatusTag tone="warning">等待中</StatusTag>
                )}
                <span className="cell-sub">
                  {module.purgedAt ? formatDateTime(module.purgedAt) : '—'}
                </span>
              </div>
            ))}
          </div>
          <div className="detail-muted">
            为保护隐私，这里不显示账号内容，也不提供「取消注销」。如果某个模块长时间没完成，点列表里的「重试」。
          </div>
        </RecordDrawer>
      )}
    </Page>
  );
}
