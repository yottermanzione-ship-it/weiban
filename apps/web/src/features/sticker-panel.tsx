import { useState } from 'react';
import '../app/stickers.css';
import { Link } from 'react-router-dom';
import { StickerEndpoints } from '@weiban/contracts';
import { useRemote } from '../data/use-remote.js';
import { useUpdates } from '../data/updates.js';
import { OldIcon } from './old-icons.js';

/** 使用系统 Unicode 字形，不复制微信或其它厂商的表情图片。 */
const EMOJI = [
  ['😀', '开心'],
  ['😁', '露齿笑'],
  ['😂', '笑哭'],
  ['🤣', '大笑'],
  ['😊', '微笑'],
  ['🥰', '喜爱'],
  ['😍', '心动'],
  ['😘', '飞吻'],
  ['🙂', '浅笑'],
  ['😉', '眨眼'],
  ['😎', '酷'],
  ['🤔', '思考'],
  ['😅', '苦笑'],
  ['🥹', '感动'],
  ['🥺', '恳求'],
  ['😭', '哭泣'],
  ['😮', '惊讶'],
  ['😳', '害羞'],
  ['😴', '睡觉'],
  ['😔', '难过'],
  ['😠', '生气'],
  ['😤', '气鼓鼓'],
  ['🙃', '倒脸'],
  ['🤗', '拥抱'],
  ['👍', '赞'],
  ['👎', '不赞'],
  ['👏', '鼓掌'],
  ['🙏', '感谢'],
  ['💪', '加油'],
  ['👌', '好的'],
  ['✌️', '胜利'],
  ['👋', '挥手'],
  ['❤️', '爱心'],
  ['💕', '双心'],
  ['💔', '心碎'],
  ['🌹', '玫瑰'],
  ['🌸', '花朵'],
  ['☀️', '太阳'],
  ['🌙', '月亮'],
  ['⭐', '星星'],
  ['🎉', '庆祝'],
  ['🎂', '蛋糕'],
  ['🎁', '礼物'],
  ['☕', '咖啡'],
  ['🍰', '甜点'],
  ['🐱', '猫'],
  ['🐶', '狗'],
  ['✨', '闪光'],
] as const;

export interface PickedSticker {
  stickerId: string;
  source: 'library' | 'user';
  mediaId: string;
  description: string | null;
}

export function StickerPanel({
  onPick,
  onEmoji,
  onErase,
  onSend,
  canSend = false,
  characterIds = [],
}: {
  onPick(sticker: PickedSticker): void;
  onEmoji(value: string): void;
  onErase(): void;
  onSend(): void;
  canSend?: boolean;
  characterIds?: readonly string[];
}) {
  const packs = useRemote(StickerEndpoints.listPacks);
  const mine = useRemote(StickerEndpoints.listMyStickers);
  const [tab, setTab] = useState('emoji');
  const [recent, setRecent] = useState<string[]>([]);
  useUpdates((update) => {
    if (
      update.type === 'data.changed' &&
      (update.data as { section?: string })?.section === 'stickers'
    ) {
      mine.refresh();
      packs.refresh();
    }
  });
  const installed = packs.data?.items ?? [];
  const series = installed.filter((p) => p.addedFromStore ?? !p.userVisible);
  // 只使用明确绑定的角色范围，不按包名猜明星，也不公开他人的个人表情。
  const dedicated = installed.filter((p) => p.characterIds.some((id) => characterIds.includes(id)));
  const pack = installed.find((p) => p.packId === tab);
  const emojiButton = (value: string, label: string) => (
    <button
      key={value}
      type="button"
      className="wx-emoji-cell"
      aria-label={label}
      onClick={() => {
        onEmoji(value);
        setRecent((before) => [value, ...before.filter((e) => e !== value)].slice(0, 8));
      }}
    >
      {value}
    </button>
  );
  const libraryCells = (items: typeof installed) =>
    items.flatMap((p) =>
      p.stickers.map((s) => (
        <button
          key={s.stickerId}
          type="button"
          className="wx-sticker-cell"
          aria-label={s.description}
          onClick={() =>
            onPick({
              stickerId: s.stickerId,
              source: 'library',
              mediaId: s.mediaId,
              description: s.description,
            })
          }
        >
          <img src={s.url} alt={s.description} loading="lazy" decoding="async" />
        </button>
      )),
    );
  return (
    <div className="wx-sticker">
      <div className="wx-sticker-tabs" role="tablist" aria-label="表情分类">
        <button
          type="button"
          role="tab"
          aria-label="通用 emoji"
          aria-selected={tab === 'emoji'}
          onClick={() => setTab('emoji')}
        >
          <OldIcon name="wechat/smile" size={22} />
        </button>
        <button
          type="button"
          role="tab"
          aria-label="添加的单个表情"
          aria-selected={tab === 'mine'}
          onClick={() => setTab('mine')}
        >
          <OldIcon name="wechat/heart" size={22} />
        </button>
        <button
          type="button"
          role="tab"
          aria-label="明星专属表情"
          aria-selected={tab === 'celebrity'}
          onClick={() => setTab('celebrity')}
        >
          <OldIcon name="wechat/star" size={22} />
        </button>
        {series.map((p) => (
          <button
            key={p.packId}
            type="button"
            role="tab"
            aria-label={p.name}
            aria-selected={tab === p.packId}
            onClick={() => setTab(p.packId)}
          >
            {p.stickers[0] ? (
              <img src={p.stickers[0].url} alt="" loading="lazy" decoding="async" />
            ) : (
              <OldIcon name="wechat/smile" size={20} />
            )}
          </button>
        ))}
        <Link className="wx-sticker-tab-link end" to="/sticker-store" aria-label="表情商店">
          <OldIcon name="wechat/add" size={20} />
        </Link>
      </div>
      <div className="wx-sticker-body">
        {tab === 'emoji' ? (
          <>
            {recent.length > 0 && (
              <>
                <p className="wx-sticker-caption">最近使用</p>
                <div className="wx-emoji-grid">
                  {recent.map((value) =>
                    emojiButton(value, EMOJI.find(([e]) => e === value)?.[1] ?? value),
                  )}
                </div>
              </>
            )}
            <p className="wx-sticker-caption">所有表情</p>
            <div className="wx-emoji-grid">
              {EMOJI.map(([value, label]) => emojiButton(value, label))}
            </div>
          </>
        ) : (
          <>
            <p className="wx-sticker-caption">
              {tab === 'mine'
                ? '添加的单个表情'
                : tab === 'celebrity'
                  ? '明星专属表情'
                  : pack?.name}
            </p>
            <div className="wx-sticker-grid">
              {tab === 'mine' && (
                <>
                  <Link className="wx-sticker-cell add" to="/me/stickers" aria-label="添加表情">
                    <OldIcon name="wechat/add" size={28} />
                  </Link>
                  {mine.data?.items.map((s) => (
                    <button
                      key={s.stickerId}
                      type="button"
                      className="wx-sticker-cell"
                      aria-label="发送个人表情"
                      onClick={() =>
                        onPick({
                          stickerId: s.stickerId,
                          source: 'user',
                          mediaId: s.mediaId,
                          description: null,
                        })
                      }
                    >
                      <img src={s.url} alt="个人表情" loading="lazy" decoding="async" />
                    </button>
                  ))}
                </>
              )}
              {tab === 'celebrity' ? libraryCells(dedicated) : pack ? libraryCells([pack]) : null}
            </div>
            {tab === 'celebrity' &&
              !packs.loading &&
              !packs.error &&
              !dedicated.some((p) => p.stickers.length) && (
                <p className="wx-sticker-caption center">当前角色暂无专属表情</p>
              )}
            {(tab === 'mine' ? mine : packs).loading && (
              <p className="wx-sticker-caption center" role="status">
                加载中…
              </p>
            )}
            {(tab === 'mine' ? mine : packs).error && (
              <div className="hint center" role="alert">
                <p>表情加载失败</p>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => (tab === 'mine' ? mine : packs).refresh()}
                >
                  重试
                </button>
              </div>
            )}
          </>
        )}
      </div>
      {tab === 'emoji' && (
        <div className="wx-emoji-actions">
          <button type="button" aria-label="删除上一个字符" disabled={!canSend} onClick={onErase}>
            ⌫
          </button>
          <button type="button" className="primary" disabled={!canSend} onClick={onSend}>
            发送
          </button>
        </div>
      )}
    </div>
  );
}
