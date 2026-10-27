import { memo, type ReactNode } from 'react';
import { Flower, Heart, Moon, MusicNote, Star } from './old-icons.js';
import type { CharacterSummary } from '@weiban/contracts';
import { avatarForeground, avatarLetters, avatarPaletteIndex } from '@weiban/client-core';
import { useAuth } from '../app/auth.js';
import { useCustomAvatar } from '../app/chat.js';
import { CachedPicture, recallCharacterAvatar, rememberCharacterAvatar } from './avatar-cache.js';
import { useCharacterProfile } from '../data/character-profile.js';
type AvatarRole = Pick<CharacterSummary, 'characterId' | 'name' | 'avatar'>;
const patterns = { star: Star, heart: Heart, note: MusicNote, moon: Moon, flower: Flower };
/** 列表头像每帧都会被父组件重渲染一次；memo 后滚动时图片子树不再重渲染。 */
export const CharacterAvatar = memo(function CharacterAvatar({
  id,
  profile,
  size = 48,
  radius = 4,
}: {
  id: string;
  profile?: AvatarRole;
  size?: number;
  /** 旧版圆角（规格 3.12）：列表 / 聊天 4，群成员与「我」页 6，资料页 8。 */
  radius?: number;
}) {
  const { session } = useAuth();
  // U8：只订阅自定义头像，不再订阅整个同步状态（每次状态变化都让列表里所有头像重渲染）。
  const privateId = useCustomAvatar(id);
  const ownerKey = `${session?.user.userId}:${session?.session.sessionId}`;
  return profile?.characterId === id ? (
    <Artwork
      key={`${ownerKey}:${id}`}
      role={profile}
      privateId={privateId}
      size={size}
      radius={radius}
    />
  ) : (
    <RequestedAvatar
      key={`${ownerKey}:${id}`}
      id={id}
      privateId={privateId}
      size={size}
      radius={radius}
    />
  );
});
function RequestedAvatar({
  id,
  privateId,
  size,
  radius,
}: {
  id: string;
  privateId?: string | null;
  size: number;
  radius: number;
}) {
  const remote = useCharacterProfile(id);
  return (
    <Artwork
      role={remote.data?.characterId === id ? remote.data : undefined}
      id={id}
      privateId={privateId}
      size={size}
      radius={radius}
      loading={remote.loading}
    />
  );
}
function Artwork({
  role,
  id = role?.characterId ?? '',
  privateId,
  size,
  radius,
  loading = false,
}: {
  role?: AvatarRole;
  id?: string;
  privateId?: string | null;
  size: number;
  radius: number;
  loading?: boolean;
}) {
  const display = role?.avatar.display;
  const letters = role ? avatarLetters(role.name, display?.avatarText) : loading ? '…' : '—';
  const palette = String(avatarPaletteIndex(id)).padStart(2, '0');
  const supplied = display?.supportColors[0];
  const background = supplied ?? `var(--wb-support-${palette}-bg)`;
  const color = supplied ? avatarForeground(supplied) : `var(--wb-support-${palette}-on)`;
  const patternName = display?.avatarPattern ?? 'star';
  const Icon = !role || patternName === 'none' ? null : patterns[patternName];
  // 资料还没读到时先用上次这个角色的头像：不先退回文字占位，图也能从缓存直接出。
  // 有资料时以资料为准（image 为 null 就是真没有图片，不能拿旧缓存顶上）。
  const pictureId =
    privateId ?? role?.avatar.image?.mediaId ?? (role ? undefined : recallCharacterAvatar(id));
  const hintUrl = role?.avatar.image?.mediaId === pictureId ? role?.avatar.image?.url : undefined;
  if (role || privateId)
    rememberCharacterAvatar(id, privateId ?? role?.avatar.image?.mediaId ?? null);
  // U8：角落小星星是 SVG 遮罩图，Chrome 每画一个都要跑一遍 SVG 文档的样式 / 布局 / 绘制；
  // 有头像图片时它被图片整个盖住，不再画（图片加载失败时作为占位一起显示）。
  // 聊天页一次重绘几十个头像时，这部分占了绘制时间的近一半。
  const pattern =
    Icon && size >= 40 ? (
      <Icon
        aria-hidden="true"
        weight="fill"
        size={size * 0.22}
        style={{
          position: 'absolute',
          right: size * 0.12,
          top: size * 0.12,
          color: display?.supportColors[1] ?? color,
          opacity: display?.supportColors[1] ? 1 : 0.55,
        }}
      />
    ) : null;
  return (
    <span
      className="character-avatar"
      role="img"
      aria-label={role ? `${role.name}头像` : loading ? '正在读取角色头像' : '角色头像暂不可用'}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background,
        color,
        fontSize: size * (Array.from(letters).length === 1 ? 0.44 : 0.34),
        fontWeight: 'var(--wb-font-weight-semibold)',
      }}
    >
      <span aria-hidden="true">{letters}</span>
      {pictureId ? (
        // 资料里的 image.url 每次取资料都可能换一个签名，直接用会让浏览器重下图片；按 mediaId 复用。
        <AvatarPicture
          key={pictureId}
          mediaId={pictureId}
          hintUrl={hintUrl}
          size={size}
          fallback={pattern}
        />
      ) : (
        pattern
      )}
    </span>
  );
}
function AvatarPicture({
  mediaId,
  hintUrl,
  size,
  fallback,
}: {
  mediaId: string;
  hintUrl?: string;
  size: number;
  fallback?: ReactNode;
}) {
  return (
    <CachedPicture
      mediaId={mediaId}
      hintUrl={hintUrl}
      width={size}
      height={size}
      fallback={fallback}
    />
  );
}
