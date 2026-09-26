import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { requestRecordingPermissionsAsync } from 'expo-audio';
import { HandsFreeConversation } from '../hands-free';

jest.mock('expo-audio', () => ({ requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })), setAudioModeAsync: jest.fn(async () => {}) }));
jest.mock('expo-speech', () => ({ stop: jest.fn(async () => {}) }));
jest.mock('expo-file-system', () => ({ File: class { exists = true; delete() {} } }));
beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); jest.clearAllMocks(); });

function setup() {
  let level = -60, started = 0, recording = false;
  const recorder = {
    uri: 'file:///turn.m4a',
    prepareToRecordAsync: jest.fn(async () => {}),
    record: jest.fn(() => { recording = true; started = Date.now(); }),
    stop: jest.fn(async () => { recording = false; }),
    getStatus: () => ({ isRecording: recording, durationMillis: Date.now() - started, metering: level, mediaServicesDidReset: false }),
  };
  const onTurn = jest.fn<(uri: string, active: () => boolean) => Promise<void>>().mockResolvedValue();
  const onError = jest.fn(), onPhase = jest.fn(), onActive = jest.fn();
  const loop = new HandsFreeConversation(recorder, { onTurn, onError, onPhase, onActive });
  return { loop, recorder, onTurn, onError, onPhase, onActive, level: (next: number) => { level = next; } };
}

test('ends at a pause and waits for translation and playback before listening again', async () => {
  const t = setup();
  let finish!: () => void;
  t.onTurn.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const done = t.loop.start();
  await jest.advanceTimersByTimeAsync(1000);
  expect(t.onTurn).not.toHaveBeenCalled();
  t.level(-20);
  await jest.advanceTimersByTimeAsync(500);
  t.level(-60);
  await jest.advanceTimersByTimeAsync(1300);
  expect(t.onTurn).toHaveBeenCalledTimes(1);
  expect(t.recorder.stop).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(5000);
  expect(t.recorder.record).toHaveBeenCalledTimes(1);
  finish();
  await jest.advanceTimersByTimeAsync(400);
  expect(t.recorder.record).toHaveBeenCalledTimes(2);
  t.loop.stop();
  await done;
  expect(t.onActive).toHaveBeenLastCalledWith(false);
});

test('stopping during a pending turn invalidates its callback and never restarts capture', async () => {
  const t = setup();
  let active!: () => boolean;
  t.onTurn.mockImplementationOnce((_uri, current) => { active = current; return new Promise(() => {}); });
  const done = t.loop.start();
  t.level(-20);
  await jest.advanceTimersByTimeAsync(600);
  t.level(-60);
  await jest.advanceTimersByTimeAsync(1300);
  expect(active()).toBe(true);
  t.loop.stop();
  await done;
  expect(active()).toBe(false);
  await jest.advanceTimersByTimeAsync(10000);
  expect(t.recorder.record).toHaveBeenCalledTimes(1);
});

test('silence times out without uploading an empty recording', async () => {
  const t = setup();
  const done = t.loop.start();
  await jest.advanceTimersByTimeAsync(30100);
  await done;
  expect(t.onTurn).not.toHaveBeenCalled();
  expect(t.onError).toHaveBeenCalledWith(expect.stringContaining('No speech'));
  expect(t.recorder.stop).toHaveBeenCalledTimes(1);
});

test('permission denial pauses without recording or retrying', async () => {
  jest.mocked(requestRecordingPermissionsAsync).mockResolvedValueOnce({ granted: false } as never);
  const t = setup();
  await t.loop.start();
  expect(t.recorder.record).not.toHaveBeenCalled();
  expect(t.onError).toHaveBeenCalledWith(expect.stringContaining('microphone'));
});

test('a long turn is capped at thirty seconds and duplicate starts cannot overlap', async () => {
  const t = setup();
  t.level(-20);
  t.onTurn.mockImplementationOnce(() => new Promise(() => {}));
  const done = t.loop.start();
  await t.loop.start();
  await jest.advanceTimersByTimeAsync(30100);
  expect(t.recorder.record).toHaveBeenCalledTimes(1);
  expect(t.onTurn).toHaveBeenCalledTimes(1);
  t.loop.stop();
  await done;
});

test('stopping while the native microphone prepares prevents a late recording', async () => {
  const t = setup();
  let prepared!: () => void;
  t.recorder.prepareToRecordAsync.mockImplementationOnce(() => new Promise(resolve => { prepared = resolve; }));
  const done = t.loop.start();
  await jest.advanceTimersByTimeAsync(1);
  t.loop.stop();
  prepared();
  await done;
  expect(t.recorder.record).not.toHaveBeenCalled();
  expect(t.recorder.stop).toHaveBeenCalledTimes(1);
});

test('microphone interruption pauses rather than submitting an incomplete turn', async () => {
  const t = setup();
  jest.spyOn(t.recorder, 'getStatus').mockReturnValue({ isRecording: false, durationMillis: 100, metering: -20, mediaServicesDidReset: true });
  const done = t.loop.start();
  await jest.advanceTimersByTimeAsync(100);
  await done;
  expect(t.onTurn).not.toHaveBeenCalled();
  expect(t.onError).toHaveBeenCalledWith(expect.stringContaining('interrupted'));
});
