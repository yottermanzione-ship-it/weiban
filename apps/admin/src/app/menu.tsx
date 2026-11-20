import {
  ActivityIcon,
  BellIcon,
  ChartLineUpIcon,
  ClipboardTextIcon,
  CpuIcon,
  CreditCardIcon,
  CubeIcon,
  GearSixIcon,
  HeadsetIcon,
  LayoutIcon,
  MicrophoneIcon,
  RobotIcon,
  ShieldWarningIcon,
  TagIcon,
  UsersIcon,
  WarningCircleIcon,
  type Icon,
} from '@phosphor-icons/react';
import type { TodoCounts } from './todos.js';

export type PageLink = {
  name: string;
  path: string;
  icon?: Icon;
  todo?: keyof TodoCounts;
  aliases?: string;
  secondary?: boolean;
};

export const NAV_GROUPS: { name: string; links: PageLink[] }[] = [
  {
    name: '总览',
    links: [{ name: '驾驶舱', path: '/dashboard', icon: LayoutIcon, aliases: '工作台' }],
  },
  {
    name: '用户资产',
    links: [
      { name: '用户列表', path: '/accounts', icon: UsersIcon },
      {
        name: '会员与充值',
        path: '/membership-records',
        icon: CreditCardIcon,
        aliases: '会员订阅记录',
      },
      { name: '充值记录', path: '/recharge-records', secondary: true },
      { name: '套餐与价格', path: '/plans', secondary: true },
      { name: '注销未完成', path: '/account-deletions', todo: 'deletions', secondary: true },
    ],
  },
  {
    name: '商业计费',
    links: [
      { name: '价目表', path: '/prices', icon: TagIcon, aliases: '模型价目表' },
      { name: '用量统计', path: '/usage', icon: ChartLineUpIcon, aliases: '用量汇总' },
      { name: '调用明细', path: '/usage?view=records', secondary: true },
      { name: '供应商对账', path: '/billing', secondary: true },
      { name: '扫码收款', path: '/scan-payments', secondary: true },
    ],
  },
  {
    name: '内容生态',
    links: [
      { name: '角色库', path: '/characters', icon: RobotIcon },
      { name: '制作申请', path: '/role-requests', icon: ClipboardTextIcon, todo: 'roleRequests' },
      { name: '音色库', path: '/voices', icon: MicrophoneIcon, aliases: '语音库' },
      { name: '角色广场', path: '/plaza', secondary: true },
      { name: '角色生态', path: '/ecology', secondary: true },
      { name: '搜索身份修正', path: '/search-entities', secondary: true },
      { name: '关系网', path: '/relations', secondary: true },
      { name: '公开动态', path: '/public-updates', secondary: true },
      { name: '行为规划', path: '/planner', secondary: true },
      { name: '表情商店', path: '/stickers', secondary: true },
      { name: '卡面模板', path: '/card-templates', secondary: true },
      { name: '宠物图鉴', path: '/pet-species', secondary: true },
      { name: '作品链接', path: '/work-links', secondary: true },
      { name: '症状标签', path: '/symptom-tags', secondary: true },
      { name: '每日一问', path: '/daily-questions', secondary: true },
      { name: '节日清单', path: '/holidays', secondary: true },
    ],
  },
  {
    name: '运营治理',
    links: [
      { name: '工单', path: '/support', icon: HeadsetIcon, todo: 'support', aliases: '帮助与反馈' },
      {
        name: '举报',
        path: '/reports',
        icon: ShieldWarningIcon,
        todo: 'reports',
        aliases: '举报处理',
      },
      { name: '公告', path: '/announcements', icon: BellIcon },
      { name: '更新说明', path: '/release-notes', secondary: true },
      { name: '版本策略', path: '/version-policies', secondary: true },
    ],
  },
  {
    name: '底层系统',
    links: [
      { name: '模型目录', path: '/model', icon: CubeIcon },
      { name: '上游账号', path: '/model?tab=upstreams', icon: CpuIcon },
      {
        name: '客户端异常',
        path: '/client-logs',
        icon: ActivityIcon,
        todo: 'clientIssues',
        aliases: '客户端报错',
      },
      { name: '系统设置', path: '/settings', icon: GearSixIcon },
      {
        name: '运行提醒',
        path: '/admin/alerts',
        icon: WarningCircleIcon,
        todo: 'alerts',
        secondary: true,
      },
      { name: '场景推荐', path: '/model?tab=settings', secondary: true },
      { name: 'Arena 文本榜', path: '/model?tab=ranking', secondary: true },
      { name: '情景模式', path: '/scenario-modes', secondary: true },
      { name: '记忆分档', path: '/memory-tiers', secondary: true },
    ],
  },
];

export const NAV_LINKS = NAV_GROUPS.flatMap((group) =>
  group.links.map((link) => ({ group: group.name, link })),
);

export function activePage(pathname: string, search: string) {
  const params = new URLSearchParams(search);
  const here = NAV_LINKS.filter(({ link }) => link.path.split('?')[0] === pathname);
  return (
    here.find(({ link }) => {
      const filter = link.path.split('?')[1];
      return filter && [...new URLSearchParams(filter)].every(([k, v]) => params.get(k) === v);
    }) ??
    here.find(({ link }) => !link.path.includes('?')) ??
    NAV_LINKS[0]!
  );
}
