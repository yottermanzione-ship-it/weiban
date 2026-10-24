/** support 删除清单登记（注销时删除该用户的反馈 / 投诉及截图）。 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  CHARACTER_PURGE_REGISTRY,
  USER_DATA_REGISTRY,
  type CharacterPurgeRegistry,
  type DbTx,
  type UserDataRegistry,
} from '../../../platform/index.js';
import { SupportService } from './support.service.js';

@Injectable()
export class SupportLifecycle implements OnModuleInit {
  constructor(
    @Inject(USER_DATA_REGISTRY) private readonly registry: UserDataRegistry,
    @Inject(CHARACTER_PURGE_REGISTRY) private readonly purgeRegistry: CharacterPurgeRegistry,
    @Inject(SupportService) private readonly support: SupportService,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      module: 'support',
      purgeUser: (userId) => this.support.purgeUser(userId),
      countUserData: (userId) => this.support.countUserData(userId),
    });
    this.purgeRegistry.register({
      module: 'support',
      purge: (tx: DbTx, characterId: string) => this.support.purgeCharacter(tx, characterId),
    });
  }
}
