import { useState } from 'react';
import { MediaEndpoints, type Profile } from '@weiban/contracts';
import { avatarLetters } from '@weiban/client-core';
import { useRemote } from '../data/use-remote.js';
export function UserMessageAvatar({ profile, size = 40 }: { profile?: Profile; size?: number }) {
  const letters = avatarLetters(profile?.nickname ?? '我');
  return (
    <span
      className="user-message-avatar"
      role="img"
      aria-label="我的头像"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.12,
        fontSize: size * (Array.from(letters).length === 1 ? 0.44 : 0.34),
      }}
    >
      <span aria-hidden="true">{letters}</span>
      {profile?.avatarMediaId && (
        <PrivateImage key={profile.avatarMediaId} mediaId={profile.avatarMediaId} />
      )}
    </span>
  );
}
function PrivateImage({ mediaId }: { mediaId: string }) {
  const media = useRemote(MediaEndpoints.getMedia, { params: { mediaId } });
  return media.data ? <Picture key={media.data.url} url={media.data.url} /> : null;
}
function Picture({ url }: { url: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return failed ? null : (
    <img
      src={url}
      alt=""
      aria-hidden="true"
      style={{ opacity: loaded ? 1 : 0 }}
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
    />
  );
}
