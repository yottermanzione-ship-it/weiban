import {
  ApiOutlined,
  AppstoreOutlined,
  CustomerServiceOutlined,
  DashboardOutlined,
  RobotOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import type { MenuDataItem } from '@ant-design/pro-components';
import type { TodoCounts } from './todos.js';

/** 7 组菜单：工作台 / 用户 / 角色 / 模型与计费 / 内容运营 / 客服与安全 / 系统。 */
export const MENU: MenuDataItem[] = [
  {
    path: '/dashboard',
    name: '工作台',
    icon: <DashboardOutlined />,
  },
  {
    key: '/users',
    name: '用户',
    icon: <TeamOutlined />,
    children: [
      { path: '/accounts', name: '用户列表' },
      { path: '/membership', name: '会员与订单' },
      { path: '/recharge', name: '充值档位' },
    ],
  },
  {
    key: '/roles',
    name: '角色',
    icon: <RobotOutlined />,
    children: [
      { path: '/characters', name: '角色库' },
      { path: '/plaza', name: '角色广场' },
      { path: '/role-requests', name: '制作申请' },
      { path: '/relations', name: '关系网' },
      { path: '/public-updates', name: '公开动态' },
    ],
  },
  {
    key: '/model-billing',
    name: '模型与计费',
    icon: <ApiOutlined />,
    children: [
      { path: '/model', name: '模型管理' },
      { path: '/prices', name: 'AI 模型价格' },
      { path: '/usage', name: '用量与花费' },
      { path: '/billing', name: '对账与平台花费' },
      { path: '/planner', name: '行为规划' },
      { path: '/ecology', name: '角色生态' },
    ],
  },
  {
    key: '/content',
    name: '内容运营',
    icon: <AppstoreOutlined />,
    children: [
      { path: '/announcements', name: '公告' },
      { path: '/release-notes', name: '更新说明' },
      { path: '/daily-questions', name: '每日一问题库' },
      { path: '/holidays', name: '节日清单' },
      { path: '/stickers', name: '表情商店' },
      { path: '/voices', name: '音色库' },
      { path: '/card-templates', name: '卡面模板' },
      { path: '/pet-species', name: '宠物图鉴' },
      { path: '/work-links', name: '作品链接' },
      { path: '/symptom-tags', name: '症状标签' },
    ],
  },
  {
    key: '/service',
    name: '客服与安全',
    icon: <CustomerServiceOutlined />,
    children: [
      { path: '/support', name: '帮助与反馈' },
      { path: '/reports', name: '举报处理' },
      { path: '/admin/alerts', name: '运行提醒' },
      { path: '/account-deletions', name: '注销未完成' },
    ],
  },
  {
    key: '/system',
    name: '系统',
    icon: <SettingOutlined />,
    children: [
      { path: '/scenario-modes', name: '情景模式' },
      { path: '/version-policies', name: '版本策略' },
      { path: '/settings', name: '系统设置' },
    ],
  },
];

/** 菜单项对应的待办数量（0 = 不显示角标）。 */
export function badgeOf(path: string | undefined, counts: TodoCounts): number {
  switch (path) {
    case '/role-requests':
      return counts.roleRequests;
    case '/support':
      return counts.support;
    case '/reports':
      return counts.reports;
    case '/account-deletions':
      return counts.deletions;
    case '/admin/alerts':
      return counts.alerts;
    default:
      return 0;
  }
}

export function groupBadge(item: MenuDataItem, counts: TodoCounts): number {
  const key = item.key ?? item.path;
  if (key === '/roles') return counts.roleRequests;
  if (key === '/service')
    return counts.support + counts.reports + counts.alerts + counts.deletions;
  return 0;
}
