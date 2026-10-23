import {requireOptionalNativeModule} from 'expo';
import type {RecordingOptions} from 'expo-audio';

type Status = {isRecording: boolean; durationMillis: number; metering?: number; speech?: boolean; mediaServicesDidReset: boolean};
type Recorder = {uri: string | null; prepareToRecordAsync(options: RecordingOptions): Promise<void>; record(): void; stop(): Promise<void>; getStatus(): Status};
type Frame = {id: string; speech?: boolean; metering: number; error?: string};
type NativeCapture = {speechDetection: boolean; startCapture(id: string): Promise<void>; stopCapture(): Promise<{uri: string}>; addListener(event: 'pcm', listener: (frame: Frame) => void): {remove(): void}};
let sequence = 0;

export class SpeechRecorder implements Recorder {
  private native: NativeCapture | null = null;
  private subscription: {remove(): void} | null = null;
  private starting: Promise<void> = Promise.resolve();
  private id = '';
  private recording = false;
  private failed = false;
  private started = 0;
  private level = -160;
  private speech = false;
  private file: string | null = null;

  constructor(private legacy: Recorder) {}
  get uri() { return this.native ? this.file : this.legacy.uri; }
  get mimeType() { return this.native ? 'audio/wav' : 'audio/mp4'; }

  async prepareToRecordAsync(options: RecordingOptions) {
    this.subscription?.remove(); this.subscription = null;
    const native = requireOptionalNativeModule<NativeCapture>('RoamieCapture');
    this.native = native?.speechDetection ? native : null;
    if (!this.native) { await this.legacy.prepareToRecordAsync(options); return; }
    this.id = String(++sequence); this.file = null; this.failed = false; this.level = -160; this.speech = false;
    const id = this.id;
    this.subscription = this.native.addListener('pcm', frame => {
      if (frame.id !== id || !this.recording) return;
      if (frame.error) { this.failed = true; return; }
      this.level = frame.metering;
      this.speech = frame.speech === true;
    });
  }

  record() {
    if (!this.native) { this.legacy.record(); return; }
    this.recording = true; this.started = Date.now();
    this.starting = this.native.startCapture(this.id).catch(() => { this.failed = true; });
    return this.starting.then(() => {
      if (this.failed) throw new Error('Microphone could not start. Please try again.');
    });
  }

  async stop() {
    if (!this.native) { await this.legacy.stop(); return; }
    this.recording = false;
    try {
      await this.starting;
      this.file = (await this.native.stopCapture()).uri;
    } finally { this.subscription?.remove(); this.subscription = null; }
  }

  getStatus(): Status {
    return this.native ? {isRecording: this.recording && !this.failed, durationMillis: Date.now() - this.started, metering: this.level, speech: this.speech, mediaServicesDidReset: this.failed} : this.legacy.getStatus();
  }
}
