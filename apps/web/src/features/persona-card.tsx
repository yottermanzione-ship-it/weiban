/*
 * 人设卡（2026-10-27 批 U4，26 号 §4）：一个组件，四处使用——广场作品详情、微伴角色详情、角色资料页「TA 的人设」、
 * 我的补充设定（对照原卡）。后台角色预览用同一份配置（apps/admin/src/components/persona-card-preview.tsx）。
 *
 * 组件只认「展示方式」，不认具体字段：板块、子板块、标题、取值全部来自 @weiban/client-core 的 PERSONA_SECTIONS。
 * 新增字段 = 配置里加一条子板块，这里不用改。规则：
 * - 板块之间 8px 灰色分组间隔，板块内无边框；取值为空的子板块（全空的板块）整块不显示，不写「未填写」；
 * - 正文超过 5 行折叠「展开」；示例对话渲染成迷你聊天气泡（左 TA 右我）；
 * - 用户端只显示 userVisible 的子板块，分类只显示「原创 / 作品角色 / 真人」一个词。
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  personaValue,
  resolvePersonaCard,
  type PersonaSource,
  type PersonaSubsection,
  type PersonaValue,
  type ResolvedSection,
  type ResolvedSubsection,
} from '@weiban/client-core';
import { OldIcon } from './old-icons.js';
import { PlazaAvatar } from './plaza.js';

export interface PersonaCardProps {
  source: PersonaSource;
  /** 不显示头部（补充设定对照原卡：页面顶栏已有名字）。 */
  hideHead?: boolean;
  /** 换掉头部默认头像（各处头像组件不同：预设角色用 CharacterAvatar，作品用 WorkAvatar）。 */
  avatar?: ReactNode;
  /** 名字右侧（广场：点赞、评论图标 + 数字）。 */
  headAside?: ReactNode;
  /** 头部最后一行（广场：作者与版本）。 */
  headExtra?: ReactNode;
  /** 头部与第一个板块之间（广场：作者的发布说明）。 */
  intro?: ReactNode;
  /** 某个子板块行尾的附加内容（按子板块编号，如 voice → 试听按钮）。 */
  asides?: Partial<Record<string, ReactNode>>;
  /** 某个子板块的值换一种画法（按子板块编号，如 source → 可点的改编来源）。 */
  renders?: Partial<Record<string, (value: PersonaValue) => ReactNode>>;
  /** 文字的统一画法（广场快照里遮盖的「▢」高亮）。 */
  renderText?: (text: string) => ReactNode;
}

export function PersonaCard(props: PersonaCardProps) {
  const sections = resolvePersonaCard(props.source, 'user');
  const head = sections.find((s) => s.section.id === 'head');
  const body = sections.filter((s) => s.section.id !== 'head');
  return (
    <div className="persona-card">
      {!props.hideHead && <PersonaHead group={head} {...props} />}
      {props.intro}
      {body.map((group) => (
        <PersonaSectionBlock key={group.section.id} group={group} {...props} />
      ))}
    </div>
  );
}

/** 人设卡在这个来源下是否有任何正文板块（头部以外）；补充设定页据此决定要不要显示「原设定」。 */
export function personaHasBody(source: PersonaSource): boolean {
  return resolvePersonaCard(source, 'user').some((s) => s.section.id !== 'head');
}

function pick(group: ResolvedSection | undefined, id: string): ResolvedSubsection | undefined {
  return group?.items.find((item) => item.sub.id === id);
}

function PersonaHead({
  group,
  avatar,
  headAside,
  headExtra,
  renderText = (t) => t,
}: PersonaCardProps & { group: ResolvedSection | undefined }) {
  const byDisplay = (display: PersonaSubsection['display']) =>
    group?.items.filter((item) => item.sub.display === display) ?? [];
  const name = personaValue.text(byDisplay('title')[0]?.value);
  const identity = byDisplay('identity').map((item) => personaValue.text(item.value));
  const lines = byDisplay('line').map((item) => personaValue.text(item.value));
  const tags = byDisplay('tags').flatMap((item) => personaValue.list(item.value));
  const avatarUrl = personaValue.text(pick(group, 'avatar')?.value) || null;
  return (
    <section className="persona-head" aria-label="角色">
      <div className="persona-head-main">
        {avatar ?? <PlazaAvatar id={name || 'persona'} name={name} url={avatarUrl} size={64} />}
        <div className="persona-head-text">
          <h2 className="persona-name">{renderText(name)}</h2>
          {identity.length > 0 && <p className="persona-identity">{identity.join(' · ')}</p>}
          {lines.map((line) => (
            <p key={line} className="persona-line">
              {renderText(line)}
            </p>
          ))}
        </div>
        {headAside && <div className="persona-head-aside">{headAside}</div>}
      </div>
      {tags.length > 0 && <PersonaTags tags={tags} renderText={renderText} />}
      {headExtra && <div className="persona-head-extra">{headExtra}</div>}
    </section>
  );
}

function PersonaTags({
  tags,
  renderText = (t) => t,
}: {
  tags: string[];
  renderText?: (text: string) => ReactNode;
}) {
  return (
    <ul className="persona-tags" aria-label="标签">
      {tags.map((tag, i) => (
        <li key={`${i}-${tag}`}>{renderText(tag)}</li>
      ))}
    </ul>
  );
}

function PersonaSectionBlock({
  group,
  asides,
  renders,
  renderText = (t) => t,
}: PersonaCardProps & { group: ResolvedSection }) {
  const blocks = group.items.filter((item) => item.sub.display !== 'keyValue');
  const pairs = group.items.filter((item) => item.sub.display === 'keyValue');
  // 板块里只有一块正文时不再重复小标题（「说话方式」下只有说话风格）
  const labelled = blocks.length > 1;
  return (
    <section className="persona-section" aria-label={group.section.title}>
      <h3 className="persona-section-title">{group.section.title}</h3>
      {blocks.map((item) => (
        <div key={item.sub.id} className={`persona-sub persona-${item.sub.display}`}>
          {labelled && (
            <h4 className="persona-sub-title">
              {item.sub.cardTitle ?? item.sub.title}
              {asides?.[item.sub.id]}
            </h4>
          )}
          {renders?.[item.sub.id]?.(item.value) ?? (
            <PersonaValueView item={item} renderText={renderText} />
          )}
        </div>
      ))}
      {pairs.length > 0 && (
        <dl className="persona-pairs">
          {pairs.map((item) => (
            <div key={item.sub.id} className="persona-pair">
              <dt>{item.sub.cardTitle ?? item.sub.title}</dt>
              <dd>
                {renders?.[item.sub.id]?.(item.value) ?? renderText(personaValue.text(item.value))}
              </dd>
              {asides?.[item.sub.id]}
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function PersonaValueView({
  item,
  renderText,
}: {
  item: ResolvedSubsection;
  renderText: (text: string) => ReactNode;
}) {
  const { value, sub } = item;
  switch (sub.display) {
    case 'text':
    case 'line':
    case 'title':
    case 'identity':
      return <FoldText text={personaValue.text(value)} renderText={renderText} />;
    case 'tags':
      return <PersonaTags tags={personaValue.list(value)} renderText={renderText} />;
    case 'quotes':
      return (
        <ul className="persona-quotes">
          {personaValue.list(value).map((quote, i) => (
            <li key={`${i}-${quote}`}>{renderText(quote)}</li>
          ))}
        </ul>
      );
    case 'bubbles':
      return (
        <ol className="persona-bubbles" aria-label={sub.title}>
          {personaValue.turns(value).map((turn, i) => (
            <li key={i} className={turn.who === 'me' ? 'me' : 'ta'}>
              <span className="persona-bubble-who">{turn.who === 'me' ? '我' : 'TA'}</span>
              <span className="persona-bubble">{renderText(turn.text)}</span>
            </li>
          ))}
        </ol>
      );
    case 'entries':
      return (
        <div className="persona-entries">
          {personaValue.entries(value).map((entry, i) => (
            <details key={`${i}-${entry.title}`}>
              <summary>
                <span>{renderText(entry.title)}</span>
                <OldIcon name="wechat/chevron_right" size={16} />
              </summary>
              <p>{renderText(entry.text)}</p>
            </details>
          ))}
        </div>
      );
    case 'avatarStrip':
      return (
        <ul className="persona-people">
          {personaValue.people(value).map((person) => (
            <li key={person.id}>
              <PlazaAvatar
                id={person.id}
                name={person.name}
                url={person.avatarUrl ?? null}
                size={48}
              />
              <span>{person.name}</span>
              {person.note && <small>{person.note}</small>}
            </li>
          ))}
        </ul>
      );
    default:
      return <p>{renderText(personaValue.text(value))}</p>;
  }
}

/** 正文：超过 5 行折叠，点「展开」看全文。 */
function FoldText({ text, renderText }: { text: string; renderText: (t: string) => ReactNode }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [overflow, setOverflow] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setOverflow(el.scrollHeight > el.clientHeight + 1);
  }, [text, open]);
  return (
    <>
      <p ref={ref} className={`persona-text${open ? '' : ' folded'}`}>
        {renderText(text)}
      </p>
      {(overflow || open) && (
        <button type="button" className="persona-more" onClick={() => setOpen((v) => !v)}>
          {open ? '收起' : '展开'}
        </button>
      )}
    </>
  );
}

/** 音色行尾的试听按钮（库内样音，不生成语音、不计费）。 */
export function VoiceSampleButton({ url, name }: { url: string | null | undefined; name: string }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => () => audio.current?.pause(), []);
  if (!url) return null;
  return (
    <button
      type="button"
      className={`persona-voice${playing ? ' playing' : ''}`}
      aria-label={playing ? `停止试听${name}` : `试听${name}`}
      onClick={() => {
        if (playing) {
          audio.current?.pause();
          setPlaying(false);
          return;
        }
        const element = new Audio(url);
        audio.current = element;
        element.onended = () => setPlaying(false);
        element.onerror = () => setPlaying(false);
        setPlaying(true);
        void element.play().catch(() => setPlaying(false));
      }}
    >
      <OldIcon name="wechat/voice" size={18} />
      试听
    </button>
  );
}
