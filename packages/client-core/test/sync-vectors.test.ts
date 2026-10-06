/** 与安卓JUnit读取同一份JSON文件；期望不由被测引擎生成。 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { ProtocolVector, type ClientSyncEffect } from '@weiban/contracts';
import { SyncEngine } from '../src/sync-engine.js';
const directory = fileURLToPath(new URL('../../contracts/test-vectors/', import.meta.url));
const files = readdirSync(directory)
  .filter((file) => file.endsWith('.json'))
  .sort();
if (files.length === 0) throw new Error('协议向量缺失');
for (const file of files) {
  const vector = ProtocolVector.parse(JSON.parse(readFileSync(`${directory}/${file}`, 'utf8')));
  test(`协议向量 ${vector.id}：${vector.description}`, () => {
    let engine = new SyncEngine(vector.initialState);
    const effects: ClientSyncEffect[] = [];
    for (const step of vector.steps) {
      const before = engine.state;
      if (step.expectError) {
        expect(() => engine.apply(step.operation)).toThrow();
        expect(engine.state).toEqual(before);
      } else if (step.operation.type === 'restart') {
        engine = new SyncEngine(JSON.parse(JSON.stringify(engine.state)));
      } else engine.apply(step.operation);
      if (step.expectState) expect(engine.state).toEqual(step.expectState);
      effects.push(...engine.drainEffects());
    }
    expect(engine.state).toEqual(vector.expected.state);
    expect(effects).toEqual(vector.expected.effects);
  });
}
