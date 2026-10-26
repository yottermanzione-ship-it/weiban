import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CaretDown, OldIcon } from './old-icons.js';
import {
  CALL_LIMITS,
  CallEndpoints,
  CallStreamServerFrame,
  CharacterEndpoints,
  type CallSession,
  type CallStreamClientFrame,
} from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { api } from '../data/client.js';
import { useRemote, friendlyError } from '../data/use-remote.js';
import { useUpdates } from '../data/updates.js';
import { useChat } from '../app/chat.js';
import { CharacterAvatar } from './character-avatar.js';
import { Dialog, showToast } from './toast.js';
import { formatDuration, isIPhone, voicePlayer } from './media.js';

/*
 * 网页语音通话（MED-06、MED-07；call.md、media-l5.md 第 7 节；ADR-0025 音频流协议）。
 * 信令走 CallEndpoints；音频走 WebSocket：上行 PCM16 / 16 kHz / 单声道（每帧约 40 ms），
 * 下行 PCM16（采样率见 call.ready）。客户端做简单的语音活动检测，角色说话时用户开口即发 barge_in 打断。
 * 任何地方都不出现费用提示（MED-06 第 10 条）。
 */

// ---------- 能力判断（iPhone 可行性结论见 docs/web/media-and-call.md） ----------

export type CallSupport = 'ok' | 'iphone' | 'browser';
export function callSupport(): CallSupport {
  const w = window as typeof window & { webkitAudioContext?: typeof AudioContext };
  const apis =
    !!navigator.mediaDevices?.getUserMedia &&
    typeof WebSocket !== 'undefined' &&
    !!(w.AudioContext || w.webkitAudioContext) &&
    window.isSecureContext;
  if (isIPhone()) {
    const match = /OS (\d+)_(\d+)/.exec(navigator.userAgent);
    // iPadOS 桌面模式 UA 不带版本号：只看接口是否齐全。
    if (!match) return apis ? 'ok' : 'iphone';
    const version = Number(match[1]) + Number(match[2]) / 100;
    return apis && version >= 16.04 ? 'ok' : 'iphone';
  }
  return apis ? 'ok' : 'browser';
}

function newAudioContext(): AudioContext {
  const w = window as typeof window & { webkitAudioContext?: typeof AudioContext };
  const Ctor = w.AudioContext ?? w.webkitAudioContext!;
  const ctx = new Ctor();
  void ctx.resume().catch(() => {});
  return ctx;
}

// ---------- 音频引擎 ----------

interface EngineEvents {
  ready(): void;
  state(state: string, durationSec: number): void;
  speaking(value: boolean): void;
  ending(outcome: string): void;
  reconnecting(value: boolean): void;
  failed(): void;
}

class CallEngine {
  private ws: WebSocket | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private sink: GainNode | null = null;
  private outputRate = 24000;
  private nextTime = 0;
  private sources: AudioBufferSourceNode[] = [];
  private agentSpeaking = false;
  private loud = 0;
  private muted = false;
  private closed = false;
  private ready = false;
  private pinger = 0;
  private lostAt = 0;
  constructor(
    private readonly callId: string,
    private readonly ctx: AudioContext,
    private readonly events: EngineEvents,
  ) {}
  async start(stream: MediaStream, ticket: { path: string; token: string }) {
    this.stream = stream;
    this.connect(ticket);
  }
  private connect(ticket: { path: string; token: string }) {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(
      `${scheme}://${location.host}${ticket.path}?token=${encodeURIComponent(ticket.token)}`,
    );
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.lostAt = 0;
      this.events.reconnecting(false);
      this.send({
        type: 'hello',
        data: { inputSampleRate: 16000, clientTime: new Date().toISOString() },
      });
      if (this.muted) this.send({ type: 'mute', data: { muted: true } });
      window.clearInterval(this.pinger);
      this.pinger = window.setInterval(
        () => this.send({ type: 'ping', data: { clientTime: new Date().toISOString() } }),
        15_000,
      );
    };
    ws.onmessage = (event) => {
      if (typeof event.data === 'string') this.control(event.data);
      else if (event.data instanceof ArrayBuffer) this.play(event.data);
    };
    ws.onclose = () => {
      window.clearInterval(this.pinger);
      if (this.ws !== ws || this.closed) return;
      this.reconnect();
    };
  }
  private reconnect() {
    if (!this.lostAt) this.lostAt = Date.now();
    this.events.reconnecting(true);
    if (Date.now() - this.lostAt > CALL_LIMITS.reconnectGraceSec * 1000) {
      this.events.failed();
      return;
    }
    window.setTimeout(() => {
      if (this.closed) return;
      void api
        .call(CallEndpoints.renewStreamTicket, { params: { callId: this.callId } })
        .then((ticket) => !this.closed && this.connect(ticket))
        .catch(() => !this.closed && this.reconnect());
    }, 1500);
  }
  private control(raw: string) {
    let frame: CallStreamServerFrame;
    try {
      frame = CallStreamServerFrame.parse(JSON.parse(raw));
    } catch {
      return;
    }
    switch (frame.type) {
      case 'call.ready':
        this.outputRate = frame.data.outputSampleRate;
        if (!this.ready) {
          this.ready = true;
          this.capture();
        }
        this.events.ready();
        break;
      case 'call.state':
        this.events.state(frame.data.state, frame.data.durationSec);
        break;
      case 'call.agent_speaking':
        this.agentSpeaking = frame.data.speaking;
        this.events.speaking(frame.data.speaking);
        break;
      case 'call.ending':
        this.events.ending(frame.data.outcome);
        break;
      default:
        break;
    }
  }
  private send(frame: CallStreamClientFrame) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(frame));
  }
  /** 麦克风 → 16 kHz PCM16 上行；同时做能量检测用于打断。 */
  private capture() {
    if (!this.stream) return;
    const source = this.ctx.createMediaStreamSource(this.stream);
    const processor = this.ctx.createScriptProcessor(2048, 1, 1);
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    const ratio = this.ctx.sampleRate / 16000;
    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      let energy = 0;
      for (let i = 0; i < input.length; i += 1) energy += input[i]! * input[i]!;
      const rms = Math.sqrt(energy / input.length);
      if (this.muted) return;
      // 语音活动检测：角色说话时连续约 120 ms 明显有声 = 用户打断。
      if (this.agentSpeaking && rms > 0.04) {
        this.loud += 1;
        if (this.loud === 3) {
          this.send({ type: 'barge_in', data: { at: new Date().toISOString() } });
          this.flush();
        }
      } else this.loud = 0;
      const length = Math.floor(input.length / ratio);
      const pcm = new Int16Array(length);
      for (let i = 0; i < length; i += 1) {
        const sample = Math.max(-1, Math.min(1, input[Math.floor(i * ratio)]!));
        pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(pcm.buffer);
    };
    source.connect(processor);
    processor.connect(sink);
    sink.connect(this.ctx.destination);
    this.processor = processor;
    this.sink = sink;
  }
  private play(data: ArrayBuffer) {
    const pcm = new Int16Array(data);
    if (!pcm.length) return;
    const buffer = this.ctx.createBuffer(1, pcm.length, this.outputRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i += 1) channel[i] = pcm[i]! / 0x8000;
    const node = this.ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(this.ctx.destination);
    const at = Math.max(this.nextTime, this.ctx.currentTime + 0.05);
    node.start(at);
    this.nextTime = at + buffer.duration;
    this.sources.push(node);
    node.onended = () => {
      this.sources = this.sources.filter((s) => s !== node);
    };
  }
  private flush() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        // 已结束
      }
    }
    this.sources = [];
    this.nextTime = 0;
  }
  setMuted(value: boolean) {
    this.muted = value;
    this.send({ type: 'mute', data: { muted: value } });
  }
  close() {
    this.closed = true;
    window.clearInterval(this.pinger);
    this.flush();
    this.processor?.disconnect();
    this.sink?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ws?.close();
    void this.ctx.close().catch(() => {});
  }
}

// ---------- 状态与界面 ----------

type Phase = 'outgoing' | 'incoming' | 'active' | 'ended';
interface CallView {
  call: CallSession;
  phase: Phase;
  minimized: boolean;
  durationSec: number;
  reconnecting: boolean;
  speaking: boolean;
  muted: boolean;
  endText: string | null;
  /** 页面刷新后恢复的通话：要用户点一下才能重新接上声音（浏览器要求手势）。 */
  detached: boolean;
}

interface CallContextValue {
  view: CallView | null;
  start(characterId: string): void;
  showIncoming(call: CallSession): void;
}
const CallContext = createContext<CallContextValue | null>(null);
export function useCall() {
  const value = useContext(CallContext);
  if (!value) throw new Error('CallProvider missing');
  return value;
}

/**
 * 私聊「+」/ 资料页的语音通话入口状态：visible = 平台开通了语音服务（未开通时不显示，MED-06 第 11 条）；
 * privateMode = 3.28（H2）该角色正处于私密模式，私密模式只开放文字和图片，入口置灰并说明。
 */
export function useCallAccess(characterId: string | undefined): {
  visible: boolean;
  privateMode: boolean;
} {
  const remote = useRemote(CallEndpoints.getAvailability, {
    query: { characterId: characterId ?? '' },
    networkOnly: true,
  });
  if (!characterId || !remote.data) return { visible: false, privateMode: false };
  return {
    visible: remote.data.reason !== 'service_disabled',
    privateMode: remote.data.reason === 'private_mode',
  };
}

export function useCallEntry(characterId: string | undefined) {
  return useCallAccess(characterId).visible;
}

/** 3.28（H2）：私密模式不能语音通话时的说明。 */
export const PRIVATE_MODE_CALL_HINT = '私密模式只支持文字和图片，切换到其他模式后才能语音通话';

async function askMicrophone(): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
  } catch {
    return null;
  }
}

function endText(outcome: string | null, durationSec: number) {
  if (outcome === 'time_limit') return '通话已达到时长上限';
  if (outcome === 'insufficient_balance') return '积分不足，通话已结束';
  if (outcome === 'declined' || outcome === 'missed') return '对方未接听';
  if (outcome === 'failed') return '网络中断，通话已结束';
  if (durationSec > 0) return `通话结束 ${formatDuration(durationSec)}`;
  return '通话已结束';
}

export function CallProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { state } = useChat();
  const [view, setView] = useState<CallView | null>(null);
  const [dialog, setDialog] = useState<null | 'iphone' | 'browser' | 'balance' | 'mic'>(null);
  const engine = useRef<CallEngine | null>(null);
  const viewRef = useRef<CallView | null>(null);
  viewRef.current = view;
  const patch = useCallback((next: Partial<CallView>) => {
    setView((v) => (v ? { ...v, ...next } : v));
  }, []);
  const finish = useCallback((outcome: string | null) => {
    engine.current?.close();
    engine.current = null;
    setView((v) =>
      v && v.phase !== 'ended'
        ? { ...v, phase: 'ended', minimized: false, endText: endText(outcome, v.durationSec) }
        : v,
    );
    window.setTimeout(() => setView((v) => (v?.phase === 'ended' ? null : v)), 1000);
  }, []);
  const attach = useCallback(
    async (
      call: CallSession,
      ticket: { path: string; token: string },
      ctx: AudioContext,
      stream: MediaStream,
    ) => {
      const instance = new CallEngine(call.callId, ctx, {
        ready: () => patch({ reconnecting: false }),
        state: (s, durationSec) => {
          if (s === 'active') patch({ phase: 'active', durationSec });
          if (s === 'ended') finish(null);
        },
        speaking: (speaking) => patch({ speaking }),
        ending: (outcome) => finish(outcome),
        reconnecting: (reconnecting) => patch({ reconnecting }),
        failed: () => {
          void api.call(CallEndpoints.hangUp, { params: { callId: call.callId } }).catch(() => {});
          finish('failed');
        },
      });
      engine.current = instance;
      await instance.start(stream, ticket);
    },
    [finish, patch],
  );
  const base = (call: CallSession, phase: Phase): CallView => ({
    call,
    phase,
    minimized: false,
    durationSec: call.durationSec,
    reconnecting: false,
    speaking: false,
    muted: false,
    endText: null,
    detached: false,
  });

  const start = useCallback(
    (characterId: string) => {
      const current = viewRef.current;
      if (current && current.phase !== 'ended') {
        patch({ minimized: false });
        return;
      }
      const support = callSupport();
      if (support !== 'ok') {
        setDialog(support);
        return;
      }
      // 必须在点击的同一个调用栈里创建 AudioContext（iPhone 要求用户手势）。
      const ctx = newAudioContext();
      voicePlayer.stop();
      void (async () => {
        try {
          const availability = await api.call(CallEndpoints.getAvailability, {
            query: { characterId },
            networkOnly: true,
          });
          if (!availability.available) {
            void ctx.close();
            if (availability.reason === 'insufficient_balance') setDialog('balance');
            else if (availability.reason === 'private_mode')
              showToast(PRIVATE_MODE_CALL_HINT, 3000, 'info');
            else if (availability.reason === 'busy') {
              const active = await api.call(CallEndpoints.getActiveCall, { networkOnly: true });
              if (active.call) setView({ ...base(active.call, 'active'), detached: true });
            } else showToast('暂时无法通话');
            return;
          }
          const stream = await askMicrophone();
          if (!stream) {
            void ctx.close();
            setDialog('mic');
            return;
          }
          const call = await api.call(CallEndpoints.startCall, {
            body: { characterId, clientRequestId: crypto.randomUUID() },
          });
          setView(base(call, 'outgoing'));
          if (call.stream) await attach(call, call.stream, ctx, stream);
        } catch (e) {
          void ctx.close().catch(() => {});
          if (e instanceof ApiFailure && e.code === 'insufficient_balance') setDialog('balance');
          else if (e instanceof ApiFailure && e.code === 'private_mode_unsupported')
            showToast(PRIVATE_MODE_CALL_HINT, 3000, 'info');
          else showToast(friendlyError(e));
        }
      })();
    },

    [attach, patch],
  );
  const showIncoming = useCallback((call: CallSession) => {
    if (viewRef.current && viewRef.current.phase !== 'ended') return;
    if (callSupport() !== 'ok') return;
    voicePlayer.stop();
    setView(base(call, 'incoming'));
  }, []);
  async function answer() {
    if (!view) return;
    const ctx = newAudioContext();
    const stream = await askMicrophone();
    if (!stream) {
      void ctx.close();
      setDialog('mic');
      return;
    }
    try {
      const call = await api.call(CallEndpoints.answerCall, {
        params: { callId: view.call.callId },
      });
      patch({ call, phase: 'active' });
      if (call.stream) await attach(call, call.stream, ctx, stream);
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      showToast(e instanceof ApiFailure && e.code === 'conflict' ? '通话已结束' : friendlyError(e));
      setView(null);
    }
  }
  function decline() {
    if (!view) return;
    void api
      .call(CallEndpoints.declineCall, { params: { callId: view.call.callId } })
      .catch(() => {});
    setView(null);
  }
  function hangUp() {
    if (!view) return;
    void api.call(CallEndpoints.hangUp, { params: { callId: view.call.callId } }).catch(() => {});
    finish(view.phase === 'outgoing' ? 'cancelled' : 'completed');
  }
  /** 刷新页面后恢复的通话：在点击里重新接上音频。 */
  async function reattach() {
    if (!view) return;
    const ctx = newAudioContext();
    const stream = await askMicrophone();
    if (!stream) {
      void ctx.close();
      setDialog('mic');
      return;
    }
    try {
      const ticket = await api.call(CallEndpoints.renewStreamTicket, {
        params: { callId: view.call.callId },
      });
      patch({ detached: false, minimized: false });
      await attach(view.call, ticket, ctx, stream);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      finish('failed');
    }
  }

  // 多设备同步：别的设备接听 / 对方结束；收到来电。
  useUpdates((update) => {
    if (update.type !== 'call.updated') return;
    const call = (update.data as { call?: CallSession } | undefined)?.call;
    if (!call) return;
    const current = viewRef.current;
    if (current?.call.callId === call.callId) {
      if (call.state === 'ended') {
        if (current.phase === 'incoming') setView(null);
        else finish(call.outcome);
      } else if (current.phase === 'incoming' && call.state !== 'ringing' && !engine.current)
        setView(null); // 另一台设备接听了
      else if (call.state === 'active' && current.phase === 'outgoing') patch({ phase: 'active' });
      return;
    }
    if (call.direction === 'incoming' && call.state === 'ringing') showIncoming(call);
  });
  // 启动时恢复进行中的通话（显示胶囊，点一下重新接上声音）。
  useEffect(() => {
    void api
      .call(CallEndpoints.getActiveCall, { networkOnly: true })
      .then(({ call }) => {
        if (!call || viewRef.current) return;
        if (call.direction === 'incoming' && call.state === 'ringing') showIncoming(call);
        else if (call.state === 'active' || call.state === 'connecting')
          setView({ ...base(call, 'active'), minimized: true, detached: true });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 计时（以服务器 call.state 为准，本地每秒补走）。
  useEffect(() => {
    if (view?.phase !== 'active') return;
    const timer = window.setInterval(() => {
      setView((v) => (v && v.phase === 'active' ? { ...v, durationSec: v.durationSec + 1 } : v));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [view?.phase]);
  // 来电 30 秒无人接听：界面淡出（服务器记未接）。
  useEffect(() => {
    if (view?.phase !== 'incoming') return;
    const timer = window.setTimeout(() => setView(null), CALL_LIMITS.ringTimeoutSec * 1000);
    return () => window.clearTimeout(timer);
  }, [view?.phase]);
  useEffect(() => () => engine.current?.close(), []);

  const contact = view
    ? state.contacts.find((c) => c.characterId === view.call.characterId)
    : undefined;
  return (
    <CallContext.Provider value={{ view, start, showIncoming }}>
      {children}
      {view && view.minimized && view.phase !== 'ended' && (
        <button
          className="call-capsule"
          onClick={() => (view.detached ? void reattach() : patch({ minimized: false }))}
        >
          通话中 {formatDuration(view.durationSec)}
        </button>
      )}
      {view && !view.minimized && (
        <CallScreen
          view={view}
          remark={contact?.remark ?? null}
          onMinimize={() => patch({ minimized: true })}
          onAnswer={() => void answer()}
          onDecline={decline}
          onHangUp={hangUp}
          onReattach={() => void reattach()}
          onMute={() => {
            const muted = !view.muted;
            engine.current?.setMuted(muted);
            patch({ muted });
          }}
          onOpenChat={() => {
            patch({ minimized: true });
            navigate(`/chat/${view.call.conversationId}`);
          }}
        />
      )}
      {dialog === 'iphone' && (
        <Dialog
          title="iPhone 网页版暂不支持语音通话"
          actions={[{ label: '知道了', tone: 'primary', onClick: () => setDialog(null) }]}
        >
          <p className="hint">
            请把 iPhone 升级到 iOS 16.4 或更高版本，并用 Safari 或主屏幕上的微伴打开
          </p>
        </Dialog>
      )}
      {dialog === 'browser' && (
        <Dialog
          title="当前浏览器暂不支持语音通话"
          actions={[{ label: '知道了', tone: 'primary', onClick: () => setDialog(null) }]}
        />
      )}
      {dialog === 'balance' && (
        <Dialog
          title="积分不足，暂时无法通话"
          actions={[
            { label: '取消', onClick: () => setDialog(null) },
            {
              label: '去充值',
              tone: 'primary',
              onClick: () => {
                setDialog(null);
                navigate('/wallet/recharge');
              },
            },
          ]}
        />
      )}
      {dialog === 'mic' && (
        <Dialog
          title="需要麦克风权限才能通话"
          actions={[{ label: '知道了', tone: 'primary', onClick: () => setDialog(null) }]}
        >
          <p className="hint">请在浏览器地址栏左侧的网站设置里允许麦克风</p>
        </Dialog>
      )}
    </CallContext.Provider>
  );
}

/** 回铃（4.13）：呼出等待时循环播放 realtime_call_ringback.mp3，来电时同样响铃。 */
function useRingback(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const audio = new Audio('/assets/old-ui/audio/realtime_call_ringback.mp3');
    audio.loop = true;
    void audio.play().catch(() => {});
    return () => {
      audio.pause();
      audio.src = '';
    };
  }, [on]);
}

/** 通话页（4.13）：头像放大模糊铺底 + 压暗；名字 28 / 600；状态行；168 大头像；三键控制区。 */
function CallScreen({
  view,
  remark,
  onMinimize,
  onAnswer,
  onDecline,
  onHangUp,
  onMute,
  onReattach,
  onOpenChat,
}: {
  view: CallView;
  remark: string | null;
  onMinimize(): void;
  onAnswer(): void;
  onDecline(): void;
  onHangUp(): void;
  onMute(): void;
  onReattach(): void;
  onOpenChat(): void;
}) {
  const profile = useRemote(CharacterEndpoints.getProfile, {
    params: { characterId: view.call.characterId },
  });
  const name = remark || profile.data?.name || '角色';
  useRingback(view.phase === 'outgoing' || view.phase === 'incoming');
  const status =
    view.phase === 'ended'
      ? view.endText
      : view.reconnecting
        ? '网络不佳，正在重连…'
        : view.phase === 'outgoing'
          ? '等待对方接受邀请'
          : view.phase === 'incoming'
            ? '邀请你语音通话'
            : view.detached
              ? '点击下方按钮继续通话'
              : `通话中 ${formatDuration(view.durationSec)}`;
  return (
    <div
      className={`call-screen wx-call-screen ${view.phase === 'ended' ? 'ending' : ''}`}
      role="dialog"
      aria-label="语音通话"
    >
      <div className="wx-call-backdrop" aria-hidden>
        <CharacterAvatar id={view.call.characterId} size={168} radius={0} />
      </div>
      <i className="wx-call-shade" aria-hidden />
      {view.phase === 'active' && (
        <button className="call-minimize" aria-label="缩小" onClick={onMinimize}>
          <CaretDown size={24} />
        </button>
      )}
      <div className="wx-call-top">
        <strong className="wx-call-name">{name}</strong>
        <span className="wx-call-status numeric">{status}</span>
        {view.phase !== 'ended' && view.phase !== 'incoming' && (
          <span className="wx-call-note">离开此页即挂断</span>
        )}
        {view.phase === 'active' && view.speaking && (
          <span className="voice-wave call-wave" aria-label="对方正在说话">
            <i />
            <i />
            <i />
          </span>
        )}
      </div>
      <span className={`wx-call-avatar ${view.phase === 'incoming' ? 'ringing' : ''}`}>
        <CharacterAvatar id={view.call.characterId} size={168} radius={18} />
      </span>
      {view.phase !== 'ended' && (
        <div className={`wx-call-controls ${view.phase === 'incoming' ? 'incoming' : ''}`}>
          {view.phase === 'incoming' ? (
            <>
              <CallButton label="拒绝" kind="decline" onClick={onDecline} icon="drawn/hangup" />
              <CallButton label="接听" kind="accept" onClick={onAnswer} icon="drawn/phone" />
            </>
          ) : view.phase === 'outgoing' ? (
            <>
              <CallButton
                label={view.muted ? '麦克风已关' : '麦克风已开'}
                kind={view.muted ? 'off' : 'on'}
                onClick={onMute}
                icon={view.muted ? 'drawn/mic_off' : 'drawn/mic'}
              />
              <CallButton label="取消" kind="decline" onClick={onHangUp} icon="drawn/hangup" />
              <CallButton label="收起" kind="off" onClick={onOpenChat} icon="wechat/chevron_down" />
            </>
          ) : view.detached ? (
            <>
              <CallButton label="挂断" kind="decline" onClick={onHangUp} icon="drawn/hangup" />
              <CallButton label="继续" kind="accept" onClick={onReattach} icon="drawn/phone" />
            </>
          ) : (
            <>
              <CallButton
                label={view.muted ? '麦克风已关' : '麦克风已开'}
                kind={view.muted ? 'off' : 'on'}
                onClick={onMute}
                icon={view.muted ? 'drawn/mic_off' : 'drawn/mic'}
              />
              <CallButton label="挂断" kind="decline" onClick={onHangUp} icon="drawn/hangup" />
              <CallButton label="收起" kind="off" onClick={onOpenChat} icon="wechat/chevron_down" />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CallButton({
  label,
  kind,
  icon,
  onClick,
}: {
  label: string;
  kind: 'accept' | 'decline' | 'on' | 'off';
  icon: string;
  onClick(): void;
}) {
  return (
    <span className="wx-call-key">
      <button className={`wx-call-round ${kind}`} aria-label={label} onClick={onClick}>
        <OldIcon name={icon} size={28} />
      </button>
      <small>{label}</small>
    </span>
  );
}

/** 来电推送的落地页 /calls/:callId：仍在响铃且浏览器能通话 → 来电页；否则进私聊（看通话记录）。 */
export function CallLinkPage() {
  const { callId = '' } = useParams();
  const navigate = useNavigate();
  const { showIncoming } = useCall();
  useEffect(() => {
    let active = true;
    void api
      .call(CallEndpoints.getCall, { params: { callId }, networkOnly: true })
      .then((call) => {
        if (!active) return;
        if (call.direction === 'incoming' && call.state === 'ringing' && callSupport() === 'ok')
          showIncoming(call);
        navigate(`/chat/${call.conversationId}`, { replace: true });
      })
      .catch(() => active && navigate('/chat', { replace: true }));
    return () => {
      active = false;
    };
  }, [callId, navigate, showIncoming]);
  return (
    <main className="empty" role="status">
      正在打开…
    </main>
  );
}

/** 资料页「语音通话」：平台未开通时不显示。 */
export function ProfileCallButton({ characterId }: { characterId: string }) {
  const access = useCallAccess(characterId);
  const { start } = useCall();
  if (!access.visible) return null;
  return (
    <button
      className={access.privateMode ? 'profile-action muted' : 'profile-action'}
      aria-disabled={access.privateMode || undefined}
      onClick={() =>
        access.privateMode ? showToast(PRIVATE_MODE_CALL_HINT, 3000, 'info') : start(characterId)
      }
    >
      <OldIcon name="wechat/voice_call" size={20} />
      语音通话
    </button>
  );
}
