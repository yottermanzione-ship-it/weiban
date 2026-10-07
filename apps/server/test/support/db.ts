/** Vitest入口；独立浏览器服务器使用不依赖测试运行器的db-admin。 */
import { describe } from 'vitest';
import { TEST_DATABASE_URL } from './db-admin.js';
export * from './db-admin.js';
if (!TEST_DATABASE_URL) console.warn('[server 集成测试] 未设置 TEST_DATABASE_URL，跳过数据库测试');
export const describeDb = TEST_DATABASE_URL ? describe : describe.skip;
