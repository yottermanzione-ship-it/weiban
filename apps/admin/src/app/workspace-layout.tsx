import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Avatar,
  Breadcrumb,
  Button,
  Drawer,
  Dropdown,
  Layout,
  Menu,
  Popover,
  Segmented,
  Tooltip,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  BellIcon,
  CaretDownIcon,
  CaretRightIcon,
  CubeIcon,
  DotsThreeIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  SidebarSimpleIcon,
  SlidersHorizontalIcon,
  SunIcon,
  XIcon,
} from '@phosphor-icons/react';
import { activePage, NAV_GROUPS, NAV_LINKS, type PageLink } from './menu.js';
import { useTodos } from './todos.js';
import { Spotlight } from './spotlight.js';
import { DENSITY_OPTIONS, readPreference, savePreference, useAppearance } from './appearance.js';
import { formatInt } from '../ui/format.js';

const COLLAPSED_KEY = 'weiban.os.sidebar';
const CST_TIME = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export function WorkspaceLayout({
  username,
  preloadPage,
  onLogout,
  children,
}: {
  username: string;
  preloadPage: (path: string) => void;
  onLogout: () => void;
  children: ReactNode;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { group, link } = activePage(location.pathname, location.search);
  const { counts, loading, partial, syncedAt, clientIssuesHasMore } = useTodos();
  const { mode, setMode, density, setDensity } = useAppearance();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => readPreference(COLLAPSED_KEY, ['yes', 'no'], 'no') === 'yes',
  );
  const searchKey = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K';

  useEffect(() => {
    setOpen(false);
    setAlertsOpen(false);
    document.title = link.name + ' · Weiban OS';
  }, [location.key, link.name]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !event.repeat) {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  const navItem = (item: PageLink) => {
    const Icon = item.icon;
    const count = item.todo ? (counts[item.todo] ?? 0) : 0;
    return {
      key: item.path,
      icon: Icon && <Icon aria-hidden />,
      title: item.name,
      label: (
        <Link
          to={item.path}
          onPointerEnter={() => preloadPage(item.path)}
          onFocus={() => preloadPage(item.path)}
          className="os-nav-link"
          aria-current={link.path === item.path ? 'page' : undefined}
        >
          <span>{item.name}</span>
          {count > 0 && (
            <span
              className={item.todo === 'clientIssues' ? 'os-nav-count os-nav-hot' : 'os-nav-count'}
            >
              {formatInt(count)}
              {item.todo === 'clientIssues' && clientIssuesHasMore ? '+' : ''}
            </span>
          )}
        </Link>
      ),
      className: count && item.todo === 'clientIssues' ? 'os-nav-has-issues' : undefined,
    };
  };

  const navigation = (compact: boolean) => {
    const items: MenuProps['items'] = NAV_GROUPS.map(({ name, links }) => {
      const secondary = links.filter((item) => item.secondary);
      return {
        key: 'section-' + name,
        type: 'group',
        label:
          compact || name === '总览' ? null : (
            <span className="os-nav-group-title">
              {name}
              {secondary.length > 0 && (
                <Dropdown
                  trigger={['click']}
                  menu={{ items: secondary.map(navItem), selectedKeys: [link.path] }}
                >
                  <Button
                    type="text"
                    size="small"
                    aria-label={name + '更多'}
                    icon={<DotsThreeIcon size={17} weight="bold" />}
                  />
                </Dropdown>
              )}
            </span>
          ),
        children: [
          ...links.filter((item) => !item.secondary).map(navItem),
          ...(compact && secondary.length
            ? [
                {
                  key: name,
                  label: name + '更多',
                  className: 'os-nav-more',
                  icon: <DotsThreeIcon aria-hidden />,
                  children: secondary.map(navItem),
                },
              ]
            : []),
        ],
      };
    });
    return (
      <nav aria-label="管理导航" className="os-navigation">
        <Menu
          mode="inline"
          inlineCollapsed={compact}
          inlineIndent={20}
          selectedKeys={[link.path]}
          onClick={({ key, domEvent }) => {
            setOpen(false);
            if (!(domEvent.target as Element | null)?.closest('a')) navigate(key);
          }}
          items={items}
        />
      </nav>
    );
  };

  const preview = import.meta.env.MODE === 'admin-preview';
  const status = loading ? '正在同步' : partial ? '部分数据未同步' : '运行数据已同步';
  const alerts = NAV_LINKS.filter(({ link: item }) => item.todo && (counts[item.todo] ?? 0) > 0);
  const densityControl = (
    <Segmented
      aria-label="全局表格密度"
      className="os-density-switch"
      size="small"
      value={density ?? 'middle'}
      options={[...DENSITY_OPTIONS]}
      onChange={setDensity}
    />
  );
  const brand = (
    <Link to="/dashboard" className="os-brand" aria-label="Weiban OS 驾驶舱">
      <span className="os-brand-icon">
        <CubeIcon size={19} weight="bold" aria-hidden />
      </span>
      <span className="os-brand-copy">
        <strong>
          Weiban OS{' '}
          <code title={preview ? '本地预览 · 测试库样本' : '香港站'}>
            {preview ? 'LOCAL' : 'HK'}
          </code>
        </strong>
        <small>微伴中枢控制台</small>
      </span>
    </Link>
  );
  return (
    <Layout hasSider className="workspace-shell">
      <aside className={collapsed ? 'os-sidebar os-sidebar-collapsed' : 'os-sidebar'}>
        <div className="os-sidebar-head">
          {brand}
          <Tooltip title={collapsed ? '展开侧栏' : '折叠侧栏'}>
            <Button
              type="text"
              className="os-icon-button"
              aria-label={collapsed ? '展开侧栏' : '折叠侧栏'}
              aria-expanded={!collapsed}
              icon={<SidebarSimpleIcon size={17} />}
              onClick={() => {
                setCollapsed(!collapsed);
                savePreference(COLLAPSED_KEY, collapsed ? 'no' : 'yes');
              }}
            />
          </Tooltip>
        </div>
        {navigation(collapsed)}
        <div className="os-sidebar-foot">
          <div className="os-sidebar-status">
            <span>
              <i
                className={loading || partial ? 'os-status-dot os-status-warning' : 'os-status-dot'}
              />
              {status}
            </span>
            {syncedAt && (
              <time className="mono" dateTime={syncedAt.toISOString()}>
                {CST_TIME.format(syncedAt)} CST
              </time>
            )}
          </div>
        </div>
      </aside>
      <Layout className="workspace-main">
        <Layout.Header className="os-topbar">
          <div className="os-topbar-location">
            <Button
              type="text"
              className="os-icon-button os-open-mobile-nav"
              aria-label="打开导航"
              icon={<SidebarSimpleIcon size={20} />}
              onClick={() => setOpen(true)}
            />
            <Breadcrumb
              separator={<CaretRightIcon size={11} />}
              items={[{ title: group }, { title: link.name }]}
            />
          </div>
          <button
            className="os-search-trigger"
            type="button"
            aria-label="全局搜索"
            onClick={() => setSearchOpen(true)}
          >
            <MagnifyingGlassIcon size={17} />
            <span>快速检索页面、用户、角色、模型…</span>
            <kbd>{searchKey}</kbd>
          </button>
          <div className="os-topbar-actions">
            <Tooltip title={mode === 'dark' ? '切换明亮主题' : '切换暗黑主题'}>
              <Button
                type="text"
                className="os-icon-button"
                aria-label="切换主题"
                icon={mode === 'dark' ? <SunIcon size={18} /> : <MoonIcon size={18} />}
                onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}
              />
            </Tooltip>
            <div className="os-desktop-density">{densityControl}</div>
            <div className="os-mobile-density">
              <Popover content={densityControl} trigger="click" placement="bottomRight">
                <Button
                  type="text"
                  className="os-icon-button"
                  aria-label="表格密度"
                  icon={<SlidersHorizontalIcon size={17} />}
                />
              </Popover>
            </div>
            <Popover
              title="风险与待办"
              trigger="click"
              placement="bottomRight"
              open={alertsOpen}
              onOpenChange={setAlertsOpen}
              content={
                <div className="os-notifications">
                  {loading && <span>正在读取…</span>}
                  {!loading && !partial && !alerts.length && <span>暂无风险或待办</span>}
                  {partial && <span>部分待办暂不可用</span>}
                  {alerts.map(({ link: item }) => (
                    <Link key={item.path} to={item.path} onClick={() => setAlertsOpen(false)}>
                      {item.name}
                      <code>
                        {formatInt(counts[item.todo!])}
                        {item.todo === 'clientIssues' && clientIssuesHasMore ? '+' : ''}
                      </code>
                    </Link>
                  ))}
                </div>
              }
            >
              <Button
                type="text"
                className="os-icon-button os-bell"
                aria-label="系统提醒"
                icon={<BellIcon size={18} />}
              >
                {alerts.length > 0 && <i aria-hidden className="os-notification-dot" />}
              </Button>
            </Popover>
            <Dropdown
              menu={{ items: [{ key: 'logout', label: '退出登录', onClick: onLogout }] }}
              trigger={['hover', 'click']}
            >
              <button className="admin-avatar os-profile" aria-label={username} type="button">
                <Avatar size={24}>{username.trim()[0]?.toUpperCase() ?? 'A'}</Avatar>
                <span>{username}</span>
                <CaretDownIcon size={12} />
              </button>
            </Dropdown>
          </div>
        </Layout.Header>
        <Layout.Content className="workspace-canvas">
          <div key={location.pathname}>{children}</div>
        </Layout.Content>
      </Layout>
      <Drawer
        width={280}
        title={brand}
        placement="left"
        open={open}
        onClose={() => setOpen(false)}
        closeIcon={<XIcon size={19} />}
        rootClassName="os-mobile-nav"
        styles={{ body: { padding: 0 } }}
      >
        {navigation(false)}
      </Drawer>
      <Spotlight open={searchOpen} onClose={() => setSearchOpen(false)} />
    </Layout>
  );
}
