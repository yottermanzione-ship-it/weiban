import { useState } from 'react';
import { CharacterCard, DraftCharacterCard, WeibanCardData } from '@weiban/contracts';
import { SchemaFields, fieldName } from './schema-fields.js';
import { errorText } from '../data/hooks.js';
export function CardEditor({
  card,
  onChange,
}: {
  card: DraftCharacterCard;
  onChange: (card: DraftCharacterCard) => void;
}) {
  const [tab, setTab] = useState<keyof typeof WeibanCardData.shape>('persona');
  const [error, setError] = useState('');
  const validation = CharacterCard.safeParse(card);
  return (
    <section>
      <h2>WB-Card 1.0 人设</h2>
      <p>人设内容与分类事实分别管理；发布检测结果由服务器生成。</p>
      <label>
        导入 WB-Card JSON
        <input
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            if (file.size > 2_000_000) {
              setError('卡片文件不能超过2MB');
              return;
            }
            void file
              .text()
              .then((text) => {
                onChange(DraftCharacterCard.parse(JSON.parse(text)));
                setError('');
              })
              .catch((e) => setError(errorText(e)));
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <p role="status">
        {validation.success
          ? '必填人设结构完整，仍需通过服务器模型检测。'
          : `待完善 ${validation.error.issues.length} 项：${validation.error.issues
              .slice(0, 5)
              .map((i) => i.path.map((p) => fieldName(String(p))).join(' / '))
              .join('；')}`}
      </p>
      <nav className="card-tabs" aria-label="人设板块">
        {Object.keys(WeibanCardData.shape).map((key) => (
          <button
            type="button"
            aria-pressed={tab === key}
            key={key}
            onClick={() => setTab(key as typeof tab)}
          >
            {fieldName(key)}
          </button>
        ))}
      </nav>
      <SchemaFields
        schema={WeibanCardData.shape[tab]}
        value={card.data[tab]}
        label={fieldName(tab)}
        onChange={(value) => onChange({ ...card, data: { ...card.data, [tab]: value } })}
      />
    </section>
  );
}
