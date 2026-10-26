import { useEffect, useRef, useState } from 'react';
import { VoiceEndpoints } from '@weiban/contracts';
import { useRemote } from '../data/use-remote.js';
import { SelectField } from './wheel-picker.js';

/** 编辑器保存音色 ID；试听使用库内样音，不生成语音、不计费。 */
export function CharacterVoiceSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: string | null;
  onChange(value: string | null): void;
  disabled?: boolean;
}) {
  const voices = useRemote(VoiceEndpoints.listVoices, { networkOnly: true });
  const items = voices.data?.items.filter((item) => item.enabled) ?? [];
  const selected = items.find((item) => item.voiceId === value);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    audio.current?.pause();
    setPlaying(false);
    setError('');
    return () => {
      audio.current?.pause();
    };
  }, [value]);
  function preview() {
    audio.current?.pause();
    if (playing || !selected?.sampleUrl) {
      setPlaying(false);
      return;
    }
    const element = new Audio(selected.sampleUrl);
    audio.current = element;
    element.onended = () => setPlaying(false);
    element.onerror = () => {
      setPlaying(false);
      setError('试听暂时不可用');
    };
    setPlaying(true);
    setError('');
    void element.play().catch(() => {
      setPlaying(false);
      setError('试听暂时不可用');
    });
  }
  return (
    <section className="stack">
      <label>
        音色（可选）
        <SelectField<string>
          title="音色"
          value={value ?? ''}
          disabled={disabled || voices.loading}
          onChange={(next) => onChange(next || null)}
          options={[
            { value: '', label: '默认（不指定音色）' },
            ...(value && !selected
              ? [{ value, label: '原音色暂不可用，可改选默认或其他音色', disabled: true }]
              : []),
            ...items.map((voice) => ({ value: voice.voiceId, label: voice.name })),
          ]}
        />
      </label>
      {voices.loading && <span role="status">正在读取音色库</span>}
      {voices.error && (
        <p role="alert">
          {voices.error}{' '}
          <button type="button" onClick={voices.refresh}>
            重试音色库
          </button>
        </p>
      )}
      {selected?.sampleUrl && (
        <button type="button" disabled={disabled} onClick={preview}>
          {playing ? '停止试听' : '试听音色'}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      <p className="hint">
        从音色库选择合成音色。保存后用于语音消息和通话；聊天设置中单独选的音色优先。试听不扣积分。
      </p>
    </section>
  );
}
