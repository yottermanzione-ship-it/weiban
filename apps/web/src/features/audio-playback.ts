/** Only app playback is stopped; never stop another app or an active call's capture. */
const stops = new Set<() => void>();
let pendingMicrophones = 0;
// 只追踪轨道状态，不保存声音；结束的轨道在下一次声音操作时移除。
const microphoneTracks = new Set<MediaStreamTrack>();

export function microphoneCaptureActive(): boolean {
  for (const track of microphoneTracks) {
    if (track.readyState !== 'live') microphoneTracks.delete(track);
  }
  return pendingMicrophones > 0 || microphoneTracks.size > 0;
}

/** 必须同步恢复自动声音模式，随后仍在本次点击里请求麦克风。 */
export function beginMicrophoneAccess(): (stream?: MediaStream) => void {
  microphoneCaptureActive();
  pendingMicrophones++;
  try {
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session && session.type !== 'auto') session.type = 'auto';
  } catch {
    // 可选接口不可写时，仍交给浏览器返回真实的录音结果。
  }
  let settled = false;
  return (stream) => {
    if (settled) return;
    settled = true;
    pendingMicrophones--;
    for (const track of stream?.getTracks() ?? []) {
      if (track.kind === 'audio' && track.readyState === 'live') microphoneTracks.add(track);
    }
  };
}

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
