/** 挂载真实表情组件，只有API与发送回调使用明确夹具；不代表生产发送或资产迁移验收。 */
import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { StickerEndpoints as S, StickerStoreEndpoints as E } from '@weiban/contracts';
import '../../../../docs/design/tokens.css';
import '../../src/app/styles.css';
import '../../src/app/shell.css';
import '../../src/app/old-ui.css';
import '../../src/app/pages-old.css';
import '../../src/app/media-call.css';
import '../../src/app/chat-old.css';
import { api } from '../../src/data/client.js';
import { AuthProvider } from '../../src/app/auth.js';
import { StickerPanel } from '../../src/features/sticker-panel.js';
import { StickerStorePage } from '../../src/features/sticker-store.js';
import { editEmoji } from '../../src/features/emoji-edit.js';
const image =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="42" fill="gold"/></svg>',
  );
const updatedAt = '2026-10-23T00:00:00Z';
const packs = [
  {
    packId: 'series',
    name: '测试系列',
    characterIds: [],
    userVisible: false,
    enabled: true,
    updatedAt,
    stickers: [
      {
        stickerId: 'series-sticker',
        mediaId: 'series-media',
        url: image,
        description: '系列表情',
        packId: 'series',
      },
    ],
  },
  {
    packId: 'dedicated',
    name: '角色专属包',
    characterIds: ['actor-me'],
    userVisible: true,
    enabled: true,
    updatedAt,
    stickers: [
      {
        stickerId: 'actor-sticker',
        mediaId: 'actor-media',
        url: image,
        description: '当前角色专属图',
        packId: 'dedicated',
      },
    ],
  },
  {
    packId: 'other',
    name: '其他角色包',
    characterIds: ['actor-other'],
    userVisible: true,
    enabled: true,
    updatedAt,
    stickers: [
      {
        stickerId: 'other-sticker',
        mediaId: 'other-media',
        url: image,
        description: '其他角色专属图',
        packId: 'other',
      },
    ],
  },
];
let added = ['series', 'dedicated'];
Object.assign(api, {
  restore: async () => null,
  cached: async () => undefined,
  call: async (
    endpoint: { path: string },
    options: { params?: { packId?: string }; body?: { packIds?: string[] } } = {},
  ) => {
    if (endpoint === S.listPacks) return { items: packs };
    if (endpoint === S.listMyStickers)
      return {
        items: [
          {
            stickerId: 'personal',
            mediaId: 'personal-media',
            url: image,
            order: 0,
            createdAt: updatedAt,
          },
        ],
      };
    const dto = (p: (typeof packs)[number]) => ({
      ...p,
      intro: '开发夹具表情包',
      coverUrl: image,
      stickerCount: 1,
      added: added.includes(p.packId),
      builtIn: false,
      inStore: true,
    });
    if (endpoint === E.listPacks) return { items: packs.slice(0, 2).map(dto) };
    if (endpoint === E.listAdded)
      return { items: added.flatMap((id) => packs.filter((p) => p.packId === id)).map(dto) };
    if (endpoint === E.removePack) {
      added = added.filter((id) => id !== options.params?.packId);
      return;
    }
    if (endpoint === E.addPack) {
      if (options.params?.packId) added.push(options.params.packId);
      return {};
    }
    if (endpoint === E.reorderMyPacks) {
      added = options.body?.packIds ?? added;
      return;
    }
    return {};
  },
});
function PanelFixture() {
  const [text, setText] = useState('');
  const [sent, setSent] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  function edit(value?: string) {
    const result = editEmoji(
      text,
      input.current?.selectionStart ?? text.length,
      input.current?.selectionEnd ?? text.length,
      value,
    );
    setText(result.value);
    requestAnimationFrame(() => input.current?.setSelectionRange(result.cursor, result.cursor));
  }
  return (
    <main>
      <textarea
        ref={input}
        aria-label="消息草稿"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <p role="status">{sent}</p>
      <StickerPanel
        characterIds={['actor-me']}
        onPick={(s) => setSent(s.description ?? '个人表情')}
        onEmoji={(value) => edit(value)}
        onErase={() => edit()}
        canSend={!!text.trim()}
        onSend={() => setSent(text)}
      />
    </main>
  );
}
const page = new URLSearchParams(location.search).get('page');
createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={[page === 'store' ? '/sticker-store' : '/panel']}>
    <AuthProvider>
      <Routes>
        <Route path="/panel" element={<PanelFixture />} />
        <Route path="/sticker-store" element={<StickerStorePage />} />
        <Route path="/sticker-store/mine" element={<StickerStorePage />} />
        <Route path="/me/stickers" element={<p>单个表情管理入口</p>} />
      </Routes>
    </AuthProvider>
  </MemoryRouter>,
);
