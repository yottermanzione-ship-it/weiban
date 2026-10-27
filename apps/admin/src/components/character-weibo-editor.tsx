import { Input, Switch } from 'antd';
import type { CharacterWeiboProfile } from '@weiban/contracts';
import { FieldHelp, SectionCard } from '../ui/page.js';
export function CharacterWeiboEditor({
  value,
  onChange,
}: {
  value?: CharacterWeiboProfile;
  onChange: (value: CharacterWeiboProfile) => void;
}) {
  const profile = value ?? { enabled: false, nickname: '' };
  const patch = (change: Partial<CharacterWeiboProfile>) => onChange({ ...profile, ...change });
  return (
    <SectionCard
      title="微博资料"
      desc="标记已有公开账号；不会替用户开启生态"
      extra={
        <span className="legacy-inline">
          有微博
          <Switch
            aria-label="有微博资料"
            checked={profile.enabled}
            onChange={(enabled) => patch({ enabled })}
          />
        </span>
      }
    >
      <label className="field-line">
        <span className="field-label">微博昵称</span>
        <Input
          aria-label="微博昵称"
          maxLength={80}
          value={profile.nickname}
          onChange={(e) => patch({ nickname: e.target.value })}
          placeholder="填写真实来源中的微博昵称，不从角色名字猜测"
        />
      </label>
      <details className="legacy-optional-fields">
        <summary>账号ID与来源头像（可选）</summary>
        <div className="legacy-two">
          <label className="field-line">
            <span className="field-label">微博账号ID（可后补）</span>
            <Input
              aria-label="微博账号ID"
              value={profile.userId ?? ''}
              onChange={(e) => patch({ userId: e.target.value.trim() || undefined })}
              placeholder="5～20位数字，需从真实账号核对"
            />
          </label>
          <label className="field-line">
            <span className="field-label">微博头像地址（可后补）</span>
            <Input
              aria-label="微博头像地址"
              value={profile.avatarUrl ?? ''}
              onChange={(e) => patch({ avatarUrl: e.target.value.trim() || undefined })}
              placeholder="真实微博头像HTTPS地址，不使用角色AI头像代替"
            />
          </label>
        </div>
      </details>
      <FieldHelp>
        {!profile.enabled
          ? '已关闭标记，不参与微博同步。'
          : profile.userId
            ? '已填写账号ID；是否取得图片仍取决于公开原帖核验和可访问性。'
            : '缺少账号ID：可同步文字，暂不取图。'}{' '}
        随角色资料保存，不代表账号已认证。
      </FieldHelp>
    </SectionCard>
  );
}
