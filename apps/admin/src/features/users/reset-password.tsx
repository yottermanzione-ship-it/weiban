import { useRef, useState } from 'react';
import { Alert, Form, Input, Modal } from 'antd';
import { ApiFailure } from '@weiban/client-core';
import { AdminUsersEndpoints, type AdminUserSummary } from '@weiban/contracts';
import { api } from '../../data/client.js';
import { errorText } from '../../data/hooks.js';
import { useToast } from '../../ui/page.js';
import { displayName } from './shared.js';

type Values = { password: string; confirmation: string };

/** 密码只留本次弹窗内存，不接详情抽屉的草稿保存。 */
export function ResetPasswordDialog({
  user,
  onClose,
}: {
  user: AdminUserSummary;
  onClose: () => void;
}) {
  const [form] = Form.useForm<Values>();
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const close = () => {
    form.resetFields();
    onClose();
  };
  async function submit() {
    if (submitting.current) return;
    submitting.current = true;
    let values: Values;
    try {
      values = await form.validateFields();
    } catch {
      submitting.current = false;
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await api.call(AdminUsersEndpoints.resetPassword, {
        params: { userId: user.userId },
        body: { password: values.password },
      });
      form.resetFields();
      toast.success(`密码已重置，${result.revokedSessions}个旧登录已退出`);
      onClose();
    } catch (e) {
      const uncertain = !(e instanceof ApiFailure) || e.status === 0 || e.status >= 500;
      setError(errorText(e) + (uncertain ? '。请先让用户尝试新密码，确认结果后再操作。' : ''));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }
  return (
    <Modal
      open
      title="重置密码"
      onCancel={close}
      onOk={() => void submit()}
      okText="确认重置"
      cancelText="取消"
      confirmLoading={saving}
      closable={!saving}
      maskClosable={!saving}
      keyboard={!saving}
      cancelButtonProps={{ disabled: saving }}
      destroyOnHidden
    >
      <p>
        用户：{displayName(user)} · 登录名：{user.username}
      </p>
      <Alert type="info" showIcon message="设置新密码后，原登录设备会退出，用户需要重新登录。" />
      {user.ban && (
        <Alert type="warning" showIcon message="该账号仍处于封禁状态，重置密码不会解封。" />
      )}
      <Form
        form={form}
        layout="vertical"
        autoComplete="off"
        preserve={false}
        style={{ marginTop: 16 }}
      >
        <Form.Item
          name="password"
          label="新密码"
          rules={[
            { required: true, message: '请输入新密码' },
            { min: 8, max: 128, message: '密码需要8至128位' },
          ]}
        >
          <Input.Password autoComplete="new-password" maxLength={128} disabled={saving} />
        </Form.Item>
        <Form.Item
          name="confirmation"
          label="再次输入新密码"
          dependencies={['password']}
          rules={[
            { required: true, message: '请再次输入新密码' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                return !value || value === getFieldValue('password')
                  ? Promise.resolve()
                  : Promise.reject(new Error('两次密码不一致'));
              },
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" maxLength={128} disabled={saving} />
        </Form.Item>
      </Form>
      {error && <Alert type="error" showIcon message={error} />}
    </Modal>
  );
}
