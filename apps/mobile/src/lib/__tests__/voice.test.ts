import { describe, expect, it, jest } from '@jest/globals';

import { pickVoice } from '../voice';

// Hoisted above the import by babel-jest.
jest.mock('expo-speech', () => ({ VoiceQuality: { Default: 'Default', Enhanced: 'Enhanced' } }));

const v = (identifier: string, language: string, quality = 'Default') => ({ identifier, name: identifier, language, quality });

describe('pickVoice', () => {
  const voices = [
    v('com.apple.voice.compact.th-TH.Kanya', 'th-TH'),
    v('com.apple.voice.enhanced.th-TH.Kanya', 'th-TH', 'Enhanced'),
    v('com.apple.voice.premium.en-US.Zoe', 'en-US', 'Enhanced'),
    v('com.apple.voice.enhanced.en-GB.Serena', 'en-GB', 'Enhanced'),
    v('com.apple.eloquence.en-US.Rocko', 'en-US'),
    v('com.apple.voice.compact.ja-JP.Kyoko', 'ja-JP'),
  ] as never[];

  it.each([
    ['prefers enhanced over compact', 'th', undefined, 'com.apple.voice.enhanced.th-TH.Kanya'],
    ['prefers premium over enhanced', 'en', undefined, 'com.apple.voice.premium.en-US.Zoe'],
    ['prefers the device region', 'en', 'GB', 'com.apple.voice.enhanced.en-GB.Serena'],
    ['falls back to the only voice', 'ja', undefined, 'com.apple.voice.compact.ja-JP.Kyoko'],
    ['none for an unknown language', 'km', undefined, undefined],
  ])('%s', (_, lang, region, want) => {
    expect(pickVoice(voices, lang, region)).toBe(want);
  });

  it('never picks novelty eloquence voices over a real one', () => {
    const only = [v('com.apple.eloquence.en-US.Rocko', 'en-US'), v('com.apple.voice.compact.en-US.Samantha', 'en-US')] as never[];
    expect(pickVoice(only, 'en')).toBe('com.apple.voice.compact.en-US.Samantha');
  });
});
