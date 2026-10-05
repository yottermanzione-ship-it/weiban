/** 评测工作者与角色读取服务分离，避免 gateway→policy→characters→gateway 构造循环。 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { JOB_QUEUE, type JobQueue } from '../../../platform/index.js';
import { CHARACTER_EVALUATOR } from '../tokens.js';
import { CharacterService } from './characters.js';
import type { CharacterEvaluator } from './evaluator.js';
type CheckInput = { characterId: string; adminId: string; revision: number };
@Injectable()
export class CharacterCheckWorker implements OnModuleInit {
  constructor(
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(CharacterService) private readonly characters: CharacterService,
    @Inject(CHARACTER_EVALUATOR) private readonly evaluator: CharacterEvaluator,
  ) {}
  async onModuleInit(): Promise<void> {
    await this.jobs.work<CheckInput>('characters.check_publish', (job) => this.runChecks(job.data));
  }
  runChecks(input: CheckInput): Promise<void> {
    return this.characters.runChecks(input, this.evaluator);
  }
}
