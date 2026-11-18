import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Avatar, Badge, Button, Drawer, Dropdown, Grid, Layout, Menu } from 'antd';
import { DownOutlined, MenuOutlined, UserOutlined } from '@ant-design/icons';
import { activePage, WORKSPACES } from './menu.js';
import { useTodos } from './todos.js';

export function WorkspaceLayout({
  username,
  onLogout,
  children,
}: {
  username: string;
  onLogout: () => void;
  children: ReactNode;
}) {
  const location = useLocation();
  const { area, link } = activePage(location.pathname, location.search);
  const { counts } = useTodos();
  const [open, setOpen] = useState(false);
  const [drawerArea, setDrawerArea] = useState(area.name);
  const desktop = Grid.useBreakpoint().lg;
  useEffect(() => {
    setOpen(false);
    document.title = link.name + ' · 微伴运营台';
  }, [location.key, link.name]);
  const sectionMenu = (workspace: typeof area) => (
    <Menu
      mode="inline"
      selectedKeys={[link.path]}
      items={workspace.sections.map((section) => ({
        key: section.title,
        type: 'group' as const,
        label: section.title,
        children: section.links.map((item) => ({
          key: item.path,
          label: (
            <Link to={item.path} className="workspace-page-link">
              <span>{item.name}</span>
              {item.todo && counts[item.todo] > 0 && (
                <Badge size="small" count={counts[item.todo]} />
              )}
            </Link>
          ),
        })),
      }))}
    />
  );
  const areas = WORKSPACES.map((item) => ({
    key: item.name,
    label: <Link to={item.sections[0]!.links[0]!.path}>{item.name}</Link>,
  }));
  return (
    <Layout className="workspace-shell">
      <Layout.Header className="workspace-header">
        {!desktop && (
          <Button
            type="text"
            aria-label="打开导航"
            icon={<MenuOutlined />}
            onClick={() => {
              setDrawerArea(area.name);
              setOpen(true);
            }}
          />
        )}
        <Link className="workspace-brand" to="/dashboard">
          <img alt="" src="/icon.svg" />
          微伴运营台
        </Link>
        {desktop && (
          <nav aria-label="工作区">
            <Menu theme="dark" mode="horizontal" selectedKeys={[area.name]} items={areas} />
          </nav>
        )}
        <div className="workspace-identity">
          {import.meta.env.MODE === 'admin-preview' && (
            <span className="demo-marker">本地示例</span>
          )}
          <Dropdown
            menu={{ items: [{ key: 'logout', label: '退出登录', onClick: onLogout }] }}
            trigger={['hover', 'click']}
          >
            <button className="admin-avatar workspace-profile">
              <Avatar size="small" icon={<UserOutlined />} />
              <span>{username}</span>
              <DownOutlined />
            </button>
          </Dropdown>
        </div>
      </Layout.Header>
      <Layout className="workspace-main">
        {desktop && (
          <Layout.Sider width={206} theme="light" className="workspace-sider">
            <nav aria-label={area.name + '导航'}>{sectionMenu(area)}</nav>
          </Layout.Sider>
        )}
        <Layout.Content className="workspace-canvas">
          <div key={location.pathname}>{children}</div>
        </Layout.Content>
      </Layout>
      <Drawer
        width={280}
        title="导航"
        placement="left"
        open={!desktop && open}
        onClose={() => setOpen(false)}
      >
        <nav aria-label="选择工作区" className="mobile-area-menu">
          {WORKSPACES.map((item) => (
            <Button
              key={item.name}
              aria-pressed={item.name === drawerArea}
              type={item.name === drawerArea ? 'primary' : 'default'}
              onClick={() => setDrawerArea(item.name)}
            >
              {item.name}
            </Button>
          ))}
        </nav>
        {sectionMenu(WORKSPACES.find((item) => item.name === drawerArea) ?? area)}
      </Drawer>
    </Layout>
  );
}
