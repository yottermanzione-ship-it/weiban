import {
  Body,
  Controller,
  Post,
  Get,
  Query,
  Param,
  UploadedFile,
  UseInterceptors,
  Res,
  Inject,
  HttpCode,
  Headers,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  MediaEndpoints,
  MediaAdminEndpoints,
  MediaExtraEndpoints,
  MEDIA_LIMITS,
  type MediaPurpose,
} from '@weiban/contracts';
import {
  AppError,
  RequireAuth,
  CurrentPrincipal,
  ContractPipe,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { MediaService } from '../application/media.js';
import { LinkPreviewService } from '../application/link-preview.js';
const params = new ContractPipe(MediaEndpoints.getMedia.params!);

/** multipart 里的可选表单字段 durationMs（语音时长，毫秒）。 */
function parseDuration(body: { durationMs?: unknown } | undefined): number | null {
  const raw = body?.durationMs;
  if (raw === undefined || raw === null || raw === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new AppError('bad_request', '语音时长格式不正确');
  return value;
}

const uploadInterceptor = FileInterceptor('file', {
  limits: { fileSize: MEDIA_LIMITS.imageMaxBytes, files: 1, fields: 1, fieldSize: 32 },
});

@Controller('api/v1/media')
export class MediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}
  @Post()
  @HttpCode(201)
  @RequireAuth('user')
  @UseInterceptors(uploadInterceptor)
  upload(
    @CurrentPrincipal() me: AuthPrincipal,
    @Query(new ContractPipe(MediaEndpoints.upload.query!)) query: { purpose: MediaPurpose },
    @UploadedFile() file: { buffer: Buffer; mimetype: string },
    @Body() body: { durationMs?: unknown },
  ) {
    return this.media.upload(me.userId, query.purpose, file, { durationMs: parseDuration(body) });
  }
  @Get(':mediaId')
  @RequireAuth('user')
  get(@CurrentPrincipal() me: AuthPrincipal, @Param(params) p: { mediaId: string }) {
    return this.media.getMedia(me.userId, p.mediaId);
  }
  @Get(':mediaId/transcript')
  @RequireAuth('user')
  transcript(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(MediaExtraEndpoints.getTranscript.params!)) p: { mediaId: string },
  ) {
    return this.media.getTranscriptForUser(me.userId, p.mediaId);
  }
  @Get(':mediaId/content')
  @RequireAuth(MediaEndpoints.download.auth)
  async content(
    @Param(params) p: { mediaId: string },
    @Query(new ContractPipe(MediaEndpoints.download.query!)) q: { token: string },
    @Headers('accept') accept: string | undefined,
    @Res() res: Response,
  ) {
    const media = await this.media.download(p.mediaId, q.token, accept);
    res.setHeader('Content-Type', media.mimeType);
    res.setHeader('Vary', 'Accept');
    res.setHeader('Content-Length', media.body.length);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.end(media.body);
  }
}

@Controller('api/v1/admin/media')
export class MediaAdminController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}
  @Post()
  @HttpCode(201)
  @RequireAuth('admin')
  @UseInterceptors(uploadInterceptor)
  upload(
    @CurrentPrincipal() me: AuthPrincipal,
    @Query(new ContractPipe(MediaAdminEndpoints.adminUpload.query!))
    query: { purpose: MediaPurpose },
    @UploadedFile() file: { buffer: Buffer; mimetype: string },
    @Body() body: { durationMs?: unknown },
  ) {
    return this.media.upload(me.userId, query.purpose, file, {
      admin: true,
      durationMs: parseDuration(body),
    });
  }
}

@Controller('api/v1/links')
export class LinkPreviewController {
  constructor(@Inject(LinkPreviewService) private readonly links: LinkPreviewService) {}
  @Post('preview')
  @HttpCode(200)
  @RequireAuth('user')
  preview(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(MediaExtraEndpoints.previewLink.body!)) body: { url: string },
  ) {
    return this.links.previewForUser(me.userId, body.url);
  }
}
