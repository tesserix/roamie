import { AppState, Platform } from 'react-native';
import * as Device from 'expo-device';
import type { LlamaContext } from 'llama.rn';
import { offlineNative } from '../../modules/roamie-offline';
import { HYMT_MODEL, hymtUnavailableReason, supportsHymt, textModelStatus } from './text-models';
import { modelFilePath } from './model-files';
import { languageName } from './languages';
import { registerOfflineEngine, withOfflineInference } from './offline-inference';

let context: LlamaContext | null = null;
let releasing: Promise<void> | null = null;
let idle: ReturnType<typeof setTimeout> | undefined;
let contextListeners: { remove(): void }[] = [];
let active: { cancelled: boolean; done: Promise<void>; stop?: () => Promise<void> } | null = null;

export function releaseOfflineText(): Promise<void> {
  if (releasing) return releasing;
  releasing = (async () => {
    const job = active;
    if (job) { job.cancelled = true; await job.stop?.().catch(() => {}); await job.done; }
    clearTimeout(idle);
    contextListeners.forEach(listener => listener.remove()); contextListeners = [];
    const previous = context; context = null;
    await previous?.release();
  })().finally(() => { releasing = null; });
  return releasing;
}
registerOfflineEngine('text', releaseOfflineText);

export async function translateHymt(text: string, to: string, from: string, signal?: AbortSignal, ready?: () => void): Promise<string | null> {
  if (signal?.aborted) throw new Error('Offline translation cancelled.');
  if (hymtUnavailableReason() || !supportsHymt(from) || !supportsHymt(to) || await textModelStatus() !== 'ready') return null;
  if (signal?.aborted) throw new Error('Offline translation cancelled.');
  return withOfflineInference('text', async () => {
    if (hymtUnavailableReason() || !supportsHymt(from) || !supportsHymt(to) || await textModelStatus() !== 'ready') return null;
    if (releasing) await releasing;
    if (!context && (await offlineNative()?.availableMemory() ?? 0) < 1600 * 1024 ** 2) throw new Error('Not enough free memory for Large model. Close other apps or use platform language packs.');
    if (signal?.aborted) throw new Error('Offline translation cancelled.');
    ready?.();
    let finish!: () => void;
    const job: NonNullable<typeof active> = { cancelled: false, done: new Promise(resolve => { finish = resolve; }) };
    active = job; clearTimeout(idle);
    let timedOut = false;
    const cancel = () => { job.cancelled = true; void job.stop?.().catch(() => {}); };
    const check = () => {
      if (timedOut) throw new Error('Large model took too long. Try a shorter phrase or use platform language packs.');
      if (job.cancelled || signal?.aborted) throw new Error('Offline translation cancelled.');
    };
    const timeout = setTimeout(() => { timedOut = true; cancel(); }, 60_000);
    signal?.addEventListener('abort', cancel, { once: true });
    const app = AppState.addEventListener('change', state => { if (state !== 'active') cancel(); });
    const memory = AppState.addEventListener('memoryWarning', cancel);
    try {
      check();
      if (!context) {
        const engine = await import('llama.rn');
        check();
        context = await engine.initLlama({ model: modelFilePath(HYMT_MODEL), n_ctx: 2048, n_parallel: 1, n_batch: 128, n_ubatch: 128, n_threads: 4, use_mmap: true, use_mlock: false, n_gpu_layers: Platform.OS === 'ios' && Device.isDevice ? 99 : 0 });
        contextListeners = [
          AppState.addEventListener('change', state => { if (state !== 'active') void releaseOfflineText().catch(() => {}); }),
          AppState.addEventListener('memoryWarning', () => { void releaseOfflineText().catch(() => {}); }),
        ];
      }
      check();
      job.stop = () => context!.stopCompletion();
      const prompt = `Translate the following text into ${languageName(to)}. Note that you should only output the translated result without any additional explanation:\n\n${text}`;
      const formatted = await context.getFormattedChat([{ role: 'user', content: prompt }]);
      check();
      const tokens = await context.tokenize(formatted.prompt);
      check();
      if (tokens.tokens.length + 512 + 8 > 2048) throw new Error('This phrase is too long for Large model. Translate a shorter section.');
      const result = await context.completion({ prompt: formatted.prompt, n_predict: 512, temperature: 0.7, top_p: 0.6, top_k: 20, penalty_repeat: 1.05, seed: 42 });
      check();
      if (result.truncated || result.stopped_limit || result.context_full || result.interrupted || result.tool_calls?.length) throw new Error('Large model returned an incomplete translation. Try a shorter phrase.');
      const translated = (result.content || (!result.reasoning_content ? result.text : '')).trim();
      if (!translated) throw new Error('Large model returned an empty translation. Please try again.');
      return translated;
    } finally {
      clearTimeout(timeout); app.remove(); memory.remove(); signal?.removeEventListener('abort', cancel);
      if (job.cancelled || signal?.aborted) await job.stop?.().catch(() => {});
      await context?.clearCache(true).catch(() => { job.cancelled = true; });
      active = null; finish();
      if (job.cancelled || signal?.aborted) void releaseOfflineText().catch(() => {});
      else idle = setTimeout(() => { void releaseOfflineText().catch(() => {}); }, 20_000);
    }
  }, signal);
}
