import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Pause, Play } from './old-icons.js';
import { CompanionEndpoints, VoiceEndpoints } from '@weiban/contracts';
import { api } from '../data/client.js';
import { useRemote, friendlyError } from '../data/use-remote.js';
import { showToast } from './toast.js';

/**
 * TA 的声音（media-l5.md 第 6 节；MED-03 第 1 条）：从音色库给角色换音色。
 * 第一行 = 默认音色（voiceId 为 null 时使用预设角色默认 / 平台默认）。试听用预先生成的音频，不扣费。
 */
export function VoicePickerPage() {
  const { characterId = '' } = useParams();
  const navigate = useNavigate();
  const voices = useRemote(VoiceEndpoints.listVoices, { networkOnly: true });
  const companion = useRemote(CompanionEndpoints.getForCharacter, { params: { characterId } });
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const current = chosen !== undefined ? chosen : (companion.data?.voiceId ?? null);
  function preview(voiceId: string, url: string | null) {
    audio.current?.pause();
    if (playing === voiceId || !url) {
      setPlaying(null);
      return;
    }
    const element = new Audio(url);
    audio.current = element;
    element.onended = () => setPlaying(null);
    element.onerror = () => {
      setPlaying(null);
      showToast('试听加载失败');
    };
    setPlaying(voiceId);
    void element.play().catch(() => setPlaying(null));
  }
  function choose(voiceId: string | null) {
    const previous = current;
    setChosen(voiceId);
    void api
      .call(CompanionEndpoints.updateForCharacter, {
        params: { characterId },
        body: { voiceId },
      })
      .catch((e) => {
        setChosen(previous);
        showToast(friendlyError(e));
      });
  }
  return (
    <main>
      <header className="page-header">
        <button className="text-button" onClick={() => void navigate(-1)}>
          ‹ 返回
        </button>
        <h1>TA 的声音</h1>
        <span />
      </header>
      {voices.loading && !voices.data && (
        <div className="panel rows" aria-busy="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton-row" />
          ))}
        </div>
      )}
      {voices.error && !voices.data && (
        <div className="empty">
          <p>加载失败</p>
          <button onClick={voices.refresh}>重试</button>
        </div>
      )}
      {voices.data && (
        <div className="panel rows">
          <button
            className="voice-row"
            onClick={() => choose(null)}
            aria-pressed={current === null}
          >
            <span className="voice-name">
              默认 <span className="tag">默认</span>
            </span>
            {current === null && <span aria-label="已选择">✓</span>}
          </button>
          {voices.data.items
            .filter((v) => v.enabled)
            .map((voice) => (
              <div key={voice.voiceId} className="voice-row">
                <button
                  className="icon-button"
                  aria-label={playing === voice.voiceId ? '停止试听' : `试听 ${voice.name}`}
                  disabled={!voice.sampleUrl}
                  onClick={() => preview(voice.voiceId, voice.sampleUrl)}
                >
                  {playing === voice.voiceId ? <Pause size={20} /> : <Play size={20} />}
                </button>
                <button
                  className="voice-choose"
                  aria-pressed={current === voice.voiceId}
                  onClick={() => choose(voice.voiceId)}
                >
                  <span className="voice-name">
                    {voice.name}
                    {voice.tags.map((t) => (
                      <span key={t} className="tag">
                        {t}
                      </span>
                    ))}
                  </span>
                  {current === voice.voiceId && <span aria-label="已选择">✓</span>}
                </button>
              </div>
            ))}
        </div>
      )}
      <p className="hint">
        所有声音都是合成音色，不模仿任何真人的声音。改了以后，语音消息和通话都会用新的声音。
      </p>
    </main>
  );
}

/** 聊天信息页「TA 的声音」行：平台没开通语音合成（音色列表为空）时不显示。 */
export function VoiceRow({
  characterId,
  voiceId,
}: {
  characterId: string;
  voiceId: string | null;
}) {
  const voices = useRemote(VoiceEndpoints.listVoices);
  if (!voices.data?.items.length) return null;
  const name = voiceId ? voices.data.items.find((v) => v.voiceId === voiceId)?.name : null;
  return (
    <Link className="row-link" to={`/characters/${characterId}/voice`}>
      <span>TA 的声音</span>
      <small>{name ?? '默认'} ›</small>
    </Link>
  );
}
