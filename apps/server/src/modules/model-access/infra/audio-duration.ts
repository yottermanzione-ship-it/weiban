/** Container duration from real bytes when the WAV header is unavailable (webm/mp4/ogg recordings). */
import { spawn } from 'node:child_process';

const FFPROBE = '/usr/bin/ffprobe';
const MAX_INPUT_BYTES = 12_000_000;
const TIMEOUT_MS = 10_000;
const MAX_SECONDS = 86_400;

/** Bounded, shell-free duration probe. Returns null (never guesses) when the tool or media is unusable. */
export function probeAudioSeconds(bytes: Uint8Array): Promise<number | null> {
  if (!bytes.length || bytes.length > MAX_INPUT_BYTES) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    let output = '';
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill('SIGKILL');
      } catch {
        /* already exited */
      }
      resolve(value);
    };
    const child = spawn(
      FFPROBE,
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=nw=1:nk=1',
        '-i',
        'pipe:0',
      ],
      { stdio: ['pipe', 'pipe', 'ignore'] },
    );
    const timer = setTimeout(() => finish(null), TIMEOUT_MS);
    timer.unref();
    child.stdout.on('data', (chunk: Buffer) => {
      if (output.length < 64) output += chunk.toString('utf8');
    });
    child.on('error', () => finish(null));
    child.on('close', () => {
      const seconds = Number(output.trim());
      finish(Number.isFinite(seconds) && seconds > 0 && seconds <= MAX_SECONDS ? seconds : null);
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(Buffer.from(bytes));
  });
}
