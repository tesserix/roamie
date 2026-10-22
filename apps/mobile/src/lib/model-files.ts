import * as FileSystem from 'expo-file-system/legacy';
import { offlineNative } from '../../modules/roamie-offline';

export type ModelFile = { file: string; bytes: number; sha256: string; repository: string; revision: string; resumable?: boolean };
export type ModelFileState = 'ready' | 'missing' | 'invalid';
const downloading = new Set<string>();
const verified = new Map<string, { uri: string; modified?: number }>();

export function modelFilePath(model: ModelFile, temporary = false) {
  if (!FileSystem.documentDirectory) throw new Error('Model storage is unavailable in this build.');
  return `${FileSystem.documentDirectory}offline-models/${model.file}${temporary ? '.download' : ''}`;
}

export const modelFileDownloading = (model: ModelFile) => downloading.has(model.file);

export async function withModelDownloadNetwork(cellular: boolean, signal: AbortSignal | undefined, action: (signal: AbortSignal) => Promise<void>) {
  const Network = await import('expo-network');
  const network = await Network.getNetworkStateAsync();
  if (network.isConnected === false || network.isInternetReachable === false) throw new Error('Connect to Wi-Fi to download this model.');
  if (!cellular && network.type !== Network.NetworkStateType.WIFI) throw new Error('Connect to Wi-Fi, or allow mobile data for this download.');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  let changedNetwork = false;
  const listener = !cellular ? Network.addNetworkStateListener(state => {
    if (state.type !== Network.NetworkStateType.WIFI || state.isConnected === false) { changedNetwork = true; controller.abort(); }
  }) : null;
  try { await action(controller.signal); }
  catch (error) {
    if (changedNetwork) throw new Error('The Wi-Fi connection changed. Reconnect to Wi-Fi and retry the download.');
    throw error;
  } finally { listener?.remove(); signal?.removeEventListener('abort', cancel); }
}

const resumePath = (model: ModelFile) => `${modelFilePath(model, true)}.resume.json`;

export async function hasPartialModelFile(model: ModelFile) {
  return (await FileSystem.getInfoAsync(modelFilePath(model, true))).exists;
}

export async function validModelFile(model: ModelFile, uri: string) {
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists && info.size === model.bytes && await offlineNative()?.sha256(uri) === model.sha256;
}

export async function modelFileStatus(model: ModelFile): Promise<ModelFileState> {
  const uri = modelFilePath(model);
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) { verified.delete(model.file); return 'missing'; }
  if (info.size !== model.bytes) { verified.delete(model.file); return 'invalid'; }
  const cached = verified.get(model.file);
  if (cached?.uri !== uri || info.modificationTime === undefined || cached.modified !== info.modificationTime) {
    if (!await validModelFile(model, uri)) { verified.delete(model.file); return 'invalid'; }
    verified.set(model.file, { uri, modified: info.modificationTime });
  }
  return 'ready';
}

function checkCanceled(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('Model download cancelled.');
}

export async function downloadModelFile(model: ModelFile, progress: (fraction: number) => void = () => {}, signal?: AbortSignal) {
  if (modelFileDownloading(model)) throw new Error('This model is already downloading.');
  downloading.add(model.file);
  const uri = modelFilePath(model, true);
  let cancel = () => {};
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let keepPartial = false;
  let invalid = false;
  let task: ReturnType<typeof FileSystem.createDownloadResumable> | undefined;
  let pausing: Promise<void> | undefined;
  const pause = () => pausing ??= (async () => {
    if (!model.resumable || !task) return;
    try {
      const saved = await task.pauseAsync();
      if (typeof saved.resumeData === 'string' && saved.resumeData.length <= 1_000_000) {
        await FileSystem.writeAsStringAsync(resumePath(model), JSON.stringify({ sha256: model.sha256, data: saved.resumeData }));
        keepPartial = true;
      }
    } catch { keepPartial = false; }
  })();
  try {
    checkCanceled(signal);
    if (await validModelFile(model, modelFilePath(model))) { progress(1); return; }
    const partial = model.resumable ? await FileSystem.getInfoAsync(uri) : undefined;
    keepPartial = partial?.exists === true;
    const required = model.resumable ? model.bytes - (partial?.exists ? Math.min(model.bytes, partial.size) : 0) : model.bytes * 2;
    if (await FileSystem.getFreeDiskStorageAsync() < required + 50 * 1024 ** 2) throw new Error('Not enough free space. Free some storage and retry.');
    await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}offline-models/`, { intermediates: true });
    let resumeData: string | undefined;
    if (model.resumable && await hasPartialModelFile(model)) {
      const saved = await FileSystem.getInfoAsync(resumePath(model));
      if (saved.exists && saved.size <= 1_000_000) {
        try {
          const value = JSON.parse(await FileSystem.readAsStringAsync(resumePath(model))) as { sha256?: string; data?: string };
          if (value.sha256 === model.sha256 && typeof value.data === 'string' && value.data.length <= 1_000_000) resumeData = value.data;
        } catch { resumeData = undefined; }
      }
    }
    if (!resumeData) {
      await FileSystem.deleteAsync(uri, { idempotent: true });
      if (model.resumable) await FileSystem.deleteAsync(resumePath(model), { idempotent: true });
    }
    keepPartial = false;
    const resumeArgs: [] | [string] = resumeData ? [resumeData] : [];
    task = FileSystem.createDownloadResumable(
      `https://huggingface.co/${model.repository}/resolve/${model.revision}/${model.file}`,
      uri, { sessionType: FileSystem.FileSystemSessionType.FOREGROUND }, data => progress(Math.min(0.99, data.totalBytesWritten / model.bytes)),
      ...resumeArgs,
    );
    cancel = () => { void (model.resumable ? pause() : task!.cancelAsync()).catch(() => {}); };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) { cancel(); checkCanceled(signal); }
    timeout = setTimeout(() => { timedOut = true; cancel(); }, (model.resumable ? 45 : 10) * 60 * 1000);
    const result = await (resumeData ? task.resumeAsync() : task.downloadAsync());
    checkCanceled(signal);
    if (timedOut) throw new Error('The model download took too long. Connect to Wi-Fi and retry.');
    if (![200, 206].includes(result?.status ?? 0) || !await validModelFile(model, uri)) {
      invalid = true;
      throw new Error('Model verification failed. Please download it again.');
    }
    checkCanceled(signal);
    await FileSystem.deleteAsync(modelFilePath(model), { idempotent: true });
    await FileSystem.moveAsync({ from: uri, to: modelFilePath(model) });
    const info = await FileSystem.getInfoAsync(modelFilePath(model));
    verified.set(model.file, { uri: modelFilePath(model), modified: info.exists ? info.modificationTime : undefined });
    progress(1);
  } catch (error) {
    if (model.resumable && !invalid) await pause();
    checkCanceled(signal);
    if (error instanceof Error && /ERR_FILESYSTEM|NSURLError|URLSession/i.test(error.message)) throw new Error('The model could not download. Check your connection and retry.');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
    await pausing;
    try {
      if (!keepPartial) {
        await FileSystem.deleteAsync(uri, { idempotent: true });
        if (model.resumable) await FileSystem.deleteAsync(resumePath(model), { idempotent: true });
      }
    } finally { downloading.delete(model.file); }
  }
}

export async function removeModelFile(model: ModelFile) {
  if (modelFileDownloading(model)) throw new Error('Cancel the download before removing this model.');
  verified.delete(model.file);
  await FileSystem.deleteAsync(modelFilePath(model), { idempotent: true });
  await FileSystem.deleteAsync(modelFilePath(model, true), { idempotent: true });
  if (model.resumable) await FileSystem.deleteAsync(resumePath(model), { idempotent: true });
}
