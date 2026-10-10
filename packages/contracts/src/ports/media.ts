import type { MediaObject, MediaPurpose } from '../http/media.js';
import type { Tx } from './common.js';

/** media 提供：验证头像归属及取得短期访问链接。不存在/无权访问时统一 not_found。 */
export interface MediaReadPort {
  getMedia(userId: string, mediaId: string): Promise<MediaObject>;
}

/**
 * 3.0：系统读写媒体（L5，D-L5-01）。提供方 media；调用方 model-access（取图给识图、存生成结果）、ai-runtime、
 * chat（校验用户发送的 mediaId 归属与用途）、moments、growth、library、importer、plaza。
 */
export interface MediaSystemPort {
  /** 校验某用户能否把这个媒体用于某用途（发消息、发朋友圈）；不属于本人或用途不符返回 false。 */
  canUse(userId: string, mediaId: string, allowedPurposes: MediaPurpose[]): Promise<boolean>;
  /** 读取原始字节（识图、语音识别、导入截图）。只在服务器内部使用。 */
  readBytes(mediaId: string): Promise<{ bytes: Uint8Array; mimeType: string }>;
  /** 保存系统生成的文件（角色发图、角色语音、宠物照片）。 */
  putObject(input: {
    ownerUserId: string | null;
    purpose: MediaPurpose;
    bytes: Uint8Array;
    mimeType: string;
    durationMs?: number;
  }): Promise<MediaObject>;
  /** 复制一份给另一用途（「添加到表情」、广场公开头像 plaza_avatar）。 */
  copyObject(input: {
    mediaId: string;
    ownerUserId: string | null;
    purpose: MediaPurpose;
  }): Promise<MediaObject>;
  /** 物理删除（导入截图随原文删除、作品删除时的公开头像）。 */
  deleteObject(mediaId: string, tx?: Tx): Promise<void>;
}

/** 3.0：语音转文字结果写入（MED-03）。提供方 media；调用方 ai-runtime。写入后 media 发 media.transcript_ready 更新。 */
export interface MediaTranscriptPort {
  setTranscript(input: {
    mediaId: string;
    status: 'ready' | 'failed' | 'unavailable';
    text: string | null;
  }): Promise<void>;
  getTranscript(
    mediaId: string,
  ): Promise<{ status: 'pending' | 'ready' | 'failed' | 'unavailable'; text: string | null }>;
}

/** 3.0：素材库读取（ai-runtime 选表情包、growth 选卡面、calls 读兜底音频）。 */
export interface MediaAssetReadPort {
  listStickersForCharacter(
    characterId: string,
  ): Promise<Array<{ stickerId: string; mediaId: string; description: string }>>;
  getVoice(voiceId: string): Promise<{
    voiceId: string;
    name: string;
    providerVoiceKey: string;
    modelKey: string;
    enabled: boolean;
    careFallbackMediaId: string | null;
  } | null>;
  listCardTemplates(
    kind: string,
    portraitFreeOnly: boolean,
  ): Promise<Array<{ templateId: string; mediaId: string }>>;
}

/** 3.0：链接预览与可访问性检查（MED-05）。提供方 media。 */
export interface LinkPreviewPort {
  preview(url: string): Promise<{
    reachable: boolean;
    title: string | null;
    description: string | null;
    source: string | null;
  }>;
}
