/**
 * 用户模型榜单来源（10-20 从「系统设置」移到「模型管理」页顶部）。
 * 3.24（试用反馈第二轮 F2 第 6 条）：榜单自动获取——服务器每天抓一次来源链接（也可「立即刷新」），
 * 按各模型的「榜单对应名称」匹配名次，用户端按相对顺序重新编号 1..N；抓不到时保留上次结果并写明原因，
 * 可改用「粘贴导入」（从榜单网页整表复制，或上传 CSV）。
 */
import { useEffect, useState } from 'react';
import { Alert, Button, Collapse, DatePicker, Form, Input, Space, Tag, Upload } from 'antd';
import { ReloadOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { ModelAccessAdminEndpoints, type LeaderboardSnapshotStatus } from '@weiban/contracts';
import { api } from '../../data/client.js';
import { errorText, useRemote } from '../../data/hooks.js';
import { useFormFeedback } from '../../data/form-feedback.js';
import { DrawerActions, RecordDrawer } from '../../ui/drawer.js';
import { FieldHelp, SectionCard, useToast } from '../../ui/page.js';

interface SourceValues {
  label: string;
  url: string;
  asOf?: dayjs.Dayjs | null;
}

const fmt = (iso: string) => dayjs(iso).format('YYYY-MM-DD HH:mm');

export function LeaderboardSourceCard({ onChanged }: { onChanged?: () => void }) {
  const toast = useToast();
  const remote = useRemote(ModelAccessAdminEndpoints.getLeaderboardSource);
  const statusRemote = useRemote(ModelAccessAdminEndpoints.getLeaderboardStatus);
  const [status, setStatus] = useState<LeaderboardSnapshotStatus | null>(null);
  const [form] = Form.useForm<SourceValues>();
  const feedback = useFormFeedback(form);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [error, setError] = useState('');
  const current = status ?? statusRemote.data ?? null;

  useEffect(() => {
    if (remote.data)
      form.setFieldsValue({
        label: remote.data.label,
        url: remote.data.url,
        asOf: remote.data.asOf ? dayjs(remote.data.asOf) : null,
      });
  }, [remote.data, form]);

  async function save() {
    const values = await feedback.validate();
    if (!values) return;
    setSaving(true);
    setError('');
    try {
      await api.call(ModelAccessAdminEndpoints.updateLeaderboardSource, {
        body: {
          label: values.label,
          url: values.url,
          asOf: values.asOf ? values.asOf.format('YYYY-MM-DD') : null,
        },
      });
      toast.success('已保存，用户端排行榜会显示新的来源');
      remote.refresh();
      statusRemote.refresh();
    } catch (e) {
      setError(feedback.report(e));
    } finally {
      setSaving(false);
    }
  }

  async function refreshNow() {
    setRefreshing(true);
    setError('');
    try {
      const next = await api.call(ModelAccessAdminEndpoints.refreshLeaderboard);
      setStatus(next);
      if (next.lastError) toast.warning('这次没抓到，已保留上次的榜单');
      else toast.success(`已更新榜单，共 ${next.snapshot?.entries ?? 0} 条`);
      onChanged?.();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <SectionCard
      title="用户模型榜单来源"
      desc={
        remote.data
          ? `用户端显示「来源：${remote.data.label}${
              current?.snapshot
                ? ` · ${dayjs(current.snapshot.fetchedAt).format('YYYY-MM-DD')}`
                : remote.data.asOf
                  ? ` · ${remote.data.asOf}`
                  : ''
            }」；名次按各模型的「榜单对应名称」自动匹配，用户端按相对顺序显示 1、2、3…`
          : '还没配置：用户端排行榜不显示来源行'
      }
      extra={
        <Space>
          <Button icon={<UploadOutlined />} onClick={() => setPasting(true)}>
            粘贴导入
          </Button>
          <Button
            icon={<ReloadOutlined />}
            loading={refreshing}
            disabled={!remote.data}
            onClick={() => void refreshNow()}
          >
            立即刷新
          </Button>
          <Button type="primary" loading={saving} onClick={() => void save()}>
            保存来源
          </Button>
        </Space>
      }
    >
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      {remote.error && (
        <Alert type="error" showIcon message={remote.error} style={{ marginBottom: 12 }} />
      )}
      <Form<SourceValues>
        form={form}
        layout="vertical"
        className="leaderboard-source-form"
        initialValues={{ url: 'https://arena.ai/leaderboard/chat/text' }}
      >
        <Form.Item
          name="label"
          label="来源名称"
          rules={[{ required: true, message: '填写来源名称' }]}
          extra={<FieldHelp>例：Arena。</FieldHelp>}
        >
          <Input maxLength={80} placeholder="Arena" />
        </Form.Item>
        <Form.Item
          label="参考日期"
          extra={
            <FieldHelp>没有自动获取 / 导入的榜单时显示这个日期；有了就显示榜单更新日期。</FieldHelp>
          }
        >
          <Form.Item name="asOf" noStyle>
            <DatePicker style={{ width: '100%' }} placeholder="选择日期" />
          </Form.Item>
        </Form.Item>
        <Form.Item
          name="url"
          label="官方链接"
          rules={[
            { required: true, message: '填写链接' },
            { type: 'url', message: '要以 https:// 开头' },
          ]}
          extra={
            <FieldHelp>只支持 Arena 官方 https 链接；服务器每天 4:20 自动抓取一次。</FieldHelp>
          }
        >
          <Input />
        </Form.Item>
      </Form>
      {current && <SnapshotStatus status={current} />}
      {pasting && (
        <PasteDrawer
          onClose={() => setPasting(false)}
          onDone={(next) => {
            setStatus(next);
            setPasting(false);
            toast.success(`已导入榜单，共 ${next.snapshot?.entries ?? 0} 条`);
            onChanged?.();
          }}
        />
      )}
    </SectionCard>
  );
}

function SnapshotStatus({ status }: { status: LeaderboardSnapshotStatus }) {
  return (
    <div className="leaderboard-status">
      <div>
        <strong>自动获取：</strong>
        {status.snapshot ? (
          <span>
            当前榜单更新于 {fmt(status.snapshot.fetchedAt)}（
            {status.snapshot.method === 'fetch' ? '服务器抓取' : '粘贴导入'}，
            {status.snapshot.entries} 条）
          </span>
        ) : (
          <span>还没有榜单数据（用户端按手填名次显示）</span>
        )}
      </div>
      {status.lastError && (
        <Alert
          type="warning"
          showIcon
          style={{ margin: '8px 0' }}
          message={`最近一次获取失败${status.lastAttemptAt ? `（${fmt(status.lastAttemptAt)}）` : ''}：${status.lastError}`}
          description={
            status.snapshot ? '用户端继续用上次的榜单。' : '可以点「粘贴导入」手动导入。'
          }
        />
      )}
      <Collapse
        ghost
        size="small"
        items={[
          {
            key: 'match',
            label: `匹配上 ${status.matched.length} 个模型，没匹配上 ${status.unmatched.length} 个`,
            children: (
              <div className="leaderboard-match">
                {status.matched.map((m) => (
                  <Tag key={m.modelKey} color="green">
                    {m.relativeRank}. {m.displayName}（原榜第 {m.rank} 名 · {m.arenaModelName}）
                  </Tag>
                ))}
                {status.unmatched.map((m) => (
                  <Tag key={m.modelKey}>
                    {m.displayName}
                    {m.arenaModelName
                      ? `（榜单里没有「${m.arenaModelName}」）`
                      : '（没填榜单对应名称）'}
                  </Tag>
                ))}
                <div className="field-help" style={{ marginTop: 6 }}>
                  没匹配上的模型在用户端排行榜里排在后面、不显示名次；在模型抽屉里改「榜单对应名称」即可。
                </div>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

function PasteDrawer({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (status: LeaderboardSnapshotStatus) => void;
}) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!text.trim()) {
      setError('先粘贴榜单内容或选择 CSV 文件');
      return;
    }
    setSaving(true);
    setError('');
    try {
      onDone(await api.call(ModelAccessAdminEndpoints.importLeaderboard, { body: { text } }));
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
      title="粘贴导入榜单"
      subtitle="服务器抓不到榜单网站时用它：导入后立即按「榜单对应名称」匹配名次"
      width={620}
      footer={
        <DrawerActions
          onCancel={onClose}
          onSubmit={() => void submit()}
          saving={saving}
          submitText="导入"
          error={error}
        />
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="怎么复制"
        description="在电脑浏览器打开榜单页（例 arena.ai/leaderboard/chat/text），从表头开始拖选整张表格复制，粘贴到下面；也可以上传 CSV（表头含 rank 和 model 两列）。每行要有名次和模型名。"
      />
      <Space style={{ marginBottom: 8 }}>
        <Upload
          accept=".csv,.txt,text/csv,text/plain"
          showUploadList={false}
          beforeUpload={(file) => {
            void file.text().then((content) => setText(content.slice(0, 1_000_000)));
            return false;
          }}
        >
          <Button icon={<UploadOutlined />}>选择 CSV 文件</Button>
        </Upload>
        <span className="field-help">
          {text ? `已填入 ${text.length.toLocaleString('en-US')} 个字符` : ''}
        </span>
      </Space>
      <Input.TextArea
        rows={16}
        className="mono"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'Rank\tModel\tScore\n1\tgemini-3-pro\t1501\n2\tclaude-opus-4-8\t1490'}
      />
    </RecordDrawer>
  );
}
