import * as FileSystem from 'expo-file-system/legacy';
import * as Device from 'expo-device';
import { offlineNative } from '../../modules/roamie-offline';
import { checkTranslationCanceled } from './offline-translation';
import type { SpeechModel } from './translation-preferences';

const REVISION = '5359861c739e955e79d9a303bcbc70fb988958b1';
export const SPEECH_MODELS = {
  base: { name: 'Base · balanced', file: 'ggml-base-q5_1.bin', bytes: 59707625, sha256: '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898', repository: 'ggerganov/whisper.cpp', revision: REVISION },
  small: { name: 'Small · higher quality', file: 'ggml-small-q5_1.bin', bytes: 190085487, sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb', repository: 'ggerganov/whisper.cpp', revision: REVISION },
  vad: { name: 'Speech detector', file: 'ggml-silero-v6.2.0.bin', bytes: 885098, sha256: '2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987', repository: 'ggml-org/whisper-vad', revision: '9ffd54a1e1ee413ddf265af9913beaf518d1639b' },
} as const;
type Artifact = keyof typeof SPEECH_MODELS;
const downloading = new Set<Artifact>();
const verified = new Map<Artifact, string>();

export const supportsSmallSpeechModel = () => Device.totalMemory !== null && Device.totalMemory >= 6 * 1024 ** 3;

function path(model: Artifact, temporary = false) {
  if (!FileSystem.documentDirectory) throw new Error('Model storage is unavailable in this build.');
  return `${FileSystem.documentDirectory}offline-models/${SPEECH_MODELS[model].file}${temporary ? '.download' : ''}`;
}

export async function installedSpeechModels(): Promise<SpeechModel[]> {
  const installed: SpeechModel[] = [];
  for (const model of ['base', 'small'] as const) {
    if (await speechModelPaths(model)) installed.push(model);
  }
  return installed;
}

async function valid(model: Artifact, uri: string) {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || info.size !== SPEECH_MODELS[model].bytes) return false;
  return await offlineNative()?.sha256(uri) === SPEECH_MODELS[model].sha256;
}

export async function speechModelPaths(model: SpeechModel): Promise<{ model: string; vad: string } | null> {
  for (const artifact of [model, 'vad'] as const) {
    const uri = path(artifact);
    if (verified.get(artifact) === uri) {
      const info = await FileSystem.getInfoAsync(uri);
      if (info.exists && info.size === SPEECH_MODELS[artifact].bytes) continue;
    }
    if (!await valid(artifact, uri)) { verified.delete(artifact); return null; }
    verified.set(artifact, uri);
  }
  return { model: path(model), vad: path('vad') };
}

async function downloadArtifact(model: Artifact, progress: (fraction: number) => void, signal?: AbortSignal) {
  if (downloading.has(model)) throw new Error('This model is already downloading.');
  downloading.add(model);
  const uri = path(model, true);
  let cancel = () => {};
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    checkTranslationCanceled(signal);
    const artifact = SPEECH_MODELS[model];
    if (await valid(model, path(model))) { progress(1); return; }
    if (await FileSystem.getFreeDiskStorageAsync() < artifact.bytes * 2 + 50 * 1024 ** 2) throw new Error('Not enough free space. Free some storage and retry.');
    await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}offline-models/`, { intermediates: true });
    await FileSystem.deleteAsync(uri, { idempotent: true });
    const task = FileSystem.createDownloadResumable(
      `https://huggingface.co/${artifact.repository}/resolve/${artifact.revision}/${artifact.file}`,
      uri, { sessionType: FileSystem.FileSystemSessionType.FOREGROUND }, data => progress(Math.min(0.99, data.totalBytesWritten / artifact.bytes)),
    );
    cancel = () => { void task.cancelAsync().catch(() => {}); };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) { cancel(); checkTranslationCanceled(signal); }
    timeout = setTimeout(() => { timedOut = true; cancel(); }, 10 * 60 * 1000);
    const result = await task.downloadAsync();
    checkTranslationCanceled(signal);
    if (timedOut) throw new Error('The model download took too long. Connect to Wi-Fi and retry.');
    if (result?.status !== 200 || !await valid(model, uri)) throw new Error('Model verification failed. Please download it again.');
    checkTranslationCanceled(signal);
    await FileSystem.deleteAsync(path(model), { idempotent: true });
    await FileSystem.moveAsync({ from: uri, to: path(model) });
    verified.set(model, path(model));
    progress(1);
  } catch (error) {
    checkTranslationCanceled(signal);
    if (error instanceof Error && /ERR_FILESYSTEM|NSURLError|URLSession/i.test(error.message)) throw new Error('The speech model could not download. Check your connection and retry.');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
    await FileSystem.deleteAsync(uri, { idempotent: true });
    downloading.delete(model);
  }
}

export async function downloadSpeechModel(model: SpeechModel, cellular = false, progress: (fraction: number) => void = () => {}, signal?: AbortSignal): Promise<void> {
  if (!offlineNative()) throw new Error('Install the latest Roamie build to download offline models.');
  if (model === 'small' && !supportsSmallSpeechModel()) throw new Error('Use Base on this phone. Small requires at least 6 GB of memory.');
  const Network = await import('expo-network');
  const network = await Network.getNetworkStateAsync();
  if (network.isConnected === false || network.isInternetReachable === false) throw new Error('Connect to Wi-Fi to download this model.');
  if (!cellular && network.type !== Network.NetworkStateType.WIFI) throw new Error('Connect to Wi-Fi, or allow mobile data for this download.');
  const bytes = SPEECH_MODELS[model].bytes;
  const total = bytes + SPEECH_MODELS.vad.bytes;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  let changedNetwork = false;
  const listener = !cellular ? Network.addNetworkStateListener(state => {
    if (state.type !== Network.NetworkStateType.WIFI || state.isConnected === false) {
      changedNetwork = true; controller.abort();
    }
  }) : null;
  try {
    await downloadArtifact(model, fraction => progress(fraction * bytes / total), controller.signal);
    await downloadArtifact('vad', fraction => progress((bytes + fraction * SPEECH_MODELS.vad.bytes) / total), controller.signal);
  } catch (error) {
    if (changedNetwork) throw new Error('The Wi-Fi connection changed. Reconnect to Wi-Fi and retry the download.');
    throw error;
  } finally { listener?.remove(); signal?.removeEventListener('abort', cancel); }
}

export async function removeSpeechModel(model: SpeechModel) {
  if (downloading.has(model)) throw new Error('Cancel the download before removing this model.');
  const { releaseOfflineSpeech } = await import('./offline-speech');
  await releaseOfflineSpeech();
  verified.delete(model);
  await FileSystem.deleteAsync(path(model), { idempotent: true });
  const remaining = await installedSpeechModels();
  if (!remaining.length && !downloading.has('vad')) {
    verified.delete('vad');
    await FileSystem.deleteAsync(path('vad'), { idempotent: true });
  }
}
