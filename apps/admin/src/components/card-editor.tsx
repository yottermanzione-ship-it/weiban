import { useState } from 'react';
import { Alert, Tabs, Upload, Button } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { CharacterCard, DraftCharacterCard, WeibanCardData } from '@weiban/contracts';
import { SchemaFields, fieldName } from './schema-fields.js';
import { errorText } from '../data/hooks.js';

/** WB-Card 人设编辑器：按 schema 自动生成表单，各板块用标签页切换。 */
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
  const tabs = Object.keys(WeibanCardData.shape) as Array<keyof typeof WeibanCardData.shape>;

  return (
    <div className="card-editor">
      <div className="card-editor-head">
        <div>
          <strong>人设卡（WB-Card 1.0）</strong>
          <div className="field-help">
            人设内容与分类事实分开管理；上架前系统会自动做一次模型检测。
          </div>
        </div>
        <Upload
          accept="application/json,.json"
          showUploadList={false}
          beforeUpload={(file) => {
            if (file.size > 2_000_000) {
              setError('人设文件不能超过 2MB');
              return false;
            }
            void file
              .text()
              .then((text) => {
                onChange(DraftCharacterCard.parse(JSON.parse(text)));
                setError('');
              })
              .catch((e: unknown) => setError(errorText(e)));
            return false;
          }}
        >
          <Button icon={<UploadOutlined />}>导入 WB-Card JSON</Button>
        </Upload>
      </div>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      <div className={validation.success ? 'card-check ok' : 'card-check'}>
        {validation.success
          ? '必填结构完整，仍需通过服务器模型检测后才能上架。'
          : `待完善 ${validation.error.issues.length} 项：${validation.error.issues
              .slice(0, 5)
              .map((i) => i.path.map((p) => fieldName(String(p))).join(' / '))
              .join('；')}`}
      </div>
      <Tabs
        activeKey={String(tab)}
        onChange={(key) => setTab(key as typeof tab)}
        items={tabs.map((key) => ({
          key: String(key),
          label: fieldName(String(key)),
          children: (
            <SchemaFields
              schema={WeibanCardData.shape[key]}
              value={card.data[key]}
              label={fieldName(String(key))}
              onChange={(value) =>
                onChange({ ...card, data: { ...card.data, [key]: value as never } })
              }
            />
          ),
        }))}
      />
    </div>
  );
}
