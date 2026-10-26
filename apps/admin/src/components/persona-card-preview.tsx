/**
 * 后台角色预览（2026-10-27 批 U4）：和用户端人设卡用同一份「板块 → 子板块」配置
 * （@weiban/client-core 的 PERSONA_SECTIONS），用 Ant Design 简单分组渲染。
 * 与用户端的区别：内部标记（真人类型、年龄设定、场景态度、互动风格等 userVisible = false 的子板块）也显示，
 * 并标「仅后台」；可打开「显示预留位置」看还没有数据来源的子板块。新增字段只改配置，这里不用改。
 */
import { useState } from 'react';
import { Avatar, Collapse, Descriptions, Empty, Space, Switch, Tag, Typography } from 'antd';
import {
  PERSONA_SECTIONS,
  personaValue,
  resolvePersonaCard,
  type PersonaSource,
  type ResolvedSubsection,
} from '@weiban/client-core';
import './persona-card-preview.css';

export function PersonaCardPreview({ source }: { source: PersonaSource }) {
  const [showReserved, setShowReserved] = useState(false);
  const resolved = resolvePersonaCard(source, 'admin');
  const filled = new Map(resolved.flatMap((g) => g.items.map((item) => [item.sub.id, item])));
  return (
    <div className="persona-preview">
      <div className="persona-preview-bar">
        <Typography.Text type="secondary">
          按用户端人设卡同一份配置分组；标「仅后台」的内容用户看不到，空的子板块在用户端整块不显示。
        </Typography.Text>
        <Space size={6}>
          <Switch size="small" checked={showReserved} onChange={setShowReserved} />
          显示预留位置
        </Space>
      </div>
      {PERSONA_SECTIONS.map((section) => {
        const subs = section.subsections.filter((sub) => showReserved || filled.has(sub.id));
        if (!subs.length) return null;
        return (
          <section key={section.id} className="persona-preview-section">
            <h4>
              {section.adminTitle ?? section.title}
              {section.adminTitle && section.adminTitle !== section.title && (
                <small>用户端：{section.title}</small>
              )}
            </h4>
            <Descriptions column={1} size="small" bordered>
              {subs.map((sub) => {
                const item = filled.get(sub.id);
                return (
                  <Descriptions.Item
                    key={sub.id}
                    label={
                      <Space size={4} wrap>
                        {sub.cardTitle ?? sub.title}
                        {!sub.userVisible && <Tag color="orange">仅后台</Tag>}
                      </Space>
                    }
                  >
                    {item ? (
                      <PreviewValue item={item} />
                    ) : (
                      <Typography.Text type="secondary">
                        {sub.from ? '未填写' : '预留（暂无数据来源）'}
                      </Typography.Text>
                    )}
                  </Descriptions.Item>
                );
              })}
            </Descriptions>
          </section>
        );
      })}
      {resolved.length === 0 && <Empty description="还没有可预览的内容" />}
    </div>
  );
}

function PreviewValue({ item }: { item: ResolvedSubsection }) {
  const { value, sub } = item;
  switch (sub.display) {
    case 'avatar':
      return <Avatar shape="square" size={48} src={personaValue.text(value)} />;
    case 'tags':
      return (
        <Space size={[4, 4]} wrap>
          {personaValue.list(value).map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </Space>
      );
    case 'quotes':
      return (
        <ul className="persona-preview-quotes">
          {personaValue.list(value).map((quote, i) => (
            <li key={i}>{quote}</li>
          ))}
        </ul>
      );
    case 'bubbles':
      return (
        <div className="persona-preview-bubbles">
          {personaValue.turns(value).map((turn, i) => (
            <div key={i} className={turn.who === 'me' ? 'me' : 'ta'}>
              <span>{turn.who === 'me' ? '我' : 'TA'}</span>
              <p>{turn.text}</p>
            </div>
          ))}
        </div>
      );
    case 'entries':
      return (
        <Collapse
          size="small"
          items={personaValue.entries(value).map((entry, i) => ({
            key: String(i),
            label: entry.title,
            children: <p className="persona-preview-text">{entry.text}</p>,
          }))}
        />
      );
    case 'avatarStrip':
      return (
        <Space wrap>
          {personaValue.people(value).map((person) => (
            <Space key={person.id} size={4}>
              <Avatar size="small" src={person.avatarUrl ?? undefined}>
                {person.name.slice(0, 1)}
              </Avatar>
              {person.name}
              {person.note && <Typography.Text type="secondary">{person.note}</Typography.Text>}
            </Space>
          ))}
        </Space>
      );
    default:
      return (
        <Typography.Paragraph
          className="persona-preview-text"
          ellipsis={{
            rows: 5,
            expandable: 'collapsible',
            symbol: (open) => (open ? '收起' : '展开'),
          }}
        >
          {personaValue.text(value)}
        </Typography.Paragraph>
      );
  }
}
