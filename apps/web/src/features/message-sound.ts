/*
 * App 内消息提示音（10-19 待办小项，docs/refactor/11-plan-and-open-topics.md C11）。
 * 照旧版 message_sound_service.dart：
 *   - 正在看的聊天里，发出和收到都播 message_receive_wechat.mp3（90ms 防抖）；
 *   - 其他会话（未免打扰）来消息、页面在前台时，播设置里选的「提示音」（IOS / PC，250ms 防抖）；
 *   - 页面在后台时不播，交给系统推送。
 * 与后台音乐混音：播放前把 navigator.audioSession.type 设成 "ambient"（Safari 16.4+ 才有），
 * 不设置 navigator.mediaSession，不抢媒体会话。开关和音色都是本机设置（同深色模式、字体大小）。
 */

const ENABLED_KEY = 'weiban:message-sound';
export const NOTICE_SOUND_KEY = 'weiban:notice-sound';
export const noticeSounds = [
  { value: 'iphone', label: 'IOS提示音', file: '/assets/old-ui/audio/notice_iphone.ogg' },
  { value: 'pc', label: 'PC提示音', file: '/assets/old-ui/audio/notice_pc.ogg' },
] as const;
const MESSAGE_FILE = '/assets/old-ui/audio/message_receive_wechat.mp3';
let memoryEnabled: boolean | null = null;

export function getMessageSoundEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== 'off';
  } catch {
    return true;
  }
}
export function setMessageSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? 'on' : 'off');
  } catch {
    // 无痕模式：只在本次打开时生效
  }
  memoryEnabled = enabled;
}
function enabled(): boolean {
  return memoryEnabled ?? getMessageSoundEnabled();
}

export function getNoticeSound(): string {
  try {
    return localStorage.getItem(NOTICE_SOUND_KEY) ?? 'iphone';
  } catch {
    return 'iphone';
  }
}
export function setNoticeSound(value: string): void {
  try {
    localStorage.setItem(NOTICE_SOUND_KEY, value);
  } catch {
    // 无痕模式：只在本次打开时生效
  }
}

/** 让提示音与正在播放的音乐混在一起，不打断音乐（iOS Safari 16.4+；其他浏览器没有此对象时跳过）。 */
function mixWithOthers(): void {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session && session.type !== 'ambient') {
    try {
      session.type = 'ambient';
    } catch {
      // 个别浏览器只读：忽略
    }
  }
}

const players = new Map<string, HTMLAudioElement>();
function player(file: string): HTMLAudioElement {
  let audio = players.get(file);
  if (!audio) {
    audio = new Audio(file);
    audio.preload = 'auto';
    players.set(file, audio);
  }
  return audio;
}
/** iOS Safari 不支持 ogg：放不了时退回微信提示音 mp3（旧版 web 端同样只用 mp3）。 */
function playable(file: string): string {
  if (!file.endsWith('.ogg')) return file;
  const probe = player(file);
  return probe.canPlayType('audio/ogg') ? file : MESSAGE_FILE;
}

function play(file: string): void {
  mixWithOthers();
  const audio = player(playable(file));
  try {
    audio.currentTime = 0;
  } catch {
    // 尚未加载完：直接播放
  }
  void audio.play().catch(() => {
    // 浏览器拦截自动播放（还没有用户手势）：静默
  });
}

let lastMessage = 0;
let lastNotice = 0;
/** 当前聊天里发出 / 收到一条消息。 */
export function playMessageSound(): void {
  if (!enabled()) return;
  const now = Date.now();
  if (now - lastMessage < 90) return;
  lastMessage = now;
  play(MESSAGE_FILE);
}
/** 其他会话来了新消息（页面在前台）。 */
export function playNoticeSound(): void {
  if (!enabled()) return;
  const now = Date.now();
  if (now - lastNotice < 250) return;
  lastNotice = now;
  const file = noticeSounds.find((s) => s.value === getNoticeSound())?.file ?? noticeSounds[0].file;
  play(file);
}
/** 设置页试听：不受开关与防抖影响。 */
export function previewNoticeSound(value: string): Promise<void> {
  mixWithOthers();
  const file = noticeSounds.find((s) => s.value === value)?.file;
  if (!file) return Promise.resolve();
  const audio = player(playable(file));
  audio.currentTime = 0;
  return audio.play();
}
