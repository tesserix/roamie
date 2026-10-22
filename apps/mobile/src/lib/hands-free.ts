import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync, setAudioModeAsync, type RecordingOptions } from 'expo-audio';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { File } from 'expo-file-system';
import { stopSpeaking } from './voice';
import { waitForMicrophoneForeground } from './microphone';
import { SPEECH_RECORDING } from './recording';

type Recorder = {
  uri: string | null;
  prepareToRecordAsync: (options: RecordingOptions) => Promise<void>;
  record: () => void;
  stop: () => Promise<void>;
  getStatus: () => { isRecording: boolean; durationMillis: number; metering?: number; mediaServicesDidReset: boolean };
};
type Callbacks = {
  onTurn: (uri: string, active: () => boolean) => Promise<void>;
  onPhase: (phase: 'idle' | 'starting' | 'listening' | 'thinking') => void;
  onActive: (active: boolean) => void;
  onError: (message: string) => void;
  onRecovery: (message: string) => void;
  isForeground: () => boolean;
};

let conversationId = 0;

export class HandsFreeConversation {
  private readonly awakeTag = `roamie-hands-free-${++conversationId}`;
  private active = false;
  private running = false;
  private requestingPermission = false;
  private revision = 0;
  private wake: (() => void) | null = null;
  private cancel: (() => void) | null = null;

  constructor(private recorder: Recorder, private callbacks: Callbacks) {}

  stop() {
    this.active = false;
    this.revision++;
    this.wake?.();
    this.cancel?.();
    stopSpeaking();
  }

  onAppBackground() {
    if (!this.requestingPermission) this.stop();
  }

  private pause(ms: number) {
    return new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); this.wake = null; resolve(); };
      const timer = setTimeout(finish, ms);
      this.wake = finish;
    });
  }

  async start() {
    if (this.running) return;
    this.running = this.active = true;
    const revision = ++this.revision;
    const current = () => this.active && revision === this.revision;
    const canceled = new Promise<void>(resolve => { this.cancel = resolve; });
    this.callbacks.onActive(true);
    this.callbacks.onPhase('starting');
    let prepared = false;
    let awake = false;
    let interruptions = 0;
    try {
      const existing = await getRecordingPermissionsAsync();
      if (!current()) return;
      let permission = existing;
      if (!permission.granted) {
        this.requestingPermission = true;
        try {
          permission = await requestRecordingPermissionsAsync();
          if (permission.granted) await waitForMicrophoneForeground(current, this.callbacks.isForeground, milliseconds => this.pause(milliseconds));
        }
        finally { this.requestingPermission = false; }
      }
      if (!current()) return;
      if (!permission.granted) throw new Error('Allow microphone access in Settings, or use Type instead.');
      if (!this.callbacks.isForeground()) throw new Error('Return to Roamie, then start hands-free again.');
      await activateKeepAwakeAsync(this.awakeTag).then(() => { awake = true; }).catch(() => {});
      if (!current()) return;
      stopSpeaking();
      while (current()) {
        this.callbacks.onPhase('starting');
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        if (!current()) break;
        await this.recorder.prepareToRecordAsync(SPEECH_RECORDING);
        prepared = true;
        if (!current()) break;
        this.recorder.record();
        this.callbacks.onPhase('listening');
        if (interruptions) this.callbacks.onRecovery('Still listening. Please repeat.');
        let interrupted = false;
        let voicedMs = 0, lastVoice = 0, heardSpeech = false, previous = 0;
        let speechLevel = -Infinity;
        const levels: number[] = [];
        const started = Date.now();
        while (current()) {
          await this.pause(100);
          if (!current()) break;
          const status = this.recorder.getStatus();
          if (!status.isRecording || status.mediaServicesDidReset) { interrupted = true; break; }
          if (status.metering == null || !Number.isFinite(status.metering)) throw new Error('Hands-free is unavailable on this device. Use tap to talk instead.');
          const elapsed = Date.now() - started;
          levels.push(status.metering);
          if (levels.length > 5) levels.shift();
          const threshold = heardSpeech ? Math.max(-42, speechLevel - 12) : -42;
          if (status.metering > threshold) {
            voicedMs += Math.min(200, elapsed - previous);
            if (levels.length >= 3) {
              const sorted = [...levels].sort((a, b) => a - b);
              speechLevel = Math.max(speechLevel, sorted[Math.floor(sorted.length / 2)]);
            }
            lastVoice = elapsed;
            if (voicedMs >= 300) heardSpeech = true;
          } else if (!heardSpeech) voicedMs = 0;
          previous = elapsed;
          if (heardSpeech && (elapsed - lastVoice >= 800 || elapsed >= 30000)) break;
          if (elapsed >= 30000) break;
        }
        if (!current()) break;
        if (interrupted) {
          if (++interruptions > 2) throw new Error('Microphone interrupted repeatedly. Check microphone access, then try again or use Type.');
          this.callbacks.onPhase('starting');
          this.callbacks.onRecovery('Microphone interrupted. Reconnecting…');
          await this.recorder.stop().catch(() => {});
          prepared = false;
          this.removeRecording();
          await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
          if (current()) await this.pause(600);
          continue;
        }
        this.callbacks.onPhase(heardSpeech ? 'thinking' : 'starting');
        await this.recorder.stop();
        prepared = false;
        if (!heardSpeech) {
          this.removeRecording();
          if (current()) await this.pause(350);
          continue;
        }
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        if (!current()) break;
        if (!this.recorder.uri) throw new Error('No recording available. Start the conversation again.');
        await Promise.race([this.callbacks.onTurn(this.recorder.uri, current), canceled]);
        interruptions = 0;
        this.removeRecording();
        if (current()) await this.pause(100);
      }
    } catch (error) {
      if (current()) this.callbacks.onError(error instanceof Error ? error.message : 'Conversation paused. Please try again.');
    } finally {
      this.active = false;
      if (prepared) await this.recorder.stop().catch(() => {});
      this.removeRecording();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
      if (awake) await deactivateKeepAwake(this.awakeTag).catch(() => {});
      this.cancel = null;
      this.running = false;
      this.callbacks.onActive(false);
      this.callbacks.onPhase('idle');
    }
  }

  private removeRecording() {
    if (!this.recorder.uri) return;
    try { const file = new File(this.recorder.uri); if (file.exists) file.delete(); } catch {}
  }
}
