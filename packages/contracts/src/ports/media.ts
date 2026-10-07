import type { MediaObject } from '../http/media.js';
/** media 提供：验证头像归属及取得短期访问链接。不存在/无权访问时统一 not_found。 */
export interface MediaReadPort {
  getMedia(userId: string, mediaId: string): Promise<MediaObject>;
}
