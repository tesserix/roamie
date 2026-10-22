import { AppState, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Device from 'expo-device';
import type { WhisperContext, WhisperVadContext } from 'whisper.rn/index';
import { offlineNative } from '../../modules/roamie-offline';
import { checkTranslationCanceled, appLanguage } from './offline-translation';
import { resolveSpeechModel, speechModelStatus, supportsSmallSpeechModel } from './speech-models';
import { translationPreferences, type SpeechModel } from './translation-preferences';

export class LocalSpeechError extends Error {
  constructor(message: string, readonly code: 'no_speech' | 'speech_busy' | 'speech_unavailable') { super(message); }
}

let loaded: { model: SpeechModel; vad: WhisperVadContext; whisper?: WhisperContext } | null = null;
let active: { cancelled: boolean; stop?: () => Promise<void>; done: Promise<void> } | null = null;
let idle: ReturnType<typeof setTimeout> | undefined;
let observing = false;
let releasing: Promise<void> | null = null;

export async function releaseOfflineSpeech() {
  releasing ??= (async () => {
    clearTimeout(idle);
    if (active) {
      const job = active;
      job.cancelled = true;
      await job.stop?.().catch(() => {});
      await job.done;
    }
    clearTimeout(idle);
    const previous = loaded;
    loaded = null;
    await previous?.whisper?.release();
    await previous?.vad.release();
  })().finally(() => { releasing = null; });
  return releasing;
}

export async function transcribeOffline(uri: string, signal?: AbortSignal): Promise<{ text: string; language: string } | null> {
  checkTranslationCanceled(signal);
  if (releasing) await releasing;
  const native = offlineNative();
  if (!native) return null;
  if (active) throw new LocalSpeechError('Finish the current translation before recording again.', 'speech_busy');
  const preferred = translationPreferences().speechModel;
  const resolved = await resolveSpeechModel(preferred);
  const model = resolved?.model ?? preferred;
  const paths = resolved?.paths;
  if (!paths && model === 'small' && !supportsSmallSpeechModel()) throw new LocalSpeechError('Select Base for speech on this phone.', 'speech_unavailable');
  checkTranslationCanceled(signal);
  if (!paths) {
    const status = await speechModelStatus(model);
    const name = model === 'base' ? 'Base' : 'Small';
    const problem = status.model === 'missing' ? `${name} speech model is not downloaded`
      : status.model === 'invalid' ? `${name} speech model did not pass verification`
        : status.detector === 'missing' ? 'The speech detector is not downloaded'
          : 'The speech detector did not pass verification';
    throw new LocalSpeechError(`${problem}. Open Profile → Offline languages and finish the speech download.`, 'speech_unavailable');
  }
  if (active) throw new LocalSpeechError('Finish the current translation before recording again.', 'speech_busy');
  if (loaded && loaded.model !== model) await releaseOfflineSpeech();
  if (!loaded?.whisper && await native.availableMemory() < (model === 'small' ? 1200 : 600) * 1024 ** 2) {
    throw new LocalSpeechError('Not enough free memory for this speech model. Close other apps or choose Base, then try again.', 'speech_unavailable');
  }
  if (active) throw new LocalSpeechError('Finish the current translation before recording again.', 'speech_busy');
  clearTimeout(idle);
  let finish = () => {};
  const job = { cancelled: false, stop: undefined as (() => Promise<void>) | undefined, done: new Promise<void>(resolve => { finish = resolve; }) };
  active = job;
  const cancel = () => { job.cancelled = true; void job.stop?.().catch(() => {}); };
  const check = () => { checkTranslationCanceled(signal); if (job.cancelled) throw new Error('Speech translation cancelled.'); };
  signal?.addEventListener('abort', cancel, { once: true });
  if (!observing) {
    observing = true;
    AppState.addEventListener('change', state => { if (state !== 'active') void releaseOfflineSpeech().catch(() => {}); });
    AppState.addEventListener('memoryWarning', () => { void releaseOfflineSpeech().catch(() => {}); });
  }
  let wav: string | undefined;
  const timeout = setTimeout(cancel, 45_000);
  try {
    check();
    wav = await native.audioToWav(uri);
    check();
    const engine = await import('whisper.rn/index');
    const threads = Math.max(1, Math.min(4, (Device.deviceYearClass ?? 2020) < 2020 ? 2 : 4));
    if (!loaded) loaded = { model, vad: await engine.initWhisperVad({ filePath: paths.vad, useGpu: false, nThreads: 2 }) };
    check();
    const segments = await loaded.vad.detectSpeech(wav, { threshold: 0.6, minSpeechDurationMs: 250 });
    check();
    if (!segments.length) throw new LocalSpeechError('No clear speech was detected. Please speak closer and try again.', 'no_speech');
    if (!loaded.whisper) {
      try { loaded.whisper = await engine.initWhisper({ filePath: paths.model, useGpu: Platform.OS === 'ios' && Device.isDevice }); }
      catch { loaded.whisper = await engine.initWhisper({ filePath: paths.model, useGpu: false }); }
    }
    check();
    const task = loaded.whisper.transcribe(wav, { language: 'auto', translate: false, maxThreads: threads, temperature: 0, temperatureInc: 0 });
    job.stop = task.stop;
    if (job.cancelled || signal?.aborted) await task.stop();
    check();
    const result = await task.promise;
    check();
    if (result.isAborted) throw new Error('Speech translation cancelled.');
    const text = result.result.trim();
    if (!text || /^\s*[[(].*[\])]\s*$/.test(text)) throw new LocalSpeechError('No clear speech was detected. Please try again.', 'no_speech');
    return { text, language: appLanguage(result.language) };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
    if (job.cancelled || signal?.aborted) await job.stop?.().catch(() => {});
    if (wav) await FileSystem.deleteAsync(wav, { idempotent: true }).catch(() => {});
    active = null;
    finish();
    idle = setTimeout(() => { void releaseOfflineSpeech().catch(() => {}); }, 30_000);
  }
}
