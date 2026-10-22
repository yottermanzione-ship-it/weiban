import { PluginEndpoints } from '@weiban/contracts';
import { useRemote } from '../data/use-remote.js';
import { GroupHeader, MenuGroup, MenuRow, NavBar, showComingSoon } from './shell-kit.js';

/**
 * 插件（设置 › 插件）：外部渠道接入。
 * 接口没返回内容时也要给出微信 / QQ / 微博 三个入口，避免整页空白。
 */
const CHANNELS = [
  { pluginId: 'wechat', name: '微信', description: '接入微信，让 TA 认识你在微信里的朋友' },
  { pluginId: 'qq', name: 'QQ', description: '接入 QQ 好友与群' },
  { pluginId: 'weibo', name: '微博', description: '真人角色读取明星的最新动态' },
];

export function PluginsPage() {
  const remote = useRemote(PluginEndpoints.list);
  const items = remote.data?.items?.length ? remote.data.items : CHANNELS;
  return (
    <main>
      <NavBar title="插件" fallback="/settings" />
      {remote.error && (
        <p className="page-note" role="alert">
          {remote.error}{' '}
          <button className="text-button" type="button" onClick={remote.refresh}>
            重试
          </button>
        </p>
      )}
      <GroupHeader>外部渠道</GroupHeader>
      <MenuGroup>
        {items.map((p) => (
          <MenuRow
            key={p.pluginId}
            label={p.name}
            subtitle={p.description}
            value="暂未开放"
            onClick={showComingSoon}
          />
        ))}
      </MenuGroup>
      <p className="page-note">
        接入后，TA 能看到你在这些平台上的公开动态；聊天记录需要你单独授权。
      </p>
    </main>
  );
}
