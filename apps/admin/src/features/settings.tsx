/**
 * 系统设置：用户模型榜单来源、每用户限流与线路健康参数。
 * 这些参数影响全站，改完立即生效；写操作会记审计。
 */
import { useEffect, useState } from 'react';
import { Alert, Button, DatePicker, Form, Input, InputNumber, Space } from 'antd';
import dayjs from 'dayjs';
import {
  ModelAccessAdminEndpoints,
  type GatewayLimits,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { useRemote } from '../data/hooks.js';
import {
  FieldHelp,
  FormSection,
  Page,
  SectionCard,
  useToast,
} from '../ui/page.js';
import { useFormFeedback } from '../data/form-feedback.js';

export function SettingsPage() {
  return (
    <Page
      title="系统设置"
      desc="影响全站的参数。改完立即生效，请确认后再保存。"
    >
      <LeaderboardCard />
      <LimitsCard />
      <SectionCard title="其它设置" desc="分散在各自页面，避免重复维护">
        <ul className="link-list">
          <li>
            公告与版本策略：内容运营 › 公告 / 系统 › 版本策略
          </li>
          <li>自动搜索公开动态：角色 › 公开动态（页面底部开关）</li>
          <li>上游账号的调度参数：模型与计费 › 模型管理 › 上游账号 › 调度设置</li>
          <li>充值档位与联系说明：用户 › 充值档位</li>
        </ul>
      </SectionCard>
    </Page>
  );
}

function LeaderboardCard() {
  const toast = useToast();
  const remote = useRemote(ModelAccessAdminEndpoints.getLeaderboardSource);
  const [form] = Form.useForm<{ label: string; url: string; asOf?: dayjs.Dayjs | null }>();
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
      toast.success('已保存');
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
      desc="用户端「模型排行榜」显示的名次来源"
      extra={
        <Button type="primary" loading={saving} onClick={() => void save()}>
          保存
        </Button>
      }
    >
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      {remote.error && <Alert type="error" showIcon message={remote.error} />}
      <Form form={form} layout="vertical" initialValues={{ url: 'https://arena.ai/leaderboard/chat/text' }}>
        <div className="form-two">
          <Form.Item
            name="label"
            label="来源名称"
            rules={[{ required: true, message: '填写来源名称' }]}
            extra={<FieldHelp>例：Arena 对话榜。</FieldHelp>}
          >
            <Input maxLength={80} />
          </Form.Item>
          <Form.Item label="参考日期" extra={<FieldHelp>榜单数据的截止日期。</FieldHelp>}>
            <Form.Item name="asOf" noStyle>
              <DatePicker style={{ width: '100%' }} placeholder="选择日期" />
            </Form.Item>
          </Form.Item>
        </div>
        <Form.Item
          name="url"
          label="官方链接"
          rules={[
            { required: true, message: '填写链接' },
            { type: 'url', message: '要以 https:// 开头' },
          ]}
          extra={<FieldHelp>只支持 Arena 官方 https 链接；系统不会自动抓取，名次仍按模型里填的排行榜名次。</FieldHelp>}
        >
          <Input />
        </Form.Item>
      </Form>
    </SectionCard>
  );
}

function LimitsCard() {
  const toast = useToast();
  const remote = useRemote(ModelAccessAdminEndpoints.getGatewayLimits);
  const [form] = Form.useForm<GatewayLimits>();
  const feedback = useFormFeedback(form);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (remote.data) form.setFieldsValue(remote.data);
  }, [remote.data, form]);

  async function save() {
    const values = await feedback.validate();
    if (!values) return;
    setSaving(true);
    setError('');
    try {
      await api.call(ModelAccessAdminEndpoints.updateGatewayLimits, {
        body: {
          perUserConcurrency: values.perUserConcurrency ?? null,
          perUserRpm: values.perUserRpm ?? null,
          failureThreshold: values.failureThreshold,
          cooldownSeconds: values.cooldownSeconds,
        },
      });
      toast.success('已保存');
      remote.refresh();
    } catch (e) {
      setError(feedback.report(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard
      title="每用户限流与线路健康"
      desc="防止单个用户把额度用光；线路连续失败会自动暂停"
      extra={
        <Button type="primary" loading={saving} onClick={() => void save()}>
          保存
        </Button>
      }
    >
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      {remote.error && <Alert type="error" showIcon message={remote.error} />}
      <Form form={form} layout="vertical">
        <FormSection title="每个用户" />
        <div className="form-two">
          <Form.Item
            name="perUserConcurrency"
            label="同时进行中的调用"
            extra={<FieldHelp>留空 = 不限。超出时这次调用按「模型暂时不可用」返回。</FieldHelp>}
          >
            <InputNumber min={1} style={{ width: '100%' }} placeholder="不限" />
          </Form.Item>
          <Form.Item
            name="perUserRpm"
            label="每分钟调用次数"
            extra={<FieldHelp>留空 = 不限。</FieldHelp>}
          >
            <InputNumber min={1} style={{ width: '100%' }} placeholder="不限" />
          </Form.Item>
        </div>
        <FormSection title="线路健康" />
        <div className="form-two">
          <Form.Item
            name="failureThreshold"
            label="连续失败几次后暂停"
            rules={[{ required: true, message: '必填' }]}
            extra={<FieldHelp>达到次数后自动停用这条线路。</FieldHelp>}
          >
            <InputNumber min={1} max={100} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="cooldownSeconds"
            label="暂停多少秒"
            rules={[{ required: true, message: '必填' }]}
            extra={<FieldHelp>暂停结束后自动恢复尝试。</FieldHelp>}
          >
            <InputNumber min={10} max={86400} style={{ width: '100%' }} />
          </Form.Item>
        </div>
        <Space>
          <Button onClick={() => form.resetFields()}>还原</Button>
        </Space>
      </Form>
    </SectionCard>
  );
}
