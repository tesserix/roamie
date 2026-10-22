import { expect, test } from '@jest/globals';
import { registerOfflineEngine, withOfflineInference } from '../offline-inference';

test('speech finishes and unloads before text can load, including after a failed job', async () => {
  const events: string[] = [];
  let finish!: () => void;
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  registerOfflineEngine('speech', async () => { events.push('release speech'); });
  registerOfflineEngine('text', async () => { events.push('release text'); });
  const speech = withOfflineInference('speech', async () => {
    events.push('speech'); started();
    await new Promise<void>(resolve => { finish = resolve; });
    throw new Error('Unclear speech');
  });
  const rejected = expect(speech).rejects.toThrow('Unclear speech');
  await entered;
  const text = withOfflineInference('text', async () => { events.push('text'); return 'Xin chào'; });
  expect(events).toEqual(['release text', 'speech']);
  finish();
  await rejected;
  await expect(text).resolves.toBe('Xin chào');
  expect(events).toEqual(['release text', 'speech', 'release speech', 'text']);
});

test('a cancelled queued job never loads a second model', async () => {
  let finish!: () => void;
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const speech = withOfflineInference('speech', async () => {
    started(); await new Promise<void>(resolve => { finish = resolve; });
  });
  await entered;
  const controller = new AbortController();
  let ran = false;
  const text = withOfflineInference('text', async () => { ran = true; }, controller.signal);
  const rejected = expect(text).rejects.toThrow('cancelled');
  controller.abort(); finish();
  await speech; await rejected;
  expect(ran).toBe(false);
});
