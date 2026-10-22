import { offlineNative } from '../../modules/roamie-offline';
import { downloadModelFile, modelFilePath, modelFileStatus, modelFileDownloading, removeModelFile, withModelDownloadNetwork } from './model-files';
import { supportsLargeOfflineModels, largeModelMemoryReason } from './offline-device';
import { saveTranslationPreferences, translationPreferences, type SpeechModel } from './translation-preferences';

const REVISION = '5359861c739e955e79d9a303bcbc70fb988958b1';
export const SPEECH_MODELS = {
  base: { name: 'Small', file: 'ggml-base-q5_1.bin', bytes: 59707625, sha256: '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898', repository: 'ggerganov/whisper.cpp', revision: REVISION },
  small: { name: 'Medium', file: 'ggml-small-q5_1.bin', bytes: 190085487, sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb', repository: 'ggerganov/whisper.cpp', revision: REVISION },
  vad: { name: 'Speech detector', file: 'ggml-silero-v6.2.0.bin', bytes: 885098, sha256: '2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987', repository: 'ggml-org/whisper-vad', revision: '9ffd54a1e1ee413ddf265af9913beaf518d1639b' },
} as const;
type Artifact = keyof typeof SPEECH_MODELS;
export type SpeechAssetState = 'ready' | 'missing' | 'invalid';
export type SpeechModelStatus = { model: SpeechAssetState; detector: SpeechAssetState };

export const supportsSmallSpeechModel = supportsLargeOfflineModels;
export const smallSpeechModelUnavailableReason = () => `${largeModelMemoryReason(SPEECH_MODELS.small.name)} Use Small.`;

const path = (model: Artifact) => modelFilePath(SPEECH_MODELS[model]);

export async function installedSpeechModels(): Promise<SpeechModel[]> {
  const installed: SpeechModel[] = [];
  for (const model of ['base', 'small'] as const) {
    if (await speechModelPaths(model)) installed.push(model);
  }
  return installed;
}

const artifactStatus = (model: Artifact) => modelFileStatus(SPEECH_MODELS[model]);

export async function speechModelStatus(model: SpeechModel): Promise<SpeechModelStatus> {
  const [modelState, detector] = await Promise.all([artifactStatus(model), artifactStatus('vad')]);
  return { model: modelState, detector };
}

export async function speechModelPaths(model: SpeechModel): Promise<{ model: string; vad: string } | null> {
  const status = await speechModelStatus(model);
  return status.model === 'ready' && status.detector === 'ready' ? { model: path(model), vad: path('vad') } : null;
}

export async function resolveSpeechModel(preferred: SpeechModel) {
  const candidates: SpeechModel[] = [preferred, preferred === 'base' ? 'small' : 'base'];
  for (const model of candidates) {
    if (model === 'small' && !supportsSmallSpeechModel()) continue;
    const paths = await speechModelPaths(model);
    if (paths) return { model, paths };
  }
  return null;
}

const downloadArtifact = (model: Artifact, progress: (fraction: number) => void, signal?: AbortSignal) => downloadModelFile(SPEECH_MODELS[model], progress, signal);

export async function downloadSpeechModel(model: SpeechModel, cellular = false, progress: (fraction: number) => void = () => {}, signal?: AbortSignal): Promise<void> {
  if (!offlineNative()) throw new Error('Install the latest Roamie build to download offline models.');
  if (model === 'small' && !supportsSmallSpeechModel()) throw new Error(smallSpeechModelUnavailableReason());
  const bytes = SPEECH_MODELS[model].bytes;
  const total = bytes + SPEECH_MODELS.vad.bytes;
  await withModelDownloadNetwork(cellular, signal, async current => {
    await downloadArtifact(model, fraction => progress(fraction * bytes / total), current);
    await downloadArtifact('vad', fraction => progress((bytes + fraction * SPEECH_MODELS.vad.bytes) / total), current);
  });
}

export async function removeSpeechModel(model: SpeechModel) {
  if (modelFileDownloading(SPEECH_MODELS[model])) throw new Error('Cancel the download before removing this model.');
  const { releaseOfflineSpeech } = await import('./offline-speech');
  await releaseOfflineSpeech();
  await removeModelFile(SPEECH_MODELS[model]);
  const remaining = await installedSpeechModels();
  const fallback = remaining.find(candidate => candidate !== 'small' || supportsSmallSpeechModel());
  if (fallback && translationPreferences().speechModel === model) await saveTranslationPreferences({ speechModel: fallback });
  if (!remaining.length && !modelFileDownloading(SPEECH_MODELS.vad)) {
    await removeModelFile(SPEECH_MODELS.vad);
  }
}
