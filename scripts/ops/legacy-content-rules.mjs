import { createHash } from 'node:crypto';

const URL_NAMESPACE = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex');
export function legacyId(kind, ...parts) {
  const digest = createHash('sha1').update(URL_NAMESPACE).update(`weiban-legacy-v1:${kind}:${JSON.stringify(parts)}`).digest();
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function legacyTime(value, fallback) {
  const text = String(value ?? '').trim();
  const iso = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(text) ? text.replace(' ', 'T') + 'Z' : text;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? new Date(fallback).toISOString() : date.toISOString();
}
export function deletedLegacyMessage(row) {
  return String(row.deleted_at ?? '').trim() !== '';
}
export function splitLegacyText(value, limit = 4000) {
  let text = String(value ?? '').replaceAll('\u0000', '');
  if (!text) return ['[旧版空消息]'];
  const parts = [];
  while (text.length > limit) {
    let count = limit;
    const last = text.charCodeAt(count - 1);
    if (last >= 0xd800 && last <= 0xdbff) count--;
    parts.push(text.slice(0, count)); text = text.slice(count);
  }
  if (text) parts.push(text);
  return parts;
}
export function visibleLegacyInteraction(row, ownerUserId, friendNames) {
  const owner = String(row.user_id ?? '').trim();
  if (owner) return owner === ownerUserId;
  return row.actor_type === 'character' && friendNames.has(String(row.actor_name));
}
export function normalizeLegacyName(name) {
  return String(name ?? '').normalize('NFKC').trim().replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase();
}
export function legacyNameIndex(characters) {
  const exact = new Map(), normalized = new Map();
  for (const character of characters) {
    const row = character.legacy_card ?? {};
    let aliases = row.aliases_json ?? [];
    try { if (typeof aliases === 'string') aliases = JSON.parse(aliases); } catch { aliases = []; }
    for (const name of [character.name, row.display_name, row.canonical_name, ...(Array.isArray(aliases) ? aliases : [])]) {
      if (typeof name !== 'string' || !name.trim()) continue;
      const key = name.trim();
      if (exact.has(key) && exact.get(key) !== character.id) exact.set(key, null); else if (!exact.has(key)) exact.set(key, character.id);
      const norm = normalizeLegacyName(key);
      if (normalized.has(norm) && normalized.get(norm) !== character.id) normalized.set(norm, null); else if (!normalized.has(norm)) normalized.set(norm, character.id);
    }
  }
  return name => exact.get(String(name).trim()) ?? normalized.get(normalizeLegacyName(name)) ?? null;
}
export function legacyMediaSource(row, manifest) {
  const bySource = manifest.bySource ?? new Map(manifest.assets.map(asset => [asset.source, asset]));
  const values = [row.media_path, row.audio_url, row.image_url, row.avatar_url, row.avatar].filter(v => typeof v === 'string' && v.trim());
  for (const value of values) if (bySource.has(value)) return { kind: 'file', ...bySource.get(value) };
  for (const value of values) {
    try { const url = new URL(value); if (url.protocol === 'https:' && url.hostname === 'picsum.photos' && !url.username && !url.password) return { kind: 'url', source: value, path: value }; } catch { /* not an external media URL */ }
  }
  return null;
}
export function legacyMessageContents(row, mediaReference) {
  const text = String(row.content ?? '').replaceAll('\u0000', '');
  const kind = String(row.message_type ?? 'text');
  const quoted = row.quoted_content ? `↪ ${row.quoted_author || '引用'}：${row.quoted_content}\n` : '';
  if (mediaReference) {
    if (kind === 'voice') {
      const rawDuration = Number(row.audio_duration) * 1000;
      const durationMs = Number.isFinite(rawDuration) && rawDuration > 0 ? Math.min(300000, Math.max(1, Math.round(rawDuration))) : 1000;
      return [{ type: 'voice', mediaId: mediaReference.id, durationMs, transcript: text ? text.slice(0, 4000) : null }];
    }
    if (kind === 'sticker') return [{ type: 'sticker', stickerId: mediaReference.stickerId, source: 'user', mediaId: mediaReference.id, description: text.replace(/^\[|\]$/g, '').slice(0, 40) || null }];
    if (kind === 'image') {
      const out = [{ type: 'image', mediaId: mediaReference.id, width: null, height: null }];
      if (text && !/^\[(图片|图像|image)\]$/i.test(text.trim())) out.push(...splitLegacyText(quoted + text).map(t => ({ type: 'text', text: t })));
      return out;
    }
  }
  const prefix = ['voice', 'image', 'sticker'].includes(kind) ? `[旧${{ voice: '语音', image: '图片', sticker: '表情' }[kind]}文件缺失] ` : kind === 'call' ? '[旧通话记录] ' : '';
  return splitLegacyText(quoted + prefix + text).map(t => ({ type: 'text', text: t }));
}
