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
      title="微博资料标记"
      desc="已有微博昵称直接标记；不代表账号认证，也不会替用户开启生态或立即采集"
    >
      <div className="legacy-inline">
        有微博资料{' '}
        <Switch
          aria-label="有微博资料"
          checked={profile.enabled}
          onChange={(enabled) => patch({ enabled })}
        />
      </div>
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
      <FieldHelp>
        {!profile.enabled
          ? '已关闭标记，不参与微博同步。'
          : profile.userId
            ? '已填写账号ID；是否取得图片仍取决于公开原帖核验和可访问性。'
            : '已标记有微博昵称，可参与已有文字同步；缺账号ID时不伪装成图片来源已核实。'}{' '}
        点下方“保存角色资料”后生效；角色生态仍由各用户自行开启，采集沿用原有费用和冷却规则。
      </FieldHelp>
    </SectionCard>
  );
}
