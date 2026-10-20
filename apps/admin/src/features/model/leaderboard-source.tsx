/**
 * 用户模型榜单来源（10-20 从「系统设置」移到「模型管理」页顶部）。
 * 用户端「模型排行榜」显示「来源：名称 · 日期」；各模型的名次在模型编辑抽屉的「榜单名次」里填。
 */
import { useEffect, useState } from 'react';
import { Alert, Button, DatePicker, Form, Input } from 'antd';
import dayjs from 'dayjs';
import { ModelAccessAdminEndpoints } from '@weiban/contracts';
import { api } from '../../data/client.js';
import { useRemote } from '../../data/hooks.js';
import { useFormFeedback } from '../../data/form-feedback.js';
import { FieldHelp, SectionCard, useToast } from '../../ui/page.js';

interface SourceValues {
  label: string;
  url: string;
  asOf?: dayjs.Dayjs | null;
}

export function LeaderboardSourceCard() {
  const toast = useToast();
  const remote = useRemote(ModelAccessAdminEndpoints.getLeaderboardSource);
  const [form] = Form.useForm<SourceValues>();
  const feedback = useFormFeedback(form);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
    } catch (e) {
      setError(feedback.report(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard
      title="用户模型榜单来源"
      desc={
        remote.data
          ? `用户端显示「来源：${remote.data.label}${remote.data.asOf ? ` · ${remote.data.asOf}` : ''}」；各模型名次在「模型」里编辑`
          : '还没配置：用户端排行榜不显示来源行。各模型名次在「模型」里编辑'
      }
      extra={
        <Button type="primary" loading={saving} onClick={() => void save()}>
          保存来源
        </Button>
      }
    >
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      {remote.error && <Alert type="error" showIcon message={remote.error} style={{ marginBottom: 12 }} />}
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
        <Form.Item label="参考日期" extra={<FieldHelp>榜单数据的截止日期。</FieldHelp>}>
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
          extra={<FieldHelp>只支持 Arena 官方 https 链接；系统不会自动抓取。</FieldHelp>}
        >
          <Input />
        </Form.Item>
      </Form>
    </SectionCard>
  );
}
