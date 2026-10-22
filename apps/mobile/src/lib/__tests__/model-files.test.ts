import { beforeEach, expect, jest, test } from '@jest/globals';
import * as FileSystem from 'expo-file-system/legacy';
import { AppState, type AppStateStatus } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { downloadModelFile, hasPartialModelFile, modelFilePath, modelFileStatus, modelFileDownloading, type ModelFile } from '../model-files';

jest.mock('expo-file-system/legacy', () => {
  const files = new Map<string, { size: number; hash: string; text?: string }>();
  return {
    __files: files, documentDirectory: 'file:///documents/', FileSystemSessionType: { FOREGROUND: 0 },
    getInfoAsync: jest.fn(async (uri: string) => files.has(uri) ? { exists: true, uri, isDirectory: false, modificationTime: 1, size: files.get(uri)!.size } : { exists: false, uri, isDirectory: false }),
    getFreeDiskStorageAsync: jest.fn(async () => 10 * 1024 ** 3),
    makeDirectoryAsync: async () => {},
    deleteAsync: jest.fn(async (uri: string) => { files.delete(uri); }),
    writeAsStringAsync: async (uri: string, text: string) => { files.set(uri, { size: text.length, hash: '', text }); },
    readAsStringAsync: async (uri: string) => files.get(uri)?.text ?? '',
    moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => { files.set(to, files.get(from)!); files.delete(from); }),
    createDownloadResumable: jest.fn((url: string, uri: string) => ({
      downloadAsync: async () => { files.set(uri, { size: 6, hash: 'bad' }); return { status: 200 }; },
      cancelAsync: async () => {},
    })),
  };
});
jest.mock('expo-modules-core', () => ({ ...jest.requireActual<object>('expo-modules-core'), requireOptionalNativeModule: jest.fn() }));

const artifact: ModelFile = { file: 'test.gguf', bytes: 6, sha256: 'a'.repeat(64), repository: 'publisher/model', revision: 'pinned' };
const files = jest.requireMock<{ __files: Map<string, { size: number; hash: string; text?: string }> }>('expo-file-system/legacy').__files;

beforeEach(() => {
  files.clear(); jest.clearAllMocks();
  jest.mocked(requireOptionalNativeModule).mockReturnValue({ sha256: async (uri: string) => files.get(uri)?.hash });
});

test('a download with the wrong checksum never becomes a ready model', async () => {
  await expect(downloadModelFile(artifact)).rejects.toThrow('verification');
  expect(await modelFileStatus(artifact)).toBe('missing');
  expect(files.has(modelFilePath(artifact, true))).toBe(false);
  expect(FileSystem.moveAsync).not.toHaveBeenCalled();
});

test('an interrupted resumable download keeps its progress and resumes before verification', async () => {
  const controller = new AbortController();
  let started!: () => void;
  let finish!: (result: undefined) => void;
  const began = new Promise<void>(resolve => { started = resolve; });
  const pause = jest.fn(async () => { finish(undefined); return { resumeData: 'native-resume-data' }; });
  jest.mocked(FileSystem.createDownloadResumable).mockImplementationOnce((_url, uri) => ({
    downloadAsync: () => new Promise<undefined>(resolve => { finish = resolve; files.set(uri, { size: 3, hash: 'partial' }); started(); }),
    pauseAsync: pause,
    cancelAsync: async () => { finish(undefined); },
  }) as unknown as ReturnType<typeof FileSystem.createDownloadResumable>);
  const model = { ...artifact, resumable: true };
  const pending = downloadModelFile(model, undefined, controller.signal);
  await began;
  controller.abort();
  await expect(pending).rejects.toThrow('cancelled');
  expect(pause).toHaveBeenCalledTimes(1);
  expect(files.has(modelFilePath(model, true))).toBe(true);
  jest.mocked(FileSystem.createDownloadResumable).mockImplementationOnce((_url, uri) => ({
    resumeAsync: async () => { files.set(uri, { size: model.bytes, hash: model.sha256 }); return { status: 206 }; },
    cancelAsync: async () => {},
  }) as unknown as ReturnType<typeof FileSystem.createDownloadResumable>);
  await downloadModelFile(model);
  expect(FileSystem.createDownloadResumable).toHaveBeenLastCalledWith(expect.any(String), modelFilePath(model, true), expect.any(Object), expect.any(Function), 'native-resume-data');
  expect(await modelFileStatus(model)).toBe('ready');
});

test('insufficient free space does not discard a paused model download', async () => {
  const model = { ...artifact, resumable: true };
  files.set(modelFilePath(model, true), { size: 3, hash: 'partial' });
  jest.mocked(FileSystem.getFreeDiskStorageAsync).mockResolvedValueOnce(0);
  await expect(downloadModelFile(model)).rejects.toThrow('space');
  expect(files.has(modelFilePath(model, true))).toBe(true);
});

test('iOS resume metadata remains resumable when URLSession owns the temporary file', async () => {
  const model = { ...artifact, resumable: true };
  const text = JSON.stringify({ sha256: model.sha256, data: 'ios-urlsession-resume' });
  files.set(`${modelFilePath(model, true)}.resume.json`, { size: text.length, hash: '', text });
  expect(await hasPartialModelFile(model)).toBe(true);
  jest.mocked(FileSystem.createDownloadResumable).mockImplementationOnce((_url, uri) => ({
    resumeAsync: async () => { files.set(uri, { size: model.bytes, hash: model.sha256 }); return { status: 200 }; },
    cancelAsync: async () => {},
  }) as never);
  await downloadModelFile(model);
  expect(FileSystem.createDownloadResumable).toHaveBeenLastCalledWith(expect.any(String), modelFilePath(model, true), expect.any(Object), expect.any(Function), 'ios-urlsession-resume');
  expect(await modelFileStatus(model)).toBe('ready');
});

test('a cleanup failure does not leave a model permanently marked as downloading', async () => {
  jest.mocked(FileSystem.deleteAsync).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('File is busy.'));
  await expect(downloadModelFile(artifact)).rejects.toThrow('busy');
  expect(modelFileDownloading(artifact)).toBe(false);
});


test('backgrounding pauses a large download and preserves its resumable partial file', async () => {
  const model = { ...artifact, resumable: true };
  let change: ((state: AppStateStatus) => void) | undefined;
  const subscription = jest.spyOn(AppState, 'addEventListener').mockImplementation((event, listener) => { if (event === 'change') change = listener as (state: AppStateStatus) => void; return { remove() {} }; });
  let created!: () => void;
  const started = new Promise<void>(resolve => { created = resolve; });
  let rejectDownload!: (error: Error) => void;
  jest.mocked(FileSystem.createDownloadResumable).mockImplementationOnce((_url, uri) => ({
    downloadAsync: async () => { files.set(uri, { size: 5, hash: '' }); created(); return new Promise((_resolve, reject) => { rejectDownload = reject; }); },
    pauseAsync: async () => { rejectDownload(new Error('paused')); return { resumeData: 'background-resume' }; }, cancelAsync: async () => {},
  }) as never);
  const controller = new AbortController();
  const download = downloadModelFile(model, undefined, controller.signal);
  try {
    await started;
    expect(change).toBeDefined();
    change!('background');
    await expect(download).rejects.toThrow('paused');
    expect(files.has(modelFilePath(model, true))).toBe(true);
    expect(files.get(`${modelFilePath(model, true)}.resume.json`)?.text).toContain('background-resume');
  } finally { controller.abort(); await download.catch(() => {}); subscription.mockRestore(); }
});
