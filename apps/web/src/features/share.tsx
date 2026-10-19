import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';
import { Lock } from './old-icons.js';
import type { z } from 'zod';
import {
  CharacterEndpoints,
  GrowthCardEndpoints,
  GrowthEndpoints,
  IdentityEndpoints,
  MediaEndpoints,
  ShareEndpoints,
  ShareRejectedDetails,
  ShareSource as ShareSourceSchema,
  type ShareImageData,
  type ShareTemplate,
} from '@weiban/contracts';
import {
  ApiFailure,
  avatarForeground,
  avatarLetters,
  avatarPaletteIndex,
} from '@weiban/client-core';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { friendlyError } from '../data/use-remote.js';
import {
  cardStyleOverflow,
  exportShareImage,
  loadImage,
  lookup,
  renderShareImage,
  type ShareRenderCard,
  type ShareRenderItem,
  type SharePerson,
} from './share-render.js';
import { showToast } from './toast.js';
import { EmptyState, NavBar } from './shell-kit.js';

/*
 * 分享图编辑页（share-templates.md 第 5、7 节；EXP-01、EXP-02）。
 * 四个入口（聊天多选、收藏、朋友圈、卡片）都跳到 /share，带上 ShareSource。
 * 服务器 prepare 决定能放进图里的内容和贴纸文案（含真人 → 「非本人」），成人模式 / 健康消息由服务器拒绝。
 */

export type ShareSource = z.infer<typeof ShareSourceSchema>;

export const SHARE_REJECT_TEXT = '成人模式 / 健康相关的消息不能生成分享图';

export function openShare(navigate: NavigateFunction, source: ShareSource) {
  navigate('/share', { state: { source } });
}

const templates: Array<[ShareTemplate, string]> = [
  ['pink_filter', '粉色滤镜'],
  ['chat_original', '聊天原样'],
  ['simple_white', '简洁白底'],
  ['card_style', '卡片风'],
];

function isIos() {
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

interface Assets {
  people: Record<string, SharePerson>;
  me: SharePerson;
  anonymousMe: SharePerson;
  items: ShareRenderItem[];
  card: ShareRenderCard | null;
  daysKnown: number | null;
  title: string;
  missing: number;
}

function paletteColor(id: string, part: 'bg' | 'on') {
  const index = String(avatarPaletteIndex(id)).padStart(2, '0');
  return getComputedStyle(document.documentElement)
    .getPropertyValue(`--wb-support-${index}-${part}`)
    .trim();
}

async function mediaUrl(mediaId: string | null | undefined) {
  if (!mediaId) return null;
  try {
    return (await api.call(MediaEndpoints.getMedia, { params: { mediaId } })).url;
  } catch {
    return null;
  }
}

export function ShareEditorPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const chat = useChat();
  const source = (location.state as { source?: ShareSource } | null)?.source;
  const sourceKey = JSON.stringify(source ?? null);
  const [data, setData] = useState<ShareImageData>();
  const [error, setError] = useState('');
  const [template, setTemplate] = useState<ShareTemplate>(
    source?.kind === 'card' ? 'card_style' : 'pink_filter',
  );
  const [defaultTemplate, setDefaultTemplate] = useState<ShareTemplate | null>(null);
  const [showMe, setShowMe] = useState(false);
  const [showTime, setShowTime] = useState(true);
  const [showDays, setShowDays] = useState(true);
  const [assets, setAssets] = useState<Assets>();
  const [preview, setPreview] = useState<{ url: string; blob: Blob } | null>(null);
  const [rendering, setRendering] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [iosImage, setIosImage] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const reported = useRef(false);
  const contactsRef = useRef(chat.state.contacts);
  contactsRef.current = chat.state.contacts;
  const conversationsRef = useRef(chat.state.conversations);
  conversationsRef.current = chat.state.conversations;

  // 1. 服务器准备内容（以服务器为准：含成人模式 / 健康消息时 422）。
  useEffect(() => {
    const request = JSON.parse(sourceKey) as ShareSource | null;
    if (!request) return;
    let active = true;
    void api
      .call(ShareEndpoints.prepare, { body: { source: request }, networkOnly: true })
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e) => {
        if (!active) return;
        if (e instanceof ApiFailure && e.code === 'share_content_not_allowed') {
          const rejected = ShareRejectedDetails.safeParse(e.details);
          const ids =
            request.kind === 'messages'
              ? request.messageIds
              : request.kind === 'favorites'
                ? request.favoriteIds
                : [];
          const reasons: Record<string, string> = {
            adult_scope: '成人模式内容',
            health_label: '健康相关内容',
            recalled: '消息已撤回',
            not_found: '内容已不可用',
          };
          setError(
            rejected.success
              ? rejected.data.rejected
                  .map((item) => {
                    const index = ids.indexOf(item.id);
                    return `${index >= 0 ? `第 ${index + 1} 条` : '所选内容'}：${reasons[item.reason] ?? '无法用于分享图'}`;
                  })
                  .join('；')
              : SHARE_REJECT_TEXT,
          );
        } else setError(friendlyError(e));
      });
    void api
      .call(ShareEndpoints.getPreferences)
      .then((prefs) => {
        if (!active) return;
        setDefaultTemplate(prefs.defaultTemplate);
        if (request.kind !== 'card') setTemplate(prefs.defaultTemplate);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [sourceKey, navigate]);

  // 2. 下载头像、消息图片、卡面、认识天数。
  useEffect(() => {
    if (!data) return;
    let active = true;
    void (async () => {
      let missing = 0;
      const people: Record<string, SharePerson> = {};
      await Promise.all(
        data.characterIds.map(async (id) => {
          const contact = contactsRef.current.find((c) => c.characterId === id);
          let profile: Awaited<
            ReturnType<typeof api.call<typeof CharacterEndpoints.getProfile>>
          > | null = null;
          try {
            profile = await api.call(CharacterEndpoints.getProfile, {
              params: { characterId: id },
            });
          } catch {
            /* 角色已不可见时用默认头像。 */
          }
          const name = contact?.remark || profile?.name || '角色';
          const supplied = profile?.avatar.display?.supportColors[0];
          // 头像优先级（SAFE-01 第 5 条）：用户上传 > 管理员上传 > 默认头像。
          const url = contact?.customAvatarMediaId
            ? await mediaUrl(contact.customAvatarMediaId)
            : (profile?.avatar.image?.url ?? null);
          const image = await loadImage(url);
          if (url && !image) missing += 1;
          people[id] = {
            name,
            letters: avatarLetters(profile?.name ?? name, profile?.avatar.display?.avatarText),
            background: supplied ?? paletteColor(id, 'bg'),
            foreground: supplied ? avatarForeground(supplied) : paletteColor(id, 'on'),
            image,
          };
        }),
      );
      const anonymousMe: SharePerson = {
        name: '我',
        letters: '我',
        background: lookup('theme.pink.light.color.bg.userAvatar'),
        foreground: lookup('theme.pink.light.color.text.userAvatar'),
        image: null,
      };
      let me = anonymousMe;
      try {
        const profile = await api.call(IdentityEndpoints.getProfile);
        const image = await loadImage(await mediaUrl(profile.avatarMediaId));
        me = {
          ...anonymousMe,
          name: profile.nickname || '我',
          letters: avatarLetters(profile.nickname || '我'),
          image,
        };
      } catch {
        /* 用「我」。 */
      }
      const items: ShareRenderItem[] = await Promise.all(
        data.items.map(async (item) => {
          const mediaId =
            item.content.type === 'image' || item.content.type === 'sticker'
              ? item.content.mediaId
              : null;
          const image = mediaId ? await loadImage(await mediaUrl(mediaId)) : null;
          if (mediaId && !image) missing += 1;
          return {
            mine: item.senderKind === 'user',
            characterId: item.characterId,
            content: item.content,
            createdAt: item.createdAt,
            image,
          };
        }),
      );
      let card: ShareRenderCard | null = null;
      if (data.cardId) {
        try {
          const detail = await api.call(GrowthCardEndpoints.getCard, {
            params: { cardId: data.cardId },
          });
          const face = await loadImage(detail.face.url);
          if (detail.face.url && !face) missing += 1;
          card = {
            title: detail.title,
            line: detail.line,
            serialNo: detail.serialNo,
            obtainedOn: detail.obtainedOn,
            kind: detail.kind,
            face,
            characterId: detail.characterId,
          };
        } catch {
          /* 卡片取不到时按消息模板画。 */
        }
      }
      let daysKnown: number | null = null;
      if (data.characterIds.length === 1) {
        try {
          daysKnown = (
            await api.call(GrowthEndpoints.getDaysKnown, {
              params: { characterId: data.characterIds[0]! },
            })
          ).daysKnown;
        } catch {
          daysKnown = null;
        }
      }
      const request = JSON.parse(sourceKey) as ShareSource | null;
      const conversation =
        request?.kind === 'messages'
          ? conversationsRef.current.find((c) => c.conversationId === request.conversationId)
          : undefined;
      const title =
        conversation?.type === 'group' && conversation.title
          ? conversation.title
          : data.characterIds.map((id) => people[id]?.name ?? '角色').join('、') || '微伴';
      if (active) setAssets({ people, me, anonymousMe, items, card, daysKnown, title, missing });
    })();
    return () => {
      active = false;
    };
  }, [data, sourceKey]);

  const group = (data?.characterIds.length ?? 0) > 1;
  const overflow = useMemo(() => (assets ? cardStyleOverflow(assets.items) : false), [assets]);

  // 3. 绘制预览；旧预览保留到新图出来。
  useEffect(() => {
    if (!assets || !data) return;
    let active = true;
    setRendering(true);
    setFailed(false);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const canvas = renderShareImage({
            template,
            label: data.label,
            items: assets.items,
            people: assets.people,
            me: showMe ? assets.me : assets.anonymousMe,
            title: assets.title,
            group,
            daysKnown: showDays ? assets.daysKnown : null,
            showTime,
            card: template === 'card_style' ? assets.card : null,
          });
          const blob = await exportShareImage(canvas);
          if (!active) return;
          setPreview((old) => {
            if (old) URL.revokeObjectURL(old.url);
            return { url: URL.createObjectURL(blob), blob };
          });
        } catch {
          if (active) setFailed(true);
        } finally {
          if (active) setRendering(false);
        }
      })();
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [assets, data, template, showMe, showTime, showDays, group, retry]);
  useEffect(
    () => () => {
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return null;
      });
    },
    [],
  );

  function report() {
    if (reported.current) return;
    reported.current = true;
    void api.call(ShareEndpoints.recordGenerated, { body: { template } }).catch(() => {});
  }
  function fileName() {
    const ext = preview?.blob.type === 'image/jpeg' ? 'jpg' : 'png';
    return `weiban-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}.${ext}`;
  }
  function save() {
    if (!preview) return;
    report();
    // iPhone 网页（含主屏幕 App）不能直接存相册：全屏展示 + 长按保存（交接说明有写）。
    if (isIos()) {
      setIosImage(preview.url);
      return;
    }
    const link = document.createElement('a');
    link.href = preview.url;
    link.download = fileName();
    link.click();
    showToast('已保存');
  }
  const canShare =
    typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
  async function shareImage() {
    if (!preview) return;
    const file = new File([preview.blob], fileName(), { type: preview.blob.type });
    if (!navigator.canShare({ files: [file] })) {
      save();
      return;
    }
    setBusy(true);
    try {
      await navigator.share({ files: [file] });
      report();
    } catch {
      /* 用户取消分享。 */
    } finally {
      setBusy(false);
    }
  }
  function toggleDefault(on: boolean) {
    if (!on) return;
    void api
      .call(ShareEndpoints.updatePreferences, { body: { defaultTemplate: template } })
      .then((prefs) => setDefaultTemplate(prefs.defaultTemplate))
      .catch((e) => showToast(friendlyError(e)));
  }

  if (!source)
    return (
      <main>
        <NavBar title="分享图" fallback="/chat" />
        <EmptyState
          icon="wechat/star"
          title="没有可以生成分享图的内容"
          desc="长按一条消息或一条朋友圈，选择「分享图」"
          action={
            <button type="button" className="text-button text-action" onClick={() => navigate(-1)}>
              返回
            </button>
          }
        />
      </main>
    );
  return (
    <main className="share-page">
      <NavBar title="分享图" fallback="/chat" onBack={() => navigate(-1)} />
      <div className="share-preview" aria-busy={rendering || (!preview && !error && !failed)}>
        {error ? (
          <div className="empty">
            <p>{error}</p>
            <button type="button" className="text-button text-action" onClick={() => navigate(-1)}>
              返回
            </button>
          </div>
        ) : failed ? (
          <div className="empty">
            <p>生成失败</p>
            <button
              type="button"
              className="text-button text-action"
              onClick={() => setRetry((v) => v + 1)}
            >
              重试
            </button>
          </div>
        ) : preview ? (
          <img
            key={preview.url}
            className="share-preview-image"
            src={preview.url}
            alt="分享图预览"
          />
        ) : (
          <p className="hint" role="status">
            正在准备分享内容…
          </p>
        )}
        {rendering && <span className="spinner" role="status" aria-label="正在生成预览" />}
      </div>
      {assets && assets.missing > 0 && <p className="hint">有 {assets.missing} 张图片没加载出来</p>}
      <div className="template-list" role="radiogroup" aria-label="模板">
        {templates.map(([key, label]) => {
          const cardOnly = source.kind === 'card' && key !== 'card_style';
          const disabled = cardOnly || (key === 'card_style' && source.kind === 'moments_post');
          return (
            <button
              key={key}
              role="radio"
              aria-checked={template === key}
              aria-disabled={disabled}
              className={`template-option ${disabled ? 'disabled' : ''}`}
              onClick={() => {
                if (cardOnly) showToast('卡片分享使用卡片风，保留卡面与编号');
                else if (disabled) showToast('这条内容不适合卡片风');
                else setTemplate(key);
              }}
            >
              <span className={`template-thumb thumb-${key}`} aria-hidden />
              <small>{label}</small>
            </button>
          );
        })}
      </div>
      {source.kind === 'card' && <p className="hint">卡片分享使用卡片风，保留卡面与编号</p>}
      {template === 'card_style' && !assets?.card && overflow && (
        <p className="hint">内容太多，建议用其他模板</p>
      )}
      <div className="panel rows share-options">
        <label className="switch-row">
          显示我的头像和昵称
          <input type="checkbox" checked={showMe} onChange={(e) => setShowMe(e.target.checked)} />
        </label>
        <label className="switch-row">
          显示时间
          <input
            type="checkbox"
            checked={showTime}
            onChange={(e) => setShowTime(e.target.checked)}
          />
        </label>
        {data && data.characterIds.length === 1 && (
          <label className="switch-row">
            显示「认识第 N 天」
            <input
              type="checkbox"
              checked={showDays}
              onChange={(e) => setShowDays(e.target.checked)}
            />
          </label>
        )}
        {data?.label === 'weiban_not_real_person' && (
          <p className="hint lock-line">
            <Lock size={14} aria-hidden /> 含真人角色内容，图片会带上「非本人，请谨慎识别」
          </p>
        )}
        <label className="switch-row">
          设为默认模板
          <input
            type="checkbox"
            checked={defaultTemplate === template}
            onChange={(e) => toggleDefault(e.target.checked)}
          />
        </label>
      </div>
      <div className="button-row share-actions">
        <button
          className="primary"
          disabled={!preview || rendering || failed || busy}
          onClick={save}
        >
          保存到相册
        </button>
        {canShare && (
          <button
            disabled={!preview || rendering || failed || busy}
            onClick={() => void shareImage()}
          >
            分享
          </button>
        )}
      </div>
      {iosImage && (
        <div
          className="ios-save-scrim"
          role="dialog"
          aria-label="长按图片保存"
          onClick={() => setIosImage(null)}
        >
          <img src={iosImage} alt="分享图" />
          <p>长按图片保存</p>
        </div>
      )}
    </main>
  );
}
