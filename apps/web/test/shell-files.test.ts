import { afterEach, expect, it, vi } from 'vitest';
import { saveImageFile } from '../src/data/shell-files.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function shell() {
  const bridge: NonNullable<Window['weibanShell']> = { postMessage: vi.fn(), onmessage: null };
  vi.stubGlobal('navigator', { userAgent: 'Android WeibanShell/1' });
  vi.stubGlobal('window', { weibanShell: bridge, setTimeout, clearTimeout });
  vi.stubGlobal(
    'FileReader',
    class {
      result = 'data:image/png;base64,AQID';
      onload?: () => void;
      readAsDataURL() {
        queueMicrotask(() => this.onload?.());
      }
    },
  );
  return bridge;
}

it('does not claim a native save before confirmation and ignores replies for other requests', async () => {
  const bridge = shell();
  const done = vi.fn();
  const work = saveImageFile(new Blob(['image'], { type: 'image/png' }), 'image.png').then(done);
  await vi.waitFor(() => expect(bridge.postMessage).toHaveBeenCalledTimes(1));
  const sent = JSON.parse(vi.mocked(bridge.postMessage).mock.calls[0]![0]) as { id: string };
  bridge.onmessage?.({ data: JSON.stringify({ id: 'other', status: 'saved' }) });
  expect(done).not.toHaveBeenCalled();
  await expect(
    saveImageFile(new Blob(['another'], { type: 'image/png' }), 'another.png'),
  ).rejects.toThrow('正在保存');
  bridge.onmessage?.({ data: JSON.stringify({ id: sent.id, status: 'saved' }) });
  await work;
  expect(done).toHaveBeenCalledWith('saved');
  expect(bridge.onmessage).toBeNull();
});

it('a cancelled file chooser stays cancelled rather than displaying success', async () => {
  const bridge = shell();
  const work = saveImageFile(new Blob(['image'], { type: 'image/png' }), 'image.png');
  await vi.waitFor(() => expect(bridge.postMessage).toHaveBeenCalledTimes(1));
  const sent = JSON.parse(vi.mocked(bridge.postMessage).mock.calls[0]![0]) as { id: string };
  bridge.onmessage?.({ data: JSON.stringify({ id: sent.id, status: 'cancelled' }) });
  await expect(work).resolves.toBe('cancelled');
});

it('rejects missing native support and unsupported content before requesting a save', async () => {
  const bridge = shell();
  await expect(
    saveImageFile(new Blob(['script'], { type: 'text/html' }), 'image.png'),
  ).rejects.toThrow('格式');
  await expect(saveImageFile(new Blob([], { type: 'image/png' }), 'image.png')).rejects.toThrow(
    '格式',
  );
  expect(bridge.postMessage).not.toHaveBeenCalled();
  window.weibanShell = undefined;
  await expect(
    saveImageFile(new Blob(['image'], { type: 'image/png' }), 'image.png'),
  ).rejects.toThrow('系统网页组件');
});

it('propagates native write failures without reporting the file saved', async () => {
  const bridge = shell();
  const work = saveImageFile(new Blob(['image'], { type: 'image/png' }), 'image.png');
  const result = expect(work).rejects.toThrow('尚未保存');
  await vi.waitFor(() => expect(bridge.postMessage).toHaveBeenCalledTimes(1));
  const sent = JSON.parse(vi.mocked(bridge.postMessage).mock.calls[0]![0]) as { id: string };
  bridge.onmessage?.({ data: JSON.stringify({ id: sent.id, status: 'failed' }) });
  await result;
});
