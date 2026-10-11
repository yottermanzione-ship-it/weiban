import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { CHARACTER_PERSONA_SUMMARIZER } from '../src/modules/characters/index.js';
import { GROWTH_CARD_COPYWRITER } from '../src/modules/growth/index.js';
import {
  AI_PERSONA_UPDATE_SUMMARIZER,
  AI_CARD_LINE_WRITER,
} from '../src/modules/ai-runtime/index.js';
import { describeDb, resetTestDatabase } from './support/db.js';
import { testConfig, testKekRing, captureLogger } from './support/fixtures.js';

describeDb('契约 3.1 完整装配', () => {
  it('真实应用能装配且底层 AI 接口指向实现', async () => {
    await resetTestDatabase();
    const { logger } = captureLogger();
    const builder = Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config: testConfig(),
          logger,
          kekRing: testKekRing().ring,
          background: false,
        }),
      ],
    });
    if (process.env.NEST_DEBUG) builder.setLogger(console);
    const moduleRef = await builder.compile();
    try {
      expect(moduleRef.get(CHARACTER_PERSONA_SUMMARIZER)).toHaveProperty('summarize');
      expect(moduleRef.get(GROWTH_CARD_COPYWRITER)).toHaveProperty('writeCardCopy');
      expect(moduleRef.get(AI_PERSONA_UPDATE_SUMMARIZER)).toHaveProperty('summarize');
      expect(moduleRef.get(AI_CARD_LINE_WRITER)).toHaveProperty('writeCardCopy');
    } finally {
      await moduleRef.close();
    }
  }, 30000);
});
