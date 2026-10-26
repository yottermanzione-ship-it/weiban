import { useEffect, useRef, useState } from 'react';
import { VoiceEndpoints } from '@weiban/contracts';
import { useRemote } from '../data/use-remote.js';
import { SubPageLayer } from './edit-page.js';
import { OldIcon } from './old-icons.js';
import { SearchField } from './search-field.js';
import { CheckSlot } from './shell-kit.js';

/** 音色库（启用的音色）。自建角色编辑页读一次，行摘要和音色二级页面共用。 */
export function useVoiceLibrary() {
  const voices = useRemote(VoiceEndpoints.listVoices, { networkOnly: true });
  const items = voices.data?.items.filter((item) => item.enabled) ?? [];
  return { items, loading: voices.loading, error: voices.error, refresh: voices.refresh };
}
export type VoiceLibrary = ReturnType<typeof useVoiceLibrary>;

/** 行右侧摘要：默认 / 音色名 / 原音色不可用。 */
export function voiceLabel(library: VoiceLibrary, value: string | null): string {
  if (!value) return '默认';
  const voice = library.items.find((item) => item.voiceId === value);
  if (voice) return voice.name;
  return library.loading ? '' : '原音色暂不可用';
}

/**
 * 音色二级页面（2026-10-27 批 U3，参照提示音页 SoundPage）：每行「名称 …… 试听 ✓」，试听和对号各占固定列；
 * 点一行选中并试听，「完成」才保存。超过 10 个音色顶部出现搜索（26 号 §2 选值梯度）。
 * 试听使用库内样音，不生成语音、不计费。
 */
export function CharacterVoicePage({
  library,
  value,
  onSave,
  onClose,
}: {
  library: VoiceLibrary;
  value: string | null;
  onSave(value: string | null): void;
  onClose(): void;
}) {
  const [draft, setDraft] = useState(value);
  const [query, setQuery] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  function preview(voiceId: string) {
    audio.current?.pause();
    const voice = library.items.find((item) => item.voiceId === voiceId);
    if (playing === voiceId || !voice?.sampleUrl) {
      setPlaying(null);
      return;
    }
    const element = new Audio(voice.sampleUrl);
    audio.current = element;
    element.onended = () => setPlaying(null);
    element.onerror = () => setPlaying(null);
    setPlaying(voiceId);
    void element.play().catch(() => setPlaying(null));
  }
  const keyword = query.trim().toLowerCase();
  const shown = keyword
    ? library.items.filter((item) => item.name.toLowerCase().includes(keyword))
    : library.items;
  const missing = value && !library.loading && !library.items.some((v) => v.voiceId === value);
  return (
    <SubPageLayer
      title="音色"
      canSave={draft !== value}
      onCancel={onClose}
      onSave={() => onSave(draft)}
    >
      {library.items.length > 10 && (
        <div className="voice-search">
          <SearchField
            value={query}
            placeholder="搜索音色"
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery('')}
          />
        </div>
      )}
      <div className="sound-list" role="radiogroup" aria-label="音色">
        {!keyword && (
          <div className="sound-row">
            <button
              type="button"
              role="radio"
              aria-checked={draft === null}
              className="pick-row sound-pick"
              onClick={() => setDraft(null)}
            >
              <span>默认（不指定音色）</span>
              <CheckSlot checked={draft === null} size={22} />
            </button>
          </div>
        )}
        {missing && !keyword && (
          <div className="sound-row">
            <button
              type="button"
              role="radio"
              aria-checked={draft === value}
              className="pick-row sound-pick"
              disabled
            >
              <span className="hint">原音色暂不可用，可改选默认或其他音色</span>
              <CheckSlot checked={draft === value} size={22} />
            </button>
          </div>
        )}
        {shown.map((voice) => (
          <div key={voice.voiceId} className="sound-row">
            <button
              type="button"
              role="radio"
              aria-checked={draft === voice.voiceId}
              className="pick-row sound-pick"
              onClick={() => {
                setDraft(voice.voiceId);
                if (voice.sampleUrl && playing !== voice.voiceId) preview(voice.voiceId);
              }}
            >
              <span>{voice.name}</span>
              <span className="sound-play-slot" aria-hidden />
              <CheckSlot checked={draft === voice.voiceId} size={22} />
            </button>
            {voice.sampleUrl && (
              <button
                type="button"
                className={`sound-play${playing === voice.voiceId ? ' playing' : ''}`}
                aria-label={
                  playing === voice.voiceId ? `停止试听${voice.name}` : `试听${voice.name}`
                }
                onClick={() => preview(voice.voiceId)}
              >
                <OldIcon name="wechat/voice" size={20} />
              </button>
            )}
          </div>
        ))}
      </div>
      {library.loading && (
        <p className="edit-hint" role="status">
          正在读取音色库…
        </p>
      )}
      {library.error && (
        <p className="edit-hint" role="alert">
          {library.error}{' '}
          <button type="button" className="text-button text-action" onClick={library.refresh}>
            重试
          </button>
        </p>
      )}
      {keyword && shown.length === 0 && <p className="edit-hint">没有找到相关音色</p>}
      <p className="edit-hint">
        保存后用于语音消息和通话；聊天设置中单独选的音色优先。试听不扣积分。
      </p>
    </SubPageLayer>
  );
}
