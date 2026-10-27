/*
 * U8 启动预加载（总经理 10-27：「能不能在启动页一次性加载好需要的资源？就像旧版微伴一样」）。
 *
 * 启动页（app/boot-splash.ts）显示期间，把首屏和常用页要用的东西一次准备好，进入后切页不再先出
 * 骨架屏 / 重新加载：
 *   关键（必须等，最多 BOOT_HARD_CAP_MS）：
 *     - 本机聊天数据就绪（会话列表、联系人；本机没有时等首次同步）；
 *     - 把本机库里上次的接口结果读进内存（自己资料、别名、钱包、会员、模型、新朋友、表情、
 *       最近会话的角色资料与模型状态）——页面首帧直接画，随后照常后台刷新。
 *   非关键（最多等到打开后 SOFT_CAP_MS，关键项完成得晚时再多给 SOFT_GRACE_MS，总共不超过
 *   BOOT_HARD_CAP_MS；弱网到点就先进，没做完的在后台继续）：
 *     - 常用接口回源刷新一次；
 *     - 最近 RECENT_AVATARS 个会话、通讯录首屏 CONTACT_AVATARS 个联系人的头像图片
 *       （下载进内存并解码），以及自己的头像；
 *     - 字体（MiSans 三个字重）、常用图标；
 *     - 表情商店列表与封面（读进内存，没缓存的下载并存本机）。
 *   后台（不等）：朋友圈第一页。
 * 主要页面的代码：网页版目前是一个整包（没有懒加载的路由分块），JS 下载完即全部就绪，并由
 * Service Worker 预缓存；这里不需要另外取分块。
 */
import {
  BillingEndpoints,
  IdentityEndpoints,
  MembershipEndpoints,
  ModelAccessEndpoints,
  NewFriendsEndpoints,
  StickerEndpoints,
  StickerStoreEndpoints,
  CharacterEndpoints,
  type EndpointDef,
} from '@weiban/contracts';
import type { LocalSyncState, RequestOptions } from '@weiban/client-core';
import { api } from '../data/client.js';
import { loadCharacterProfile } from '../data/character-profile.js';
import { preloadAvatar, rememberCharacterAvatar } from '../features/avatar-cache.js';
import { iconUrl } from '../features/old-icons.js';
import { preloadCover, readStoreSnapshot, saveStoreSnapshot } from '../features/sticker-cache.js';
import { preloadMomentsFeed } from '../features/moments.js';

/** 从打开网址算起最多等这么久，到点无论如何进入。 */
export const BOOT_HARD_CAP_MS = 8000;
/** 非关键项最多等到这个时间点（从打开网址算起）。 */
const SOFT_CAP_MS = 2500;
/** 关键项完成得晚时，非关键项最多再多等这么久。 */
const SOFT_GRACE_MS = 800;
/** 预加载头像的最近会话数（约一屏半）。 */
const RECENT_AVATARS = 20;
/** 另外预加载头像的通讯录首屏联系人数。 */
const CONTACT_AVATARS = 10;
/** 从本机库读进内存的角色资料上限（最近会话 + 联系人）。 */
const PRIME_PROFILES = 200;
/** 同时下载的图片数（与列表的头像缓存并发一致）。 */
const PARALLEL = 4;
/** 表情商店预加载的封面数（精选 + 前几个）。 */
const STICKER_COVERS = 12;

type Owner = { userId: string; sessionId: string };
type Pair = readonly [EndpointDef, RequestOptions<EndpointDef>?];

/** 常用页面一打开就要的接口（参数与页面里 useRemote 的写法一致，才命中同一份缓存）。 */
const COMMON: Pair[] = [
  [IdentityEndpoints.getProfile],
  [IdentityEndpoints.getAlias],
  [BillingEndpoints.getWallet],
  [MembershipEndpoints.get],
  [ModelAccessEndpoints.listModels],
  [NewFriendsEndpoints.list],
  [StickerEndpoints.listPacks],
  [StickerEndpoints.listMyStickers],
  [IdentityEndpoints.getNotificationSettings],
];

/** 四个页签首屏和聊天页常用的图标与彩色图（其余图标由 Service Worker 预缓存，用到时不走网络）。 */
const ICONS = [
  'wechat/search',
  'wechat/add_circle',
  'wechat/chat',
  'wechat/chat_pair',
  'wechat/person',
  'wechat/tag',
  'wechat/star',
  'wechat/star_filled',
  'wechat/grid',
  'wechat/check',
  'wechat/smile',
  'wechat/info',
  'wechat/heart',
  'wechat/more',
  'wechat/note',
  'wechat/picture',
  'wechat/store',
  'wechat/bell',
  'wechat/bell_mute',
  'wechat/close',
  'wechat/transfer',
  'wechat/voice_call',
  'wechat/chevron_right',
  'wechat/chevron_down',
  'wechat/back_crop',
  'wechat/finder',
  'wechat/discover_scan',
  'wechat/discover_listen',
  'wechat/discover_mini_program',
  'wechat/contacts_official',
  'drawn/people',
  'color/color_shake',
  'color/color_look',
  'color/color_live',
  'color/color_game',
  // 「我」「发现」页菜单里的彩色图（<img>，解码后首帧就能画出来）
  'wechat/membership.webp',
  'wechat/profile_service.webp',
  'wechat/card.png',
  'wechat/discover_moments.png',
  'color/color_favorites.svg',
  'color/color_settings.svg',
];

/** 与会话列表（features/conversation-list.tsx）一致的顺序：置顶在前，再按最后一条消息时间。 */
function recentConversations(state: LocalSyncState) {
  return state.conversations
    .filter((item) => !item.state.hidden)
    .sort(
      (a, b) =>
        Number(b.state.pinned) - Number(a.state.pinned) ||
        (b.lastMessage?.createdAt ?? b.updatedAt).localeCompare(
          a.lastMessage?.createdAt ?? a.updatedAt,
        ),
    );
}

/** 最近会话里出现的角色（群聊取前 4 位，与群头像宫格一致），去重、保持顺序。 */
function recentCharacters(state: LocalSyncState, limit: number): string[] {
  const ids: string[] = [];
  for (const item of recentConversations(state)) {
    const characters = item.participants
      .filter((participant) => participant.kind === 'character')
      .map((participant) => participant.refId);
    for (const id of item.type === 'group' ? characters.slice(0, 4) : characters.slice(0, 1))
      if (!ids.includes(id)) ids.push(id);
    if (ids.length >= limit) break;
  }
  return ids.slice(0, limit);
}

async function pool<T>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<unknown>,
  step: (done: number) => void,
): Promise<void> {
  let next = 0;
  let done = 0;
  const runner = async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await work(item).catch(() => {});
      done++;
      step(done / items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
}

/** 各项按权重累计成总进度（0~1）。 */
class Progress {
  private readonly parts = new Map<string, { weight: number; done: number }>();
  constructor(private readonly onChange: (fraction: number) => void) {}
  add(name: string, weight: number) {
    this.parts.set(name, { weight, done: 0 });
  }
  set(name: string, fraction: number) {
    const part = this.parts.get(name);
    if (!part) return;
    part.done = Math.max(part.done, Math.min(1, fraction));
    let total = 0;
    let done = 0;
    for (const item of this.parts.values()) {
      total += item.weight;
      done += item.weight * item.done;
    }
    this.onChange(total ? done / total : 1);
  }
}

function until(at: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, at - performance.now())));
}

function loadFonts(): Promise<unknown> {
  if (typeof document === 'undefined' || !document.fonts?.load) return Promise.resolve();
  return Promise.all(
    ['400', '500', '600'].map((weight) => document.fonts.load(`${weight} 16px MiSans`, '微伴')),
  );
}

/** 解码过的图标留着引用：浏览器才不会把解码结果丢掉，页面里同一地址的 <img> 首帧就能画出来。 */
const decodedIcons: HTMLImageElement[] = [];
function decodeImage(url: string): Promise<void> {
  const image = new Image();
  image.src = url;
  return image
    .decode()
    .then(() => {
      if (decodedIcons.length < ICONS.length) decodedIcons.push(image);
    })
    .catch(() => {});
}

async function preloadStickerStore(step: (fraction: number) => void): Promise<void> {
  let items = readStoreSnapshot();
  if (!items) {
    const owner = api.ownerKey();
    const page = await api.call(StickerStoreEndpoints.listPacks, { networkOnly: true });
    if (api.ownerKey() !== owner) return;
    items = page.items;
    saveStoreSnapshot(items);
  }
  const covers = items.filter((item) => item.coverUrl).slice(0, STICKER_COVERS);
  await pool(
    covers,
    PARALLEL,
    (item) => preloadCover(item.packId, item.updatedAt, item.coverUrl),
    step,
  );
}

/**
 * 通讯录首屏的联系人（与 features/contacts.tsx 同样按备注 / 名字的拼音排序；名字取内存里的资料）。
 * 只是近似首屏，用来提前准备头像，不影响页面自己的排序。
 */
const collator = new Intl.Collator('zh-CN-u-co-pinyin');
function firstContacts(state: LocalSyncState, limit: number): string[] {
  const label = (contact: LocalSyncState['contacts'][number]) =>
    contact.remark ||
    api.peek(
      CharacterEndpoints.getProfile,
      { params: { characterId: contact.characterId } },
      { allowStale: true },
    )?.value.name ||
    '';
  return [...state.contacts]
    .map((contact) => ({ id: contact.characterId, label: label(contact) }))
    .sort((a, b) => collator.compare(a.label, b.label))
    .slice(0, limit)
    .map((item) => item.id);
}

async function preloadRecentAvatars(
  owner: Owner,
  state: LocalSyncState,
  step: (fraction: number) => void,
): Promise<void> {
  const ids = [
    ...new Set([
      ...recentCharacters(state, RECENT_AVATARS),
      ...firstContacts(state, CONTACT_AVATARS),
    ]),
  ];
  const custom = new Map(
    state.contacts
      .filter((contact) => contact.customAvatarMediaId)
      .map((contact) => [contact.characterId, contact.customAvatarMediaId!]),
  );
  await pool(
    ids,
    PARALLEL,
    async (id) => {
      if (!api.owns(owner)) return;
      const privateId = custom.get(id);
      if (privateId) {
        rememberCharacterAvatar(id, privateId);
        await preloadAvatar(privateId);
        return;
      }
      const profile = await loadCharacterProfile(id, owner);
      const image = profile.avatar.image;
      rememberCharacterAvatar(id, image?.mediaId ?? null);
      if (image && api.owns(owner)) await preloadAvatar(image.mediaId, image.url);
    },
    step,
  );
}

export type BootReport = {
  /** 关键项完成（或到上限）的时间点，从打开网址算起（毫秒）。 */
  criticalAt: number;
  /** 进入首页的时间点。 */
  readyAt: number;
  /** 到点时还没完成、转入后台继续的项目。 */
  skipped: string[];
};

/**
 * 启动预加载。owner 为空（未登录）时只准备字体和图标。
 * chatReady：本机聊天数据就绪（initialized）时给出当前状态；拿不到时给 null。
 */
export async function preloadForBoot({
  owner,
  chatReady,
  onProgress,
}: {
  owner: Owner | null;
  chatReady: Promise<LocalSyncState | null>;
  onProgress(fraction: number): void;
}): Promise<BootReport> {
  const progress = new Progress(onProgress);
  const critical: Promise<unknown>[] = [];
  const all: Promise<unknown>[] = [];
  const pending = new Set<string>();
  const track = <T>(
    name: string,
    weight: number,
    isCritical: boolean,
    work: (step: (fraction: number) => void) => Promise<T>,
  ): Promise<T | undefined> => {
    progress.add(name, weight);
    pending.add(name);
    const job = work((fraction) => progress.set(name, fraction))
      .catch(() => undefined)
      .finally(() => {
        pending.delete(name);
        progress.set(name, 1);
      });
    if (isCritical) critical.push(job);
    all.push(job);
    return job;
  };
  track('fonts', 1, false, loadFonts);
  track('icons', 1, false, (step) => pool(ICONS, 8, (name) => decodeImage(iconUrl(name)), step));
  if (owner) {
    const chat = track('chat', 3, true, () => chatReady);
    const cache = track('cache', 2, true, async (step) => {
      await Promise.all(COMMON.map(([endpoint, options]) => api.prime(endpoint, options)));
      step(0.4);
      const state = await chat;
      if (!state || !api.owns(owner)) return;
      // 最近会话 + 全部联系人的角色资料（只读本机库，不发请求）：会话列表、通讯录首帧就有名字和头像地址。
      const recent = recentCharacters(state, RECENT_AVATARS * 2);
      const ids = [
        ...new Set([...recent, ...state.contacts.map((contact) => contact.characterId)]),
      ].slice(0, PRIME_PROFILES);
      await Promise.all([
        ...ids.map((id) =>
          api.prime(CharacterEndpoints.getProfile, { params: { characterId: id } }),
        ),
        ...recent
          .slice(0, RECENT_AVATARS)
          .map((id) =>
            api.prime(ModelAccessEndpoints.getModelStatus, { query: { characterId: id } }),
          ),
      ]);
    });
    track('refresh', 1, false, (step) =>
      pool(
        [...COMMON],
        PARALLEL,
        ([endpoint, options]) =>
          api.owns(owner) ? api.call(endpoint, options) : Promise.resolve(),
        step,
      ),
    );
    track('avatars', 4, false, async (step) => {
      // 等资料读进内存再挑通讯录首屏（按名字排序要用到名字）。
      await cache;
      const state = await chat;
      if (!state || !api.owns(owner)) return;
      await preloadRecentAvatars(owner, state, step);
    });
    track('me', 1, false, async () => {
      const profile = await api.call(IdentityEndpoints.getProfile);
      if (profile.avatarMediaId && api.owns(owner)) await preloadAvatar(profile.avatarMediaId);
    });
    track('stickers', 1, false, preloadStickerStore);
  }
  await Promise.race([Promise.all(critical), until(BOOT_HARD_CAP_MS)]);
  const criticalAt = performance.now();
  const softUntil = Math.min(BOOT_HARD_CAP_MS, Math.max(SOFT_CAP_MS, criticalAt + SOFT_GRACE_MS));
  await Promise.race([Promise.all(all), until(softUntil)]);
  const readyAt = performance.now();
  // 后台：进入后再取朋友圈第一页，不和首屏抢网络。
  if (owner && api.owns(owner)) void preloadMomentsFeed().catch(() => {});
  return { criticalAt, readyAt, skipped: [...pending] };
}
