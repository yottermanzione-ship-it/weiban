import { useState } from 'react';
import { UserCircle } from '@phosphor-icons/react';
import { MediaEndpoints } from '@weiban/contracts';
import { useRemote } from '../data/use-remote.js';
function UploadedAvatar({ mediaId }: { mediaId: string }) {
  const remote = useRemote(MediaEndpoints.getMedia, { params: { mediaId } });
  const [failed, setFailed] = useState(false);
  return remote.data && !failed ? (
    <img
      className="user-avatar"
      src={remote.data.url}
      alt="我的头像"
      onError={() => setFailed(true)}
    />
  ) : (
    <UserCircle size={64} />
  );
}
export function ProfileAvatar({ mediaId }: { mediaId: string | null | undefined }) {
  return mediaId ? <UploadedAvatar key={mediaId} mediaId={mediaId} /> : <UserCircle size={64} />;
}
