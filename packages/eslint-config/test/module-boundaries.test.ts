/**
 * 证明模块边界规则 R1～R9 真的生效：用共享配置检查一段虚构文件内容，
 * 越界写法必须报错，合规写法必须不报错。
 * 文件不需要真实存在：规则只看文件路径和代码文本。
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ESLint, type Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import weibanConfig from '../index.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfigFile: true,
  overrideConfig: weibanConfig as Linter.Config[],
});

/** 检查一段代码，返回命中的边界规则消息（只看 weiban/* 规则）。 */
async function boundaryErrors(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, file) });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId?.startsWith('weiban/'))
    .map((m) => m.message);
}

const SERVER = 'apps/server/src';

describe('R1 公开出口', () => {
  it('引用别的模块内部文件 → 报错', async () => {
    const errors = await boundaryErrors(
      `${SERVER}/modules/contacts/application/add-contact.ts`,
      "import { messages } from '../../chat/infra/db/schema';\nexport const x = messages;\n",
    );
    expect(errors.join('\n')).toMatch(/^R1 公开出口/m);
  });

  it('只引用别的模块 index → 通过', async () => {
    const errors = await boundaryErrors(
      `${SERVER}/modules/contacts/application/add-contact.ts`,
      "import { ChatModule } from '../../chat';\nimport { X } from '../../chat/index.js';\nexport const y = [ChatModule, X];\n",
    );
    expect(errors).toEqual([]);
  });

  it('模块内部互相引用 → 通过', async () => {
    const errors = await boundaryErrors(
      `${SERVER}/modules/chat/application/send-user-message.ts`,
      "import { messages } from '../infra/db/schema';\nexport const x = messages;\n",
    );
    expect(errors).toEqual([]);
  });

  it('modules 下出现未登记的模块 → 报错', async () => {
    const errors = await boundaryErrors(`${SERVER}/modules/unknown-thing/index.ts`, 'export {};\n');
    expect(errors.join('\n')).toMatch(/没有在 packages\/eslint-config\/architecture\.js 登记/);
  });
});

describe('R2 层级方向', () => {
  it('底层 identity import 上层 ai-runtime → 报错', async () => {
    const errors = await boundaryErrors(
      `${SERVER}/modules/identity/application/register.ts`,
      "import { AiRuntimeModule } from '../../ai-runtime';\nexport const x = AiRuntimeModule;\n",
    );
    expect(errors.join('\n')).toMatch(/^R2 层级方向/m);
  });

  it('平台内核 import 业务模块 → 报错', async () => {
    const errors = await boundaryErrors(
      `${SERVER}/platform/events/dispatcher.ts`,
      "import { ChatModule } from '../../modules/chat';\nexport const x = ChatModule;\n",
    );
    expect(errors.join('\n')).toMatch(/^R2 层级方向/m);
  });

  it('上层 ai-runtime 调中层 chat、同层之间、装配入口引用所有模块 → 通过', async () => {
    expect(
      await boundaryErrors(
        `${SERVER}/modules/ai-runtime/application/reply.ts`,
        "import { ChatModule } from '../../chat';\nimport { clock } from '../../../platform/clock';\nexport const x = [ChatModule, clock];\n",
      ),
    ).toEqual([]);
    expect(
      await boundaryErrors(
        `${SERVER}/modules/model-access/application/generate.ts`,
        "import { BillingModule } from '../../billing';\nexport const x = BillingModule;\n",
      ),
    ).toEqual([]);
    expect(
      await boundaryErrors(
        `${SERVER}/app.module.ts`,
        "import { ChatModule } from './modules/chat';\nimport { AiRuntimeModule } from './modules/ai-runtime';\nexport const x = [ChatModule, AiRuntimeModule];\n",
      ),
    ).toEqual([]);
  });
});

describe('R3 聊天不依赖 AI', () => {
  it('chat import ai-runtime（哪怕是 index）→ 报错', async () => {
    const errors = await boundaryErrors(
      `${SERVER}/modules/chat/application/send-user-message.ts`,
      "import { AiRuntimeModule } from '../../ai-runtime';\nexport const x = AiRuntimeModule;\n",
    );
    expect(errors.join('\n')).toMatch(/^R3 聊天不依赖 AI/m);
  });
});

describe('R4 模型出口唯一', () => {
  it('非 model-access 模块 import 供应商 SDK 或请求供应商域名 → 报错', async () => {
    const errors = await boundaryErrors(
      `${SERVER}/modules/ai-runtime/application/reply.ts`,
      "import OpenAI from 'openai';\nexport const url = 'https://api.deepseek.com/v1/chat/completions';\nexport const c = OpenAI;\n",
    );
    expect(errors.filter((e) => e.startsWith('R4'))).toHaveLength(2);
  });

  it('网页端直接 import 供应商 SDK → 报错', async () => {
    const errors = await boundaryErrors(
      'apps/web/src/features/chat/send.ts',
      "import Anthropic from '@anthropic-ai/sdk';\nexport const c = Anthropic;\n",
    );
    expect(errors.join('\n')).toMatch(/^R4/m);
  });

  it('model-access 模块使用供应商 SDK → 通过', async () => {
    const errors = await boundaryErrors(
      `${SERVER}/modules/model-access/infra/upstreams/openai-compatible.ts`,
      "import OpenAI from 'openai';\nexport const url = 'https://api.deepseek.com';\nexport const c = OpenAI;\n",
    );
    expect(errors).toEqual([]);
  });
});

describe('R5 推送出口唯一', () => {
  it('非 push 模块 import 推送 SDK → 报错；push 模块 → 通过', async () => {
    const code = "import webpush from 'web-push';\nexport const p = webpush;\n";
    expect(
      (await boundaryErrors(`${SERVER}/modules/chat/events/on-message.ts`, code)).join('\n'),
    ).toMatch(/^R5/m);
    expect(await boundaryErrors(`${SERVER}/modules/push/infra/web-push-channel.ts`, code)).toEqual(
      [],
    );
  });
});

describe('R6 契约来源', () => {
  it('绕过包出口引用契约内部文件 → 报错；从包出口导入 → 通过', async () => {
    expect(
      (
        await boundaryErrors(
          'apps/web/src/data/api.ts',
          "import { Message } from '../../../../packages/contracts/src/http/chat';\nexport type M = Message;\n",
        )
      ).join('\n'),
    ).toMatch(/^R6/m);
    expect(
      (
        await boundaryErrors(
          `${SERVER}/modules/chat/api/controller.ts`,
          "import { Message } from '@weiban/contracts/src/http/chat';\nexport type M = Message;\n",
        )
      ).join('\n'),
    ).toMatch(/^R6/m);
    expect(
      await boundaryErrors(
        'apps/web/src/data/api.ts',
        "import { type Message } from '@weiban/contracts';\nexport type M = Message;\n",
      ),
    ).toEqual([]);
  });
});

describe('R7 时间', () => {
  it('业务模块直接取当前时间 → 报错', async () => {
    const errors = await boundaryErrors(
      `${SERVER}/modules/contacts/domain/accept.ts`,
      'export const a = new Date();\nexport const b = Date.now();\n',
    );
    expect(errors.filter((e) => e.startsWith('R7'))).toHaveLength(2);
  });

  it('解析时间戳、平台内核、测试文件 → 通过', async () => {
    const code = 'export const a = new Date();\nexport const b = Date.now();\n';
    expect(
      await boundaryErrors(
        `${SERVER}/modules/contacts/domain/accept.ts`,
        "export const a = new Date('2026-10-04T00:00:00Z');\n",
      ),
    ).toEqual([]);
    expect(await boundaryErrors(`${SERVER}/platform/clock/system-clock.ts`, code)).toEqual([]);
    expect(await boundaryErrors(`${SERVER}/modules/contacts/domain/accept.test.ts`, code)).toEqual(
      [],
    );
  });
});

describe('R8 数据表', () => {
  it('定义别人的 schema、原生 SQL 访问别人的表 → 报错', async () => {
    const errors = await boundaryErrors(
      `${SERVER}/modules/contacts/infra/db/repositories/contacts-repo.ts`,
      [
        'declare const pgSchema: (name: string) => unknown;',
        'declare const sql: (s: TemplateStringsArray, ...v: unknown[]) => unknown;',
        'declare const db: { execute: (q: string) => unknown };',
        "export const s = pgSchema('chat');",
        'export const q = sql`select * from chat.messages where id = ${1}`;',
        'export const r = db.execute(\'select * from "billing"."accounts"\');',
        '',
      ].join('\n'),
    );
    expect(errors.filter((e) => e.startsWith('R8'))).toHaveLength(3);
  });

  it('访问自己的 schema、普通字符串里的事件名 → 通过', async () => {
    const errors = await boundaryErrors(
      `${SERVER}/modules/contacts/infra/db/schema.ts`,
      [
        'declare const pgSchema: (name: string) => unknown;',
        'declare const sql: (s: TemplateStringsArray, ...v: unknown[]) => unknown;',
        "export const s = pgSchema('contacts');",
        'export const q = sql`select * from contacts.contacts`;',
        "export const eventType = 'chat.message_created';",
        '',
      ].join('\n'),
    );
    expect(errors).toEqual([]);
  });
});

describe('R9 扣费出口唯一', () => {
  const code = [
    'declare const billingPort: {',
    '  estimateAndReserve(i: unknown): unknown;',
    '  settle(i: unknown): unknown;',
    '  release(i: unknown): unknown;',
    '  getSpendStatus(u: string): unknown;',
    '};',
    'declare const lock: { release(): void };',
    'billingPort.estimateAndReserve({});',
    'billingPort.settle({});',
    'billingPort.release({});',
    "billingPort.getSpendStatus('u1');",
    'lock.release();',
    '',
  ].join('\n');

  it('ai-runtime 冻结 / 结算 / 解冻 → 报错 3 次（读 getSpendStatus、普通 release 不报）', async () => {
    const errors = await boundaryErrors(`${SERVER}/modules/ai-runtime/application/plan.ts`, code);
    expect(errors.filter((e) => e.startsWith('R9'))).toHaveLength(3);
  });

  it('model-access 调用 → 通过', async () => {
    expect(
      await boundaryErrors(`${SERVER}/modules/model-access/application/generate.ts`, code),
    ).toEqual([]);
  });
});
