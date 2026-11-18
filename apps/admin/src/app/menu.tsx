import type { TodoCounts } from './todos.js';

type PageLink = { name: string; path: string; todo?: keyof TodoCounts };
type Section = { title: string; links: PageLink[] };
export const WORKSPACES: { name: string; sections: Section[] }[] = [
  {
    name: '工作台',
    sections: [
      {
        title: '日常工作',
        links: [
          { name: '工作台', path: '/dashboard' },
          { name: '运行提醒', path: '/admin/alerts', todo: 'alerts' },
          { name: '客户端报错', path: '/client-logs' },
        ],
      },
    ],
  },
  {
    name: '用户',
    sections: [
      {
        title: '账号',
        links: [
          { name: '用户列表', path: '/accounts' },
          { name: '会员订阅记录', path: '/membership-records' },
          { name: '充值记录', path: '/recharge-records' },
        ],
      },
      {
        title: '客服',
        links: [
          { name: '帮助与反馈', path: '/support', todo: 'support' },
          { name: '举报处理', path: '/reports', todo: 'reports' },
          { name: '注销未完成', path: '/account-deletions', todo: 'deletions' },
        ],
      },
    ],
  },
  {
    name: '角色',
    sections: [
      {
        title: '角色管理',
        links: [
          { name: '角色库', path: '/characters' },
          { name: '制作申请', path: '/role-requests', todo: 'roleRequests' },
          { name: '角色广场', path: '/plaza' },
          { name: '搜索身份修正', path: '/search-entities' },
        ],
      },
      {
        title: '角色活动',
        links: [
          { name: '关系网', path: '/relations' },
          { name: '公开动态', path: '/public-updates' },
          { name: '行为规划', path: '/planner' },
          { name: '角色生态', path: '/ecology' },
        ],
      },
    ],
  },
  {
    name: '模型',
    sections: [
      {
        title: '配置',
        links: [
          { name: '模型目录', path: '/model' },
          { name: '上游账号', path: '/model?tab=upstreams' },
          { name: '场景推荐', path: '/model?tab=settings' },
          { name: 'Arena 文本榜', path: '/model?tab=ranking' },
        ],
      },
      {
        title: '用量与账务',
        links: [
          { name: '调用明细', path: '/usage?view=records' },
          { name: '用量汇总', path: '/usage' },
          { name: '模型价目表', path: '/prices' },
          { name: '供应商对账', path: '/billing' },
        ],
      },
    ],
  },
  {
    name: '运营',
    sections: [
      {
        title: '收入',
        links: [
          { name: '扫码收款', path: '/scan-payments' },
          { name: '套餐与价格', path: '/plans' },
        ],
      },
      {
        title: '发布',
        links: [
          { name: '公告', path: '/announcements' },
          { name: '更新说明', path: '/release-notes' },
          { name: '每日一问', path: '/daily-questions' },
          { name: '节日清单', path: '/holidays' },
        ],
      },
      {
        title: '素材',
        links: [
          { name: '表情商店', path: '/stickers' },
          { name: '音色库', path: '/voices' },
          { name: '卡面模板', path: '/card-templates' },
          { name: '宠物图鉴', path: '/pet-species' },
          { name: '作品链接', path: '/work-links' },
          { name: '症状标签', path: '/symptom-tags' },
        ],
      },
    ],
  },
  {
    name: '系统',
    sections: [
      {
        title: '应用设置',
        links: [
          { name: '系统设置', path: '/settings' },
          { name: '情景模式', path: '/scenario-modes' },
          { name: '记忆分档', path: '/memory-tiers' },
          { name: '版本策略', path: '/version-policies' },
        ],
      },
    ],
  },
];
export function activePage(pathname: string, search: string) {
  const params = new URLSearchParams(search);
  const candidates = WORKSPACES.flatMap((area) =>
    area.sections.flatMap((section) => section.links.map((link) => ({ area, section, link }))),
  );
  const here = candidates.filter(({ link }) => link.path.split('?')[0] === pathname);
  return (
    here.find(({ link }) => {
      const filter = link.path.split('?')[1];
      return filter && [...new URLSearchParams(filter)].every(([k, v]) => params.get(k) === v);
    }) ??
    here.find(({ link }) => !link.path.includes('?')) ??
    candidates[0]!
  );
}
