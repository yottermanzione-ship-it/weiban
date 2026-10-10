/** 导入（契约 ImporterEndpoints），T-079。 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ImporterEndpoints as E,
  MEDIA_LIMITS,
  type RecognizedDialogueLine,
} from '@weiban/contracts';
import type { z } from 'zod';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { ImporterService, type UploadedFile as Uploaded } from '../application/importer.service.js';

const jobParams = new ContractPipe(E.getJob.params!);
const uploadInterceptor = FileInterceptor('file', {
  limits: {
    fileSize: Math.max(MEDIA_LIMITS.importFileMaxBytes, MEDIA_LIMITS.imageMaxBytes),
    files: 1,
    fields: 0,
  },
});

@Controller('api/v1/imports')
@RequireAuth('user')
export class ImporterController {
  constructor(@Inject(ImporterService) private readonly importer: ImporterService) {}

  @Post()
  @HttpCode(201)
  create(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(E.createJob.body!)) body: unknown,
  ) {
    return this.importer.createJob(p.userId, body);
  }

  @Get()
  list(@CurrentPrincipal() p: AuthPrincipal) {
    return this.importer.listJobs(p.userId);
  }

  @Post(':jobId/files')
  @HttpCode(200)
  @UseInterceptors(uploadInterceptor)
  upload(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(jobParams) params: { jobId: string },
    @UploadedFile() file: Uploaded | undefined,
  ) {
    return this.importer.uploadFile(p.userId, params.jobId, file);
  }

  @Post(':jobId/files/done')
  @HttpCode(200)
  finish(@CurrentPrincipal() p: AuthPrincipal, @Param(jobParams) params: { jobId: string }) {
    return this.importer.finishUpload(p.userId, params.jobId);
  }

  @Get(':jobId')
  get(@CurrentPrincipal() p: AuthPrincipal, @Param(jobParams) params: { jobId: string }) {
    return this.importer.getJob(p.userId, params.jobId);
  }

  @Get(':jobId/dialogue')
  dialogue(@CurrentPrincipal() p: AuthPrincipal, @Param(jobParams) params: { jobId: string }) {
    return this.importer.getDialogue(p.userId, params.jobId);
  }

  @Post(':jobId/dialogue/confirm')
  @HttpCode(200)
  confirm(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(jobParams) params: { jobId: string },
    @Body(new ContractPipe(E.confirmDialogue.body!))
    body: { lines?: z.infer<typeof RecognizedDialogueLine>[] },
  ) {
    return this.importer.confirmDialogue(p.userId, params.jobId, body);
  }

  @Post(':jobId/speaker')
  @HttpCode(200)
  speaker(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(jobParams) params: { jobId: string },
    @Body(new ContractPipe(E.selectSpeaker.body!)) body: { speaker: string },
  ) {
    return this.importer.selectSpeaker(p.userId, params.jobId, body.speaker);
  }

  @Post(':jobId/start')
  @HttpCode(200)
  start(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(jobParams) params: { jobId: string },
    @Body(new ContractPipe(E.start.body!)) body: { keepRaw: boolean },
  ) {
    return this.importer.start(p.userId, params.jobId, body);
  }

  @Get(':jobId/result')
  result(@CurrentPrincipal() p: AuthPrincipal, @Param(jobParams) params: { jobId: string }) {
    return this.importer.getResult(p.userId, params.jobId);
  }

  @Put(':jobId/result')
  saveResult(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(jobParams) params: { jobId: string },
    @Body(new ContractPipe(E.saveResultDraft.body!)) body: unknown,
  ) {
    return this.importer.saveResultDraft(p.userId, params.jobId, body);
  }

  @Delete(':jobId')
  @HttpCode(204)
  async cancel(@CurrentPrincipal() p: AuthPrincipal, @Param(jobParams) params: { jobId: string }) {
    await this.importer.cancel(p.userId, params.jobId);
  }

  @Post(':jobId/raw/delete')
  @HttpCode(200)
  deleteRaw(@CurrentPrincipal() p: AuthPrincipal, @Param(jobParams) params: { jobId: string }) {
    return this.importer.deleteRaw(p.userId, params.jobId);
  }
}
