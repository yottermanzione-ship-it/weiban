import type { Profile } from '@weiban/contracts';
import { UserAvatar } from './user-avatar.js';
export function ProfileAvatar({ profile }: { profile?: Profile }) {
  return <UserAvatar profile={profile} size={64} imageClassName="user-avatar" />;
}
