# Speech detection fixtures

These AAC recordings contain synthetic travel phrases generated with macOS voices at 155 words per minute. They contain no account or personal information.

| File | Voice | Spoken source |
| --- | --- | --- |
| speech-en.m4a | Samantha | Excuse me, how do I get to the station? |
| speech-ja.m4a | Kyoko | この道をまっすぐ行って、左に曲がってください。歩いて五分くらいです。 |
| speech-hi.m4a | Lekha | क्या पार्क के पास शाकाहारी खाना मिल सकता है? |
| speech-th.m4a | Kanya | ที่นั่นมีอาหารไม่เผ็ดไหมคะ |

Tests exercise real decoding and speech detection. Translation-provider responses are controlled test doubles; these tests do not measure translation accuracy.

`short-en.m4a`, `short-ja.m4a`, `short-hi.m4a`, and `short-th.m4a` use the same voices and contain “Yes,” “はい,” “हाँ,” and “ค่ะ,” respectively. They protect short replies from overly strict speech-duration filtering.

`speaker-{sulafat,algieba}-{en,hi,or}-{0,1}.wav` are synthetic travel utterances generated with the existing Gemini 3.8 Flash TTS API on 23 October 2026. Sulafat and Algieba are preset voice labels, not real customer identities. The files contain the first three seconds resampled to mono 16 kHz, PCM16 WAV. Prompt 0 asks where the train station is and requests two tickets for tomorrow morning; prompt 1 requests water and asks the journey price, in English, Hindi or Odia. They contain no user microphone recordings or account data.

Speaker tests initialize references from Sulafat English prompt 0 and Algieba Hindi prompt 0, then evaluate prompt 1 in other languages. This separates the evaluation phrase from the reference phrase. These fixtures validate actual model inference and routing consistency for two generated voice presets; they do not establish human speaker accuracy, native pronunciation quality or universal language recognition.
