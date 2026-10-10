import type { SyncPort } from '@weiban/contracts';

export const MEDIA_STORAGE = Symbol('weiban.media.storage');
export const MEDIA_READ_PORT = Symbol('weiban.media.read');
/** 3.0（T-069）：契约 MediaSystemPort。 */
export const MEDIA_SYSTEM_PORT = Symbol('weiban.media.system');
/** 3.0：契约 MediaTranscriptPort。 */
export const MEDIA_TRANSCRIPT_PORT = Symbol('weiban.media.transcript');
/** 3.0：契约 MediaAssetReadPort。 */
export const MEDIA_ASSET_READ_PORT = Symbol('weiban.media.asset-read');
/** 3.0：契约 LinkPreviewPort（链接可访问性检查，供 AI 与作品链接库使用）。 */
export const LINK_PREVIEW_PORT = Symbol('weiban.media.link-preview');
/** chat 发送校验：用户发的表情是否可用（见 MediaStickerCheck）。 */
export const MEDIA_STICKER_CHECK = Symbol('weiban.media.sticker-check');

export interface MediaStickerCheck {
  /** 用户发送表情消息前校验：library = 启用且用户可见的库内表情；user = 本人的表情。mediaId 必须对应。 */
  canSendSticker(
    userId: string,
    input: { stickerId: string; source: 'library' | 'user'; mediaId: string },
  ): Promise<boolean>;
}

/**
 * 以下三个由装配入口（app.module.ts）绑定：media 是底层，不能 import realtime / chat / characters（会形成循环或反向依赖）。
 * 未绑定时：不发同步更新；「从消息添加表情」返回 not_found；音色名称不做真人姓名检查（启动日志不报错，生产环境必须绑定）。
 */
export const MEDIA_SYNC = Symbol('weiban.media.sync');
export type MediaSync = Pick<SyncPort, 'appendUpdate'>;

export const MEDIA_MESSAGE_LOOKUP = Symbol('weiban.media.message-lookup');
export interface MediaMessageLookup {
  /**
   * 读取用户可见的一条消息里的媒体（图片 / 表情）。不是该用户会话里的消息、已撤回或不是图片 / 表情时返回 null。
   */
  findMessageMedia(
    userId: string,
    conversationId: string,
    messageId: string,
  ): Promise<{ mediaId: string } | null>;
}

export const MEDIA_REAL_PERSON_NAMES = Symbol('weiban.media.real-person-names');
export interface MediaRealPersonNames {
  /** 已录入的真人角色（basis = real_person）的姓名。 */
  listRealPersonNames(): Promise<string[]>;
}

/**
 * 注销核验（T-080，scripts/verify-user-purged）：对象存储里没有对应元数据行的「孤儿」文件。
 * 存储键是服务器生成的 `{uuid}.sealed`，不按用户分目录；注销删完元数据后用户文件就无法再归属，
 * 所以核验的口径是「全库不存在孤儿文件」（10 分钟内的上传中文件可能短暂出现）。
 */
export const MEDIA_STORAGE_AUDIT = Symbol('weiban.media.storage-audit');
export interface MediaStorageAudit {
  /** listed = false 表示存储驱动不支持列举（无法核验）。 */
  findOrphanKeys(limit?: number): Promise<{ listed: boolean; total: number; orphans: string[] }>;
}
