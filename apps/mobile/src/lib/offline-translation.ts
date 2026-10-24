import { requireOptionalNativeModule } from 'expo';
import { Paths } from 'expo-file-system';
import type { TurnRequest, TurnResponse } from './api';

export type OfflineStatus = { available: boolean; online: boolean; wifi: boolean; supported: string[]; downloaded: string[] };
type NativeTranslator = {
  isOnline?(): Promise<boolean>;
  status(): Promise<Omit<OfflineStatus, 'available'>>;
  translate(text: string, from: string, to: string): Promise<string>;
  download(from: string, to: string, cellular: boolean): Promise<void>;
  remove(language: string): Promise<void>;
};
const native = () => requireOptionalNativeModule<NativeTranslator>('RoamieOffline');
export const MAX_OFFLINE_LANGUAGES = 5;
export function offlineFreeStorage(): number | null {
  try { const bytes = Paths.availableDiskSpace; return Number.isFinite(bytes) && bytes >= 0 ? bytes : null; }
  catch { return null; }
}
function checkDownloadStorage(packs: number) {
  if (!packs) return;
  const free = offlineFreeStorage();
  if (free === null) throw new Error('Could not check device storage. Please retry before downloading.');
  // Conservative download/extraction headroom, not an exact SDK model size.
  const required = (packs * 100 + 200) * 1024 * 1024;
  if (free < required) throw new Error(`Free at least ${Math.ceil(required / 1024 / 1024)} MB of device storage before downloading. Remove unused packs or files and retry.`);
}
export const offlineCode = (code: string) => code === 'fil' ? 'tl' : code;
let active = false;
let operation: 'translate' | 'download' | 'remove' | null = null;
const listeners = new Set<() => void>();
export const offlineModelBusy = () => active;
export const subscribeOfflineModels = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
async function runModelOperation<T>(kind: NonNullable<typeof operation>, work: () => Promise<T>): Promise<T> {
  if (active) throw new Error('The offline translator is busy. Please wait and retry.');
  active = true;
  operation = kind;
  listeners.forEach(listener => listener());
  try { return await work(); } finally { active = false; operation = null; listeners.forEach(listener => listener()); }
}

async function waitForInference(signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new Error('Translation cancelled.');
  if (!active || operation !== 'translate') return;
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: string) => { clearTimeout(timer); listeners.delete(changed); signal.removeEventListener('abort', aborted); if (error) reject(new Error(error)); else resolve(); };
    const changed = () => { if (!active) finish(); };
    const aborted = () => finish('Translation cancelled.');
    const timer = setTimeout(() => finish('The offline translator is busy. Please retry.'), 10000);
    listeners.add(changed); signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted(); else changed();
  });
}

export async function isOnline(): Promise<boolean> {
  const module = native();
  if (!module) return true;
  return module.isOnline ? module.isOnline() : (await module.status()).online;
}

export async function offlineStatus(): Promise<OfflineStatus> {
  const module = native();
  return module ? { ...await module.status(), available: true } : { available: false, online: true, wifi: false, supported: [], downloaded: [] };
}

export async function translateOffline(text: string, from: string, to: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new Error('Translation cancelled.');
  if (signal) await waitForInference(signal);
  return runModelOperation('translate', async () => {
  if (!text.trim() || text.length > 2000) throw new Error('Enter between 1 and 2000 characters.');
  const module = native();
  if (!module) throw new Error('Offline translation needs the latest mobile app.');
  const status = await offlineStatus();
  const source = offlineCode(from), target = offlineCode(to);
  if (![source, target].every(code => status.supported.includes(code))) throw new Error('This language is not supported offline.');
  if (![source, target].every(code => status.downloaded.includes(code))) throw new Error('Download both languages in Profile → Offline languages before translating offline.');
  if (signal?.aborted) throw new Error('Translation cancelled.');
  const result = await module.translate(text, source, target);
  if (signal?.aborted) throw new Error('Translation cancelled.');
  return result;
  });
}

export async function downloadOfflinePair(from: string, to: string, cellular = false): Promise<void> {
  return downloadOfflineLanguages([from, to], cellular);
}

export async function downloadOfflineLanguages(languages: string[], cellular = false): Promise<void> {
  return runModelOperation('download', async () => {
    const module = native();
    if (!module) throw new Error('Offline translation needs the latest mobile app.');
    const status = await offlineStatus();
    if (!status.online) throw new Error('Connect to the internet to download languages.');
    if (!status.wifi && !cellular) throw new Error('Connect to Wi-Fi, or allow mobile data for this download.');
    const selected = [...new Set(languages.map(offlineCode))];
    if (!selected.length) throw new Error('Select languages to download.');
    if (selected.some(code => !status.supported.includes(code))) throw new Error('A selected language is not supported offline.');
    const added = selected.filter(code => !status.downloaded.includes(code));
    if (added.length && new Set([...status.downloaded, ...selected]).size > MAX_OFFLINE_LANGUAGES) throw new Error('You can keep up to five offline languages. Remove a downloaded language first.');
    checkDownloadStorage(added.length);
    const pending = new Set(added);
    const anchor = selected.length > 1 ? selected[0] : status.downloaded.find(code => code !== selected[0] && status.supported.includes(code));
    if (!anchor) throw new Error('Select at least two languages for your first download.');
    for (const code of selected) {
      if (code !== anchor) {
        checkDownloadStorage(pending.size);
        await module.download(anchor, code, cellular);
        pending.delete(anchor); pending.delete(code);
      }
    }
  });
}

export async function removeOfflineLanguage(language: string): Promise<void> {
  return runModelOperation('remove', async () => {
    const module = native();
    if (!module) throw new Error('Offline translation needs the latest mobile app.');
    await module.remove(offlineCode(language));
  });
}

export async function offlineTurn(request: TurnRequest, signal?: AbortSignal): Promise<TurnResponse & { offline: true }> {
  if (request.audio) throw new Error('Offline voice input is not ready here. Choose Type or open Offline languages.');
  if (request.autoMine || !request.partnerLocked || !request.mine || !request.partner) throw new Error('Choose both conversation languages to translate offline.');
  const fromMe = request.expectedSpeaker !== 'partner';
  const from = fromMe ? request.mine : request.partner, to = fromMe ? request.partner : request.mine;
  const translation = await translateOffline(request.text ?? '', from, to, signal);
  return { offline: true, mine: request.mine, partner: request.partner, fromMe, transcript: request.text ?? '', translation, detected: from, target: to, confidence: 1, candidates: [from], romanized: '', sameLanguage: from === to, decisionModel: 'mlkit-on-device' };
}
