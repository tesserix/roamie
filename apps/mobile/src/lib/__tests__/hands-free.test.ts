import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import { HandsFreeConversation } from '../hands-free';

jest.mock('expo-audio', () => ({ RecordingPresets: { HIGH_QUALITY: { extension: '.m4a' } }, getRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })), requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })), setAudioModeAsync: jest.fn(async () => {}) }));
jest.mock('expo-speech', () => ({ stop: jest.fn(async () => {}) }));
jest.mock('expo-file-system', () => ({ File: class { exists = true; delete() {} } }));
beforeEach(() => {
  jest.useFakeTimers();
  jest.mocked(getRecordingPermissionsAsync).mockReset().mockResolvedValue({ granted: true } as never);
  jest.mocked(requestRecordingPermissionsAsync).mockReset().mockResolvedValue({ granted: true } as never);
});
afterEach(() => { jest.useRealTimers(); jest.clearAllMocks(); });

function setup() {
  let level = -60, started = 0, recording = false, foreground = true;
  const recorder = {
    uri: 'file:///turn.m4a',
    prepareToRecordAsync: jest.fn(async () => {}),
    record: jest.fn(() => { recording = true; started = Date.now(); }),
    stop: jest.fn(async () => { recording = false; }),
    getStatus: () => ({ isRecording: recording, durationMillis: Date.now() - started, metering: level, mediaServicesDidReset: false }),
  };
  const onTurn = jest.fn<(uri: string, active: () => boolean) => Promise<void>>().mockResolvedValue();
  const onError = jest.fn(), onPhase = jest.fn(), onActive = jest.fn(), onRecovery = jest.fn();
  const loop = new HandsFreeConversation(recorder, { onTurn, onError, onPhase, onActive, onRecovery, isForeground: () => foreground });
  return { loop, recorder, onTurn, onError, onPhase, onActive, onRecovery, level: (next: number) => { level = next; }, foreground: (next: boolean) => { foreground = next; } };
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

test('consecutive turns use fresh native recording files rather than reopening the previous recorder', async () => {
  const t = setup();
  let file = 0;
  t.recorder.prepareToRecordAsync.mockImplementation(async (...args: unknown[]) => {
    if (args[0]) t.recorder.uri = `file:///turn-${++file}.m4a`;
  });
  const done = t.loop.start();
  for (let turn = 0; turn < 2; turn++) {
    t.level(-20);
    await jest.advanceTimersByTimeAsync(600);
    t.level(-60);
    await jest.advanceTimersByTimeAsync(1700);
  }
  expect(t.onTurn.mock.calls.map(([uri]) => uri)).toEqual(['file:///turn-1.m4a', 'file:///turn-2.m4a']);
  t.loop.stop();
  await done;
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

test('a long quiet pause discards silent audio and keeps listening for the next speaker', async () => {
  const t = setup();
  const done = t.loop.start();
  await jest.advanceTimersByTimeAsync(30600);
  expect(t.onTurn).not.toHaveBeenCalled();
  expect(t.onError).not.toHaveBeenCalled();
  expect(t.recorder.stop).toHaveBeenCalledTimes(1);
  expect(t.recorder.record).toHaveBeenCalledTimes(2);
  expect(t.onPhase).toHaveBeenLastCalledWith('listening');
  t.level(-20);
  await jest.advanceTimersByTimeAsync(500);
  t.level(-60);
  await jest.advanceTimersByTimeAsync(1300);
  expect(t.onTurn).toHaveBeenCalledTimes(1);
  t.loop.stop();
  await done;
});

test('permission denial pauses without recording or retrying', async () => {
  jest.mocked(getRecordingPermissionsAsync).mockResolvedValueOnce({ granted: false } as never);
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

test('a temporary microphone interruption discards partial speech and resumes without another tap', async () => {
  const t = setup();
  const status = t.recorder.getStatus;
  jest.spyOn(t.recorder, 'getStatus').mockImplementationOnce(() => ({ isRecording: false, durationMillis: 100, metering: -20, mediaServicesDidReset: true })).mockImplementation(status);
  const done = t.loop.start();
  await jest.advanceTimersByTimeAsync(1000);
  expect(t.recorder.record).toHaveBeenCalledTimes(2);
  expect(t.onError).not.toHaveBeenCalled();
  expect(t.onActive).not.toHaveBeenCalledWith(false);
  expect(t.onRecovery).toHaveBeenLastCalledWith('Still listening. Please repeat.');
  expect(t.onTurn).not.toHaveBeenCalled();
  t.level(-20);
  await jest.advanceTimersByTimeAsync(500);
  t.level(-60);
  await jest.advanceTimersByTimeAsync(1300);
  expect(t.onTurn).toHaveBeenCalledTimes(1);
  t.loop.stop();
  await done;
});

test('persistent microphone interruption stops after two recovery attempts without submitting partial speech', async () => {
  const t = setup();
  jest.spyOn(t.recorder, 'getStatus').mockReturnValue({ isRecording: false, durationMillis: 100, metering: -20, mediaServicesDidReset: true });
  const done = t.loop.start();
  await jest.advanceTimersByTimeAsync(2000);
  await done;
  expect(t.recorder.record).toHaveBeenCalledTimes(3);
  expect(t.onTurn).not.toHaveBeenCalled();
  expect(t.onError).toHaveBeenCalledWith(expect.stringContaining('interrupted'));
});


test('stop during microphone reconnection cancels the retry and releases capture', async () => {
  const t = setup();
  jest.spyOn(t.recorder, 'getStatus').mockReturnValue({ isRecording: false, durationMillis: 100, metering: -20, mediaServicesDidReset: true });
  const done = t.loop.start();
  await jest.advanceTimersByTimeAsync(200);
  expect(t.onRecovery).toHaveBeenCalledWith('Microphone interrupted. Reconnecting…');
  t.loop.stop();
  await done;
  await jest.advanceTimersByTimeAsync(5000);
  expect(t.recorder.record).toHaveBeenCalledTimes(1);
  expect(t.onActive).toHaveBeenLastCalledWith(false);
  expect(t.onError).not.toHaveBeenCalled();
});

test('backgrounding during microphone reconnection prevents a late restart', async () => {
  const t = setup();
  jest.spyOn(t.recorder, 'getStatus').mockReturnValue({ isRecording: false, durationMillis: 100, metering: -20, mediaServicesDidReset: true });
  const done = t.loop.start();
  await jest.advanceTimersByTimeAsync(200);
  t.foreground(false);
  t.loop.onAppBackground();
  await done;
  await jest.advanceTimersByTimeAsync(5000);
  expect(t.recorder.record).toHaveBeenCalledTimes(1);
  expect(t.onActive).toHaveBeenLastCalledWith(false);
  expect(t.onError).not.toHaveBeenCalled();
});

test('an already granted microphone does not reopen Android permission handling', async () => {
  const t = setup();
  const done = t.loop.start();
  await jest.advanceTimersByTimeAsync(100);
  expect(getRecordingPermissionsAsync).toHaveBeenCalled();
  expect(requestRecordingPermissionsAsync).not.toHaveBeenCalled();
  expect(t.recorder.record).toHaveBeenCalledTimes(1);
  t.loop.stop();
  await done;
});


test('granting permission survives the temporary native permission activity', async () => {
  const t = setup();
  jest.mocked(getRecordingPermissionsAsync).mockResolvedValueOnce({ granted: false } as never);
  jest.mocked(requestRecordingPermissionsAsync).mockImplementationOnce(async () => {
    t.loop.onAppBackground();
    return { granted: true } as never;
  });
  const done = t.loop.start();
  await jest.advanceTimersByTimeAsync(100);
  expect(t.recorder.record).toHaveBeenCalledTimes(1);
  expect(t.onError).not.toHaveBeenCalled();
  t.loop.stop();
  await done;
});

test('first permission waits for iOS to become active before starting capture', async () => {
  const t = setup();
  jest.mocked(getRecordingPermissionsAsync).mockResolvedValueOnce({ granted: false } as never);
  jest.mocked(requestRecordingPermissionsAsync).mockImplementationOnce(async () => {
    t.foreground(false);
    t.loop.onAppBackground();
    setTimeout(() => t.foreground(true), 500);
    return { granted: true } as never;
  });
  const done = t.loop.start();
  await jest.advanceTimersByTimeAsync(200);
  expect(t.recorder.record).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(500);
  expect(t.recorder.record).toHaveBeenCalledTimes(1);
  expect(t.onError).not.toHaveBeenCalled();
  t.loop.stop();
  await done;
});

test('stop during the first-permission foreground transition prevents a late microphone start', async () => {
  const t = setup();
  jest.mocked(getRecordingPermissionsAsync).mockResolvedValueOnce({ granted: false } as never);
  jest.mocked(requestRecordingPermissionsAsync).mockImplementationOnce(async () => { t.foreground(false); return { granted: true } as never; });
  const done = t.loop.start();
  await jest.advanceTimersByTimeAsync(200);
  t.loop.stop();
  await done;
  t.foreground(true);
  await jest.advanceTimersByTimeAsync(4000);
  expect(t.recorder.record).not.toHaveBeenCalled();
  expect(t.onError).not.toHaveBeenCalled();
  expect(t.onActive).toHaveBeenLastCalledWith(false);
});

test('granting permission cannot start recording if the app remains in background', async () => {
  const t = setup();
  jest.mocked(getRecordingPermissionsAsync).mockResolvedValueOnce({ granted: false } as never);
  jest.mocked(requestRecordingPermissionsAsync).mockImplementationOnce(async () => {
    t.loop.onAppBackground();
    t.foreground(false);
    return { granted: true } as never;
  });
  const done = t.loop.start();
  await jest.advanceTimersByTimeAsync(3100);
  await done;
  expect(t.recorder.record).not.toHaveBeenCalled();
  expect(t.onActive).toHaveBeenLastCalledWith(false);
});

test('explicit stop during a permission prompt cancels even after permission is granted', async () => {
  const t = setup();
  let grant!: () => void;
  jest.mocked(getRecordingPermissionsAsync).mockResolvedValueOnce({ granted: false } as never);
  jest.mocked(requestRecordingPermissionsAsync).mockImplementationOnce(() => new Promise(resolve => { grant = () => resolve({ granted: true } as never); }));
  const done = t.loop.start();
  await jest.advanceTimersByTimeAsync(1);
  t.loop.stop();
  grant();
  await done;
  expect(t.recorder.record).not.toHaveBeenCalled();
});


test('stop during permission preflight does not open a late permission prompt', async () => {
  const t = setup();
  let finish!: () => void;
  jest.mocked(getRecordingPermissionsAsync).mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ granted: false } as never); }));
  const done = t.loop.start();
  t.loop.stop();
  finish();
  await done;
  expect(requestRecordingPermissionsAsync).not.toHaveBeenCalled();
  expect(t.recorder.record).not.toHaveBeenCalled();
});
