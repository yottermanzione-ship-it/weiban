/**
 * 首次权限逐个申请的纯逻辑（任务卡 T-20261103 第 1 项）。
 *
 * 系统权限框不能同时出现两个，Safari 还要求每次系统申请都在一次用户点击里发起：
 * 所以一次只申请一项（先通知、再麦克风），每一步都由用户在我们自己的说明框里点一次按钮触发；
 * 同意、拒绝、关掉系统框或出错都算这一步有了结果，照常进入下一步，不卡死。
 */
export type PermissionStep = 'notification' | 'microphone';

/**
 * 开始申请前某项权限的状态：
 * - prompt：需要申请（显示这一步）；
 * - granted：已授权，跳过这一步；
 * - denied：浏览器里已被拒绝，系统框不会再出现，跳过（用到时由现有提示引导去设置里打开）；
 * - unsupported：浏览器不支持或当前环境不能申请（如 iPhone 未加主屏幕时的通知），跳过。
 */
export type PermissionStatus = 'prompt' | 'granted' | 'denied' | 'unsupported';

/** 一步的结果：granted 同意；denied 拒绝；dismissed 关掉系统框没选；failed 申请出错。 */
export type StepOutcome = 'granted' | 'denied' | 'dismissed' | 'failed';

export const STEP_ORDER: readonly PermissionStep[] = ['notification', 'microphone'];

/** 需要逐个申请的步骤（固定顺序：通知 → 麦克风；已授权、已拒绝、不支持的跳过）。 */
export function plannedSteps(status: Record<PermissionStep, PermissionStatus>): PermissionStep[] {
  return STEP_ORDER.filter((step) => status[step] === 'prompt');
}

/**
 * 逐步流程。`confirm()` 必须在用户点击的同步调用链里调用：它同步发起当前这一步的系统申请
 * （request 在 confirm 内立即调用），等结果回来才前进；前一步没结果时再点不会发第二个申请。
 */
export class PermissionFlow {
  private index = 0;
  private busy = false;

  constructor(
    readonly steps: readonly PermissionStep[],
    private readonly request: (step: PermissionStep) => Promise<StepOutcome>,
  ) {}

  /** 当前要申请的一步；全部走完为 null。 */
  get current(): PermissionStep | null {
    return this.steps[this.index] ?? null;
  }

  get done(): boolean {
    return this.index >= this.steps.length;
  }

  /** 第几步（从 1 开始），用于说明框里的「第 N 步，共 M 步」。 */
  get position(): number {
    return Math.min(this.index + 1, this.steps.length);
  }

  /** 用户点了「开启」：只申请当前这一步，结果回来（无论同意与否）后进入下一步。 */
  confirm(): Promise<{ step: PermissionStep; outcome: StepOutcome } | null> {
    const step = this.current;
    if (!step || this.busy) return Promise.resolve(null);
    this.busy = true;
    let pending: Promise<StepOutcome>;
    try {
      pending = this.request(step);
    } catch {
      pending = Promise.resolve('failed');
    }
    return pending
      .catch((): StepOutcome => 'failed')
      .then((outcome) => {
        this.busy = false;
        this.index += 1;
        return { step, outcome };
      });
  }

  /** 用户点了「暂不开启」：不发系统申请，直接进入下一步。 */
  skip(): void {
    if (this.busy || this.done) return;
    this.index += 1;
  }
}
