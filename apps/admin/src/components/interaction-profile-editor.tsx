import { Alert, Input, InputNumber } from 'antd';
import { FieldHelp } from '../ui/page.js';

type Props = { kind: 'moments' | 'group'; value: string; onChange: (value: string) => void };
const list = (value: unknown): string =>
  Array.isArray(value)
    ? value.filter((v) => typeof v === 'string').join('\n')
    : typeof value === 'string'
      ? value
      : '';
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
export function InteractionProfileEditor({ kind, value, onChange }: Props) {
  let data: Record<string, unknown> = {},
    error = false;
  try {
    const parsed: unknown = value.trim() ? JSON.parse(value) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      data = parsed as Record<string, unknown>;
    else if (parsed !== null) error = true;
  } catch {
    error = true;
  }
  const get = (keys: string[]) =>
    keys.map((k) => data[k]).find((v) => v !== undefined && v !== null && v !== '');
  const set = (keys: string[], next: unknown) => {
    const copy = { ...data };
    for (const k of keys) delete copy[k];
    if (next !== '' && next !== null && next !== undefined) copy[keys[0]!] = next;
    onChange(Object.keys(copy).length ? JSON.stringify(copy, null, 2) : '');
  };
  const renderText = (label: string, keys: string[], multiple = false) => (
    <label className="field-line">
      <span className="field-label">{label}</span>
      <Input.TextArea
        aria-label={label}
        disabled={error}
        autoSize={{ minRows: 1 }}
        value={multiple ? list(get(keys)) : text(get(keys))}
        onChange={(e) =>
          set(
            keys,
            multiple
              ? e.target.value
                  .split('\n')
                  .map((v) => v.trim())
                  .filter(Boolean)
              : e.target.value,
          )
        }
      />
    </label>
  );
  return (
    <div>
      {error && (
        <Alert
          type="warning"
          showIcon
          message="当前互动资料不是可分区编辑的对象，原文完整保留；请展开高级原文核对，未静默替换。"
        />
      )}
      {kind === 'moments' ? (
        <>
          {renderText('朋友圈语气', [
            'tone',
            'style',
            'mood',
            'voice',
            'moment_tone',
            'post_style',
          ])}
          {renderText(
            '常写主题（每行一项）',
            ['topics', 'themes', 'themes_json', 'subjects', 'content_topics'],
            true,
          )}
          {renderText('朋友圈评论风格', [
            'comment_style',
            'commentStyle',
            'reply_style',
            'comment_tone',
          ])}
        </>
      ) : (
        <>
          {renderText('群聊说话风格', [
            'group_style',
            'groupStyle',
            'group_chat_style',
            'style',
            'chat_style',
            'chatStyle',
            'description',
          ])}
          {renderText(
            '群聊话题与爱好（每行一项）',
            ['hobbies', 'topics', 'interests', 'likes'],
            true,
          )}
          <label className="field-line">
            <span className="field-label">群聊活跃度（0～100）</span>
            <InputNumber
              aria-label="群聊活跃度"
              min={0}
              max={100}
              disabled={error}
              value={
                typeof get(['talkativeness', 'activity', 'frequency', 'reply_frequency']) ===
                'number'
                  ? (get(['talkativeness', 'activity', 'frequency', 'reply_frequency']) as number)
                  : undefined
              }
              onChange={(v) =>
                set(['talkativeness', 'activity', 'frequency', 'reply_frequency'], v)
              }
            />
          </label>
        </>
      )}
      <FieldHelp>
        只修改你编辑的风格资料；其他未识别项保留。发布频率、工具权限和计费不是这里的文字开关。
      </FieldHelp>
      <details open={error || undefined}>
        <summary>高级：完整互动原文</summary>
        <Input.TextArea
          aria-label={kind === 'moments' ? '朋友圈完整原文' : '群聊完整原文'}
          value={value}
          autoSize={{ minRows: 3, maxRows: 12 }}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      </details>
    </div>
  );
}
