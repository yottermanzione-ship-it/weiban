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

  it('经 globalThis / global 取 Date、不带 new 调用 Date()、拿走 Date.now → 报错（T-015 加固）', async () => {
    const errors = await boundaryErrors(
      `${SERVER}/modules/contacts/domain/accept.ts`,
      [
        'export const a = new globalThis.Date();',
        'export const b = globalThis.Date.now();',
        "export const c = globalThis['Date'].now();",
        'export const d = new global.Date();',
        'export const e = Date();',
        'export const f = Date.now;',
        'export const g = new Date;',
        '',
      ].join('\n'),
    );
    expect(errors.filter((e) => e.startsWith('R7'))).toHaveLength(7);
  });

  it('apps/server/src 下 modules 以外的文件（装配入口、其他目录）也检查（T-015 加固）', async () => {
    const code = 'export const a = new Date();\n';
    expect((await boundaryErrors(`${SERVER}/main.ts`, code)).join('\n')).toMatch(/^R7/m);
    expect((await boundaryErrors(`${SERVER}/app.module.ts`, code)).join('\n')).toMatch(/^R7/m);
    expect((await boundaryErrors(`${SERVER}/jobs/cleanup.ts`, code)).join('\n')).toMatch(/^R7/m);
  });

  it('解析时间戳、平台内核、测试文件、服务器以外 → 通过', async () => {
    const code =
      'export const a = new Date();\nexport const b = Date.now();\nexport const c = new globalThis.Date();\n';
    expect(
      await boundaryErrors(
        `${SERVER}/modules/contacts/domain/accept.ts`,
        "export const a = new Date('2026-10-04T00:00:00Z');\nexport const b = new globalThis.Date(0);\nexport const c = Date.parse('2026-10-04');\n",
      ),
    ).toEqual([]);
    expect(await boundaryErrors(`${SERVER}/platform/clock/system-clock.ts`, code)).toEqual([]);
    expect(await boundaryErrors(`${SERVER}/modules/contacts/domain/accept.test.ts`, code)).toEqual(
      [],
    );
    expect(await boundaryErrors('apps/server/test/integration/chat.test.ts', code)).toEqual([]);
    expect(await boundaryErrors('apps/web/src/features/chat/time.ts', code)).toEqual([]);
  });
});

describe('服务器禁止路径别名（T-015）', () => {
  it('@/、~/、#、src/ 这类别名导入 → 报错', async () => {
    const errors = await boundaryErrors(
      `${SERVER}/modules/contacts/application/add-contact.ts`,
      [
        "import { a } from '@/modules/chat';",
        "import { b } from '~/platform/clock';",
        "import { c } from '#platform/clock';",
        "import { d } from 'src/modules/chat';",
        "export { e } from 'modules/chat/infra/db/schema';",
        "export const f = await import('@/modules/billing');",
        'export const all = [a, b, c, d];',
        '',
      ].join('\n'),
    );
    expect(errors.filter((e) => e.startsWith('禁止路径别名'))).toHaveLength(6);
  });

  it('服务器测试目录里用别名 → 报错', async () => {
    const errors = await boundaryErrors(
      'apps/server/test/integration/chat.test.ts',
      "import { ChatModule } from '@/modules/chat';\nexport const x = ChatModule;\n",
    );
    expect(errors.join('\n')).toMatch(/^禁止路径别名/m);
  });

  it('相对路径、npm 包（含 @scope/包）、服务器以外的别名 → 通过', async () => {
    expect(
      await boundaryErrors(
        `${SERVER}/modules/contacts/application/add-contact.ts`,
        [
          "import { ChatModule } from '../../chat';",
          "import { clock } from '../../../platform/clock/index.js';",
          "import { Injectable } from '@nestjs/common';",
          "import { type Message } from '@weiban/contracts';",
          "import pg from 'pg';",
          "import { readFile } from 'node:fs/promises';",
          'export type M = Message;',
          'export const all = [ChatModule, clock, Injectable, pg, readFile];',
          '',
        ].join('\n'),
      ),
    ).toEqual([]);
    expect(
      await boundaryErrors(
        'apps/web/src/features/chat/send.ts',
        "import { x } from '@/lib/x';\nexport const y = x;\n",
      ),
    ).toEqual([]);
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

describe('R9 扣费出口唯一（3.1 规则 A / B / C）', () => {
  const AI = `${SERVER}/modules/ai-runtime/application/plan.ts`;
  const r9 = (errors: string[]) => errors.filter((e) => e.startsWith('R9'));

  it('Q-009 绕过①：声明为 BillingReservationPort 类型的 port 调用 port.settle → 报错（ai-runtime、contacts 都拦）', async () => {
    const code = [
      "import type { BillingReservationPort } from '@weiban/contracts';",
      'declare const port: BillingReservationPort;',
      "port.settle({ holdId: 'h', usageRecordId: 'u', actual: {}, startedAt: '' });",
      '',
    ].join('\n');
    for (const file of [AI, `${SERVER}/modules/contacts/application/gift.ts`]) {
      expect(r9(await boundaryErrors(file, code)).join('\n')).toMatch(/BillingReservationPort/);
    }
  });

  it("Q-009 绕过②：计算属性 billingPort['estimateAndReserve'](…) → 报错", async () => {
    const code = [
      'declare const billingPort: Record<string, (i: unknown) => unknown>;',
      "billingPort['estimateAndReserve']({});",
      '',
    ].join('\n');
    expect(r9(await boundaryErrors(AI, code))).toHaveLength(1);
  });

  it('规则 A：别名导入、注入令牌、再导出、命名空间（值 / 类型位置）、import() 类型与解构 → 各自报错', async () => {
    const cases = [
      "import { type BillingReservationPort as Wallet } from '@weiban/contracts';\nexport type W = Wallet;\n",
      "import { BILLING_RESERVATION_PORT as T } from '../../billing';\nexport const t = T;\n",
      "export { BillingReservationPort } from '@weiban/contracts';\n",
      "export { BILLING_RESERVATION_PORT as TOKEN } from '../../billing';\n",
      "import * as c from '@weiban/contracts';\nexport type P = c.BillingReservationPort;\n",
      "import * as billing from '../../billing';\nexport const t = billing.BILLING_RESERVATION_PORT;\n",
      "import * as billing from '../../billing';\nexport const t = billing['BILLING_RESERVATION_PORT'];\n",
      "export type P = import('@weiban/contracts').BillingReservationPort;\n",
      "export const load = async () => {\n  const { BILLING_RESERVATION_PORT: t } = await import('../../billing');\n  return t;\n};\n",
      "export const load = async () => (await import('../../billing')).BILLING_RESERVATION_PORT;\n",
    ];
    for (const code of cases) {
      const errors = r9(await boundaryErrors(AI, code));
      expect(errors.length, code).toBeGreaterThanOrEqual(1);
      expect(errors.join('\n'), code).toMatch(/BillingReservationPort|BILLING_RESERVATION_PORT/);
    }
  });

  it('规则 B：estimateAndReserve 的点访问、模板字符串键、解构、字符串常量 → 各自报错', async () => {
    const cases = [
      'declare const x: { estimateAndReserve(i: unknown): unknown };\nx.estimateAndReserve({});\n',
      'declare const x: Record<string, (i: unknown) => unknown>;\nx[`estimateAndReserve`]({});\n',
      'declare const x: { estimateAndReserve(i: unknown): unknown };\nconst { estimateAndReserve: f } = x;\nf({});\n',
      "declare const x: Record<string, (i: unknown) => unknown>;\nconst k = 'estimateAndReserve';\nx[k]?.({});\n",
    ];
    for (const code of cases) {
      expect(r9(await boundaryErrors(AI, code)).length, code).toBeGreaterThanOrEqual(1);
    }
  });

  it('规则 C：业务模块 import ModuleRef（含别名、命名空间）→ 报错；platform、装配入口 → 通过', async () => {
    const named = "import { ModuleRef as Ref } from '@nestjs/core';\nexport const r = Ref;\n";
    const ns = "import * as core from '@nestjs/core';\nexport const r = core.ModuleRef;\n";
    for (const file of [AI, `${SERVER}/modules/model-access/application/generate.ts`]) {
      expect(r9(await boundaryErrors(file, named)).join('\n')).toMatch(/ModuleRef/);
      expect(r9(await boundaryErrors(file, ns)).join('\n')).toMatch(/ModuleRef/);
    }
    expect(await boundaryErrors(`${SERVER}/platform/nest/module-ref.ts`, named)).toEqual([]);
    expect(await boundaryErrors(`${SERVER}/app.module.ts`, named)).toEqual([]);
  });

  it('合规：model-access 引用并调用冻结 / 结算 / 解冻 → 通过', async () => {
    const code = [
      "import type { BillingReservationPort } from '@weiban/contracts';",
      "import { BILLING_RESERVATION_PORT } from '../../billing';",
      'declare const port: BillingReservationPort;',
      'port.estimateAndReserve({} as never);',
      "port['estimateAndReserve']({} as never);",
      "port.settle({ holdId: 'h', usageRecordId: 'u', actual: {}, startedAt: '' });",
      "port.release({ holdId: 'h', reason: 'cancelled' });",
      'export const token = BILLING_RESERVATION_PORT;',
      '',
    ].join('\n');
    expect(
      await boundaryErrors(`${SERVER}/modules/model-access/application/generate.ts`, code),
    ).toEqual([]);
  });

  it('合规：其他模块只用 BillingReadPort.getSpendStatus、普通对象的 settle / release → 通过', async () => {
    const code = [
      "import type { BillingReadPort } from '@weiban/contracts';",
      "import { BILLING_READ_PORT } from '../../billing';",
      'declare const reader: BillingReadPort;',
      'declare const lock: { release(): void };',
      'declare const promise: { settle(): void };',
      "export const status = reader.getSpendStatus({ kind: 'user', userId: 'u1' });",
      'lock.release();',
      'promise.settle();',
      'export const token = BILLING_READ_PORT;',
      '',
    ].join('\n');
    expect(await boundaryErrors(AI, code)).toEqual([]);
  });

  it('豁免：billing 自己、装配入口、集成测试 → 通过', async () => {
    const code =
      "import type { BillingReservationPort } from '@weiban/contracts';\ndeclare const port: BillingReservationPort;\nport.estimateAndReserve({} as never);\n";
    expect(await boundaryErrors(`${SERVER}/modules/billing/application/reserve.ts`, code)).toEqual(
      [],
    );
    expect(await boundaryErrors(`${SERVER}/app.module.ts`, code)).toEqual([]);
    expect(await boundaryErrors('apps/server/test/integration/billing.test.ts', code)).toEqual([]);
  });
});

describe('R10 测试引用（3.2）', () => {
  const IT = 'apps/server/test/integration/chat.test.ts';
  const r10 = (errors: string[]) => errors.filter((e) => e.startsWith('R10'));

  it('集成测试引用模块内部文件 → 报错', async () => {
    const errors = await boundaryErrors(
      IT,
      [
        "import { messages } from '../../src/modules/chat/infra/db/schema';",
        "import { send } from '../../src/modules/chat/domain/send';",
        'export const all = [messages, send];',
        '',
      ].join('\n'),
    );
    expect(r10(errors)).toHaveLength(2);
  });

  it('集成测试引用 src/ 下装配入口以外的其他目录 → 仍报错', async () => {
    const errors = await boundaryErrors(
      IT,
      [
        "import { loadConfig } from '../../src/config/load';",
        "import { runEvals } from '../../src/cli/run-evals';",
        'export const all = [loadConfig, runEvals];',
        '',
      ].join('\n'),
    );
    expect(r10(errors)).toHaveLength(2);
  });

  it('集成测试引用装配入口 app.module.ts、main.ts（启动整个应用）→ 通过', async () => {
    const errors = await boundaryErrors(
      IT,
      [
        "import { AppModule } from '../../src/app.module';",
        "import { bootstrap } from '../../src/main.js';",
        'export const all = [AppModule, bootstrap];',
        '',
      ].join('\n'),
    );
    expect(errors).toEqual([]);
  });

  it('集成测试引用 index.ts、testing.ts、platform/、测试目录自己的工具 → 通过', async () => {
    const errors = await boundaryErrors(
      IT,
      [
        "import { ChatModule } from '../../src/modules/chat';",
        "import { X } from '../../src/modules/chat/index.js';",
        "import { fakeGateway } from '../../src/modules/model-access/testing';",
        "import { clock } from '../../src/platform/clock';",
        "import { resetDb } from '../helpers/db';",
        'export const all = [ChatModule, X, fakeGateway, clock, resetDb];',
        '',
      ].join('\n'),
    );
    expect(errors).toEqual([]);
  });

  it('生产代码 import 任何模块的 testing.ts（含本模块）→ 报错', async () => {
    expect(
      r10(
        await boundaryErrors(
          `${SERVER}/modules/ai-runtime/application/reply.ts`,
          "import { fakeGateway } from '../../model-access/testing';\nexport const f = fakeGateway;\n",
        ),
      ),
    ).toHaveLength(1);
    expect(
      r10(
        await boundaryErrors(
          `${SERVER}/modules/chat/application/send.ts`,
          "import { factory } from '../testing.js';\nexport const f = factory;\n",
        ),
      ),
    ).toHaveLength(1);
  });

  it('模块内单元测试引用本模块内部文件、其他模块的 testing.ts → 通过', async () => {
    const errors = await boundaryErrors(
      `${SERVER}/modules/ai-runtime/application/reply.test.ts`,
      [
        "import { plan } from './plan';",
        "import { fakeGateway } from '../../model-access/testing';",
        'export const all = [plan, fakeGateway];',
        '',
      ].join('\n'),
    );
    expect(errors).toEqual([]);
  });
});

describe('R4 扩展到 packages/ai-evals（3.3）', () => {
  it('评测包 import 供应商 SDK、请求供应商域名 → 报错；只放用例和评分逻辑 → 通过', async () => {
    const errors = await boundaryErrors(
      'packages/ai-evals/src/run.ts',
      "import OpenAI from 'openai';\nexport const url = 'https://api.anthropic.com/v1/messages';\nexport const c = OpenAI;\n",
    );
    expect(errors.filter((e) => e.startsWith('R4'))).toHaveLength(2);
    expect(
      await boundaryErrors(
        'packages/ai-evals/src/rubric.ts',
        "export const rubric = { id: 'persona-01', maxScore: 5 };\n",
      ),
    ).toEqual([]);
  });
});
