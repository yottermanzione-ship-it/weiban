/**
 * 证明「服务器模块之间禁止循环依赖」真的生效（dependency-cruiser，配置见 ../dependency-cruiser.js）。
 * 循环要看多个文件之间的引用，所以每个用例在系统临时目录里搭一个迷你的 apps/server/src，
 * 用和 `pnpm lint:deps` 完全相同的配置检查，用完删除。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cruise, type ICruiseResult } from 'dependency-cruiser';
import { afterEach, describe, expect, it } from 'vitest';
import config from '../dependency-cruiser.js';

const MODULES = 'apps/server/src/modules';
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** 在临时目录写入一组文件（路径相对仓库根），跑循环检查，返回违规的规则名和起点文件。 */
async function cycleViolations(files: Record<string, string>): Promise<string[]> {
  const root = mkdtempSync(path.join(tmpdir(), 'weiban-cycles-'));
  roots.push(root);
  for (const [file, code] of Object.entries(files)) {
    const full = path.join(root, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, code);
  }
  const result = await cruise(['apps/server'], {
    ...config.options,
    baseDir: root,
    validate: true,
    ruleSet: { forbidden: config.forbidden },
  });
  const output = result.output as ICruiseResult;
  // 先确认所有 import 都解析到了文件，否则「没有违规」可能只是没看懂引用
  const unresolved = output.modules.flatMap((m) =>
    m.dependencies.filter((d) => d.couldNotResolve).map((d) => `${m.source} -> ${d.module}`),
  );
  expect(unresolved).toEqual([]);
  return output.summary.violations.map((v) => `${v.rule.name}: ${v.from}`);
}

describe('同层模块循环依赖', () => {
  it('chat 和 contacts 经过 index 互相引用 → 报错', async () => {
    const violations = await cycleViolations({
      [`${MODULES}/chat/index.ts`]: "export * from './chat.service.js';\n",
      [`${MODULES}/chat/chat.service.ts`]:
        "import { contactsName } from '../contacts/index.js';\nexport const chatName = `chat-${contactsName}`;\n",
      [`${MODULES}/contacts/index.ts`]: "export * from './contacts.service.js';\n",
      [`${MODULES}/contacts/contacts.service.ts`]:
        "import { chatName } from '../chat/index.js';\nexport const contactsName = 'contacts';\nexport const peer = () => chatName;\n",
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(
      /^no-cross-module-cycle: apps\/server\/src\/modules\/(chat|contacts)\//,
    );
  });

  it('只在类型上互相依赖（import type）也算循环 → 报错', async () => {
    const violations = await cycleViolations({
      [`${MODULES}/billing/index.ts`]: "export * from './billing-port';\n",
      [`${MODULES}/billing/billing-port.ts`]:
        "import type { ModelKey } from '../model-access';\nexport interface BillingPort { price(k: ModelKey): number }\n",
      [`${MODULES}/model-access/index.ts`]: "export * from './model-key';\n",
      [`${MODULES}/model-access/model-key.ts`]:
        "import type { BillingPort } from '../billing';\nexport type ModelKey = string;\nexport type Uses = BillingPort;\n",
    });
    expect(violations.join('\n')).toMatch(/^no-cross-module-cycle:/m);
  });

  it('三个模块绕一圈（chat → contacts → media → chat）→ 报错', async () => {
    const violations = await cycleViolations({
      [`${MODULES}/chat/index.ts`]: "import { c } from '../contacts';\nexport const a = c;\n",
      [`${MODULES}/contacts/index.ts`]: "import { m } from '../media';\nexport const c = m;\n",
      [`${MODULES}/media/index.ts`]: "import { a } from '../chat';\nexport const m = () => a;\n",
    });
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations.every((v) => v.startsWith('no-cross-module-cycle:'))).toBe(true);
  });

  it('单向依赖、同一模块内部的循环、测试文件 → 通过', async () => {
    const violations = await cycleViolations({
      // 单向：contacts → chat
      [`${MODULES}/chat/index.ts`]: "export const chatName = 'chat';\n",
      [`${MODULES}/contacts/index.ts`]:
        "import { chatName } from '../chat';\nexport const contactsName = chatName;\n",
      // 模块内部两个文件互相引用：不在本规则范围
      [`${MODULES}/media/a.ts`]: "import { b } from './b';\nexport const a = () => b;\n",
      [`${MODULES}/media/b.ts`]: "import { a } from './a';\nexport const b = () => a;\n",
      // 测试文件引用对方不算
      [`${MODULES}/chat/chat.test.ts`]:
        "import { contactsName } from '../contacts';\nexport const t = contactsName;\n",
    });
    expect(violations).toEqual([]);
  });
});
