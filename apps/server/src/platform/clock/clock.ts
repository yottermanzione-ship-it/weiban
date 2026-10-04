/**
 * 平台时钟（规则 R7）：服务器里「现在几点」一律从这里取。
 * 业务代码禁止直接 new Date() / Date.now()（lint 拦截），测试用 TestClock 固定或拨快时间。
 */

/** 注入令牌：构造函数里写 @Inject(CLOCK) private readonly clock: Clock。 */
export const CLOCK = Symbol('weiban.platform.clock');

export interface Clock {
  /** 当前时间（UTC 时间点）。每次返回新的 Date 对象，调用方可以随意修改。 */
  now(): Date;
  /** 当前时间的毫秒时间戳。 */
  nowMs(): number;
}

/** 生产用：读系统时间。 */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  nowMs(): number {
    return Date.now();
  }
}

/** 测试用：时间固定不动，需要时手动拨。禁止在测试里真的等待（engineering-standards.md 第 7 节）。 */
export class TestClock implements Clock {
  private current: number;

  constructor(start: Date | string | number = '2026-01-01T00:00:00.000Z') {
    this.current = new Date(start).getTime();
  }

  now(): Date {
    return new Date(this.current);
  }

  nowMs(): number {
    return this.current;
  }

  /** 把时间设为指定时刻。 */
  set(time: Date | string | number): void {
    this.current = new Date(time).getTime();
  }

  /** 往后拨若干毫秒。 */
  advance(ms: number): void {
    this.current += ms;
  }
}
