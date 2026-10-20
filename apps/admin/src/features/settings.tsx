/**
 * 系统设置：每用户限流与线路健康参数。（用户模型榜单来源 10-20 移到「模型管理」页顶部。）
 * 这些参数影响全站，改完立即生效；写操作会记审计。
 */
import { useEffect, useState } from 'react';
import { Alert, Button, Form, InputNumber, Space } from 'antd';
import { Link } from 'react-router-dom';
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
      <LimitsCard />
      <SectionCard title="其它设置" desc="分散在各自页面，避免重复维护">
        <ul className="link-list">
          <li>
            公告与版本策略：内容运营 › 公告 / 系统 › 版本策略
          </li>
          <li>
            用户模型榜单来源：<Link to="/model">模型与计费 › 模型管理</Link>（页面顶部）；各模型名次在模型编辑里填
          </li>
          <li>自动搜索公开动态：角色 › 公开动态（页面底部开关）</li>
          <li>上游账号的调度参数：模型与计费 › 模型管理 › 上游账号 › 调度设置</li>
          <li>
            会员价格、充值档位、注册赠送积分：<Link to="/plans">用户 › 套餐与价格</Link>
          </li>
        </ul>
      </SectionCard>
    </Page>
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
