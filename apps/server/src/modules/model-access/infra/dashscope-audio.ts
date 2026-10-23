/** Download only the provider-returned public audio object, without forwarding provider credentials. */
import { lookup } from 'node:dns/promises';
import { BlockList } from 'node:net';
import { request } from 'node:https';

const MAX_AUDIO_BYTES = 12_000_000;
const TIMEOUT_MS = 30_000;
const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(address, prefix, 'ipv4');

export function dashscopeAudioUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    // Some official signed objects are labelled HTTP although the same object supports TLS.
    // Upgrade the URL only; never send HTTP, follow a redirect, or relax the DNS/IP checks.
    if (url.protocol === 'http:' && !url.port && /\.(aliyuncs|aliyun)\.com$/u.test(url.hostname))
      url.protocol = 'https:';
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.hash &&
      (!url.port || url.port === '443') &&
      /\.(aliyuncs|aliyun)\.com$/u.test(url.hostname)
      ? url
      : null;
  } catch {
    return null;
  }
}

/**
 * Select only public A records, then pin the TLS connection to the inspected IPv4 address.
 * IPv6-only sources are deliberately refused, never retried through a less restrictive fetch.
 * One attempt, no redirects, one overall DNS/body deadline and a streamed byte limit.
 */
export async function downloadDashscopeAudio(raw: string): Promise<Uint8Array> {
  const url = dashscopeAudioUrl(raw);
  if (!url) throw new Error('DASHSCOPE_AUDIO_URL_REJECTED');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  timer.unref();
  try {
    const addresses = await new Promise<Array<{ address: string; family: number }>>(
      (resolve, reject) => {
        const aborted = () => reject(new Error('DASHSCOPE_AUDIO_TIMEOUT'));
        controller.signal.addEventListener('abort', aborted, { once: true });
        void lookup(url.hostname, { all: true, family: 4 })
          .then(resolve, reject)
          .finally(() => {
            controller.signal.removeEventListener('abort', aborted);
          });
      },
    );
    if (
      !addresses.length ||
      addresses.some((a) => a.family !== 4 || blocked.check(a.address, 'ipv4'))
    )
      throw new Error('DASHSCOPE_AUDIO_ADDRESS_REJECTED');
    const address = addresses[0]!.address;
    return await new Promise<Uint8Array>((resolve, reject) => {
      const req = request(
        url,
        {
          method: 'GET',
          agent: false,
          // An explicit family disables dual-stack auto-selection and keeps the pinned lookup scalar.
          family: 4,
          servername: url.hostname,
          signal: controller.signal,
          // Keep the original hostname for certificate verification, but do not resolve it again.
          lookup: (_hostname, _options, callback) => callback(null, address, 4),
          headers: { Accept: 'audio/wav, application/octet-stream' },
        },
        (response) => {
          const length = response.headers['content-length'];
          if (
            response.statusCode !== 200 ||
            (length !== undefined && (!/^\d+$/u.test(length) || Number(length) > MAX_AUDIO_BYTES))
          ) {
            response.destroy();
            reject(new Error('DASHSCOPE_AUDIO_RESPONSE_REJECTED'));
            return;
          }
          let size = 0;
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_AUDIO_BYTES) {
              response.destroy();
              reject(new Error('DASHSCOPE_AUDIO_SIZE_LIMIT'));
              return;
            }
            chunks.push(chunk);
          });
          response.once('end', () => resolve(new Uint8Array(Buffer.concat(chunks, size))));
          response.once('aborted', () => reject(new Error('DASHSCOPE_AUDIO_INCOMPLETE')));
          response.once('error', () => reject(new Error('DASHSCOPE_AUDIO_READ_FAILED')));
        },
      );
      req.once('error', () => reject(new Error('DASHSCOPE_AUDIO_NETWORK_FAILED')));
      req.end();
    });
  } finally {
    clearTimeout(timer);
  }
}
