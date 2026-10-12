/**
 * 公告与更新说明的 HTTP 接口，一一对应契约 http/announcements.ts（3.2）。
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  AnnouncementAdminEndpoints,
  AnnouncementEndpoints,
  ReleaseAdminEndpoints,
  ReleaseEndpoints,
  type AdminAnnouncement,
  type AdminReleaseNote,
  type AppVersionPolicy,
  type ReleasePlatform,
} from '@weiban/contracts';
import type { z } from 'zod';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { AnnouncementService, ReleaseService } from '../application/announcements.js';

const U = AnnouncementEndpoints;
const UA = AnnouncementAdminEndpoints;
const R = ReleaseEndpoints;
const RA = ReleaseAdminEndpoints;

type Out<S extends z.ZodType | undefined> = z.output<NonNullable<S>>;

function schema<S extends z.ZodType>(value: S | undefined): S {
  if (!value) throw new Error('契约接口缺少 schema');
  return value;
}

@Controller('api/v1')
export class AnnouncementController {
  constructor(
    @Inject(AnnouncementService) private readonly announcements: AnnouncementService,
    @Inject(ReleaseService) private readonly releases: ReleaseService,
  ) {}

  @Get('announcements')
  @RequireAuth(U.listAnnouncements.auth)
  list(
    @CurrentPrincipal() me: AuthPrincipal,
    @Query(new ContractPipe(schema(U.listAnnouncements.query)))
    q: Out<typeof U.listAnnouncements.query>,
  ) {
    return this.announcements.listForUser(me.userId, q.platform);
  }

  @Post('announcements/read')
  @HttpCode(204)
  @RequireAuth(U.markAnnouncementsRead.auth)
  async markRead(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(U.markAnnouncementsRead.body)))
    body: Out<typeof U.markAnnouncementsRead.body>,
  ): Promise<void> {
    await this.announcements.markRead(me.userId, body.announcementIds);
  }

  @Get('app/version-check')
  @RequireAuth(R.checkVersion.auth)
  checkVersion(
    @Query(new ContractPipe(schema(R.checkVersion.query))) q: Out<typeof R.checkVersion.query>,
  ) {
    return this.releases.checkVersion(q.platform, q.versionCode);
  }

  @Get('app/release-notes')
  @RequireAuth(R.listReleaseNotes.auth)
  listNotes(
    @CurrentPrincipal() me: AuthPrincipal,
    @Query(new ContractPipe(schema(R.listReleaseNotes.query)))
    q: Out<typeof R.listReleaseNotes.query>,
  ) {
    return this.releases.listForUser(me.userId, q.platform, q.versionCode);
  }

  @Post('app/release-notes/seen')
  @HttpCode(204)
  @RequireAuth(R.markReleaseNotesSeen.auth)
  async markSeen(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(R.markReleaseNotesSeen.body)))
    body: Out<typeof R.markReleaseNotesSeen.body>,
  ): Promise<void> {
    await this.releases.markSeen(me.userId, body.platform, body.versionCode);
  }
}

@Controller('api/v1/admin')
export class AnnouncementAdminController {
  constructor(
    @Inject(AnnouncementService) private readonly announcements: AnnouncementService,
    @Inject(ReleaseService) private readonly releases: ReleaseService,
  ) {}

  // ---------- 公告 ----------

  @Get('announcements')
  @RequireAuth(UA.listAnnouncements.auth)
  async list(): Promise<{ items: AdminAnnouncement[] }> {
    return { items: await this.announcements.listAdmin() };
  }

  @Post('announcements')
  @HttpCode(201)
  @RequireAuth(UA.createAnnouncement.auth)
  create(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(UA.createAnnouncement.body)))
    body: Out<typeof UA.createAnnouncement.body>,
  ): Promise<AdminAnnouncement> {
    return this.announcements.create(me.userId, body);
  }

  @Patch('announcements/:announcementId')
  @RequireAuth(UA.updateAnnouncement.auth)
  update(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(UA.updateAnnouncement.params))) p: { announcementId: string },
    @Body(new ContractPipe(schema(UA.updateAnnouncement.body)))
    body: Out<typeof UA.updateAnnouncement.body>,
  ): Promise<AdminAnnouncement> {
    return this.announcements.update(me.userId, p.announcementId, body);
  }

  @Post('announcements/:announcementId/publish')
  @HttpCode(200)
  @RequireAuth(UA.publishAnnouncement.auth)
  publish(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(UA.publishAnnouncement.params))) p: { announcementId: string },
  ): Promise<AdminAnnouncement> {
    return this.announcements.publish(me.userId, p.announcementId);
  }

  @Post('announcements/:announcementId/withdraw')
  @HttpCode(200)
  @RequireAuth(UA.withdrawAnnouncement.auth)
  withdraw(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(UA.withdrawAnnouncement.params))) p: { announcementId: string },
  ): Promise<AdminAnnouncement> {
    return this.announcements.withdraw(me.userId, p.announcementId);
  }

  @Delete('announcements/:announcementId')
  @HttpCode(204)
  @RequireAuth(UA.deleteAnnouncement.auth)
  async remove(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(UA.deleteAnnouncement.params))) p: { announcementId: string },
  ): Promise<void> {
    await this.announcements.remove(me.userId, p.announcementId);
  }

  // ---------- 更新说明 ----------

  @Get('release-notes')
  @RequireAuth(RA.listReleaseNotes.auth)
  async listNotes(
    @Query(new ContractPipe(schema(RA.listReleaseNotes.query)))
    q: Out<typeof RA.listReleaseNotes.query>,
  ): Promise<{ items: AdminReleaseNote[] }> {
    return { items: await this.releases.listNotes(q.platform) };
  }

  @Post('release-notes')
  @HttpCode(201)
  @RequireAuth(RA.createReleaseNote.auth)
  createNote(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(RA.createReleaseNote.body)))
    body: Out<typeof RA.createReleaseNote.body>,
  ): Promise<AdminReleaseNote> {
    return this.releases.createNote(me.userId, body);
  }

  @Patch('release-notes/:releaseNoteId')
  @RequireAuth(RA.updateReleaseNote.auth)
  updateNote(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(RA.updateReleaseNote.params))) p: { releaseNoteId: string },
    @Body(new ContractPipe(schema(RA.updateReleaseNote.body)))
    body: Out<typeof RA.updateReleaseNote.body>,
  ): Promise<AdminReleaseNote> {
    return this.releases.updateNote(me.userId, p.releaseNoteId, body);
  }

  @Delete('release-notes/:releaseNoteId')
  @HttpCode(204)
  @RequireAuth(RA.deleteReleaseNote.auth)
  async deleteNote(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(RA.deleteReleaseNote.params))) p: { releaseNoteId: string },
  ): Promise<void> {
    await this.releases.deleteNote(me.userId, p.releaseNoteId);
  }

  // ---------- 版本策略 ----------

  @Get('app-version-policies')
  @RequireAuth(RA.listVersionPolicies.auth)
  async listPolicies(): Promise<{ items: AppVersionPolicy[] }> {
    return { items: await this.releases.listPolicies() };
  }

  @Put('app-version-policies/:platform')
  @RequireAuth(RA.updateVersionPolicy.auth)
  updatePolicy(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(RA.updateVersionPolicy.params)))
    p: { platform: ReleasePlatform },
    @Body(new ContractPipe(schema(RA.updateVersionPolicy.body)))
    body: Out<typeof RA.updateVersionPolicy.body>,
  ): Promise<AppVersionPolicy> {
    return this.releases.updatePolicy(me.userId, p.platform, body);
  }
}
