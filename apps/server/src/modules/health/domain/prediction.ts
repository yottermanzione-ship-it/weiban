/**
 * 经期预测算法（PLAY-01 第 3 条，P-37）。
 * 纯函数，无 I/O。使用解密后的经期记录在内存里计算。
 */

/** 以天为单位计算两个 YYYY-MM-DD 日期之间的差值（后 - 前）。 */
export function dateDiffDays(from: string, to: string): number {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000);
}

/** 今天的 YYYY-MM-DD 字符串（UTC）。测试时可注入。 */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface CycleData {
  entryId: string;
  startDate: string;
  endDate: string | null;
}

export interface DayLogData {
  date: string;
  flow: string | null;
  pain: 'none' | 'mild' | 'moderate' | 'severe' | null;
  symptoms: string[];
  notes: string | null;
}

export type Confidence = 'normal' | 'irregular' | 'insufficient_data';

export interface PredictionOutput {
  predictedNextStart: string | null;
  predictedDays: number | null;
  confidence: Confidence;
}

/**
 * 计算预测结果。
 * 至少需要 2 条完整经期（有结束日）才能给出预测。
 * 周期间隔标准差 > 5 天时标记为 irregular。
 */
export function predict(cycles: CycleData[], today: string = todayUtc()): PredictionOutput {
  const complete = cycles
    .filter((c) => c.startDate && c.endDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  if (complete.length < 2) {
    return { predictedNextStart: null, predictedDays: null, confidence: 'insufficient_data' };
  }

  // 周期长度 = 相邻两次经期起始日间隔
  const cycleGaps: number[] = [];
  for (let i = 1; i < complete.length; i++) {
    cycleGaps.push(dateDiffDays(complete[i - 1]!.startDate, complete[i]!.startDate));
  }

  const avgGap = cycleGaps.reduce((s, v) => s + v, 0) / cycleGaps.length;
  const stddev =
    cycleGaps.length > 1
      ? Math.sqrt(
          cycleGaps.reduce((s, v) => s + (v - avgGap) ** 2, 0) / (cycleGaps.length - 1),
        )
      : 0;

  // 经期天数 = 各完整经期的持续天数均值
  const periodLengths = complete.map((c) => dateDiffDays(c.startDate, c.endDate!));
  const avgPeriodDays = Math.round(
    periodLengths.reduce((s, v) => s + v, 0) / periodLengths.length,
  );

  const confidence: Confidence = stddev > 5 ? 'irregular' : 'normal';

  // 以最后一次经期的起始日推算下次
  const lastStart = complete[complete.length - 1]!.startDate;
  const predictedMs = new Date(lastStart).getTime() + Math.round(avgGap) * 86_400_000;
  const predictedNextStart = new Date(predictedMs).toISOString().slice(0, 10);

  // 如果预测日期已过 today，说明可能正在经期或数据不足，返回 null 更准确
  const adjusted = predictedNextStart <= today ? null : predictedNextStart;

  return {
    predictedNextStart: adjusted,
    predictedDays: avgPeriodDays > 0 ? avgPeriodDays : null,
    confidence,
  };
}

/**
 * 判断当前是否在经期，以及第几天。
 * @param cycles - 所有经期（已解密）
 * @param today - 今天的 YYYY-MM-DD
 */
export function currentPeriodStatus(
  cycles: CycleData[],
  today: string = todayUtc(),
): { inPeriod: boolean; dayOfPeriod: number | null; currentCycle: CycleData | null } {
  // 找到包含 today 的经期（startDate <= today <= endDate，或 started <= today 且 endDate 为 null）
  for (const c of cycles) {
    if (c.startDate > today) continue;
    if (c.endDate && c.endDate < today) continue;
    const day = dateDiffDays(c.startDate, today) + 1;
    return { inPeriod: true, dayOfPeriod: day, currentCycle: c };
  }
  return { inPeriod: false, dayOfPeriod: null, currentCycle: null };
}

/**
 * 找到某天所属的经期（用于提取当天日记里的 pain / symptoms）。
 * 规则：startDate <= date <= endDate，或 startDate <= date 且 endDate 为 null（进行中）。
 */
export function findCycleForDate(cycles: CycleData[], date: string): CycleData | null {
  for (const c of cycles) {
    if (c.startDate > date) continue;
    if (c.endDate && c.endDate < date) continue;
    return c;
  }
  return null;
}
