/**
 * 鉴权守卫骨架（security-and-privacy.md 第 2 节、ADR-0006）。
 *
 * - 每个接口用 @RequireAuth('none' | 'user' | 'admin') 标明登录要求，取值与契约 defineEndpoint 的 auth 一致。
 *   **没标的接口默认要求 user**（默认拒绝，防止忘写导致接口裸奔）。
 * - 令牌从 `Authorization: Bearer <令牌>` 读取（不读 URL、不读 Cookie）。
 * - 「令牌是否有效、属于谁」由 identity 模块实现 SessionVerifier 并在装配时以 SESSION_VERIFIER 提供；
 *   平台内核不依赖 identity（R2）。identity 还没接入时，所有需要登录的接口一律 401。
 * - 通过后在请求上挂 principal，控制器用 @CurrentPrincipal() 取；日志上下文自动带 userId。
 */
import {
  createParamDecorator,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { AuthLevel } from '@weiban/contracts';
import type { Request } from 'express';
import { setLogContextField } from '../logging/log-context.js';
import { AppError } from '../http/app-error.js';

export const SESSION_VERIFIER = Symbol('weiban.platform.session-verifier');
const AUTH_LEVEL_KEY = 'weiban:auth-level';
const SCOPE_KEY = 'weiban:required-scope';

/** 管理员 API key 的作用域（identity.admin_api_keys.scope 的取值）。 */
export const SCOPE_ROLE_REQUESTS_COMPLETE = 'role-requests:complete' as const;
export const SCOPE_MUSE_WEIBO_PUBLISH = 'muse-weibo:publish' as const;

export interface AuthPrincipal {
  userId: string;
  sessionId: string;
  role: 'user' | 'admin';
  /** 是否为管理会话（管理后台登录产生，12 小时过期）。 */
  adminSession: boolean;
  /**
   * API key 的作用域；会话登录为 null（不受限）。
   * 带 scope 的 key 只能调标注了同一 scope 的接口（fail-closed）。
   */
  scope?: string | null;
}

/** 由 identity 模块实现：校验令牌（只比对哈希）并返回身份；无效、过期、已作废返回 null。 */
export interface SessionVerifier {
  verify(token: string, level: Exclude<AuthLevel, 'none'>): Promise<AuthPrincipal | null>;
}

/** 标注接口的登录要求（类或方法上均可，方法上的优先）。 */
export const RequireAuth = (level: AuthLevel) => SetMetadata(AUTH_LEVEL_KEY, level);

/**
 * 标注接口要求的作用域（类或方法上均可，方法上的优先）。
 * 只有带 scope 的 API key 受它约束：key 的 scope 必须与标注一致，否则 403；
 * 没有标注 scope 的接口一律不接受带 scope 的 key（防止一把只给结案的 key 被拿去调别的接口）。
 * 会话登录（scope 为 null）不受它约束。
 */
export const RequireScope = (scope: string) => SetMetadata(SCOPE_KEY, scope);

type RequestWithPrincipal = Request & { principal?: AuthPrincipal };

export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1] ?? null;
}

export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolveVerifier: () => SessionVerifier | null,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const level =
      this.reflector.getAllAndOverride<AuthLevel | undefined>(AUTH_LEVEL_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'user';
    if (level === 'none') return true;

    const request = context.switchToHttp().getRequest<RequestWithPrincipal>();
    const token = extractBearerToken(request.header('authorization'));
    if (!token) throw new AppError('unauthenticated', '请先登录');
    const verifier = this.resolveVerifier();
    const principal = verifier ? await verifier.verify(token, level) : null;
    if (!principal) throw new AppError('unauthenticated', '登录已失效，请重新登录');
    if (level === 'admin' && (principal.role !== 'admin' || !principal.adminSession)) {
      throw new AppError('forbidden', '需要管理员身份');
    }
    // 带 scope 的 API key：接口必须标注同一 scope，否则拒绝（fail-closed）。
    if (principal.scope != null) {
      const requiredScope = this.reflector.getAllAndOverride<string | undefined>(SCOPE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (requiredScope !== principal.scope) {
        throw new AppError('forbidden', '该凭证无权调用此接口');
      }
    }
    request.principal = principal;
    setLogContextField('userId', principal.userId);
    return true;
  }
}

/** 控制器参数装饰器：取当前登录者。只能用在需要登录的接口上。 */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthPrincipal => {
    const principal = context.switchToHttp().getRequest<RequestWithPrincipal>().principal;
    if (!principal) throw new AppError('unauthenticated', '请先登录');
    return principal;
  },
);
