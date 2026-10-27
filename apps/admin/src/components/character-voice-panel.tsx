import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Select, Space } from 'antd';
import { VoiceAdminEndpoints, WorkLinkAdminEndpoints, type AdminVoice } from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText } from '../data/hooks.js';
import { adminMediaUrl } from '../data/media-url.js';
import { FieldHelp, SectionCard } from '../ui/page.js';
import { loadCharacterVoiceState } from './character-voice-state.js';

/** 复用音色库/默认音色接口；不创建音色、不调用克隆或收费试听。 */
export function CharacterVoicePanel({ characterId }: { characterId: string }) {
  const [voices, setVoices] = useState<AdminVoice[]>([]);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [boundName, setBoundName] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setNotice('');
    setReady(false);
    setVoices([]);
    setVoiceId(null);
    setSaved(null);
    setBoundName(null);
    loadCharacterVoiceState(
      () => api.call(VoiceAdminEndpoints.listVoices),
      () => api.call(WorkLinkAdminEndpoints.getDefaultVoice, { params: { characterId } }),
    )
      .then((state) => {
        if (!active) return;
        setVoices(state.voices);
        if (state.binding) {
          setVoiceId(state.binding.voiceId);
          setSaved(state.binding.voiceId);
          setBoundName(state.binding.voiceName);
        }
        setReady(state.ready);
        setError(
          [
            state.catalogError && `音色目录读取失败：${errorText(state.catalogError.cause)}`,
            state.bindingError && `角色默认音色读取失败：${errorText(state.bindingError.cause)}`,
          ]
            .filter(Boolean)
            .join('；'),
        );
      })
      .catch((e) => {
        if (active) setError(`音色资料读取失败：${errorText(e)}`);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [characterId, reload]);
  const selected = useMemo(() => voices.find((v) => v.voiceId === voiceId), [voices, voiceId]);
  async function save() {
    if (!ready) return;
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
    <SectionCard title="声音与音色" desc="选择已有声线；独立保存，不自动克隆或合成">
      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          action={
            <Button onClick={() => setReload((n) => n + 1)} disabled={loading}>
              重试
            </Button>
          }
        />
      )}
      {notice && <Alert type="success" showIcon message={notice} />}
      <label className="field-line">
        <span className="field-label">角色默认音色</span>
        <Select
          aria-label="角色默认音色"
          showSearch
          optionFilterProp="label"
          allowClear
          loading={loading}
          disabled={loading || saving || !ready}
          style={{ width: '100%' }}
          placeholder={
            loading
              ? '读取音色资料…'
              : ready
                ? '未指定，沿用现有回退设置'
                : '音色资料未完整读取，请重试'
          }
          value={voiceId ?? undefined}
          onChange={(v) => {
            setVoiceId(v ?? null);
            setNotice('');
          }}
          options={[
            ...(voiceId && !selected
              ? [
                  {
                    value: voiceId,
                    label: `${boundName ?? '已绑定音色'}（目录未读到此条）`,
                    disabled: true,
                  },
                ]
              : []),
            ...voices.map((v) => ({
              value: v.voiceId,
              label: `${v.name} · ${v.modelKey}${v.enabled ? '' : '（已停用）'}`,
              disabled: !v.enabled,
            })),
          ]}
        />
      </label>
      {voiceId && !selected && !loading && (
        <Alert
          type="warning"
          showIcon
          message={`当前已绑定：${boundName ?? '已有音色'}。目录中暂未读到对应条目，不代表没有绑定；不会自动替换。`}
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
          disabled={loading || saving || !ready || voiceId === null}
        >
          清除默认选择
        </Button>
        <Button
          type="primary"
          onClick={() => void save()}
          loading={saving}
          disabled={loading || !ready || voiceId === saved}
        >
          保存音色设置
        </Button>
      </Space>
    </SectionCard>
  );
}
