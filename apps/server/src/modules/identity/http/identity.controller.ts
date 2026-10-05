/**
 * identity 的 HTTP 接口，一一对应契约 IdentityEndpoints / IdentityAdminEndpoints
 * （packages/contracts/src/http/identity.ts）。请求体一律用契约里的 schema 校验。
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  IdentityAdminEndpoints,
  IdentityEndpoints,
  type AuthResponse,
  type CurrentUser,
  type NotificationSettings,
  type Profile,
  type SessionSummary,
  type UserPreferences,
} from '@weiban/contracts';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { AccountService } from '../application/accounts.js';
import { InviteService, type Invite } from '../application/invites.js';
import { SessionService } from '../application/sessions.js';
import { SettingsService } from '../application/settings.js';

const E = IdentityEndpoints;
const A = IdentityAdminEndpoints;

type Body<T extends { body?: z.ZodType }> = z.output<NonNullable<T['body']>>;

/** 契约里接口的 body / params 是可选属性；这里取出来并确认存在。 */
function schema<S extends z.ZodType>(value: S | undefined): S {
  if (!value) throw new Error('契约接口缺少 schema');
  return value;
}

/** 客户端 IP（反向代理后面需配置 HTTP_TRUST_PROXY，否则拿到的是代理的地址）。 */
function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

@Controller('api/v1')
export class IdentityController {
  constructor(
    @Inject(AccountService) private readonly accounts: AccountService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  // ---------- 注册 / 登录 / 退出 ----------

  @Post('auth/register')
  @RequireAuth(E.register.auth)
  async register(
    @Body(new ContractPipe(schema(E.register.body))) body: Body<typeof E.register>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { response, created } = await this.accounts.register(body, clientIp(req));
    // 新建账号 201；同一次注册的重试（账号已建好）200
    res.status(created ? 201 : 200);
    return response;
  }

  @Post('auth/login')
  @HttpCode(200)
  @RequireAuth(E.login.auth)
  login(
    @Body(new ContractPipe(schema(E.login.body))) body: Body<typeof E.login>,
    @Req() req: Request,
  ): Promise<AuthResponse> {
    return this.accounts.login(body, clientIp(req));
  }

  @Post('auth/logout')
  @HttpCode(204)
  @RequireAuth(E.logout.auth)
  async logout(@CurrentPrincipal() me: AuthPrincipal): Promise<void> {
    await this.accounts.logout(me.userId, me.sessionId);
  }

  // ---------- 当前用户与登录设备 ----------

  @Get('me')
  @RequireAuth(E.me.auth)
  me(@CurrentPrincipal() me: AuthPrincipal): Promise<CurrentUser> {
    return this.accounts.currentUser(me.userId);
  }

  @Get('me/sessions')
  @RequireAuth(E.listSessions.auth)
  async listSessions(@CurrentPrincipal() me: AuthPrincipal): Promise<{ items: SessionSummary[] }> {
    return { items: await this.sessions.list(me.userId, me.sessionId) };
  }

  @Delete('me/sessions/:sessionId')
  @HttpCode(204)
  @RequireAuth(E.revokeSession.auth)
  async revokeSession(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(E.revokeSession.params))) params: { sessionId: string },
  ): Promise<void> {
    await this.accounts.revokeSession(me.userId, params.sessionId);
  }

  // ---------- 资料、通知设置、界面偏好 ----------

  @Get('me/profile')
  @RequireAuth(E.getProfile.auth)
  getProfile(@CurrentPrincipal() me: AuthPrincipal): Promise<Profile> {
    return this.settings.requireProfile(me.userId);
  }

  @Patch('me/profile')
  @RequireAuth(E.updateProfile.auth)
  updateProfile(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(E.updateProfile.body))) body: Body<typeof E.updateProfile>,
  ): Promise<Profile> {
    return this.settings.updateProfile(me.userId, body);
  }

  @Get('me/notification-settings')
  @RequireAuth(E.getNotificationSettings.auth)
  getNotificationSettings(@CurrentPrincipal() me: AuthPrincipal): Promise<NotificationSettings> {
    return this.settings.requireNotificationSettings(me.userId);
  }

  @Patch('me/notification-settings')
  @RequireAuth(E.updateNotificationSettings.auth)
  updateNotificationSettings(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(E.updateNotificationSettings.body)))
    body: Body<typeof E.updateNotificationSettings>,
  ): Promise<NotificationSettings> {
    return this.settings.updateNotificationSettings(me.userId, body);
  }

  @Get('me/preferences')
  @RequireAuth(E.getPreferences.auth)
  getPreferences(@CurrentPrincipal() me: AuthPrincipal): Promise<UserPreferences> {
    return this.settings.getPreferences(me.userId);
  }

  @Patch('me/preferences')
  @RequireAuth(E.updatePreferences.auth)
  updatePreferences(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(E.updatePreferences.body)))
    body: Body<typeof E.updatePreferences>,
  ): Promise<UserPreferences> {
    return this.settings.updatePreferences(me.userId, body);
  }

  // ---------- 注销 ----------

  @Delete('me')
  @HttpCode(202)
  @RequireAuth(E.deleteAccount.auth)
  async deleteAccount(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(E.deleteAccount.body))) body: Body<typeof E.deleteAccount>,
  ): Promise<{ status: 'deleting' }> {
    await this.accounts.requestDeletion(me.userId, body.password);
    return { status: 'deleting' };
  }
}

@Controller('api/v1/admin')
export class IdentityAdminController {
  constructor(@Inject(InviteService) private readonly invites: InviteService) {}

  @Post('invites')
  @RequireAuth(A.createInvite.auth)
  createInvite(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(A.createInvite.body))) body: Body<typeof A.createInvite>,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<Invite> {
    return this.invites.create(body.expiresInDays, me.userId, idempotencyKey);
  }

  @Get('invites')
  @RequireAuth(A.listInvites.auth)
  async listInvites(): Promise<{ items: Invite[] }> {
    return { items: await this.invites.list() };
  }
}
