import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChannelEndpoints,
  type ChannelCharacter,
  type ChannelId,
  type ChannelState,
  type WechatQrAttempt,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { friendlyError } from '../data/use-remote.js';
import { Dialog, showToast } from './toast.js';
import { GroupHeader, MenuGroup, MenuRow, NavBar, Sheet, showComingSoon } from './shell-kit.js';
import { encodeQr } from './qr-code.js';

/**
 * 插件（设置 › 插件）：外部渠道接入。
 *
 * 2026-10-25 按真实旧协议重做（没有外部网关、没有 webhook）：
 * - 微信 = iLink 扫码：服务器出码 → 页面画二维码 → 微信扫一扫 → 服务器轮询扫码状态 → 绑定成功。
 *   之后微信里的文字会经服务器长轮询进来，交给现有私聊与计费链路；角色的回复再发回微信。
 * - 微博 = 用户自己的 AppID / AppSecret 换 ws_token（通道默认关闭，未实网验证，页面如实说明）。
 *
 * 安全与边界（界面上也这么写，不藏）：
 * - 二维码在本机用 canvas 画出来，不加载任何外部图片（站点 CSP 是 img-src 'self' blob: data:）。
 * - bot_token / AppSecret 只在服务器解密使用；页面只显示角色名和掩码后的账号。
 * - 重新扫码 / 解绑会让微信里那条旧会话失效；如果旧版微伴也接过同一个微信，两边不能同时用。
 */

const CHANNEL_ROWS: ReadonlyArray<{ id: 'wechat' | 'qq' | 'weibo'; label: string }> = [
  { id: 'wechat', label: '微信接入' },
  { id: 'qq', label: 'QQ接入' },
  { id: 'weibo', label: '微博接入' },
];

function statusText(state: ChannelState | null): string {
  if (!state) return '未绑定';
  if (state.status === 'active') return '已绑定';
  if (state.status === 'pending') return '待扫码';
  if (state.status === 'revoked') return '已失效';
  if (state.integration === 'not_configured') return '尚未配置';
  if (state.integration === 'not_integrated') return '未联调';
  return '未绑定';
}

function subtitleOf(state: ChannelState): string {
  if (state.status === 'active') {
    const who = state.characterName ?? state.accountMasked ?? '已绑定';
    return `${who} · ${state.channel === 'wechat' ? '微信' : '微博'}`;
  }
  if (state.status === 'pending') return '已生成二维码，等微信扫码确认';
  if (state.integration === 'not_configured') return '服务器缺少接入配置，请联系管理员';
  if (state.integration === 'not_integrated') return '通道尚未开通（默认关闭），暂不能绑定';
  return state.description;
}

function timeText(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

export function PluginsPage() {
  const [items, setItems] = useState<ChannelState[] | null>(null);
  const [characters, setCharacters] = useState<ChannelCharacter[]>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<'wechat' | 'weibo' | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.call(ChannelEndpoints.list);
      setItems(data.items);
      setCharacters(data.characters);
      setError('');
    } catch (e) {
      setError(friendlyError(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const current = open ? (items?.find((item) => item.channel === open) ?? null) : null;

  return (
    <main>
      <NavBar title="插件" fallback="/settings" />
      {error && (
        <p className="page-note" role="alert">
          {error}{' '}
          <button className="text-button" type="button" onClick={() => void load()}>
            重试
          </button>
        </p>
      )}
      <GroupHeader>外部渠道</GroupHeader>
      <MenuGroup>
        {CHANNEL_ROWS.map((row) => {
          if (row.id === 'qq') {
            return (
              <MenuRow
                key="qq"
                label="QQ接入"
                subtitle="在QQ中与角色聊天"
                value="暂未开放"
                onClick={showComingSoon}
              />
            );
          }
          const state = items?.find((item) => item.channel === row.id) ?? null;
          const channel = row.id;
          const text = statusText(state);
          return (
            <MenuRow
              key={row.id}
              label={row.label}
              subtitle={state ? subtitleOf(state) : '正在读取接入状态…'}
              value={
                text === '已绑定' || text === '待扫码' ? (
                  <span className="ink-brand">{text}</span>
                ) : (
                  text
                )
              }
              onClick={() => {
                if (!state) return;
                setOpen(channel);
              }}
            />
          );
        })}
      </MenuGroup>
      <p className="page-note">
        微信接入用微信扫一扫把角色接到微信里；微博接入要用你自己的微博开放平台 AppID / AppSecret。
        QQ 暂未开放。
      </p>
      {open && current && (
        <ChannelSheet
          key={current.channel}
          state={current}
          characters={characters}
          onClose={() => setOpen(null)}
          onChanged={load}
        />
      )}
    </main>
  );
}

function ChannelSheet({
  state,
  characters,
  onClose,
  onChanged,
}: {
  state: ChannelState;
  characters: ChannelCharacter[];
  onClose(): void;
  onChanged(): Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [attempt, setAttempt] = useState<WechatQrAttempt | null>(null);
  const [characterId, setCharacterId] = useState(state.characterId ?? '');
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const live = state.integration === 'live';
  // 契约里 channel 是容错枚举（未来可能出现不认识的渠道）：这里只认微信 / 微博两种。
  const channel: ChannelId | null =
    state.channel === 'wechat' || state.channel === 'weibo' ? state.channel : null;

  // 二维码状态：只在等扫码时每 2.5 秒问一次；服务器那边是真实 get_qrcode_status。
  useEffect(() => {
    if (!attempt || attempt.status !== 'wait') return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const next = await api.call(ChannelEndpoints.wechatQrStatus, {
          params: { attemptId: attempt.attemptId },
        });
        if (cancelled) return;
        if (next.status === 'confirmed') {
          setAttempt(null);
          await onChanged();
          showToast('微信已连接', 2000, 'success');
        } else if (next.status === 'expired') {
          setAttempt(next);
        } else {
          setAttempt({ ...next, bindUrl: attempt.bindUrl });
        }
      } catch {
        if (!cancelled) setAttempt({ ...attempt });
      }
    }, 2500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [attempt, onChanged]);

  async function startBinding() {
    if (!characterId) {
      setError('先选一个角色');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await api.call(ChannelEndpoints.wechatQr, { body: { characterId } });
      setAttempt(result);
      await onChanged();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveCharacter() {
    if (!characterId || !channel) return;
    setBusy(true);
    setError('');
    try {
      await api.call(ChannelEndpoints.setCharacter, {
        params: { channel },
        body: { characterId },
      });
      await onChanged();
      showToast('出口角色已切换', 2000, 'success');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function connectWeibo() {
    if (!characterId || !appId.trim() || !appSecret.trim()) {
      setError('请先选好角色，并填 AppID 与 AppSecret');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.call(ChannelEndpoints.weiboConnect, {
        body: { characterId, appId: appId.trim(), appSecret: appSecret.trim() },
      });
      setAppSecret('');
      await onChanged();
      showToast('微博凭据已保存', 2000, 'success');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function unbind() {
    if (!channel) return;
    setBusy(true);
    setError('');
    try {
      await api.call(ChannelEndpoints.unbind, { params: { channel } });
      await onChanged();
      showToast('已解除绑定', 2000, 'success');
      onClose();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  const channelLabel = state.channel === 'wechat' ? '微信' : '微博';

  return (
    <Sheet title={state.name} onClose={onClose} closeDisabled={busy}>
      <div>
        {state.status === 'active' ? (
          <>
            <MenuGroup>
              <MenuRow label="出口角色" value={state.characterName ?? '—'} chevron={false} />
              <MenuRow
                label="账号"
                value={state.accountName ?? state.accountMasked ?? '—'}
                chevron={false}
              />
              <MenuRow label="绑定时间" value={timeText(state.boundAt)} chevron={false} />
              <MenuRow label="最近一次消息" value={timeText(state.lastEventAt)} chevron={false} />
            </MenuGroup>
            {live && (
              <>
                <GroupHeader>换谁在{channelLabel}里回你</GroupHeader>
                <CharacterPicker
                  characters={characters}
                  selectedId={characterId}
                  onSelect={setCharacterId}
                />
                <button
                  className="primary full"
                  type="button"
                  disabled={busy || !characterId || characterId === state.characterId}
                  onClick={() => void saveCharacter()}
                >
                  {busy ? '保存中…' : '保存出口角色'}
                </button>
              </>
            )}
            <p className="page-note">
              对方在{channelLabel}里发给 TA 的文字会转进微伴，由「
              {state.characterName ?? '这个角色'}」回复； 回复再发回{channelLabel}
              。图片、语音、表情暂时不在{channelLabel}里收发。
            </p>
            <p className="page-note">
              解除绑定或重新绑定会让{channelLabel}里那条旧会话失效。如果你在旧版微伴里也接过同一个
              {channelLabel}，请先在旧版解绑——两个版本不能同时接管同一个账号。
            </p>
            <MenuGroup>
              <MenuRow
                label="解除绑定"
                danger
                chevron={false}
                onClick={() => !busy && setConfirming(true)}
              />
            </MenuGroup>
          </>
        ) : !live ? (
          <>
            <p className="page-note">
              {state.integration === 'not_configured'
                ? `${state.name}缺少服务器配置，请联系管理员。现在不影响其他功能。`
                : `${state.name}通道还没有开通（服务器默认关闭）。页面和数据都按真实协议做好，但本轮没有在真实账号上打通验证，所以不会假装可用。`}
            </p>
            {state.lastError && <p className="page-note">{state.lastError}</p>}
          </>
        ) : state.channel === 'wechat' ? (
          <>
            <p className="page-note">
              绑定后，你在微信里发给这个 ClawBot 的文字会由选中的角色回复。
              二维码用微信「扫一扫」，约 2 分钟有效；重新生成会让上一张码立刻作废。
            </p>
            <p className="page-note">
              注意：如果你在旧版微伴里接过同一个微信，请先在旧版解绑，否则两边会互相抢会话。
            </p>
            <CharacterPicker
              characters={characters}
              selectedId={characterId}
              onSelect={setCharacterId}
            />
            {attempt && attempt.status === 'wait' ? (
              <>
                <QrImage text={attempt.bindUrl} />
                <p className="page-note">
                  打开微信 → 右上角「+」→ 扫一扫 → 扫上面的二维码
                  {attempt.characterName ? `（出口角色：${attempt.characterName}）` : ''}。
                  同一部手机可以先截图，再从微信扫一扫右下角相册选这张图。
                </p>
                <p className="page-note">
                  等扫码确认中…（这张码在{' '}
                  {new Date(attempt.expiresAt).toLocaleTimeString('zh-CN', { hour12: false })}{' '}
                  前有效）
                </p>
                {attempt.lastError && <p className="page-note">{attempt.lastError}</p>}
                <button
                  className="primary full"
                  type="button"
                  disabled={busy}
                  onClick={() => void startBinding()}
                >
                  {busy ? '正在重新生成…' : '重新生成二维码'}
                </button>
              </>
            ) : (
              <>
                {attempt?.status === 'expired' && (
                  <p className="page-note">{attempt.lastError ?? '二维码已过期，请重新生成。'}</p>
                )}
                <button
                  className="primary full"
                  type="button"
                  disabled={busy || !characterId}
                  onClick={() => void startBinding()}
                >
                  {busy ? '正在生成…' : '生成绑定二维码'}
                </button>
              </>
            )}
            {state.lastError && <p className="page-note">{state.lastError}</p>}
          </>
        ) : (
          <>
            <p className="page-note">
              微博接入要用你自己的微博开放平台 AppID / AppSecret：服务器用它换一次 ws_token
              校验，校验通过后按你的密钥（DEK）加密保存。
            </p>
            {live ? (
              <>
                <CharacterPicker
                  characters={characters}
                  selectedId={characterId}
                  onSelect={setCharacterId}
                />
                <div className="wx-auth-fields">
                  <label className="wx-auth-field">
                    <span>AppID</span>
                    <input
                      value={appId}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="微博开放平台的 AppID"
                      onChange={(event) => setAppId(event.target.value)}
                    />
                  </label>
                  <label className="wx-auth-field">
                    <span>AppSecret</span>
                    <input
                      value={appSecret}
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="微博开放平台的 AppSecret"
                      onChange={(event) => setAppSecret(event.target.value)}
                    />
                  </label>
                </div>
                <button
                  className="primary full"
                  type="button"
                  disabled={busy}
                  onClick={() => void connectWeibo()}
                >
                  {busy ? '正在校验…' : '连接微博'}
                </button>
                <p className="page-note">
                  这条通道本轮没有可用的微博账号做联调，属于「已实现、未实网验证」。
                  连接后如果收不到消息，请回到这里解绑并联系管理员。
                </p>
              </>
            ) : (
              <p className="page-note">通道未开通，暂时不能填凭据。</p>
            )}
            {state.lastError && <p className="page-note">{state.lastError}</p>}
          </>
        )}
        {error && (
          <p className="page-note" role="alert">
            {error}
          </p>
        )}
      </div>
      {confirming && (
        <Dialog
          title="解除绑定？"
          actions={[
            { label: '取消', onClick: () => setConfirming(false) },
            { label: '解除', danger: true, onClick: () => void unbind() },
          ]}
        >
          解除后微伴不再接收和回复这个{channelLabel}的消息，之后可以重新绑定。
        </Dialog>
      )}
    </Sheet>
  );
}

function CharacterPicker({
  characters,
  selectedId,
  onSelect,
}: {
  characters: ChannelCharacter[];
  selectedId: string;
  onSelect(id: string): void;
}) {
  if (!characters.length)
    return <p className="page-note">通讯录里还没有可用好友。请先添加好友，再回来选出口角色。</p>;
  return (
    <MenuGroup>
      {characters.map((item) => (
        <MenuRow
          key={item.characterId}
          label={item.name}
          chevron={false}
          value={item.characterId === selectedId ? '已选择' : ''}
          onClick={() => onSelect(item.characterId)}
        />
      ))}
    </MenuGroup>
  );
}

/** 二维码画布：本地生成（不加载外部图片，符合站点 CSP）。 */
function QrImage({ text }: { text: string }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let matrix: ReturnType<typeof encodeQr>;
    try {
      matrix = encodeQr(text);
    } catch {
      return;
    }
    const quiet = 4;
    const modules = matrix.size + quiet * 2;
    const scale = Math.max(1, Math.floor(220 / modules));
    const pixels = modules * scale;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    element.width = pixels * dpr;
    element.height = pixels * dpr;
    element.style.width = `${pixels}px`;
    element.style.height = `${pixels}px`;
    const context = element.getContext('2d');
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 二维码必须纯白底深色模块才能被扫出来：这里刻意不用主题色。
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, pixels, pixels);
    context.fillStyle = '#000000';
    for (let y = 0; y < matrix.size; y++) {
      for (let x = 0; x < matrix.size; x++) {
        if (!matrix.get(x, y)) continue;
        context.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
      }
    }
  }, [text]);
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--wb-space-4) 0' }}>
      <canvas ref={canvas} aria-label="微信绑定二维码" role="img" />
    </div>
  );
}
