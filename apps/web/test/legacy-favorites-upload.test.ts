import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthResponse } from '@weiban/contracts';
const mocks = vi.hoisted(() => ({ get: vi.fn(), owns: vi.fn() }));
vi.mock('../src/data/client.js', () => ({
  localStore: { get: mocks.get },
  api: { owns: mocks.owns },
}));
import { uploadMedia } from '../src/data/upload.js';

const id = '11111111-1111-4111-8111-111111111111';
function auth(other = false) {
  return AuthResponse.parse({
    user: {
      userId: other ? '22222222-2222-4222-8222-222222222222' : id,
      username: other ? 'other1' : 'legacy1',
      role: 'user',
      profileCompleted: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    session: {
      sessionId: id,
      kind: 'app',
      token: (other ? 'SYNTHETIC-OTHER-' : 'SYNTHETIC-ORIGINAL-').padEnd(48, 'x'),
      expiresAt: '2027-01-01T00:00:00.000Z',
    },
  });
}
const session = auth();
const owner = {
  userId: session.user.userId,
  sessionId: session.session.sessionId,
  token: session.session.token,
};
class FakeXhr {
  static requests: FakeXhr[] = [];
  static duringSetup: (() => void) | undefined;
  headers: Record<string, string> = {};
  method = '';
  url = '';
  body: FormData | null = null;
  sends = 0;
  aborts = 0;
  status = 200;
  timeout = 0;
  responseText = JSON.stringify({
    mediaId: id,
    purpose: 'chat_image',
    mimeType: 'image/png',
    sizeBytes: 5,
    width: 1,
    height: 1,
    url: 'http://127.0.0.1/fixture-image',
    urlExpiresAt: '2027-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  upload = {
    onprogress: null as
      null | ((event: { lengthComputable: boolean; loaded: number; total: number }) => void),
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    FakeXhr.requests.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
    FakeXhr.duringSetup?.();
  }
  send(body: FormData) {
    this.body = body;
    this.sends++;
  }
  abort() {
    this.aborts++;
    this.onabort?.();
  }
}
beforeEach(() => {
  mocks.get.mockResolvedValue(session);
  mocks.owns.mockReturnValue(true);
  FakeXhr.requests = [];
  FakeXhr.duringSetup = undefined;
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('uploads original bytes with the captured session header and removes completed abort listeners', async () => {
  const controller = new AbortController();
  const work = uploadMedia(
    'chat_image',
    new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'image/png' }),
    { owner, signal: controller.signal },
  );
  await vi.waitFor(() => expect(FakeXhr.requests[0]?.sends).toBe(1));
  const xhr = FakeXhr.requests[0]!;
  expect(xhr.method).toBe('POST');
  expect(xhr.url).toBe('/api/v1/media?purpose=chat_image');
  expect(xhr.headers.Authorization).toBe(`Bearer ${session.session.token}`);
  expect([...new Uint8Array(await (xhr.body!.get('file') as Blob).arrayBuffer())]).toEqual([
    1, 2, 3, 4, 5,
  ]);
  xhr.onload?.();
  await expect(work).resolves.toMatchObject({ mediaId: id });
  controller.abort();
  expect(xhr.aborts).toBe(0);
});

it('cancellation while awaiting credentials creates no XHR and sends no body', async () => {
  let finish!: (value: AuthResponse) => void;
  mocks.get.mockReturnValue(
    new Promise<AuthResponse>((resolve) => {
      finish = resolve;
    }),
  );
  const controller = new AbortController();
  const work = uploadMedia('chat_image', new Blob(['source']), {
    owner,
    signal: controller.signal,
  });
  controller.abort();
  finish(session);
  await expect(work).rejects.toMatchObject({ code: 'request_cancelled' });
  expect(FakeXhr.requests).toEqual([]);
});

it('a different account returned from credential storage cannot receive old bytes or its token in a request', async () => {
  mocks.get.mockResolvedValue(auth(true));
  mocks.owns.mockReturnValue(false);
  await expect(
    uploadMedia('chat_image', new Blob(['old-source']), { owner }),
  ).rejects.toMatchObject({ code: 'request_cancelled' });
  expect(FakeXhr.requests).toEqual([]);
});

it('a switch during request setup is checked again before send', async () => {
  FakeXhr.duringSetup = () => mocks.owns.mockReturnValue(false);
  await expect(
    uploadMedia('chat_image', new Blob(['old-source']), { owner }),
  ).rejects.toMatchObject({ code: 'request_cancelled' });
  expect(FakeXhr.requests).toHaveLength(1);
  expect(FakeXhr.requests[0]!.headers.Authorization).toBe(`Bearer ${session.session.token}`);
  expect(FakeXhr.requests[0]!.sends).toBe(0);
  expect(FakeXhr.requests[0]!.body).toBeNull();
});

it('switch and abort during upload cancels the original XHR once and ignores late success', async () => {
  const controller = new AbortController();
  const progress = vi.fn();
  const work = uploadMedia('chat_image', new Blob(['bytes']), {
    owner,
    signal: controller.signal,
    onProgress: progress,
  });
  await vi.waitFor(() => expect(FakeXhr.requests[0]?.sends).toBe(1));
  const xhr = FakeXhr.requests[0]!;
  mocks.owns.mockReturnValue(false);
  controller.abort();
  await expect(work).rejects.toMatchObject({ code: 'request_cancelled' });
  xhr.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 5 });
  xhr.onload?.();
  expect(xhr.aborts).toBe(1);
  expect(xhr.sends).toBe(1);
  expect(progress).not.toHaveBeenCalled();
  expect(FakeXhr.requests).toHaveLength(1);
  expect(xhr.headers.Authorization).toBe(`Bearer ${session.session.token}`);
});

it('a late response is rejected after ownership changes even if the caller did not abort', async () => {
  const work = uploadMedia('chat_image', new Blob(['bytes']), { owner });
  await vi.waitFor(() => expect(FakeXhr.requests[0]?.sends).toBe(1));
  const xhr = FakeXhr.requests[0]!;
  mocks.owns.mockReturnValue(false);
  xhr.onload?.();
  await expect(work).rejects.toMatchObject({ code: 'request_cancelled' });
  expect(xhr.aborts).toBe(0);
  expect(FakeXhr.requests.map((request) => request.method)).toEqual(['POST']);
});

it('existing callers without owner continue using their current stored session', async () => {
  mocks.get.mockResolvedValue(auth(true));
  const work = uploadMedia('chat_image', new Blob(['bytes']));
  await vi.waitFor(() => expect(FakeXhr.requests[0]?.sends).toBe(1));
  const xhr = FakeXhr.requests[0]!;
  expect(xhr.headers.Authorization).toBe(`Bearer ${auth(true).session.token}`);
  xhr.onload?.();
  await expect(work).resolves.toMatchObject({ mediaId: id });
});
