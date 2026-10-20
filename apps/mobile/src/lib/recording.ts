import { RecordingPresets } from 'expo-audio';

export const SPEECH_RECORDING = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
  numberOfChannels: 1,
  bitRate: 64000,
  web: { ...RecordingPresets.HIGH_QUALITY.web, bitsPerSecond: 64000 },
};
