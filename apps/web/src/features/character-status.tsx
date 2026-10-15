import { useEffect, useState } from 'react';
import { TimelineEndpoints, type TimelineMood } from '@weiban/contracts';
import { getCharacterStatusVisible } from '../data/display-prefs.js';
import { useRemote } from '../data/use-remote.js';
const moods: Record<TimelineMood, [string, string]> = {
  happy: ['😊', '开心'],
  neutral: ['🙂', '平静'],
  tired: ['😴', '有点累'],
  annoyed: ['😤', '有点烦'],
  excited: ['🤩', '兴奋'],
  sad: ['🥺', '难过'],
  anxious: ['🥺', '有点不安'],
};
export function CharacterStatus({
  characterId,
  enabled,
}: {
  characterId: string;
  enabled: boolean;
}) {
  const [visible, setVisible] = useState(getCharacterStatusVisible);
  const [, setNow] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => {
      setVisible(getCharacterStatusVisible());
      setNow(new Date());
    };
    window.addEventListener('weiban:display-prefs', refresh);
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener('weiban:display-prefs', refresh);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
      window.clearInterval(timer);
    };
  }, []);
  const status = useRemote(
    TimelineEndpoints.getStatus,
    { params: { characterId }, networkOnly: true },
    enabled && visible,
  );
  const updated = status.data?.updatedAt ? new Date(status.data.updatedAt) : null;
  const mood = status.data?.mood;
  const now = new Date();
  if (
    !enabled ||
    !visible ||
    !mood ||
    !updated ||
    updated.toDateString() !== now.toDateString() ||
    updated > now
  )
    return null;
  const [emoji, label] = moods[mood];
  return (
    <span
      className="character-status"
      role="img"
      aria-label={`状态：${label}`}
      title={`${label} · ${updated.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`}
    >
      {emoji}
    </span>
  );
}
