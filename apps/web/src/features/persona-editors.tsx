/*
 * 自建角色各字段的整页编辑器（2026-10-27 批 U3）。全部是页内二级页面 SubPageLayer：
 * 顶栏「取消 / 标题 / 完成」，没改动时完成灰色；编辑的是草稿，「完成」才写回创建页，「取消」/ 返回键丢弃。
 * 用哪个编辑器、参数是多少由人设板块配置（packages/client-core/src/persona-sections.ts）决定，这里只管长相和交互。
 */
import { useEffect, useRef, useState } from 'react';
import type { AgeSetting, CharacterBasis, RealPersonKind } from '@weiban/contracts';
import { CountTextarea, PickRow, SubPageLayer } from './edit-page.js';
import {
  AGE_OPTIONS,
  BASIS_OPTIONS,
  REAL_KIND_OPTIONS,
  parseDialogue,
  serializeDialogue,
  type DialogueTurn,
  type PersonaEditor,
} from '@weiban/client-core';
import { CheckSlot, SwitchRow } from './shell-kit.js';

type Editor<K extends PersonaEditor['kind']> = Extract<PersonaEditor, { kind: K }>;

// ---------- 长文本：大文本区 + 字数 ----------

export function LongTextPage({
  title,
  editor,
  initial,
  onSave,
  onClose,
}: {
  title: string;
  editor: Editor<'longText'>;
  initial: string;
  onSave(value: string): void;
  onClose(): void;
}) {
  const [value, setValue] = useState(initial);
  const length = value.trim().length;
  return (
    <SubPageLayer
      title={title}
      canSave={value !== initial}
      onCancel={onClose}
      onSave={() => onSave(value)}
      className="persona-editor"
    >
      <div className="persona-long-text">
        <CountTextarea
          label={title}
          value={value}
          onChange={setValue}
          maxLength={editor.maxLength}
          placeholder={editor.placeholder}
          rows={editor.maxLength > 1000 ? 14 : 7}
        />
      </div>
      {editor.minLength ? (
        <p className="edit-hint">
          {length >= editor.minLength
            ? `已写 ${length} 字`
            : `至少 ${editor.minLength} 字，已写 ${length} 字`}
        </p>
      ) : (
        editor.hint && <p className="edit-hint">{editor.hint}</p>
      )}
    </SubPageLayer>
  );
}

// ---------- 可增删条目：口头禅、标签 ----------

const clean = (items: string[]) => items.map((item) => item.trim()).filter(Boolean);

export function ListPage({
  title,
  editor,
  initial,
  onSave,
  onClose,
}: {
  title: string;
  editor: Editor<'list'>;
  initial: string[];
  onSave(value: string[]): void;
  onClose(): void;
}) {
  const [items, setItems] = useState<string[]>(initial.length ? initial : ['']);
  const focusIndex = useRef<number | null>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusIndex.current === null) return;
    const inputs = list.current?.querySelectorAll<HTMLInputElement>('input');
    inputs?.[focusIndex.current]?.focus();
    focusIndex.current = null;
  });
  const canAdd = items.length < editor.maxItems;
  const add = () => {
    if (!canAdd) return;
    focusIndex.current = items.length;
    setItems([...items, '']);
  };
  const changed = JSON.stringify(clean(items)) !== JSON.stringify(clean(initial));
  return (
    <SubPageLayer
      title={title}
      canSave={changed}
      onCancel={onClose}
      onSave={() => onSave(clean(items).slice(0, editor.maxItems))}
      className="persona-editor"
    >
      <div className="edit-group first list-editor" ref={list}>
        {items.map((item, index) => (
          <div className="list-editor-row" key={index}>
            <button
              type="button"
              className="list-editor-remove"
              aria-label={`删除这条${editor.itemName}`}
              onClick={() => setItems(items.filter((_, i) => i !== index))}
            >
              <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
                <circle cx="11" cy="11" r="10" fill="currentColor" />
                <path d="M6.5 11h9" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
            <input
              aria-label={`${editor.itemName} ${index + 1}`}
              value={item}
              maxLength={editor.itemMaxLength}
              placeholder={editor.placeholder}
              autoFocus={index === 0 && !initial.length}
              onChange={(event) =>
                setItems(items.map((v, i) => (i === index ? event.target.value : v)))
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  if (item.trim()) add();
                }
              }}
            />
          </div>
        ))}
        {canAdd && (
          <button type="button" className="list-editor-add" onClick={add}>
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
              <circle cx="11" cy="11" r="10" fill="currentColor" />
              <path d="M6.5 11h9M11 6.5v9" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <span>添加{editor.itemName}</span>
          </button>
        )}
      </div>
      <p className="edit-hint">
        {editor.hint ??
          `最多 ${editor.maxItems} 条，每条不超过 ${editor.itemMaxLength} 字；空着的条目不会保存`}
      </p>
    </SubPageLayer>
  );
}

// ---------- 示例对话：「我说 / TA 说」气泡 ----------

export function DialoguePage({
  editor,
  initial,
  onSave,
  onClose,
}: {
  editor: Editor<'dialogue'>;
  initial: string;
  onSave(value: string): void;
  onClose(): void;
}) {
  const [turns, setTurns] = useState<DialogueTurn[]>(() => parseDialogue(initial));
  const [raw, setRaw] = useState<string | null>(null);
  const focusIndex = useRef<number | null>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusIndex.current === null) return;
    const areas = list.current?.querySelectorAll<HTMLTextAreaElement>('textarea');
    areas?.[focusIndex.current]?.focus();
    focusIndex.current = null;
  });
  const text = raw ?? serializeDialogue(turns);
  const baseline = raw === null ? serializeDialogue(parseDialogue(initial)) : initial;
  const tooLong = text.length > editor.maxLength;
  const add = (who: DialogueTurn['who']) => {
    focusIndex.current = turns.length;
    setTurns([...turns, { who, text: '' }]);
  };
  return (
    <SubPageLayer
      title="示例对话"
      canSave={text.trim() !== baseline.trim() && !tooLong}
      onCancel={onClose}
      onSave={() => onSave(text.trim())}
      className="persona-editor"
    >
      <p className="edit-hint dialogue-intro">
        写几段你和 TA 的对话，TA 会照着这个感觉说话。点「我 / TA」可以换说话人。
        <button
          type="button"
          className="text-button text-action"
          onClick={() => {
            if (raw === null) setRaw(serializeDialogue(turns));
            else {
              setTurns(parseDialogue(raw));
              setRaw(null);
            }
          }}
        >
          {raw === null ? '按原文编辑' : '按气泡编辑'}
        </button>
      </p>
      {raw !== null ? (
        <div className="persona-long-text">
          <CountTextarea
            label="示例对话原文"
            value={raw}
            onChange={setRaw}
            maxLength={editor.maxLength}
            placeholder={'我：周末有空吗？\nTA：有呀，想去哪？'}
            rows={12}
          />
        </div>
      ) : (
        <div className="dialogue-editor" ref={list}>
          {turns.length === 0 && <p className="dialogue-empty">还没有对话，从下面添加第一句</p>}
          {turns.map((turn, index) => (
            <div key={index} className={`dialogue-turn ${turn.who}`}>
              <button
                type="button"
                className="dialogue-who"
                aria-label={`${turn.who === 'me' ? '我说' : 'TA 说'}，点按换成${turn.who === 'me' ? 'TA 说' : '我说'}`}
                onClick={() =>
                  setTurns(
                    turns.map((t, i) =>
                      i === index ? { ...t, who: t.who === 'me' ? 'ta' : 'me' } : t,
                    ),
                  )
                }
              >
                {turn.who === 'me' ? '我' : 'TA'}
              </button>
              <textarea
                className="dialogue-bubble"
                aria-label={`第 ${index + 1} 句，${turn.who === 'me' ? '我说' : 'TA 说'}`}
                rows={Math.max(1, turn.text.split('\n').length)}
                value={turn.text}
                placeholder={turn.who === 'me' ? '我说…' : 'TA 说…'}
                onChange={(event) =>
                  setTurns(
                    turns.map((t, i) => (i === index ? { ...t, text: event.target.value } : t)),
                  )
                }
              />
              <button
                type="button"
                className="dialogue-remove"
                aria-label={`删除第 ${index + 1} 句`}
                onClick={() => setTurns(turns.filter((_, i) => i !== index))}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                  <path
                    d="M4 4l8 8M12 4l-8 8"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          ))}
          <div className="dialogue-add">
            <button type="button" className="dialogue-add-ta" onClick={() => add('ta')}>
              + TA 说
            </button>
            <button type="button" className="dialogue-add-me" onClick={() => add('me')}>
              + 我说
            </button>
          </div>
        </div>
      )}
      {/* 按原文编辑时文本区右下角已有剩余字数，这里只在气泡模式显示 */}
      {raw === null && (
        <p className={`edit-hint dialogue-count${tooLong ? ' over' : ''}`}>
          {tooLong
            ? `超出 ${text.length - editor.maxLength} 字，删减一些再保存`
            : `${text.length} / ${editor.maxLength}`}
        </p>
      )}
    </SubPageLayer>
  );
}

// ---------- 角色分类（分类说明放在页内） ----------

export interface BasisValue {
  basis: CharacterBasis;
  realKind: RealPersonKind;
  declared: boolean;
}

export function BasisPage({
  initial,
  isLocked,
  imported,
  onSave,
  onClose,
}: {
  initial: BasisValue;
  /** 分类单向锁（真人不能改回其他）+ 导入草稿未声明时只能选真人。 */
  isLocked(value: CharacterBasis, declared: boolean): boolean;
  /** 来自聊天记录导入时：需要先声明不以真实人物身份出现；可能的真名列表。 */
  imported: { realNames: string[] } | null;
  onSave(value: BasisValue): void;
  onClose(): void;
}) {
  const [value, setValue] = useState(initial);
  const changed =
    value.basis !== initial.basis ||
    value.declared !== initial.declared ||
    (value.basis === 'real_person' && value.realKind !== initial.realKind);
  return (
    <SubPageLayer
      title="角色分类"
      canSave={changed}
      onCancel={onClose}
      onSave={() => onSave(value)}
      className="persona-editor"
    >
      <div className="edit-group first" role="radiogroup" aria-label="角色分类">
        {BASIS_OPTIONS.map((option) => {
          const locked = isLocked(option.value, value.declared);
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={value.basis === option.value}
              className="pick-row basis-pick"
              disabled={locked}
              onClick={() => setValue({ ...value, basis: option.value })}
            >
              <span className="basis-text">
                <span>{option.label}</span>
                <small>{option.description}</small>
              </span>
              <CheckSlot checked={value.basis === option.value} size={22} />
            </button>
          );
        })}
      </div>
      <p className="edit-hint">选择「真人」的角色不会有成人模式，也不会生成 TA 的肖像。</p>
      {value.basis === 'real_person' && (
        <>
          <h2 className="edit-section">真人类型</h2>
          <div className="edit-group" role="radiogroup" aria-label="真人类型">
            {REAL_KIND_OPTIONS.map((option) => (
              <PickRow
                key={option.value}
                label={option.label}
                checked={value.realKind === option.value}
                onClick={() => setValue({ ...value, realKind: option.value })}
              />
            ))}
          </div>
        </>
      )}
      {imported && (
        <>
          <h2 className="edit-section">来自聊天记录导入</h2>
          <div className="edit-group">
            <SwitchRow
              label="不以真实人物的身份出现"
              subtitle="我会替换掉真名和真实经历"
              checked={value.declared}
              onChange={(declared) =>
                setValue({
                  ...value,
                  declared,
                  basis: declared ? value.basis : 'real_person',
                })
              }
            />
          </div>
          {value.basis !== 'real_person' && imported.realNames.length > 0 && (
            <p className="edit-hint warn">
              草稿里可能有真名：{imported.realNames.join('、')}，请替换成新的名字
            </p>
          )}
        </>
      )}
    </SubPageLayer>
  );
}

// ---------- 年龄设定 ----------

export interface AgeValue {
  ageSetting: AgeSetting;
  childAppearance: boolean;
}

export function AgePage({
  initial,
  isLocked,
  onSave,
  onClose,
}: {
  initial: AgeValue;
  isLocked(value: AgeSetting): boolean;
  onSave(value: AgeValue): void;
  onClose(): void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <SubPageLayer
      title="年龄设定"
      canSave={
        value.ageSetting !== initial.ageSetting || value.childAppearance !== initial.childAppearance
      }
      onCancel={onClose}
      onSave={() => onSave(value)}
      className="persona-editor"
    >
      <div className="edit-group first" role="radiogroup" aria-label="年龄设定">
        {AGE_OPTIONS.map((option) => (
          <PickRow
            key={option.value}
            label={option.label}
            checked={value.ageSetting === option.value}
            disabled={isLocked(option.value)}
            onClick={() => setValue({ ...value, ageSetting: option.value })}
          />
        ))}
      </div>
      {isLocked('adult') && <p className="edit-hint">已保存为未成年，不能再改为成年。</p>}
      <div className="edit-group first">
        <SwitchRow
          label="外表是儿童"
          checked={value.childAppearance}
          onChange={(childAppearance) => setValue({ ...value, childAppearance })}
        />
      </div>
    </SubPageLayer>
  );
}
