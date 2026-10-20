/**
 * 系统设置：每用户限流与线路健康参数、好感度阶段阈值（3.25）。（用户模型榜单来源 10-20 移到「模型管理」页顶部。）
 * 这些参数影响全站，改完立即生效；写操作会记审计。
 */
import { useEffect, useState } from 'react';
import { Alert, Button, Form, InputNumber, Space } from 'antd';
import { Link } from 'react-router-dom';
import {
  FamiliarityStageThresholds,
  GrowthAdminEndpoints,
  ModelAccessAdminEndpoints,
  type GatewayLimits,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { FieldHelp, FormSection, Page, SectionCard, useToast } from '../ui/page.js';
import { useFormFeedback } from '../data/form-feedback.js';

export function SettingsPage() {
  return (
    <Page title="系统设置" desc="影响全站的参数。改完立即生效，请确认后再保存。">
      <LimitsCard />
      <FamiliarityStagesCard />
      <SectionCard title="其它设置" desc="分散在各自页面，避免重复维护">
        <ul className="link-list">
          <li>公告与版本策略：内容运营 › 公告 / 系统 › 版本策略</li>
          <li>
            用户模型榜单来源：<Link to="/model">模型与计费 › 模型管理</Link>
            （页面顶部）；各模型名次在模型编辑里填
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

/**
 * 3.25（10-21 G1-6）：好感度六阶段阈值。点数规则不变（每条有效消息 +4 等），这里只调「到第几阶段要多少点」。
 * 从未充值且非会员的账号、未成年设定的角色最高停在「亲密好友」。已达到的阶段不因调高阈值回落。
 */
function FamiliarityStagesCard() {
  const toast = useToast();
  const remote = useRemote(GrowthAdminEndpoints.getFamiliarityStages);
  const [values, setValues] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (remote.data) setValues(remote.data.thresholds);
  }, [remote.data]);

  const names = remote.data?.stageNames ?? [];
  const parsed = FamiliarityStageThresholds.safeParse(values);
  const changed =
    !!remote.data && JSON.stringify(values) !== JSON.stringify(remote.data.thresholds);

  async function save() {
    if (!parsed.success) return;
    setSaving(true);
    setError('');
    try {
      await api.call(GrowthAdminEndpoints.updateFamiliarityStages, {
        body: { thresholds: parsed.data },
      });
      toast.success('已保存好感度阶段');
      remote.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard
      title="好感度阶段"
      desc="每条有效消息 +4 点（PRO+ ×2），这里设到每个阶段需要的累计点数"
      extra={
        <Button
          type="primary"
          loading={saving}
          disabled={!changed || !parsed.success}
          onClick={() => void save()}
        >
          保存
        </Button>
      }
    >
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      {remote.error && <Alert type="error" showIcon message={remote.error} />}
      {changed && !parsed.success && (
        <Alert
          type="warning"
          showIcon
          message="第一阶段必须是 0，后面每个阶段都要比前一个大"
          style={{ marginBottom: 12 }}
        />
      )}
      <div className="form-three">
        {names.map((name, i) => (
          <div className="field-line" key={name}>
            <span className="field-label">
              {i + 1}. {name}
              <span className="field-label-hint">
                {i === 0 ? '起点，固定 0' : `约 ${Math.ceil((values[i] ?? 0) / 4)} 条有效消息`}
              </span>
            </span>
            <InputNumber
              min={0}
              max={1000000}
              disabled={i === 0}
              style={{ width: '100%' }}
              value={values[i]}
              onChange={(v) =>
                setValues((cur) => cur.map((x, j) => (j === i ? Number(v ?? 0) : x)))
              }
            />
          </div>
        ))}
      </div>
      <FieldHelp>
        从未充值、也不是 PRO+ 会员的账号最高停在第 {remote.data?.freeCeilingLevel ?? 3} 阶段「
        {names[(remote.data?.freeCeilingLevel ?? 3) - 1] ?? '亲密好友'}
        」，充值或开通会员后解除；未成年设定的角色同样最高到这一阶段。调高阈值不会让已经达到的阶段回落。
      </FieldHelp>
    </SectionCard>
  );
}
