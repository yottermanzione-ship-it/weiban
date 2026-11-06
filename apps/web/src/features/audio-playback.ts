/** Only app playback is stopped; never stop another app or an active call's capture. */
const stops = new Set<() => void>();
export function registerPlaybackStop(stop: () => void): () => void {
  stops.add(stop);
  return () => {
    stops.delete(stop);
  };
}
export function stopPlaybackForMicrophone(): void {
  for (const stop of stops) stop();
}
/** Pause alone retains the decoder/output route on some Android WebViews. */
export function releaseAudioPlayback(audio: HTMLAudioElement | null): void {
  if (!audio) return;
  audio.onended = null;
  audio.onerror = null;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}
