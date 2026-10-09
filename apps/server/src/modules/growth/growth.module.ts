import { Module } from '@nestjs/common';
import { ContactsModule } from '../contacts/index.js';
import { GrowthController } from './http/growth.controller.js';
import { GrowthService } from './application/growth.service.js';
import { GROWTH_SERVICE } from './tokens.js';

@Module({
  imports: [ContactsModule],
  controllers: [GrowthController],
  providers: [GrowthService, { provide: GROWTH_SERVICE, useExisting: GrowthService }],
  exports: [GROWTH_SERVICE],
})
export class GrowthModule {}
