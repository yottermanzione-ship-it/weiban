import type { Profile } from '@weiban/contracts';
import { UserAvatar } from './user-avatar.js';
export function ProfileAvatar({ profile, size = 64 }: { profile?: Profile; size?: number }) {
  return <UserAvatar profile={profile} size={size} imageClassName="user-avatar" />;
}
