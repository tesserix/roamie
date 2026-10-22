import { AppState } from 'react-native';

type Engine = 'speech' | 'text';
const releases = new Map<Engine, () => Promise<void>>();
let tail = Promise.resolve();

export function registerOfflineEngine(engine: Engine, release: () => Promise<void>) {
  releases.set(engine, release);
}

export function withOfflineInference<T>(engine: Engine, operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const run = tail.then(async () => {
    if (signal?.aborted) throw new Error('Offline translation cancelled.');
    if (AppState.currentState === 'background' || AppState.currentState === 'inactive') throw new Error('Keep Roamie open while translating offline.');
    for (const [name, release] of releases) if (name !== engine) await release();
    if (signal?.aborted) throw new Error('Offline translation cancelled.');
    return operation();
  });
  tail = run.then(() => {}, () => {});
  return run;
}
