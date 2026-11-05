/** Let the browser choose its native encoder first. An advertised MIME can still fail to start. */
export function startVoiceRecorder(
  stream: MediaStream,
  handlers: Pick<MediaRecorder, 'ondataavailable' | 'onstop' | 'onerror'>,
): MediaRecorder {
  const formats = [
    undefined,
    'audio/mp4',
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
  ];
  let failure: unknown = new DOMException('Recorder unavailable', 'NotSupportedError');
  for (const mimeType of formats) {
    let recorder: MediaRecorder | undefined;
    try {
      if (
        mimeType &&
        (typeof MediaRecorder.isTypeSupported !== 'function' ||
          !MediaRecorder.isTypeSupported(mimeType))
      )
        continue;
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      Object.assign(recorder, handlers);
      recorder.start();
      if (recorder.state !== 'recording')
        throw new DOMException('Recorder did not enter recording state', 'InvalidStateError');
      return recorder;
    } catch (error) {
      failure = error;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.onerror = null;
        try {
          if (recorder.state !== 'inactive') recorder.stop();
        } catch {
          // Continue with a fresh encoder, never reuse a failed recorder.
        }
      }
      // A permission/security failure must not be retried as an encoder compatibility issue.
      if (
        error instanceof DOMException &&
        ['NotAllowedError', 'SecurityError'].includes(error.name)
      )
        break;
    }
  }
  throw failure;
}

export function releaseVoiceRecorder(recorder: MediaRecorder): void {
  recorder.ondataavailable = null;
  recorder.onstop = null;
  recorder.onerror = null;
  try {
    if (recorder.state !== 'inactive') recorder.stop();
  } finally {
    recorder.stream.getTracks().forEach((track) => track.stop());
  }
}
