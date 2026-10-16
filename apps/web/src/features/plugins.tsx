import { PluginEndpoints } from '@weiban/contracts';
import { useRemote } from '../data/use-remote.js';
import { MenuGroup, MenuRow, NavBar, showComingSoon } from './shell-kit.js';
export function PluginsPage() {
  const remote = useRemote(PluginEndpoints.list);
  return (
    <main>
      <NavBar title="插件" fallback="/settings" />
      {remote.error && <p role="alert">{remote.error}</p>}
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
      <p className="muted">外部渠道尚未开放接入。</p>
    </main>
  );
}
