import { z } from 'zod';
import { Button, Checkbox, InputNumber, Input, Select } from 'antd';
import { MinusCircleOutlined } from '@ant-design/icons';
const names: Record<string, string> = {
  persona: '人设',
  speech: '语言风格',
  examples: '对话范例',
  knowledge: '知识库',
  simulation: '生活模拟',
  social: '社交行为',
  recognition: '识别',
  opening: '开场',
  modes: '模式',
  safetyStyle: '安全表达',
  profileExtra: '补充资料',
  admin: '管理备注',
  summary: '人设摘要',
  background: '背景',
  personality: '性格',
  values: '价值观',
  likes: '喜欢',
  dislikes: '不喜欢',
  personaTags: '性格标签',
  personaTagsCustom: '补充标签',
  defaultAttitudeToUser: '对用户的默认态度',
  growthByFamiliarity: '熟悉度变化',
  worldNote: '世界观',
  selfReference: '自称',
  addressUserDefault: '称呼用户',
  tone: '语气',
  sentenceLength: '句子长度',
  catchphrases: '口头禅',
  catchphraseFrequency: '口头禅频率',
  emojiHabit: '表情习惯',
  frequency: '频率',
  favorites: '常用表情',
  punctuationHabit: '标点习惯',
  dialect: '方言',
  typoStyle: '错字风格',
  forbiddenWords: '禁用词',
  languageNotes: '语言备注',
  id: '编号',
  scene: '场景',
  turns: '对话',
  role: '说话人',
  text: '内容',
  entries: '条目',
  title: '标题',
  category: '类别',
  keys: '关键词',
  secondaryKeys: '辅助关键词',
  selective: '选择性触发',
  content: '内容',
  constant: '常驻',
  priority: '优先级',
  validFrom: '开始日期',
  validTo: '结束日期',
  sources: '来源',
  confidence: '可信度',
  unknownPolicy: '未知知识处理',
  dailyActivities: '日常活动（至少8项）',
  placeTypes: '活动地点',
  hobbies: '爱好',
  workRhythm: '工作节奏',
  storylineSeeds: '故事线索',
  forbiddenEventTopics: '禁止事件主题',
  moodBaseline: '情绪基线',
  sharePreference: '分享偏好',
  talkativeness: '健谈程度',
  groupStyle: '群聊风格',
  moments: '朋友圈',
  frequencyPerWeek: '每周频率范围',
  imageSubjects: '配图主题',
  commentStyle: '评论风格',
  stickerPacks: '表情包',
  stickerRate: '表情频率',
  voiceId: '声音编号',
  proactiveStyle: '主动联系风格',
  callStyle: '通话风格',
  selfEnabled: '识别自身',
  selfPublicImages: '公开图片',
  selfReferenceMediaIds: '参考媒体编号',
  appearanceCues: '外观线索',
  kind: '类型',
  date: '日期',
  publisher: '发布方',
  visualCues: '视觉线索',
  sourceUrl: '来源链接',
  firstMessageGuidance: '首条消息指导',
  referralGreetingGuidance: '转介绍问候',
  adminAllowlist: '允许模式',
  modeOverrides: '模式补充',
  deflectStyle: '回避表达',
  refuseSelfieStyle: '拒绝自拍表达',
  careVoice: '关怀表达',
  careFallbackText: '危机兜底（信任的人、12356、110、120）',
  occupation: '职业',
  gender: '性别',
  ageDisplay: '年龄展示',
  workSource: '作品出处',
  fanNameUsage: '粉丝称呼用法',
  worksDetail: '作品详情',
  type: '类型',
  year: '年份',
  searchKeywords: '搜索关键词',
  creatorNotes: '创建者备注（不会发送给模型）',
  sourceList: '来源清单',
  creationMethod: '创建方式',
  importSource: '导入来源',
  author: '作者',
  version: '版本',
  format: '格式',
  extensions: '扩展数据',
  url: '链接',
  accessedAt: '访问日期',
};
export const fieldName = (key: string) => names[key] ?? key;
function base(schema: z.ZodType): z.ZodType {
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault
  )
    return base(schema.unwrap() as z.ZodType);
  return schema;
}
function initial(schema: z.ZodType): unknown {
  const s = base(schema);
  if (s instanceof z.ZodObject) return {};
  if (s instanceof z.ZodArray) return [];
  if (s instanceof z.ZodTuple) return s.def.items.map((x) => initial(x as z.ZodType));
  if (s instanceof z.ZodBoolean) return false;
  if (s instanceof z.ZodNumber) return 0;
  if (s instanceof z.ZodEnum) return s.options[0];
  return '';
}
export function SchemaFields({
  schema,
  value,
  onChange,
  label,
}: {
  schema: z.ZodType;
  value: unknown;
  onChange: (value: unknown) => void;
  label: string;
}) {
  const s = base(schema);
  if (s instanceof z.ZodObject) {
    const record =
      typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
    return (
      <div className="nested-group">
        <div className="nested-title">{label}</div>
        <div className="nested-body">
          {Object.entries(s.shape as Record<string, z.ZodType>).map(([key, child]) => (
            <SchemaFields
              key={key}
              schema={child as z.ZodType}
              value={record[key]}
              label={fieldName(key)}
              onChange={(next) => {
                const copy = { ...record };
                if (next === undefined) delete copy[key];
                else copy[key] = next;
                onChange(copy);
              }}
            />
          ))}
        </div>
      </div>
    );
  }
  if (s instanceof z.ZodArray) {
    const items = Array.isArray(value) ? value : [];
    return (
      <div className="nested-group">
        <div className="nested-title">
          {label}
          <Button
            size="small"
            type="link"
            onClick={() => onChange([...items, initial(s.element as z.ZodType)])}
          >
            + 添加
          </Button>
        </div>
        <div className="nested-body">
          {items.map((item, i) => (
            <div className="array-item" key={i}>
              <SchemaFields
                schema={s.element as z.ZodType}
                value={item}
                label={`${label} ${i + 1}`}
                onChange={(next) => onChange(items.map((x, j) => (j === i ? next : x)))}
              />
              <Button
                type="text"
                danger
                size="small"
                icon={<MinusCircleOutlined />}
                onClick={() => onChange(items.filter((_, j) => j !== i))}
              />
            </div>
          ))}
          {items.length === 0 && <span className="field-help">还没有内容，点右上角「+ 添加」。</span>}
        </div>
      </div>
    );
  }
  if (s instanceof z.ZodTuple)
    return (
      <div className="nested-group">
        <div className="nested-title">{label}</div>
        <div className="nested-body">
          {s.def.items.map((child, i) => (
            <SchemaFields
              key={i}
              schema={child as z.ZodType}
              label={`${label} ${i + 1}`}
              value={Array.isArray(value) ? value[i] : undefined}
              onChange={(next) => {
                const items = Array.isArray(value)
                  ? [...value]
                  : s.def.items.map((x) => initial(x as z.ZodType));
                items[i] = next;
                onChange(items);
              }}
            />
          ))}
        </div>
      </div>
    );
  if (s instanceof z.ZodBoolean)
    return (
      <div className="field-line">
        <Checkbox checked={value === true} onChange={(e) => onChange(e.target.checked)}>
          {label}
        </Checkbox>
      </div>
    );
  if (s instanceof z.ZodEnum)
    return (
      <div className="field-line">
        <span className="field-label">{label}</span>
        <Select
          allowClear
          style={{ width: '100%' }}
          placeholder="未填写"
          value={typeof value === 'string' ? value : undefined}
          onChange={(next) => onChange(next ?? undefined)}
          options={s.options.map((x) => ({ value: String(x), label: String(x) }))}
        />
      </div>
    );
  if (s instanceof z.ZodNumber)
    return (
      <div className="field-line">
        <span className="field-label">{label}</span>
        <InputNumber
          style={{ width: '100%' }}
          value={typeof value === 'number' ? value : undefined}
          onChange={(next) => onChange(next === null ? undefined : next)}
        />
      </div>
    );
  if (s instanceof z.ZodString || s instanceof z.ZodUnion)
    return (
      <div className="field-line">
        <span className="field-label">{label}</span>
        <Input.TextArea
          autoSize={{ minRows: 2, maxRows: 10 }}
          value={typeof value === 'string' || typeof value === 'number' ? value : ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      </div>
    );
  return (
    <div className="field-line">
      <span className="field-label">{label}</span>
      <span className="field-help">通过 WB-Card 文件导入维护此扩展字段。</span>
    </div>
  );
}
