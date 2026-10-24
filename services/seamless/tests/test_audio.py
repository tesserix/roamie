import base64
import io
import wave

import numpy as np
import pytest

from roamie_seamless.audio import decode_audio, encode_audio


def test_audio_roundtrips_and_rejects_wrong_format_and_long_clips() -> None:
    audio = np.array([0.0, 0.25, -0.25], dtype=np.float32)
    np.testing.assert_allclose(decode_audio(encode_audio(audio, 16000)), audio, atol=0.0001)
    for invalid in ["not base64!", base64.b64encode(b"not wav").decode()]:
        with pytest.raises(ValueError):
            decode_audio(invalid)
    for rate, frames in [(8000, 100), (16000, 480001), (16000, 0)]:
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav:
            wav.setparams((1, 2, rate, 0, "NONE", "not compressed"))
            wav.writeframes(b"\x00\x00" * frames)
        with pytest.raises(ValueError):
            decode_audio(base64.b64encode(buffer.getvalue()).decode())
