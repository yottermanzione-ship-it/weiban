import type { z } from 'zod';
import type { CardKnowledgeEntry } from '@weiban/contracts';
type Entry = z.infer<typeof CardKnowledgeEntry>;
/** 世界书只检索卡片权威条目；有效期/secondaryKeys/常驻项在代码执行。 */
export function publicKnowledge(
  entries: Entry[],
  text: string,
  localDate: string,
  realPerson: boolean,
): Entry[] {
  const query = text.normalize('NFKC').toLocaleLowerCase();
  const matched = (keys: string[]) =>
    keys.some((key) => key.trim() && query.includes(key.normalize('NFKC').toLocaleLowerCase()));
  return entries
    .filter((entry) => {
      if (realPerson && (entry.confidence === 'userSource' || entry.confidence === 'fictionCanon'))
        return false;
      if (entry.validFrom && entry.validFrom > localDate) return false;
      if (entry.validTo && entry.validTo < localDate) return false;
      return (
        entry.constant ||
        (matched(entry.keys) && (!entry.selective || matched(entry.secondaryKeys ?? [])))
      );
    })
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .slice(0, 16);
}
