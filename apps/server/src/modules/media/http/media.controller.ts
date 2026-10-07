import {
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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  MediaEndpoints,
  MediaAdminEndpoints,
  MEDIA_LIMITS,
  type MediaPurpose,
} from '@weiban/contracts';
import {
  RequireAuth,
  CurrentPrincipal,
  ContractPipe,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { MediaService } from '../application/media.js';
const params = new ContractPipe(MediaEndpoints.getMedia.params!);
@Controller('api/v1/media')
export class MediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}
  @Post()
  @HttpCode(201)
  @RequireAuth('user')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MEDIA_LIMITS.imageMaxBytes, files: 1, fields: 0 },
    }),
  )
  upload(
    @CurrentPrincipal() me: AuthPrincipal,
    @Query(new ContractPipe(MediaEndpoints.upload.query!)) query: { purpose: MediaPurpose },
    @UploadedFile() file: { buffer: Buffer; mimetype: string },
  ) {
    return this.media.upload(me.userId, query.purpose, file);
  }
  @Get(':mediaId')
  @RequireAuth('user')
  get(@CurrentPrincipal() me: AuthPrincipal, @Param(params) p: { mediaId: string }) {
    return this.media.getMedia(me.userId, p.mediaId);
  }
  @Get(':mediaId/content')
  @RequireAuth(MediaEndpoints.download.auth)
  async content(
    @Param(params) p: { mediaId: string },
    @Query(new ContractPipe(MediaEndpoints.download.query!)) q: { token: string },
    @Res() res: Response,
  ) {
    const media = await this.media.download(p.mediaId, q.token);
    res.setHeader('Content-Type', media.mimeType);
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
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MEDIA_LIMITS.imageMaxBytes, files: 1, fields: 0 },
    }),
  )
  upload(
    @CurrentPrincipal() me: AuthPrincipal,
    @Query(new ContractPipe(MediaAdminEndpoints.adminUpload.query!))
    query: { purpose: 'character_avatar' },
    @UploadedFile() file: { buffer: Buffer; mimetype: string },
  ) {
    return this.media.upload(me.userId, query.purpose, file, true);
  }
}
