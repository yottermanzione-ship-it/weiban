import type { Profile } from '@weiban/contracts';
import { avatarLetters } from '@weiban/client-core';
import { useAuth } from '../app/auth.js';
import { CachedPicture, recallMyAvatar, rememberMyAvatar, useMediaUrl } from './avatar-cache.js';
export function UserAvatar({
  profile,
  size = 40,
  radius = 4,
  imageClassName,
}: {
  profile?: Profile;
  size?: number;
  radius?: number;
  imageClassName?: string;
}) {
  const { session } = useAuth();
  const userId = session?.user.userId;
  if (profile) rememberMyAvatar(userId, profile.avatarMediaId ?? null);
  // F1-6：资料未读到前先用本次打开里记住的头像；都没有时只画底色，不先闪昵称缩写。
  const mediaId = profile ? (profile.avatarMediaId ?? null) : recallMyAvatar(userId);
  const url = useMediaUrl(mediaId);
  const letters = profile ? avatarLetters(profile.nickname ?? '我') : '';
  return (
    <span
      className="user-message-avatar"
      role="img"
      aria-label="我的头像"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        fontSize: size * (Array.from(letters).length === 1 ? 0.44 : 0.34),
      }}
    >
      {!mediaId && <span aria-hidden="true">{letters}</span>}
      {mediaId && (
        <CachedPicture
          url={url}
          className={imageClassName}
          fallback={<span aria-hidden="true">{letters}</span>}
        />
      )}
    </span>
  );
}
