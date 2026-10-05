/**
 * 账号运维命令行（在 apps/server 目录运行，pnpm --filter 会自动切换过去）。用法见 docs/backend/identity.md 第 7 节。
 *
 *   pnpm --filter @weiban/server identity create-admin <用户名> [--tz Asia/Shanghai]
 *   pnpm --filter @weiban/server identity reset-password <用户名>
 *   pnpm --filter @weiban/server identity set-role <用户名> <user|admin>
 *   pnpm --filter @weiban/server identity create-invite [--days 7] [--bonus 10]
 *   pnpm --filter @weiban/server identity verify-purged <用户ID>
 *   pnpm --filter @weiban/server identity sweep-sessions
 *
 * 生产（构建后）：node dist/identity.js <命令> …
 *
 * 密码不放在命令参数里（会留在命令历史）：在终端里运行时提示输入两次（不回显）；
 * 也可以用管道从标准输入传入一行，例如  echo 'xxx' | node dist/identity.js reset-password boss
 */
import 'reflect-metadata';
import { createInterface } from 'node:readline';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { CommandError, IdentityCommands } from '../modules/identity/index.js';
import { loadLocalEnv } from '../platform/config/local-env.js';
import { NestPinoLogger } from '../platform/logging/nest-logger.js';
import { ConfigError, createLogger, loadConfig } from '../platform/index.js';

const USAGE = `用法：
  identity create-admin <用户名> [--tz 时区]   创建管理员（随后输入密码）
  identity reset-password <用户名>            重置密码（随后输入新密码；该账号所有设备下线、解除锁定）
  identity set-role <用户名> <user|admin>     改角色（降为 user 时作废其管理会话）
  identity create-invite [--days 天数] [--bonus 元]
                                              生成一个邀请码（不填天数则永不过期；--bonus 注册赠送余额，单位元）
  identity verify-purged <用户ID>             注销核验：列出每个模块剩余的数据条数
  identity sweep-sessions                     清扫已过期的会话`;

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

/** 读密码：终端里不回显地问两次；管道输入则读第一行。 */
async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return (Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0] ?? '').trim();
  }
  const ask = (prompt: string) =>
    new Promise<string>((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
      const internal = rl as unknown as { _writeToOutput: (s: string) => void };
      let muted = false;
      internal._writeToOutput = (s: string) => {
        if (!muted) process.stdout.write(s);
      };
      rl.question(prompt, (answer) => {
        rl.close();
        process.stdout.write('\n');
        resolve(answer);
      });
      muted = true;
    });
  const first = await ask('请输入密码（10–128 位，不显示）：');
  const second = await ask('请再输入一次：');
  if (first !== second) throw new CommandError('两次输入的密码不一致');
  return first;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2).filter((a) => a !== '--');
  if (!command || command === 'help' || command === '--help') {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  loadLocalEnv();
  const config = loadConfig();
  const logger = createLogger({ level: 'warn' });
  const app = await NestFactory.createApplicationContext(
    AppModule.forRoot({ config, logger, background: false }),
    { logger: new NestPinoLogger(logger) },
  );
  try {
    const commands = app.get(IdentityCommands);
    const out = (line: string) => process.stdout.write(`${line}\n`);
    switch (command) {
      case 'create-admin': {
        const username = args[0];
        if (!username) throw new CommandError('缺少用户名');
        const password = await readPassword();
        const id = await commands.createAdmin(username, password, option(args, '--tz'));
        out(`已创建管理员 ${username}（用户 ID ${id}）`);
        break;
      }
      case 'reset-password': {
        const username = args[0];
        if (!username) throw new CommandError('缺少用户名');
        const password = await readPassword();
        const revoked = await commands.resetPassword(username, password);
        out(`已重置 ${username} 的密码，${revoked} 台设备已下线`);
        break;
      }
      case 'set-role': {
        const [username, role] = args;
        if (!username || (role !== 'user' && role !== 'admin')) {
          throw new CommandError('用法：set-role <用户名> <user|admin>');
        }
        await commands.setRole(username, role);
        out(`已把 ${username} 设为 ${role}`);
        break;
      }
      case 'create-invite': {
        const days = option(args, '--days');
        const bonusYuan = option(args, '--bonus');
        const bonusMicros = bonusYuan === undefined ? 0 : Math.round(Number(bonusYuan) * 1_000_000);
        const invite = await commands.createInvite(
          days === undefined ? null : Number(days),
          bonusMicros,
        );
        out(`邀请码：${invite.code}`);
        if (bonusMicros > 0) out(`注册赠送：${bonusMicros / 1_000_000} 元`);
        out(`有效期至：${invite.expiresAt ?? '永不过期'}`);
        break;
      }
      case 'verify-purged': {
        const userId = args[0];
        if (!userId) throw new CommandError('缺少用户 ID');
        const counts = await commands.verifyPurged(userId);
        for (const { module, count } of counts)
          out(`${count === 0 ? '[已清空]' : '[有残留]'} ${module}: ${count}`);
        if (counts.some((c) => c.count > 0)) process.exitCode = 2;
        break;
      }
      case 'sweep-sessions': {
        out(`已清扫 ${await commands.sweepSessions()} 个过期会话`);
        break;
      }
      default:
        throw new CommandError(`未知命令 ${command}\n${USAGE}`);
    }
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof CommandError || error instanceof ConfigError) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write(`执行失败：${error instanceof Error ? error.message : String(error)}\n`);
  }
  process.exitCode = 1;
});
