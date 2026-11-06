import { Logger } from '@nestjs/common';
import type { MemoryService } from './memory.js';

/** 收尾写入幂等；短暂数据库错误重试三次，失败只记分类，绝不记录通话文字。 */
export async function saveCallTranscript(
  memory: Pick<MemoryService, 'enqueueCallExtraction'>,
  input: Parameters<MemoryService['enqueueCallExtraction']>[0],
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await memory.enqueueCallExtraction(input);
      return;
    } catch {
      if (attempt === 2)
        new Logger('CallTranscript').error({ code: 'call_transcript_save_failed' });
    }
  }
}
