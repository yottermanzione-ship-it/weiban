import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChannelEndpoints,
  type ChannelCharacter,
  type ChannelId,
  type ChannelState,
  type WechatQrAttempt,
  type QqPairing,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { friendlyError } from '../data/use-remote.js';
import { AlertDialog, showToast } from './toast.js';
import { GroupHeader, MenuGroup, MenuRow, NavBar, Sheet } from './shell-kit.js';
import { encodeQr } from './qr-code.js';
import { parseWeiboCredentials, wechatBindLink } from '@weiban/client-core';
import { copyText } from './copy-text.js';
import './channel-binding.css';

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
  if (state.status === 'pending') return state.channel === 'qq' ? '待QQ确认' : '待扫码';
  if (state.status === 'revoked') return '已失效';
  if (state.integration === 'not_configured') return '尚未配置';
  if (state.integration === 'not_integrated') return '未联调';
  return '未绑定';
}

function subtitleOf(state: ChannelState): string {
  if (state.status === 'active') {
    const who = state.characterName ?? state.accountMasked ?? '已绑定';
    return `${who} · ${state.channel === 'wechat' ? '微信' : state.channel === 'qq' ? 'QQ' : '微博'}`;
  }
  if (state.status === 'pending')
    return state.channel === 'qq'
      ? '凭据已保存，等待你在QQ发送绑定码'
      : '已生成二维码，等微信扫码确认';
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
  const [open, setOpen] = useState<ChannelId | null>(null);

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
          const state = items?.find((item) => item.channel === row.id) ?? null;
          const channel = row.id;
          const text = statusText(state);
          return (
            <MenuRow
              key={row.id}
              label={row.label}
              subtitle={state ? subtitleOf(state) : '正在读取接入状态…'}
              value={
                text === '已绑定' || text === '待扫码' || text === '待QQ确认' ? (
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
        微信接入用微信扫一扫把角色接到微信里；微博接入用龙虾助手私信发放的 AppID / AppSecret。 QQ
        接入请使用自己的官方机器人，填写凭据后在QQ私聊里发送一次性绑定码。
        旧版微伴的绑定不会自动同步，请在这里分别完成绑定；角色回复按现有积分规则计费。
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
  const [credentials, setCredentials] = useState('');
  const [qqPair, setQqPair] = useState<QqPairing | null>(null);
  const live = state.integration === 'live';
  const contentRef = useRef<HTMLDivElement>(null);
  const linkFieldRef = useRef<HTMLInputElement>(null);
  const bindLink = attempt ? wechatBindLink(attempt.bindUrl, navigator.userAgent) : null;

  useEffect(() => {
    if (attempt?.attemptId) contentRef.current?.closest('.sheet-body')?.scrollTo({ top: 0 });
  }, [attempt?.attemptId]);

  function selectCharacter(id: string) {
    setCharacterId(id);
    if (state.channel === 'wechat' && attempt && id !== attempt.characterId) setAttempt(null);
  }

  async function copyBindLink() {
    if (busy || !bindLink || attempt?.status !== 'wait') return;
    const copied = await copyText(bindLink.bindUrl);
    if (copied) showToast('链接已复制，到微信文件传输助手粘贴并点开', 3000, 'success');
    else {
      linkFieldRef.current?.focus();
      linkFieldRef.current?.select();
      showToast('请长按下方链接手动复制，再到微信中打开', 3000, 'warning');
    }
  }
  // 契约里 channel 是容错枚举（未来可能出现不认识的渠道）：这里只认微信 / 微博两种。
  const channel: ChannelId | null =
    state.channel === 'wechat' || state.channel === 'weibo' || state.channel === 'qq'
      ? state.channel
      : null;

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

  useEffect(() => {
    if (state.channel !== 'qq' || state.status !== 'pending') return;
    let pending = false;
    const timer = window.setInterval(() => {
      if (pending) return;
      pending = true;
      void onChanged().finally(() => {
        pending = false;
      });
    }, 2500);
    return () => window.clearInterval(timer);
  }, [state.channel, state.status, onChanged]);

  async function connectQq(refresh = false) {
    if (!characterId || (!refresh && (!appId.trim() || !appSecret.trim()))) {
      setError('先选日常角色，再填写QQ官方机器人 AppID / AppSecret');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = refresh
        ? await api.call(ChannelEndpoints.qqPairing, { body: { characterId } })
        : await api.call(ChannelEndpoints.qqConnect, {
            body: { characterId, appId: appId.trim(), appSecret: appSecret.trim() },
          });
      setQqPair(result);
      setAppId('');
      setAppSecret('');
      await onChanged();
      contentRef.current?.closest('.sheet-body')?.scrollTo({ top: 0 });
    } catch (error) {
      setError(friendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  async function startBinding() {
    if (!characterId) {
      setError('先选一个角色');
      return;
    }
    setBusy(true);
    setError('');
    setAttempt(null); // 用户要求换新码后，不再展示或复制上一张可能已失效的授权票。
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
    const parsed = credentials.trim()
      ? parseWeiboCredentials(credentials)
      : { appId: appId.trim(), appSecret: appSecret.trim() };
    if (!characterId || !parsed?.appId || !parsed.appSecret) {
      setError('先选好角色，再粘贴助手返回的一组完整凭据，或手动填 AppID 与 AppSecret');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.call(ChannelEndpoints.weiboConnect, {
        body: { characterId, appId: parsed.appId, appSecret: parsed.appSecret },
      });
      setAppSecret('');
      setAppId('');
      setCredentials('');
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

  const channelLabel = state.channel === 'wechat' ? '微信' : state.channel === 'qq' ? 'QQ' : '微博';

  return (
    <Sheet title={state.name} onClose={onClose} closeDisabled={busy}>
      <div className="channel-sheet-content" ref={contentRef}>
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
            <div className="channel-bound-actions">
              {live && (
                <button
                  className="channel-action-button"
                  type="button"
                  disabled={busy || !characterId || characterId === state.characterId}
                  onClick={() => void saveCharacter()}
                >
                  {busy ? '保存中…' : '保存出口角色'}
                </button>
              )}
              <button
                className="channel-action-button channel-action-danger"
                type="button"
                disabled={busy}
                onClick={() => setConfirming(true)}
              >
                解除新站绑定
              </button>
            </div>
            {live && (
              <>
                <GroupHeader>换谁在{channelLabel}里回你</GroupHeader>
                <CharacterPicker
                  characters={characters}
                  selectedId={characterId}
                  onSelect={setCharacterId}
                  disabled={busy}
                />
              </>
            )}
            <p className="page-note">
              对方在{channelLabel}里发给 TA 的文字会转进微伴，由「
              {state.characterName ?? '这个角色'}」回复； 回复再发回{channelLabel}
              。图片、语音、表情暂时不在{channelLabel}里收发。
            </p>
            <p className="page-note">
              解绑只停止新站的接收和回复，不会替你操作旧站。请不要为测试去旧版解绑或重置凭据；
              若要保留旧连接，新站请用旧版未占用的测试授权，同一份平台授权两端使用可能互相挤掉。
            </p>
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
            <div className="wechat-bind-toolbar">
              <p className="wechat-bind-selection">
                出口角色：
                <strong>
                  {characters.find((item) => item.characterId === characterId)?.name ??
                    '请先选择角色'}
                </strong>
              </p>
              <button
                className="channel-action-button full"
                type="button"
                disabled={busy || !characterId}
                onClick={() => void startBinding()}
              >
                {busy
                  ? '正在生成…'
                  : attempt?.status === 'wait'
                    ? '重新生成二维码'
                    : '生成绑定二维码'}
              </button>
            </div>
            {attempt?.status === 'wait' ? (
              bindLink ? (
                <section className="wechat-bind-result" aria-label="微信绑定方式">
                  <QrImage text={bindLink.bindUrl} />
                  <div className="wechat-bind-link-actions">
                    <a
                      className="wechat-bind-open channel-action-button"
                      href={bindLink.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() =>
                        showToast('请在微信内完成绑定，返回本页等待确认', 3000, 'info')
                      }
                    >
                      {bindLink.label}
                    </a>
                    <button
                      className="wechat-bind-copy channel-action-button"
                      type="button"
                      onClick={() => void copyBindLink()}
                    >
                      复制绑定链接
                    </button>
                  </div>
                  <input
                    ref={linkFieldRef}
                    className="wechat-bind-url"
                    aria-label="微信绑定链接"
                    readOnly
                    value={bindLink.bindUrl}
                    autoComplete="off"
                    spellCheck={false}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <p className="page-note">
                    不能扫码时，把链接粘贴到自己的微信「文件传输助手」后点开；安卓会优先尝试微信，系统不支持时退回官方网页。此链接是临时授权凭证，请勿分享给他人；操作后返回本页等待确认，打开微信不等于已绑定。
                  </p>
                  <p className="page-note">
                    等待微信确认… 此码在{' '}
                    {new Date(attempt.expiresAt).toLocaleTimeString('zh-CN', { hour12: false })}{' '}
                    前有效。
                  </p>
                  {attempt.lastError && (
                    <p className="page-note" role="alert">
                      {attempt.lastError}
                    </p>
                  )}
                </section>
              ) : (
                <p className="page-note" role="alert">
                  微信返回的绑定链接不正确，请重新生成。
                </p>
              )
            ) : (
              <p className="page-note">
                {attempt?.status === 'expired'
                  ? (attempt.lastError ?? '二维码已过期，请重新生成。')
                  : '先选一个日常聊天模式的角色，再点上方生成二维码；生成后也可以直接打开或复制绑定链接。'}
              </p>
            )}
            <GroupHeader>选择在微信里回复你的角色</GroupHeader>
            <CharacterPicker
              characters={characters}
              selectedId={characterId}
              onSelect={selectCharacter}
              disabled={busy}
            />
            <p className="page-note">
              二维码可用微信「扫一扫」扫描，同一部手机也可截图后从相册识别，约 2
              分钟有效；重新生成会让上一张码作废，换角色后也需要重新生成。
            </p>
            <p className="page-note">
              保留旧连接时，请用新测试微信号；不要去旧版解绑。同一个微信号在新站重新授权，平台可能让旧授权失效。
            </p>
            {state.lastError && <p className="page-note">{state.lastError}</p>}
          </>
        ) : state.channel === 'qq' ? (
          <>
            <p className="page-note">
              使用QQ官方平台创建的独立机器人，不是个人QQ密码或Cookie；不要复用旧版正在使用的机器人。只接收本人配对后的私聊日常文字，不接群聊、图片或语音；机器人的可用范围仍以QQ平台的审核和发布状态为准。
            </p>
            {state.status === 'pending' ? (
              <>
                <div className="channel-bound-actions">
                  <button
                    className="channel-action-button"
                    type="button"
                    disabled={busy || !characterId}
                    onClick={() => void connectQq(true)}
                  >
                    重新生成绑定码
                  </button>
                  <button
                    className="channel-action-button channel-action-danger"
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirming(true)}
                  >
                    清除QQ凭据重填
                  </button>
                </div>
                {qqPair ? (
                  <>
                    <label className="wx-auth-field wx-auth-field--credentials">
                      <span>在QQ私聊原样发送这一行</span>
                      <input
                        className="wechat-bind-url"
                        aria-label="QQ绑定命令"
                        readOnly
                        autoComplete="off"
                        value={'绑定 ' + qqPair.pairingCode}
                        onFocus={(event) => event.currentTarget.select()}
                      />
                    </label>
                    <button
                      type="button"
                      className="channel-action-button full"
                      onClick={() => void copyText('绑定 ' + qqPair.pairingCode)}
                    >
                      复制QQ绑定命令
                    </button>
                    <p className="page-note">
                      此码在 {timeText(qqPair.expiresAt)}{' '}
                      前有效；不要发给他人，旧码会在重新生成后失效。
                    </p>
                  </>
                ) : (
                  <p className="page-note">
                    凭据已加密保存。为保护安全，刷新页面后不会重新显示旧绑定码；请点上方重新生成。
                  </p>
                )}
                <p className="page-note">
                  到QQ官方管理页点「扫码聊天」，用你自己的QQ添加这只机器人，把绑定命令发到它的私聊，然后返回本页等待「已绑定」。绑定码不会送给AI，也不计聊天费用；确认前的普通消息不会触发角色回复。
                </p>
                <a
                  className="channel-action-button"
                  href="https://q.qq.com/qqbot/openclaw/index.html"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  前往QQ官方管理页
                </a>
              </>
            ) : (
              <>
                <div className="wechat-bind-toolbar">
                  <p className="wechat-bind-selection">
                    出口角色：
                    <strong>
                      {characters.find((item) => item.characterId === characterId)?.name ??
                        '请先选择角色'}
                    </strong>
                  </p>
                  <button
                    className="channel-action-button full"
                    type="button"
                    disabled={busy || !characterId || !appId.trim() || !appSecret.trim()}
                    onClick={() => void connectQq()}
                  >
                    {busy ? '正在校验…' : '连接QQ并生成绑定码'}
                  </button>
                </div>
                <div className="wx-auth-fields">
                  <label className="wx-auth-field">
                    <span>AppID</span>
                    <input
                      autoComplete="off"
                      spellCheck={false}
                      value={appId}
                      placeholder="QQ官方机器人的AppID"
                      onChange={(event) => setAppId(event.target.value)}
                    />
                  </label>
                  <label className="wx-auth-field">
                    <span>AppSecret</span>
                    <input
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={appSecret}
                      placeholder="只在本页填写新密钥，不要发到聊天里"
                      onChange={(event) => setAppSecret(event.target.value)}
                    />
                  </label>
                </div>
              </>
            )}
            <GroupHeader>选择在QQ里回复你的角色</GroupHeader>
            <CharacterPicker
              characters={characters}
              selectedId={characterId}
              disabled={busy}
              onSelect={(id) => {
                setCharacterId(id);
                if (id !== characterId) setQqPair(null);
              }}
            />
            <p className="page-note">
              更换待配对角色后请重新生成绑定码。QQ使用最近私聊的被动回复窗口，不尝试主动群发；长时间未说话时请先在QQ发一句日常文字。
            </p>
            {state.lastError && (
              <p className="page-note" role="alert">
                {state.lastError}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="page-note">
              在微博私信「微博龙虾助手」，发送“连接龙虾”，把助手返回的整段 AppID / AppSecret
              粘贴到下面。 不需要个人微博
              UID，也不用注册普通开放平台应用；服务器校验后加密保存凭据。
            </p>
            {live ? (
              <>
                <CharacterPicker
                  characters={characters}
                  selectedId={characterId}
                  onSelect={setCharacterId}
                />
                <div className="wx-auth-fields">
                  <label className="wx-auth-field wx-auth-field--credentials">
                    <span>一键粘贴助手凭据</span>
                    <textarea
                      value={credentials}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="把微博龙虾助手返回的整段凭据粘贴到这里"
                      onChange={(event) => {
                        const value = event.target.value;
                        setCredentials(value);
                        const pair = parseWeiboCredentials(value);
                        if (pair) {
                          setAppId(pair.appId);
                          setAppSecret(pair.appSecret);
                        }
                      }}
                    />
                  </label>
                  <p className="page-note">
                    支持带标签、两行、JSON
                    或配置命令；不会执行命令，点击连接时只发送识别出的两项凭据，不发送粘贴原文。也可在下面手动填。
                  </p>
                  <label className="wx-auth-field">
                    <span>AppID</span>
                    <input
                      value={appId}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="龙虾助手给的 AppID"
                      onChange={(event) => {
                        setCredentials('');
                        setAppId(event.target.value);
                      }}
                    />
                  </label>
                  <label className="wx-auth-field">
                    <span>AppSecret</span>
                    <input
                      value={appSecret}
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="龙虾助手给的 AppSecret"
                      onChange={(event) => {
                        setCredentials('');
                        setAppSecret(event.target.value);
                      }}
                    />
                  </label>
                </div>
                <button
                  className="channel-action-button full"
                  type="button"
                  disabled={busy}
                  onClick={() => void connectWeibo()}
                >
                  {busy ? '正在校验…' : '连接微博'}
                </button>
                <p className="page-note">
                  凭据保存后，回到同一个龙虾助手私信发一句普通文字测试，服务器会自动取得回信目标，不需要再填
                  UID。
                  支持日常文字消息，私密模式的内容不会发送到站外；旧版绑定不会自动同步，请勿同时让旧站使用同一份凭据。
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
        <AlertDialog
          title="解除绑定？"
          message={`只解除当前新站的${channelLabel}连接，不操作旧版服务器或旧绑定。之后可以${channel === 'wechat' ? '重新生成二维码扫码' : channel === 'qq' ? '重新填写QQ凭据并发送绑定码' : '重新填写助手凭据'}，再次测试绑定。`}
          confirmLabel="解除绑定"
          onCancel={() => setConfirming(false)}
          onConfirm={() => void unbind()}
        />
      )}
    </Sheet>
  );
}

function CharacterPicker({
  characters,
  selectedId,
  onSelect,
  disabled = false,
}: {
  characters: ChannelCharacter[];
  selectedId: string;
  onSelect(id: string): void;
  disabled?: boolean;
}) {
  if (!characters.length)
    return <p className="page-note">通讯录里还没有可用好友。请先添加好友，再回来选出口角色。</p>;
  return (
    <MenuGroup className="channel-character-picker">
      {characters.map((item) => (
        <MenuRow
          key={item.characterId}
          label={item.name}
          chevron={false}
          value={item.characterId === selectedId ? '已选择' : ''}
          disabled={disabled}
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
