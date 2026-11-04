/**
 * 搜索身份修正（5.6，T-20261104e；docs/refactor/24-character-search.md 第 3 步）。
 *
 * - 实体关联：把同一个人 / 角色的公开资料标识（百科条目等）和本站官方角色归到一个实体，填写核实过的身份说明与出处；
 *   可以合并两个实体、把错并的拆开。只有这里登记的关联才会让联网查找的候选显示「添加 / 去聊天」，
 *   名字相同不会自动合并。
 * - 角色别名：官方角色的搜索别名先「添加（待审核）」，通过后才进站内搜索；人设里的别名可以从搜索里去掉 / 恢复。
 * 每次修改都要写原因，记审计（谁、何时、改了什么、原因），对应角色的搜索投影随后自动刷新。
 */
import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Checkbox, Drawer, Input, Modal, Select, Space, Tabs, Tag } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import {
  CharacterAdminEndpoints,
  SearchAdminEndpoints,
  type AdminSearchAliasOp,
  type AdminSearchCorrection,
  type AdminSearchEntity,
  type AdminSearchEntityDetail,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { formatDateTime } from '../ui/format.js';
import { Page, SectionCard, useToast } from '../ui/page.js';
import {
  aliasActions,
  aliasOpLabel,
  aliasStatusLabel,
  correctionLabel,
  parseLines,
  parseSourceLines,
  reasonProblem,
  sourcesToText,
} from './search-entities-helpers.js';

const { TextArea } = Input;

export function SearchEntitiesPage() {
  return (
    <Page
      title="搜索身份修正"
      desc="把同一个人物的公开资料和本站官方角色关联起来、修正身份说明和搜索别名。名字相同不会自动合并；每次修改都要写原因并记审计。"
    >
      <Tabs
        items={[
          { key: 'entities', label: '实体关联', children: <EntitiesTab /> },
          { key: 'aliases', label: '角色别名', children: <AliasesTab /> },
        ]}
      />
    </Page>
  );
}

/** 官方角色下拉（角色库里的全部官方角色）。 */
function useCharacterOptions() {
  const list = useRemote(CharacterAdminEndpoints.list);
  return useMemo(
    () =>
      (list.data?.items ?? []).map((c) => ({
        value: c.characterId,
        label: `${c.name}${c.status === 'published' ? '' : '（未上架）'}`,
      })),
    [list.data],
  );
}

function History({ items }: { items: AdminSearchCorrection[] }) {
  if (!items.length) return <div className="detail-muted">还没有修正记录</div>;
  return (
    <div className="simple-list">
      {items.map((item) => (
        <div className="simple-row" key={item.auditId}>
          <span className="simple-main">
            <b>{correctionLabel(item.action)}</b> · {item.summary}
            <div className="detail-muted">原因：{item.reason || '—'}</div>
          </span>
          <span className="detail-muted">
            {item.actorName} · {formatDateTime(item.at)}
          </span>
        </div>
      ))}
    </div>
  );
}

function ReasonInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Input
      maxLength={200}
      placeholder="修改原因（必填，记入审计），例如：百科条目核对为同一人"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// ---------- 实体关联 ----------

function EntitiesTab() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const list = useRemote(SearchAdminEndpoints.listEntities, { query: { q: query } });
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <SectionCard
      title="实体"
      desc="一个实体 = 一个人物 / 角色。归到同一实体的公开资料标识在联网查找里合并成一项，关联的官方角色显示「添加 / 去聊天」。"
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
          新建实体
        </Button>
      }
    >
      <Input.Search
        style={{ maxWidth: 360, marginBottom: 14 }}
        placeholder="按名字、实体键或标识查找"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onSearch={(value) => setQuery(value.trim())}
        allowClear
      />
      {list.error && <Alert type="error" showIcon message={list.error} />}
      <div className="simple-list">
        {(list.data?.items ?? []).map((entity) => (
          <div className="simple-row" key={entity.entityKey}>
            <span className="simple-main">
              <b>{entity.displayName}</b> <span className="detail-muted">{entity.entityKey}</span>
              <div className="detail-muted">
                {entity.identity ? `身份：${entity.identity}` : '未填写核实身份'} · 标识{' '}
                {entity.identifiers.length} 个 · 官方角色{' '}
                {entity.characters.map((c) => c.name).join('、') || '无'}
              </div>
            </span>
            <Button size="small" onClick={() => setOpenKey(entity.entityKey)}>
              查看 / 修正
            </Button>
          </div>
        ))}
        {!list.loading && !list.data?.items.length && (
          <div className="detail-muted">还没有实体。点「新建实体」登记第一个。</div>
        )}
      </div>
      {creating && (
        <CreateEntityModal
          onClose={() => setCreating(false)}
          onCreated={(detail) => {
            setCreating(false);
            list.refresh();
            setOpenKey(detail.entity.entityKey);
          }}
        />
      )}
      {openKey && (
        <EntityDrawer
          entityKey={openKey}
          onClose={() => setOpenKey(null)}
          onChanged={(key) => {
            list.refresh();
            setOpenKey(key);
          }}
        />
      )}
    </SectionCard>
  );
}

function CreateEntityModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (detail: AdminSearchEntityDetail) => void;
}) {
  const toast = useToast();
  const options = useCharacterOptions();
  const [displayName, setDisplayName] = useState('');
  const [identity, setIdentity] = useState('');
  const [identifiers, setIdentifiers] = useState('');
  const [sources, setSources] = useState('');
  const [characterIds, setCharacterIds] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    const parsed = parseSourceLines(sources);
    const problem =
      (!displayName.trim() && '请填写显示名') ||
      (parsed.invalid.length && `这些出处不是网址：${parsed.invalid.join('；')}`) ||
      reasonProblem(reason);
    if (problem) return setError(problem);
    setBusy(true);
    setError('');
    try {
      const detail = await api.call(SearchAdminEndpoints.createEntity, {
        body: {
          displayName: displayName.trim(),
          identity: identity.trim() || null,
          sources: parsed.sources,
          identifiers: parseLines(identifiers),
          characterIds,
          reason: reason.trim(),
        },
      });
      toast.success('已新建');
      onCreated(detail);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title="新建实体"
      okText="新建"
      confirmLoading={busy}
      onOk={() => void submit()}
      onCancel={onClose}
      width={640}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        {error && <Alert type="error" showIcon message={error} />}
        <Input
          maxLength={64}
          placeholder="显示名，例如：李晨"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <Input
          maxLength={120}
          placeholder="核实过的身份说明（选填），例如：中国内地男演员"
          value={identity}
          onChange={(e) => setIdentity(e.target.value)}
        />
        <TextArea
          rows={3}
          placeholder={
            '公开资料标识或百科条目地址，每行一个（选填）\n例如 https://baike.baidu.com/item/李晨/12345'
          }
          value={identifiers}
          onChange={(e) => setIdentifiers(e.target.value)}
        />
        <TextArea
          rows={3}
          placeholder={'出处，每行「标题 | 网址」或只写网址（选填，最多 5 条）'}
          value={sources}
          onChange={(e) => setSources(e.target.value)}
        />
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          placeholder="关联的官方角色（选填）"
          options={options}
          value={characterIds}
          onChange={setCharacterIds}
          optionFilterProp="label"
        />
        <ReasonInput value={reason} onChange={setReason} />
        <div className="field-note">
          只填可核对的公开资料。没有可识别标识时系统会生成平台人工关联的实体键（manual:…）。
        </div>
      </Space>
    </Modal>
  );
}

function EntityDrawer({
  entityKey,
  onClose,
  onChanged,
}: {
  entityKey: string;
  onClose: () => void;
  onChanged: (entityKey: string) => void;
}) {
  const remote = useRemote(SearchAdminEndpoints.getEntity, { query: { entityKey } });
  const detail = remote.data;
  return (
    <Drawer open width={720} title="实体详情" onClose={onClose} destroyOnHidden>
      {remote.error && <Alert type="error" showIcon message={remote.error} />}
      {detail && (
        <EntityEditor
          key={`${detail.entity.entityKey}:${detail.entity.updatedAt}:${detail.history.length}`}
          detail={detail}
          onSaved={(next) => {
            remote.refresh();
            onChanged(next.entity.entityKey);
          }}
        />
      )}
    </Drawer>
  );
}

function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(
    reason: string,
    call: () => Promise<AdminSearchEntityDetail>,
    done: (d: AdminSearchEntityDetail) => void,
  ) {
    const problem = reasonProblem(reason);
    if (problem) return setError(problem);
    setBusy(true);
    setError('');
    try {
      const detail = await call();
      toast.success('已保存，搜索结果会在几秒内刷新');
      done(detail);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

function EntityEditor({
  detail,
  onSaved,
}: {
  detail: AdminSearchEntityDetail;
  onSaved: (detail: AdminSearchEntityDetail) => void;
}) {
  const entity = detail.entity;
  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      <div>
        <h3 style={{ margin: 0 }}>{entity.displayName}</h3>
        <div className="detail-muted">
          实体键 {entity.entityKey} · 更新于 {formatDateTime(entity.updatedAt)}
        </div>
      </div>
      <IdentityForm entity={entity} onSaved={onSaved} />
      <LinksForm entity={entity} onSaved={onSaved} />
      <MergeSplitForm entity={entity} onSaved={onSaved} />
      <SectionCard title="修正历史">
        <History items={detail.history} />
      </SectionCard>
    </Space>
  );
}

function IdentityForm({
  entity,
  onSaved,
}: {
  entity: AdminSearchEntity;
  onSaved: (detail: AdminSearchEntityDetail) => void;
}) {
  const [displayName, setDisplayName] = useState(entity.displayName);
  const [identity, setIdentity] = useState(entity.identity ?? '');
  const [sources, setSources] = useState(sourcesToText(entity.sources));
  const [reason, setReason] = useState('');
  const action = useAction();
  function save() {
    const parsed = parseSourceLines(sources);
    if (parsed.invalid.length)
      return action.setError(`这些出处不是网址：${parsed.invalid.join('；')}`);
    if (!displayName.trim()) return action.setError('请填写显示名');
    void action.run(
      reason,
      () =>
        api.call(SearchAdminEndpoints.updateEntity, {
          body: {
            entityKey: entity.entityKey,
            displayName: displayName.trim(),
            identity: identity.trim() || null,
            sources: parsed.sources,
            reason: reason.trim(),
          },
        }),
      onSaved,
    );
  }
  return (
    <SectionCard
      title="身份说明与出处"
      desc="填写后，搜索里这个人物的身份不再标「未核实」。清空身份说明 = 回到未核实。"
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        {action.error && <Alert type="error" showIcon message={action.error} />}
        <Input
          maxLength={64}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <Input
          maxLength={120}
          placeholder="核实过的身份说明"
          value={identity}
          onChange={(e) => setIdentity(e.target.value)}
        />
        <TextArea
          rows={3}
          placeholder="出处，每行「标题 | 网址」或只写网址（最多 5 条）"
          value={sources}
          onChange={(e) => setSources(e.target.value)}
        />
        <ReasonInput value={reason} onChange={setReason} />
        <Button type="primary" loading={action.busy} onClick={save}>
          保存身份说明
        </Button>
      </Space>
    </SectionCard>
  );
}

function LinksForm({
  entity,
  onSaved,
}: {
  entity: AdminSearchEntity;
  onSaved: (detail: AdminSearchEntityDetail) => void;
}) {
  const options = useCharacterOptions();
  const [removeIds, setRemoveIds] = useState<string[]>([]);
  const [removeChars, setRemoveChars] = useState<string[]>([]);
  const [addIds, setAddIds] = useState('');
  const [addChars, setAddChars] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const action = useAction();
  const linked = new Set(entity.characters.map((c) => c.characterId));
  function save() {
    const addIdentifiers = parseLines(addIds);
    if (!addIdentifiers.length && !removeIds.length && !addChars.length && !removeChars.length)
      return action.setError('没有要修改的关联');
    void action.run(
      reason,
      () =>
        api.call(SearchAdminEndpoints.linkEntity, {
          body: {
            entityKey: entity.entityKey,
            addIdentifiers,
            removeIdentifiers: removeIds,
            addCharacterIds: addChars,
            removeCharacterIds: removeChars,
            reason: reason.trim(),
          },
        }),
      onSaved,
    );
  }
  return (
    <SectionCard
      title="关联"
      desc="已属于其他实体的标识或角色不能直接关联：先在那边取消，或用下面的「合并」。"
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        {action.error && <Alert type="error" showIcon message={action.error} />}
        <div>
          <b>公开资料标识</b>（勾选 = 取消关联）
          <Checkbox.Group
            style={{ display: 'grid', gap: 4, marginTop: 6 }}
            value={removeIds}
            onChange={(v) => setRemoveIds(v as string[])}
            options={entity.identifiers.map((i) => ({
              value: i.identifier,
              label: (
                <span>
                  {i.identifier}{' '}
                  {i.sourceUrl && (
                    <a href={i.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">
                      打开
                    </a>
                  )}
                </span>
              ),
            }))}
          />
          {!entity.identifiers.length && <div className="detail-muted">没有标识</div>}
        </div>
        <TextArea
          rows={2}
          placeholder="新增标识或百科条目地址，每行一个"
          value={addIds}
          onChange={(e) => setAddIds(e.target.value)}
        />
        <div>
          <b>官方角色</b>（勾选 = 取消关联）
          <Checkbox.Group
            style={{ display: 'grid', gap: 4, marginTop: 6 }}
            value={removeChars}
            onChange={(v) => setRemoveChars(v as string[])}
            options={entity.characters.map((c) => ({
              value: c.characterId,
              label: `${c.name}${c.published ? '' : '（未上架）'}`,
            }))}
          />
          {!entity.characters.length && <div className="detail-muted">没有关联的官方角色</div>}
        </div>
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          placeholder="新增关联的官方角色"
          options={options.filter((o) => !linked.has(o.value))}
          value={addChars}
          onChange={setAddChars}
          optionFilterProp="label"
        />
        <ReasonInput value={reason} onChange={setReason} />
        <Button type="primary" loading={action.busy} onClick={save}>
          保存关联
        </Button>
      </Space>
    </SectionCard>
  );
}

function MergeSplitForm({
  entity,
  onSaved,
}: {
  entity: AdminSearchEntity;
  onSaved: (detail: AdminSearchEntityDetail) => void;
}) {
  const [fromKey, setFromKey] = useState('');
  const [mergeReason, setMergeReason] = useState('');
  const merge = useAction();
  const [splitIds, setSplitIds] = useState<string[]>([]);
  const [splitChars, setSplitChars] = useState<string[]>([]);
  const [splitName, setSplitName] = useState('');
  const [splitIdentity, setSplitIdentity] = useState('');
  const [splitReason, setSplitReason] = useState('');
  const split = useAction();
  return (
    <SectionCard title="合并 / 拆分" desc="确认是同一人物才合并；发现把两个人并在一起了就拆分。">
      <Space direction="vertical" style={{ width: '100%' }}>
        <b>把另一个实体并进来</b>
        {merge.error && <Alert type="error" showIcon message={merge.error} />}
        <Input
          placeholder="要并进来的实体键（在列表里复制）"
          value={fromKey}
          onChange={(e) => setFromKey(e.target.value)}
        />
        <ReasonInput value={mergeReason} onChange={setMergeReason} />
        <Button
          loading={merge.busy}
          disabled={!fromKey.trim()}
          onClick={() =>
            void merge.run(
              mergeReason,
              () =>
                api.call(SearchAdminEndpoints.mergeEntity, {
                  body: {
                    entityKey: entity.entityKey,
                    fromEntityKey: fromKey.trim(),
                    reason: mergeReason.trim(),
                  },
                }),
              onSaved,
            )
          }
        >
          合并
        </Button>
        <b style={{ marginTop: 12 }}>拆分到新实体</b>
        {split.error && <Alert type="error" showIcon message={split.error} />}
        <Checkbox.Group
          style={{ display: 'grid', gap: 4 }}
          value={splitIds}
          onChange={(v) => setSplitIds(v as string[])}
          options={entity.identifiers.map((i) => ({ value: i.identifier, label: i.identifier }))}
        />
        <Checkbox.Group
          style={{ display: 'grid', gap: 4 }}
          value={splitChars}
          onChange={(v) => setSplitChars(v as string[])}
          options={entity.characters.map((c) => ({ value: c.characterId, label: c.name }))}
        />
        <Input
          maxLength={64}
          placeholder="新实体的显示名"
          value={splitName}
          onChange={(e) => setSplitName(e.target.value)}
        />
        <Input
          maxLength={120}
          placeholder="新实体核实过的身份说明（选填）"
          value={splitIdentity}
          onChange={(e) => setSplitIdentity(e.target.value)}
        />
        <ReasonInput value={splitReason} onChange={setSplitReason} />
        <Button
          loading={split.busy}
          disabled={!splitName.trim() || (!splitIds.length && !splitChars.length)}
          onClick={() =>
            void split.run(
              splitReason,
              () =>
                api.call(SearchAdminEndpoints.splitEntity, {
                  body: {
                    entityKey: entity.entityKey,
                    identifiers: splitIds,
                    characterIds: splitChars,
                    displayName: splitName.trim(),
                    identity: splitIdentity.trim() || null,
                    reason: splitReason.trim(),
                  },
                }),
              onSaved,
            )
          }
        >
          拆分
        </Button>
      </Space>
    </SectionCard>
  );
}

// ---------- 角色别名 ----------

function AliasesTab() {
  const options = useCharacterOptions();
  const [characterId, setCharacterId] = useState<string | null>(null);
  return (
    <SectionCard
      title="官方角色的搜索别名"
      desc="新加的别名先待审核，通过后才进站内搜索；人设里的别名可以从搜索里去掉（不改人设本身）。"
    >
      <Select
        showSearch
        style={{ width: 360, marginBottom: 14 }}
        placeholder="选择官方角色"
        options={options}
        value={characterId}
        onChange={setCharacterId}
        optionFilterProp="label"
      />
      {characterId && <AliasEditor key={characterId} characterId={characterId} />}
    </SectionCard>
  );
}

function AliasEditor({ characterId }: { characterId: string }) {
  const toast = useToast();
  const remote = useRemote(SearchAdminEndpoints.getCharacter, { params: { characterId } });
  const [view, setView] = useState(remote.data);
  useEffect(() => setView(remote.data), [remote.data]);
  const [alias, setAlias] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function change(op: AdminSearchAliasOp, text: string) {
    const problem = (!text.trim() && '请填写别名') || reasonProblem(reason);
    if (problem) return setError(problem);
    setBusy(true);
    setError('');
    try {
      const next = await api.call(SearchAdminEndpoints.changeAlias, {
        params: { characterId },
        body: { op, alias: text.trim(), reason: reason.trim() },
      });
      setView(next);
      if (op === 'propose') setAlias('');
      toast.success(`已${aliasOpLabel(op)}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  if (remote.error) return <Alert type="error" showIcon message={remote.error} />;
  if (!view) return null;
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <div>
        <b>{view.name}</b>
        {!view.published && <Tag style={{ marginLeft: 8 }}>未上架</Tag>}
        <div className="detail-muted">
          {view.entity
            ? `关联实体：${view.entity.displayName}（${view.entity.entityKey}）${view.entity.identity ? ` · 身份：${view.entity.identity}` : ''}`
            : '没有关联实体（在「实体关联」里关联）'}
        </div>
      </div>
      {error && <Alert type="error" showIcon message={error} />}
      <ReasonInput value={reason} onChange={setReason} />
      <div className="simple-list">
        {view.aliases.map((item) => (
          <div className="simple-row" key={item.aliasKey}>
            <span className="simple-main">
              {item.alias}{' '}
              <span className="detail-muted">
                {item.origin === 'persona' ? '人设别名' : '搜索别名'}
              </span>
            </span>
            <Tag
              bordered={false}
              color={
                item.status === 'approved'
                  ? 'green'
                  : item.status === 'pending'
                    ? 'gold'
                    : 'default'
              }
            >
              {aliasStatusLabel(item.status)}
              {item.searchable ? ' · 可搜到' : ''}
            </Tag>
            <Space size={4}>
              {aliasActions(item).map((op) => (
                <Button
                  key={op}
                  size="small"
                  type="link"
                  danger={op === 'reject' || op === 'remove'}
                  disabled={busy}
                  onClick={() => void change(op, item.alias)}
                >
                  {aliasOpLabel(op)}
                </Button>
              ))}
            </Space>
          </div>
        ))}
        {!view.aliases.length && <div className="detail-muted">还没有别名</div>}
      </div>
      <Space.Compact style={{ width: 360 }}>
        <Input
          maxLength={64}
          placeholder="新别名（添加后待审核）"
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
        />
        <Button disabled={busy || !alias.trim()} onClick={() => void change('propose', alias)}>
          添加
        </Button>
      </Space.Compact>
      <SectionCard title="修正历史">
        <History items={view.history} />
      </SectionCard>
    </Space>
  );
}
