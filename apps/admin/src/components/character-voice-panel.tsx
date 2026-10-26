import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Select, Space } from 'antd';
import { VoiceAdminEndpoints, WorkLinkAdminEndpoints, type AdminVoice } from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText } from '../data/hooks.js';
import { adminMediaUrl } from '../data/media-url.js';
import { FieldHelp, SectionCard } from '../ui/page.js';

/** 复用音色库/默认音色接口；不创建音色、不调用克隆或收费试听。 */
export function CharacterVoicePanel({ characterId }: { characterId: string }) {
  const [voices, setVoices] = useState<AdminVoice[]>([]);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    Promise.all([
      api.call(VoiceAdminEndpoints.listVoices),
      api.call(WorkLinkAdminEndpoints.getDefaultVoice, { params: { characterId } }),
    ])
      .then(([list, current]) => {
        if (active) {
          setVoices(list.items);
          setVoiceId(current.voiceId);
          setSaved(current.voiceId);
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [characterId]);
  const selected = useMemo(() => voices.find((v) => v.voiceId === voiceId), [voices, voiceId]);
  async function save() {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const next = await api.call(WorkLinkAdminEndpoints.setDefaultVoice, {
        params: { characterId },
        body: { voiceId },
      });
      setSaved(next.voiceId);
      setNotice('默认音色已保存；用户自行选择的音色不变。');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <SectionCard
      title="声音与音色"
      desc="与人物文本分开管理；选择已入库音色，不重新克隆、不批量生成声音"
    >
      {error && <Alert type="error" showIcon message={error} />}
      {notice && <Alert type="success" showIcon message={notice} />}
      <label className="field-line">
        <span className="field-label">角色默认音色</span>
        <Select
          aria-label="角色默认音色"
          showSearch
          optionFilterProp="label"
          allowClear
          loading={loading}
          disabled={loading || saving}
          style={{ width: '100%' }}
          placeholder="未指定，沿用现有回退设置"
          value={voiceId ?? undefined}
          onChange={(v) => {
            setVoiceId(v ?? null);
            setNotice('');
          }}
          options={voices.map((v) => ({
            value: v.voiceId,
            label: `${v.name} · ${v.modelKey}${v.enabled ? '' : '（已停用）'}`,
            disabled: !v.enabled,
          }))}
        />
      </label>
      {voiceId && !selected && !loading && (
        <Alert
          type="warning"
          showIcon
          message="当前绑定音色未在可用目录中找到，请核对后再选择；不会自动替换。"
        />
      )}
      {selected && (
        <div className="legacy-voice-summary">
          <div>合成模型：{selected.modelKey}</div>
          <div>音色状态：{selected.enabled ? '已启用' : '已停用'}</div>
          {selected.sampleUrl ? (
            <audio
              aria-label="已存音色样本试听"
              controls
              preload="none"
              src={adminMediaUrl(selected.sampleUrl)}
            />
          ) : (
            <FieldHelp>此条目没有已存试听音频；不会为打开页面自动生成或收费。</FieldHelp>
          )}
        </div>
      )}
      <FieldHelp>
        千问使用音色库登记的供应商音色ID；已有参考音频不在这里自动重建。此设置独立保存，角色人设历史恢复不会改动它。
      </FieldHelp>
      <Space>
        <Button
          onClick={() => {
            setVoiceId(null);
            setNotice('');
          }}
          disabled={loading || saving || voiceId === null}
        >
          清除默认选择
        </Button>
        <Button
          type="primary"
          onClick={() => void save()}
          loading={saving}
          disabled={loading || voiceId === saved}
        >
          保存音色设置
        </Button>
      </Space>
    </SectionCard>
  );
}
