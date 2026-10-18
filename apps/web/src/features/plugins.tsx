import { PluginEndpoints } from '@weiban/contracts';
import { useRemote } from '../data/use-remote.js';
import { MenuGroup, MenuRow, NavBar, showComingSoon } from './shell-kit.js';
export function PluginsPage() {
  const remote = useRemote(PluginEndpoints.list);
  return (
    <main>
      <NavBar title="插件" fallback="/settings" />
      {remote.loading && !remote.data && (
        <p className="empty" role="status">
          正在读取插件…
        </p>
      )}
      {remote.error && (
        <p className="page-note" role="alert">
          {remote.error}{' '}
          <button className="text-button" type="button" onClick={remote.refresh}>
            重试
          </button>
        </p>
      )}
      <MenuGroup>
        {remote.data?.items.map((p) => (
          <MenuRow
            key={p.pluginId}
            label={p.name}
            subtitle={p.description}
            value="即将推出"
            onClick={showComingSoon}
          />
        ))}
      </MenuGroup>
      <p className="page-note">外部渠道尚未开放接入。</p>
    </main>
  );
}
