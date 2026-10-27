/** Composite voice-call pipeline: one user-facing model, three real components (ADR 20261024). */
export interface VoiceCallPipeline {
  asrModelKey: string;
  textModelKey: string;
  ttsModelKey: string;
}
export type VoiceCallPipelineResult =
  | { ok: true; value: VoiceCallPipeline }
  | { ok: false; error: 'pipeline_invalid' | 'pipeline_duplicate_components' };

const MODEL_KEY = /^[a-z0-9][a-z0-9._-]{0,47}\/[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/;
const fields = ['asrModelKey', 'textModelKey', 'ttsModelKey'] as const;

/** Strict validation: unknown fields, missing components or repeated components are rejected. */
export function parseVoiceCallPipeline(raw: unknown): VoiceCallPipelineResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return { ok: false, error: 'pipeline_invalid' };
  const record = raw as Record<string, unknown>;
  if (Object.keys(record).some((key) => !(fields as readonly string[]).includes(key)))
    return { ok: false, error: 'pipeline_invalid' };
  const values: string[] = [];
  for (const field of fields) {
    const value = record[field];
    if (typeof value !== 'string' || !MODEL_KEY.test(value))
      return { ok: false, error: 'pipeline_invalid' };
    values.push(value);
  }
  if (new Set(values).size !== values.length)
    return { ok: false, error: 'pipeline_duplicate_components' };
  return {
    ok: true,
    value: { asrModelKey: values[0]!, textModelKey: values[1]!, ttsModelKey: values[2]! },
  };
}
