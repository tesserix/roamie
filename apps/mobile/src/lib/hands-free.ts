import { requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import { File } from 'expo-file-system';
import { stopSpeaking } from './voice';

type Recorder = {
  uri: string | null;
  prepareToRecordAsync: () => Promise<void>;
  record: () => void;
  stop: () => Promise<void>;
  getStatus: () => { isRecording: boolean; durationMillis: number; metering?: number; mediaServicesDidReset: boolean };
};
type Callbacks = {
  onTurn: (uri: string, active: () => boolean) => Promise<void>;
  onPhase: (phase: 'idle' | 'starting' | 'listening' | 'thinking') => void;
  onActive: (active: boolean) => void;
  onError: (message: string) => void;
};

export class HandsFreeConversation {
  private active = false;
  private running = false;
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
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!current()) return;
      if (!permission.granted) throw new Error('Allow microphone access in Settings, or use Type instead.');
      stopSpeaking();
      while (current()) {
        this.callbacks.onPhase('starting');
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        if (!current()) break;
        await this.recorder.prepareToRecordAsync();
        prepared = true;
        if (!current()) break;
        this.recorder.record();
        this.callbacks.onPhase('listening');
        let voicedMs = 0, lastVoice = 0, heardSpeech = false, previous = 0;
        const started = Date.now();
        while (current()) {
          await this.pause(100);
          if (!current()) break;
          const status = this.recorder.getStatus();
          if (!status.isRecording || status.mediaServicesDidReset) throw new Error('Microphone interrupted. Start the conversation again.');
          if (status.metering == null || !Number.isFinite(status.metering)) throw new Error('Hands-free is unavailable on this device. Use tap to talk instead.');
          const elapsed = Date.now() - started;
          if (status.metering > -42) {
            voicedMs += Math.min(200, elapsed - previous);
            lastVoice = elapsed;
            if (voicedMs >= 300) heardSpeech = true;
          } else if (!heardSpeech) voicedMs = 0;
          previous = elapsed;
          if (heardSpeech && (elapsed - lastVoice >= 1200 || elapsed >= 30000)) break;
          if (elapsed >= 30000) throw new Error('No speech heard. Start hands-free when you are ready.');
        }
        if (!current()) break;
        this.callbacks.onPhase('thinking');
        await this.recorder.stop();
        prepared = false;
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        if (!current()) break;
        if (!this.recorder.uri) throw new Error('No recording available. Start the conversation again.');
        await Promise.race([this.callbacks.onTurn(this.recorder.uri, current), canceled]);
        this.removeRecording();
        if (current()) await this.pause(350);
      }
    } catch (error) {
      if (current()) this.callbacks.onError(error instanceof Error ? error.message : 'Conversation paused. Please try again.');
    } finally {
      this.active = false;
      if (prepared) await this.recorder.stop().catch(() => {});
      this.removeRecording();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
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
