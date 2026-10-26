import { describe, expect, it } from 'vitest';
import { normalizeDashscopeWav, wavFromPcm } from './media-adapter.js';

describe('DashScope completed streaming WAV lengths', () => {
  it('repairs the exact RIFF/data length pair returned by restored Qwen cloned voices', () => {
    const wav = Buffer.from(wavFromPcm(new Uint8Array(4800), 24000));
    wav.writeUInt32LE(0x7fffffbf, 4);
    wav.writeUInt32LE(0x7fffff9b, 40);
    const normalized = normalizeDashscopeWav(wav);
    expect(normalized).not.toBeNull();
    const view = Buffer.from(normalized!);
    expect(view.readUInt32LE(4)).toBe(view.length - 8);
    expect(view.readUInt32LE(40)).toBe(4800);
  });

  it('continues rejecting arbitrary oversized or truncated data chunks', () => {
    const wav = Buffer.from(wavFromPcm(new Uint8Array(4800), 24000));
    wav.writeUInt32LE(0x7fffffbf, 4);
    wav.writeUInt32LE(0x7fffff9a, 40);
    expect(normalizeDashscopeWav(wav)).toBeNull();
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.writeUInt32LE(4802, 40);
    expect(normalizeDashscopeWav(wav)).toBeNull();
  });
});
