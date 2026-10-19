import { useState } from 'react';
import { Alert, Button, Form, Input } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { IdentityEndpoints, type AuthResponse } from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText } from '../data/hooks.js';

interface LoginValues {
  username: string;
  password: string;
}

export function LoginPage({ onLogin }: { onLogin: (auth: AuthResponse) => void }) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function submit(values: LoginValues) {
    setError('');
    setPending(true);
    try {
      const auth = await api.call(IdentityEndpoints.login, {
        body: {
          username: values.username,
          password: values.password,
          kind: 'admin',
          device: {
            platform: 'web',
            name: '管理后台',
            appVersion: '0.1.0',
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        },
      });
      await api.authenticate(auth);
      onLogin(auth);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-brand">
        <div className="admin-logo admin-logo-lg">伴</div>
        <div>
          <h1>微伴管理后台</h1>
          <p>管理用户、角色、模型与内容</p>
        </div>
      </div>
      <div className="login-card">
        <h2>登录</h2>
        <p className="login-sub">请使用管理员账号登录</p>
        {error && <Alert type="error" showIcon message={error} className="login-error" />}
        <Form<LoginValues> layout="vertical" requiredMark={false} onFinish={(v) => void submit(v)}>
          <Form.Item
            name="username"
            label="管理员账号"
            rules={[{ required: true, message: '请输入账号' }]}
          >
            <Input
              size="large"
              prefix={<UserOutlined />}
              autoComplete="username"
              placeholder="账号"
            />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[
              { required: true, message: '请输入密码' },
              { min: 8, message: '密码至少 8 位' },
            ]}
          >
            <Input.Password
              size="large"
              prefix={<LockOutlined />}
              autoComplete="current-password"
              placeholder="密码"
            />
          </Form.Item>
          <Button type="primary" size="large" block htmlType="submit" loading={pending}>
            登录
          </Button>
        </Form>
      </div>
      <p className="login-foot">微伴 · 内部管理系统</p>
    </div>
  );
}
