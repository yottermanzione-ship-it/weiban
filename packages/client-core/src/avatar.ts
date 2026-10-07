/** Stable UTF-16/unsigned-32 hash shared by Web and Android; numbered palette 01–12. */
export function avatarPaletteIndex(characterId: string): number {
  let hash = 0;
  for (let index = 0; index < characterId.length; index++)
    hash = (Math.imul(hash, 31) + characterId.charCodeAt(index)) >>> 0;
  return (hash % 12) + 1;
}
/** Canonical name only: a contact remark must never change the default avatar. */
export function avatarLetters(name: string, override: string | null = null): string {
  if (override) return Array.from(override.normalize('NFC')).slice(0, 2).join('');
  const normalized = name.normalize('NFC');
  const han = Array.from(normalized).filter((letter) => /\p{Script=Han}/u.test(letter));
  if (han.length) return (han.length === 3 ? han.slice(-2) : han.slice(0, 2)).join('');
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  return (
    Array.from(
      words
        .map((word) => Array.from(word)[0])
        .join('')
        .toUpperCase(),
    )
      .slice(0, 2)
      .join('') || '?'
  );
}
/** WCAG contrast chooses white or ink for a supplied support color, including very dark colors. */
export function avatarForeground(background: string): '#FFFFFF' | '#1F1A1D' {
  const luminance = (hex: string) => {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('Invalid avatar color');
    const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
    const linear = channels.map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
    return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
  };
  const level = luminance(background),
    ink = luminance('#1F1A1D');
  const whiteContrast = 1.05 / (level + 0.05);
  const inkContrast = (Math.max(level, ink) + 0.05) / (Math.min(level, ink) + 0.05);
  return whiteContrast >= inkContrast ? '#FFFFFF' : '#1F1A1D';
}
