import { useEffect, useRef, useState } from 'react';
import type { Key } from 'react';

export function useListSelection<T>(scope: string, pageRows: T[], keyOf: (row: T) => string) {
  const [snapshot, setSnapshot] = useState<{ scope: string; rows: T[]; all: boolean }>({
    scope,
    rows: [],
    all: false,
  });
  const sequence = useRef(0);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => {
    setSnapshot((previous) =>
      previous.scope === scope ? previous : { scope, rows: [], all: false },
    );
    sequence.current += 1;
  }, [scope]);
  const rows = snapshot.scope === scope ? snapshot.rows : [];
  function select(keys: Key[]) {
    sequence.current++;
    const lookup = new Map([...rows, ...pageRows].map((row) => [keyOf(row), row]));
    setSnapshot({
      scope,
      rows: keys.flatMap((key) => {
        const row = lookup.get(String(key));
        return row ? [row] : [];
      }),
      all: snapshot.scope === scope && snapshot.all && keys.length > 0,
    });
  }
  function clear() {
    sequence.current++;
    setSnapshot({ scope, rows: [], all: false });
  }
  async function selectAll(load: () => Promise<T[]>) {
    const revision = ++sequence.current;
    const result = await load();
    if (revision === sequence.current && currentScope.current === scope)
      setSnapshot({ scope, rows: result, all: true });
  }
  function changePage() {
    if (!snapshot.all || snapshot.scope !== scope) clear();
  }
  return { rows, keys: rows.map(keyOf), select, clear, selectAll, changePage };
}
