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
