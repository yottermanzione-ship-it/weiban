import { useMemo, useState } from 'react';
import { Button, Input, Space } from 'antd';
import { splitPersonaText, joinPersonaText } from './persona-text-sections.js';

/** 展示当前实际运行文字；分段编辑和完整原文是同一份内容，不藏第二份生效规则。 */
export function PersonaTextEditor({
  label,
  value,
  onChange,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  const [full, setFull] = useState(false);
  const document = useMemo(() => splitPersonaText(value), [value]);
  const segmented = document.parts.length > 0 && !full;
  return (
    <div className="persona-text-editor">
      <div className="legacy-entry-head">
        <strong>
          {label}
          {required ? '（必填）' : ''}
        </strong>
        <Space>
          {document.parts.length > 0 && (
            <Button size="small" type="text" onClick={() => setFull((v) => !v)}>
              {full ? '分段编辑' : '查看完整原文'}
            </Button>
          )}
        </Space>
      </div>
      {!segmented ? (
        <Input.TextArea
          aria-label={label}
          value={value}
          autoSize={{ minRows: 1 }}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <>
          {document.leading.trim() && (
            <label className="field-line">
              <span className="field-label">其他人设原文</span>
              <Input.TextArea
                aria-label={`${label}其他原文`}
                value={document.leading}
                autoSize={{ minRows: 1 }}
                onChange={(e) =>
                  onChange(joinPersonaText({ ...document, leading: e.target.value }))
                }
              />
            </label>
          )}
          {document.parts.map((part, index) => (
            <label className="field-line" key={index}>
              <span className="field-label">{part.label}</span>
              <Input.TextArea
                aria-label={`${label}：${part.label}`}
                value={part.text}
                autoSize={{ minRows: 1 }}
                onChange={(e) =>
                  onChange(
                    joinPersonaText({
                      ...document,
                      parts: document.parts.map((p, i) =>
                        i === index ? { ...p, text: e.target.value } : p,
                      ),
                    }),
                  )
                }
              />
            </label>
          ))}
        </>
      )}
    </div>
  );
}
