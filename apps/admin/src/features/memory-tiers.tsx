/**
 * 记忆分档（v5 批 B，docs/refactor/16-membership-v5.md §5）。
 * 免费 / PRO+ 两档的记忆参数、新用户体验天数、翻聊天记录条数。改完立即生效（约 30 秒内）。
 */
import { useEffect, useState } from 'react';
import { Alert, Button, Form, InputNumber, Space } from 'antd';
import { MemoryTierEndpoints, type MemoryTierLimits } from '@weiban/contracts';
import { api } from '../data/client.js';
import { useRemote } from '../data/hooks.js';
import { FieldHelp, FormSection, Page, SectionCard, useToast } from '../ui/page.js';
import { useFormFeedback } from '../data/form-feedback.js';

type TierForm = {
  residentLimit: number;
  libraryLimit: number | null;
  summaryDays: number | null;
  retrieveLimit: number;
  recallDays: number | null;
};
type FormValues = {
  free: TierForm;
  proPlus: TierForm;
  newUserTrialDays: number;
  recallTopK: number;
  groupMemoryMessageThreshold?: number;
  groupMemoryIdleMinutes?: number;
};

const tierOut = (t: TierForm): MemoryTierLimits => ({
  residentLimit: t.residentLimit,
  libraryLimit: t.libraryLimit ?? null,
  summaryDays: t.summaryDays ?? null,
  retrieveLimit: t.retrieveLimit,
  recallDays: t.recallDays ?? null,
});

function TierFields({ name }: { name: 'free' | 'proPlus' }) {
  return (
    <div className="form-two">
      <Form.Item
        name={[name, 'residentLimit']}
        label="常驻记忆条数"
        rules={[{ required: true, message: '必填' }]}
        extra={<FieldHelp>每次回复都带上的重要事实（名字、称呼、生日这类）。</FieldHelp>}
      >
        <InputNumber min={0} max={50} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item
        name={[name, 'libraryLimit']}
        label="记忆库容量（每个角色）"
        extra={<FieldHelp>留空 = 不限。超出的记忆不删除，只是暂不参与聊天。</FieldHelp>}
      >
        <InputNumber min={1} max={1000} style={{ width: '100%' }} placeholder="不限" />
      </Form.Item>
      <Form.Item
        name={[name, 'summaryDays']}
        label="聊天摘要保留天数"
        extra={<FieldHelp>留空 = 全部。只影响发给模型的摘要，不删数据。</FieldHelp>}
      >
        <InputNumber min={1} max={3650} style={{ width: '100%' }} placeholder="全部" />
      </Form.Item>
      <Form.Item
        name={[name, 'retrieveLimit']}
        label="每次按话题回想条数"
        rules={[{ required: true, message: '必填' }]}
      >
        <InputNumber min={0} max={20} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item
        name={[name, 'recallDays']}
        label="翻聊天记录范围（天）"
        extra={<FieldHelp>留空 = 从认识第一天起全部。</FieldHelp>}
      >
        <InputNumber min={1} max={3650} style={{ width: '100%' }} placeholder="全部" />
      </Form.Item>
    </div>
  );
}

export function MemoryTiersPage() {
  const toast = useToast();
  const remote = useRemote(MemoryTierEndpoints.adminGet);
  const [form] = Form.useForm<FormValues>();
  const feedback = useFormFeedback(form);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (remote.data) form.setFieldsValue(remote.data);
  }, [remote.data, form]);

  async function save() {
    const v = await feedback.validate();
    if (!v) return;
    setSaving(true);
    setError('');
    try {
      await api.call(MemoryTierEndpoints.adminUpdate, {
        body: {
          free: tierOut(v.free),
          proPlus: tierOut(v.proPlus),
          newUserTrialDays: v.newUserTrialDays,
          recallTopK: v.recallTopK,
          groupMemoryMessageThreshold: v.groupMemoryMessageThreshold ?? 20,
          groupMemoryIdleMinutes: v.groupMemoryIdleMinutes ?? 10,
        },
      });
      toast.success('已保存，约 30 秒内生效');
      remote.refresh();
    } catch (e) {
      setError(feedback.report(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Page
      title="记忆分档"
      desc="免费与 PRO+ 的记忆范围、新用户体验、翻聊天记录。只决定发给模型的内容，不删除任何数据。"
    >
      <SectionCard
        title="记忆参数"
        desc={
          remote.data?.updatedAt
            ? `上次修改：${remote.data.updatedAt.slice(0, 16).replace('T', ' ')}`
            : '当前为默认值'
        }
        extra={
          <Button type="primary" loading={saving} onClick={() => void save()}>
            保存
          </Button>
        }
      >
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
        {remote.error && <Alert type="error" showIcon message={remote.error} />}
        <Form form={form} layout="vertical">
          <FormSection title="免费" desc="默认：常驻 3、记忆库 30、摘要 7 天、回想 3、翻 7 天" />
          <TierFields name="free" />
          <FormSection title="PRO+" desc="默认：常驻 16、记忆库不限、摘要全部、回想 8、翻全部" />
          <TierFields name="proPlus" />
          <FormSection title="通用" />
          <div className="form-two">
            <Form.Item
              name="groupMemoryMessageThreshold"
              label="群聊每多少条用户消息整理一次"
              extra={<FieldHelp>默认20条，整理会消耗该用户积分，与生态开关无关。</FieldHelp>}
            >
              <InputNumber min={5} max={100} placeholder="20" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="groupMemoryIdleMinutes"
              label="群聊安静多少分钟后整理"
              extra={<FieldHelp>不足消息数量时，按静默时间整理；默认10分钟。</FieldHelp>}
            >
              <InputNumber min={1} max={120} placeholder="10" style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <div className="form-two">
            <Form.Item
              name="newUserTrialDays"
              label="新用户按 PRO+ 记忆的天数"
              rules={[{ required: true, message: '必填' }]}
              extra={<FieldHelp>从注册时间算；0 = 不送。只送记忆。</FieldHelp>}
            >
              <InputNumber min={0} max={60} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="recallTopK"
              label="翻聊天记录每次取几条原话"
              rules={[{ required: true, message: '必填' }]}
              extra={<FieldHelp>用户提到「还记得 / 上次…」时才翻；0 = 关闭。</FieldHelp>}
            >
              <InputNumber min={0} max={10} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Space>
            <Button onClick={() => remote.data && form.setFieldsValue(remote.data)}>还原</Button>
          </Space>
        </Form>
      </SectionCard>
    </Page>
  );
}
