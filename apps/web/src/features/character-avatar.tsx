import { useState } from 'react';
import { Flower, Heart, Moon, MusicNote, Star } from '@phosphor-icons/react';
import { CharacterEndpoints, MediaEndpoints, type CharacterSummary } from '@weiban/contracts';
import { avatarForeground, avatarLetters, avatarPaletteIndex } from '@weiban/client-core';
import { useAuth } from '../app/auth.js';
import { useChat } from '../app/chat.js';
import { useRemote } from '../data/use-remote.js';
type AvatarRole = Pick<CharacterSummary, 'characterId' | 'name' | 'avatar'>;
const patterns = { star: Star, heart: Heart, note: MusicNote, moon: Moon, flower: Flower };
export function CharacterAvatar({
  id,
  profile,
  size = 48,
}: {
  id: string;
  profile?: AvatarRole;
  size?: number;
}) {
  const { session } = useAuth();
  const { state } = useChat();
  const ownerKey = `${session?.user.userId}:${session?.session.sessionId}`;
  const privateId = state.contacts.find(
    (contact) => contact.characterId === id,
  )?.customAvatarMediaId;
  return profile?.characterId === id ? (
    <Artwork key={`${ownerKey}:${id}`} role={profile} privateId={privateId} size={size} />
  ) : (
    <RequestedAvatar key={`${ownerKey}:${id}`} id={id} privateId={privateId} size={size} />
  );
}
function RequestedAvatar({
  id,
  privateId,
  size,
}: {
  id: string;
  privateId?: string | null;
  size: number;
}) {
  const remote = useRemote(CharacterEndpoints.getProfile, { params: { characterId: id } });
  return (
    <Artwork
      role={remote.data?.characterId === id ? remote.data : undefined}
      id={id}
      privateId={privateId}
      size={size}
    />
  );
}
function Artwork({
  role,
  id = role?.characterId ?? '',
  privateId,
  size,
}: {
  role?: AvatarRole;
  id?: string;
  privateId?: string | null;
  size: number;
}) {
  const display = role?.avatar.display;
  const letters = avatarLetters(role?.name ?? '', display?.avatarText);
  const palette = String(avatarPaletteIndex(id)).padStart(2, '0');
  const supplied = display?.supportColors[0];
  const background = supplied ?? `var(--wb-support-${palette}-bg)`;
  const color = supplied ? avatarForeground(supplied) : `var(--wb-support-${palette}-on)`;
  const pattern = display?.avatarPattern ?? 'star';
  const Icon = pattern === 'none' ? null : patterns[pattern];
  return (
    <span
      className="character-avatar"
      role="img"
      aria-label={`${role?.name ?? '角色'}头像`}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.12,
        background,
        color,
        fontSize: size * (Array.from(letters).length === 1 ? 0.44 : 0.34),
        fontWeight: 600,
      }}
    >
      <span aria-hidden="true">{letters}</span>
      {Icon && size >= 40 && (
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
      )}
      {privateId ? (
        <PrivatePicture key={privateId} mediaId={privateId} />
      ) : role?.avatar.image ? (
        <Picture key={role.avatar.image.url} url={role.avatar.image.url} />
      ) : null}
    </span>
  );
}
function PrivatePicture({ mediaId }: { mediaId: string }) {
  const remote = useRemote(MediaEndpoints.getMedia, { params: { mediaId } });
  return remote.data ? <Picture key={remote.data.url} url={remote.data.url} /> : null;
}
function Picture({ url }: { url: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return failed ? null : (
    <img
      aria-hidden="true"
      alt=""
      src={url}
      style={{ opacity: loaded ? 1 : 0 }}
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
    />
  );
}
