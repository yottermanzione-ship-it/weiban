/**
 * play 模块的公共接线（各玩法共用，只此一处）：
 * - 删除清单：模块 play 只能登记一次，把各玩法的 purgeUser / countUserData 汇总（注销需删除
 *   每日一问的回答、心愿清单、慢信、专注记录、TA 的提醒）。
 * - contacts 事件：角色软删除 / 恢复 / 彻底删除分发给各玩法。
 * - 到点兜底扫描：每分钟一次调用各玩法的 sweepDue（精确到点用 PlayJobs.at）。
 * 新玩法（T-092～T-095）：实现 PlayFeature，在构造函数注入并加入 features 数组即可。
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  CLOCK,
  DATABASE,
  EVENT_BUS,
  LOGGER,
  USER_DATA_REGISTRY,
  type Clock,
  type Database,
  type EventBus,
  type Logger,
  type UserDataRegistry,
} from '../../../platform/index.js';
import { DailyQuestionService } from './daily-question.service.js';
import type { PlayFeature } from './play-feature.js';
import { PLAY_DUE_SWEEP_JOB, PlayJobs } from './play-jobs.js';

@Injectable()
export class PlayLifecycle implements OnModuleInit {
  private readonly features: PlayFeature[];

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(USER_DATA_REGISTRY) private readonly registry: UserDataRegistry,
    @Inject(PlayJobs) private readonly jobs: PlayJobs,
    @Inject(DailyQuestionService) daily: DailyQuestionService,
  ) {
    this.features = [daily];
  }

  async onModuleInit(): Promise<void> {
    this.registry.register({
      module: 'play',
      purgeUser: (userId) =>
        this.db.transaction(async (tx) => {
          let n = 0;
          for (const f of this.features) n += await f.purgeUser(tx, userId);
          return n;
        }),
      countUserData: async (userId) => {
        let n = 0;
        for (const f of this.features) n += await f.countUserData(userId);
        return n;
      },
    });

    this.bus.subscribe({
      consumer: 'play.on_contact_removed',
      eventType: 'contacts.contact_removed',
      handle: async (event, tx) => {
        const { userId, characterId } = event.payload;
        for (const f of this.features) await f.onContactRemoved?.(tx, userId, characterId);
      },
    });
    this.bus.subscribe({
      consumer: 'play.on_contact_accepted',
      eventType: 'contacts.contact_accepted',
      handle: async (event, tx) => {
        const { userId, characterId } = event.payload;
        for (const f of this.features) await f.onContactRestored?.(tx, userId, characterId);
      },
    });
    this.bus.subscribe({
      consumer: 'play.on_contact_purged',
      eventType: 'contacts.contact_purged',
      handle: async (event, tx) => {
        const { userId, characterId } = event.payload;
        for (const f of this.features) await f.onContactPurged?.(tx, userId, characterId);
      },
    });

    await this.jobs.register(PLAY_DUE_SWEEP_JOB, () => this.sweep());
    await this.jobs.cron(PLAY_DUE_SWEEP_JOB, '* * * * *');
  }

  private async sweep(): Promise<void> {
    const now = this.clock.now();
    for (const f of this.features) {
      if (!f.sweepDue) continue;
      try {
        await f.sweepDue(now);
      } catch (err) {
        // 一个玩法出错不影响其他玩法；下一分钟再扫。
        this.logger.error({ err, feature: f.featureName }, 'play 到点扫描出错');
      }
    }
  }
}
