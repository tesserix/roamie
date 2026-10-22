import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import { session } from './auth-client';

export const AI_CONSENT_VERSION = '2026-10-21';
export const aiConsentKey = (subject: string) => `roamie.ai-consent.${AI_CONSENT_VERSION}.${encodeURIComponent(subject)}`;
export const AI_DISCLOSURE = 'With your permission, Roamie sends the text and recent conversation, voice recordings, selected images or documents, and trip details needed for your request to Tesserix services, Google Cloud AI and TypeSafe JEV for translation, recognition, planning and quality review. Documents also use our document-recognition service. Ask your conversation partner before sharing their speech. AI can make mistakes. You can withdraw permission in Profile & settings → AI data sharing. Read the Privacy policy there for storage and retention details.';
const pending = new Map<string, Promise<void>>();
const withdrawals = new Map<string, number>();
const blocked = new Set<string>();
const denied = () => new Error('AI data sharing is off. Review AI data sharing in Profile & settings to continue.');

export function usesAI(path: string, method: string) {
  return method === 'POST' && (['/v1/talk/turn', '/v1/talk/speech', '/v1/translate/text', '/v1/signs/translate', '/v1/receipts/extract', '/v1/statements/extract', '/v1/trips/plan', '/v1/trip-manager'].includes(path) || /^\/v1\/trips\/[^/]+\/planning$/.test(path));
}

export async function reviewAIConsent(subject: string): Promise<void> {
  const existing = pending.get(subject);
  if (existing) return existing;
  const revision = session.revision?.();
  const withdrawal = withdrawals.get(subject);
  const unchanged = () => session.current()?.sub === subject && session.revision?.() === revision;
  const operation = (async () => {
    if (!unchanged()) throw new Error('The account changed. Please try again.');
    const allowed = await new Promise<boolean>(resolve => Alert.alert('AI data sharing', AI_DISCLOSURE, [
      { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Allow and continue', onPress: () => resolve(true) },
    ], { cancelable: false }));
    if (!unchanged()) throw new Error('The account changed. Please try again.');
    if (withdrawals.get(subject) !== withdrawal) throw denied();
    await AsyncStorage.setItem(aiConsentKey(subject), allowed ? 'allowed' : 'denied');
    if (withdrawals.get(subject) !== withdrawal) {
      await AsyncStorage.setItem(aiConsentKey(subject), 'denied');
      throw denied();
    }
    if (allowed) blocked.delete(subject);
    if (!allowed) throw denied();
  })();
  pending.set(subject, operation);
  try { await operation; } finally { if (pending.get(subject) === operation) pending.delete(subject); }
}

export async function requireAIConsent(subject: string, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new Error('Request cancelled or timed out.');
  if (blocked.has(subject)) throw denied();
  const choice = await AsyncStorage.getItem(aiConsentKey(subject));
  if (choice === 'denied') throw denied();
  if (choice !== 'allowed') {
    let abort: (() => void) | undefined;
    try {
      await Promise.race([
        reviewAIConsent(subject),
        new Promise<never>((_, reject) => {
          abort = () => reject(new Error('Request cancelled or timed out.'));
          signal?.addEventListener('abort', abort, { once: true });
          if (signal?.aborted) abort();
        }),
      ]);
    } finally { if (abort) signal?.removeEventListener('abort', abort); }
  }
  if (signal?.aborted) throw new Error('Request cancelled or timed out.');
}

export async function assertAIConsent(subject: string) {
  if (blocked.has(subject) || await AsyncStorage.getItem(aiConsentKey(subject)) !== 'allowed') throw denied();
}

export async function withdrawAIConsent(subject: string) {
  blocked.add(subject);
  withdrawals.set(subject, (withdrawals.get(subject) ?? 0) + 1);
  await AsyncStorage.setItem(aiConsentKey(subject), 'denied');
}
