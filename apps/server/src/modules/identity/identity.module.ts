import { PluginsController } from './http/plugins.controller.js';
import { MembershipService } from './application/membership.js';
import { MembershipController } from './http/membership.controller.js';
import { IDENTITY_MEMBERSHIP_READ_PORT } from './tokens.js';
/**
 * identity 模块装配（D-L0-06）。说明见 docs/backend/identity.md。
 */
import { Module } from '@nestjs/common';
import { MediaModule } from '../media/index.js';
import {
  CLOCK,
  DATABASE,
  SESSION_VERIFIER,
  type Clock,
  type Database,
} from '../../platform/index.js';
import { AccountService, LOGIN_THROTTLE, PASSWORD_HASHER } from './application/accounts.js';
import { IdentityCommands } from './application/commands.js';
import { DeletionService } from './application/deletion.js';
import { PurgeVerifier } from './application/purge-verifier.js';
import { InviteService } from './application/invites.js';
import { SessionService } from './application/sessions.js';
import { SettingsService } from './application/settings.js';
import { IdentityAdminController, IdentityController } from './http/identity.controller.js';
import { AnnouncementService, ReleaseService } from './application/announcements.js';
import {
  AnnouncementAdminController,
  AnnouncementController,
} from './http/announcements.controller.js';
import { LoginThrottle } from './infra/login-throttle.js';
import { PasswordHasher } from './infra/password-hasher.js';
import {
  IDENTITY_ACCOUNT_STATUS_PORT,
  IDENTITY_DIRECTORY_PORT,
  IDENTITY_READ_PORT,
  IDENTITY_SESSION_READ_PORT,
  IDENTITY_SETTINGS_WRITE_PORT,
  IDENTITY_USER_STATUS_PORT,
} from './tokens.js';
import { UserStatusService } from './application/user-status.js';
import { UserStatusController } from './http/user-status.controller.js';

@Module({
  imports: [MediaModule],
  controllers: [
    IdentityController,
    IdentityAdminController,
    AnnouncementController,
    AnnouncementAdminController,
    UserStatusController,
    MembershipController,
    PluginsController,
  ],
  providers: [
    { provide: PASSWORD_HASHER, useValue: new PasswordHasher() },
    {
      provide: LOGIN_THROTTLE,
      useFactory: (db: Database, clock: Clock) => new LoginThrottle(db, clock),
      inject: [DATABASE, CLOCK],
    },
    SessionService,
    SettingsService,
    AccountService,
    InviteService,
    DeletionService,
    PurgeVerifier,
    IdentityCommands,
    AnnouncementService,
    ReleaseService,
    // 平台鉴权守卫按这个令牌找令牌校验器（kernel.md 第 10 节）
    { provide: SESSION_VERIFIER, useExisting: SessionService },
    { provide: IDENTITY_SESSION_READ_PORT, useExisting: SessionService },
    { provide: IDENTITY_READ_PORT, useExisting: SettingsService },
    { provide: IDENTITY_ACCOUNT_STATUS_PORT, useExisting: SettingsService },
    { provide: IDENTITY_DIRECTORY_PORT, useExisting: SettingsService },
    { provide: IDENTITY_SETTINGS_WRITE_PORT, useExisting: SettingsService },
    MembershipService,
    { provide: IDENTITY_MEMBERSHIP_READ_PORT, useExisting: MembershipService },
    UserStatusService,
    { provide: IDENTITY_USER_STATUS_PORT, useExisting: UserStatusService },
  ],
  exports: [
    SESSION_VERIFIER,
    IDENTITY_READ_PORT,
    IDENTITY_SESSION_READ_PORT,
    IDENTITY_ACCOUNT_STATUS_PORT,
    IDENTITY_DIRECTORY_PORT,
    IDENTITY_SETTINGS_WRITE_PORT,
    IDENTITY_USER_STATUS_PORT,
    IDENTITY_MEMBERSHIP_READ_PORT,
    IdentityCommands,
  ],
})
export class IdentityModule {}
