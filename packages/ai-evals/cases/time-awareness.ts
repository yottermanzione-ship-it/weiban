import type { EvalCase } from '../src/index.js';

const instant = '2026-10-11T17:20:00Z';
const base: EvalCase['setup'] = {
  character: 'S-02',
  fit: 3,
  mode: 'daily',
  relationship: 'friend',
  memories: [],
  history: [],
  time: instant,
  timeZone: 'Asia/Shanghai',
};
const checks = ['runtime_clock_prepared', 'user_time_zone_prepared'];
const active = ['S-01', 'S-02', 'S-03'].map((character, i): EvalCase => ({
  id: `TIME-${String(i + 1).padStart(3, '0')}`,
  category: 'time_awareness',
  prdRefs: ['SIM-04', 'eval-plan 3.8'],
  setup: {
    ...base,
    character,
    history: ['这个话题好有意思！', '我还想接着聊。', '你接着说呀！'],
    recentUserMessageTimes: [
      '2026-10-11T17:16:00Z',
      '2026-10-11T17:18:00Z',
      '2026-10-11T17:19:00Z',
    ],
  },
  input: '我还精神着呢，刚才那个话题你接着讲！',
  mustInclude: [],
  mustNotInclude: ['晚安', '早点睡吧拜拜'],
  judgeRubric: '本地01:20且用户持续活跃，可以关心未睡原因，但应继续当前话题，不用告别结束聊天。',
  hard: true,
  requiredJudgeChecks: ['continues_active_conversation', 'does_not_end_chat_for_late_hour'],
  requiredRuntimeChecks: [...checks, 'recent_user_activity_prepared'],
}));
type ClockScenario = {
  input: string;
  rubric: string;
  judge: string;
  includeAny?: readonly string[];
  timeZone?: string;
  sleep?: true;
  holiday?: true;
};
const scenarios: readonly ClockScenario[] = [
  {
    input: '困了，睡了，明天再聊吧。',
    rubric: '用户明确结束聊天，可以自然道晚安，不强行挽留；此题是凌晨不告别规则的反向对照。',
    judge: 'respects_explicit_sleep_request',
    sleep: true,
  },
  {
    input: '今天星期几？',
    rubric: '上海本地2026-10-12星期一，不能使用服务器UTC日期的星期日。',
    judge: 'correct_local_weekday_without_contradiction',
    includeAny: ['星期一', '周一', '礼拜一'],
  },
  {
    input: '今天星期几？',
    rubric: '同一瞬间UTC本地仍为2026-10-11星期日，不能套用上海日期。',
    judge: 'correct_local_weekday_without_contradiction',
    timeZone: 'UTC',
    includeAny: ['星期日', '星期天', '周日', '礼拜天'],
  },
  {
    input: '现在几点？',
    rubric: '上海本地凌晨01:20；数字、中文时间可用，但不能同时给出冲突时间。',
    judge: 'correct_local_time_without_contradiction',
    includeAny: ['01:20', '1:20', '一点二十', '一时二十', '1点20'],
  },
  {
    input: '今天是什么节日呀？',
    rubric: '上海本地2026-01-01为元旦，不编造其他节日；执行器须实际提供该日节日上下文。',
    judge: 'correct_holiday_without_fabrication',
    includeAny: ['元旦'],
    holiday: true,
  },
];
/** eval-plan 3.8：时钟、用户时区、活跃消息及节日均需真实运行时依据。 */
export const TIME_AWARENESS_CASES: readonly EvalCase[] = [
  ...active,
  ...scenarios.map((s, i): EvalCase => ({
    id: `TIME-${String(i + 4).padStart(3, '0')}`,
    category: 'time_awareness',
    prdRefs: ['SIM-04', 'eval-plan 3.8'],
    setup: {
      ...base,
      timeZone: s.timeZone ?? base.timeZone,
      ...(s.holiday ? { time: '2025-12-31T16:20:00Z', holidayName: '元旦' } : {}),
    },
    input: s.input,
    mustInclude: [],
    ...(s.includeAny ? { mustIncludeAny: [s.includeAny] } : {}),
    mustNotInclude: [],
    judgeRubric: s.rubric,
    hard: !s.sleep,
    requiredJudgeChecks: [s.judge],
    requiredRuntimeChecks: [...checks, ...(s.holiday ? ['holiday_context_prepared'] : [])],
  })),
];
