import type { EvalCase } from '../src/index.js';

const setup: EvalCase['setup'] = {
  character: 'S-01',
  fit: 3,
  mode: 'daily',
  relationship: '朋友',
  memories: [],
  history: [],
};

// SIM-01：角色回答「你今天干嘛了」时与日常事件一致
const sim01Cases: [string, string[], string[], string[], string][] = [
  [
    '你今天干嘛了？',
    ['daily_events:今天上午开了两小时的组会，下午去超市买东西，晚上在家追了一集剧'],
    ['组会', '超市', '剧'],
    [],
    '回答中的活动必须能在预置日常事件中找到来源',
  ],
  [
    '今天有没有发生什么有意思的事？',
    ['daily_events:下午路上碰到只流浪猫，给它买了罐头'],
    ['猫', '罐头'],
    [],
    '意外事件（unexpected kind）应被纳入回答',
  ],
  [
    '你今天工作顺利吗？',
    ['daily_events:今天赶完了一个方案，截止前提交了'],
    ['方案', '截止', '提交'],
    [],
    'work 类事件应与问题匹配',
  ],
  [
    '你今天心情怎么样？',
    ['mood:tired', 'daily_events:今天连续开了三个会，有点累'],
    ['累', '会议'],
    [],
    '心情 tired 与事件描述一致',
  ],
  [
    '你今天见朋友了吗？',
    ['daily_events:下午和同学小林一起喝了下午茶'],
    ['小林', '下午茶'],
    [],
    'social 类事件召回正确',
  ],
  [
    '最近在忙什么？',
    ['daily_events:今天跑步30分钟，做了拉伸', 'daily_events:下午看了一本设计书'],
    ['跑步', '书'],
    [],
    '多条事件合理汇总，不逐条罗列',
  ],
  [
    '今天有没有出门？',
    ['daily_events:今天一整天都在家，没出门'],
    ['在家', '没出门'],
    [],
    'rest 类事件正确反映',
  ],
  [
    '你今天吃了什么好吃的？',
    ['daily_events:中午自己做了番茄炒蛋'],
    ['番茄炒蛋'],
    [],
    '日常细节来自事件，不编造',
  ],
  [
    '今天遇到什么烦心事了吗？',
    ['mood:annoyed', 'daily_events:手机屏幕碎了，准备明天去修'],
    ['手机', '碎'],
    [],
    '心情 annoyed 与意外事件对应',
  ],
  [
    '你刚才在干嘛？',
    ['daily_events:刚看完一集综艺，正在休息'],
    ['综艺', '休息'],
    [],
    'leisure 类事件准确召回，不出现未预置的新活动',
  ],
];

// SIM-02：角色当天的行为和状态与日常事件内部一致（追问时说法不变）
const sim02Cases: [string, string[], string[], string[], string][] = [
  [
    '你说你今天买了东西，买了什么？',
    ['daily_events:今天去超市买了一些水果和牛奶'],
    ['水果', '牛奶'],
    [],
    '追问时细节与原事件一致，不引入新物品',
  ],
  [
    '你说去见了小林，去哪里了？',
    ['daily_events:下午和小林在咖啡厅喝咖啡'],
    ['咖啡厅'],
    ['餐厅', '书店'],
    '地点细节不变，不随机替换',
  ],
  [
    '那本书你现在看到哪里了？',
    ['daily_events:看了设计书，大概看了三分之一'],
    ['三分之一'],
    [],
    '进度细节一致',
  ],
  [
    '你说手机碎了，是怎么碎的？',
    ['daily_events:手机从桌上掉地上摔碎了'],
    ['掉', '地上'],
    [],
    '事故细节一致，不编造新原因',
  ],
];

export const L3_CASES: EvalCase[] = [
  ...sim01Cases.map(([input, memories, mustInclude, mustNotInclude, judgeRubric], i) => ({
    id: `SIM-L3-${String(i + 1).padStart(3, '0')}`,
    category: 'simulation' as const,
    prdRefs: ['SIM-01'],
    setup: {
      ...setup,
      memories,
      history: [],
    },
    input,
    checks: {
      rules: {
        mustIncludeAny: mustInclude.length > 0 ? mustInclude : undefined,
        mustNotInclude: mustNotInclude.length > 0 ? mustNotInclude : undefined,
      },
      judge: {
        rubric: judgeRubric,
        passThreshold: 0.9,
      },
    },
    severity: 'soft' as const,
  })),
  ...sim02Cases.map(([input, memories, mustInclude, mustNotInclude, judgeRubric], i) => ({
    id: `SIM-L3-${String(i + 11).padStart(3, '0')}`,
    category: 'simulation' as const,
    prdRefs: ['SIM-02'],
    setup: {
      ...setup,
      memories,
      history: [],
    },
    input,
    checks: {
      rules: {
        mustIncludeAny: mustInclude.length > 0 ? mustInclude : undefined,
        mustNotInclude: mustNotInclude.length > 0 ? mustNotInclude : undefined,
      },
      judge: {
        rubric: judgeRubric,
        passThreshold: 0.9,
      },
    },
    severity: 'soft' as const,
  })),
];
