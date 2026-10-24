import base64
import binascii
import io
import wave

import numpy as np
from numpy.typing import NDArray


def decode_audio(value: str) -> NDArray[np.float32]:
    try:
        raw = base64.b64decode(value, validate=True)
        with wave.open(io.BytesIO(raw), "rb") as wav:
            frames = wav.getnframes()
            if (
                wav.getnchannels() != 1
                or wav.getsampwidth() != 2
                or wav.getframerate() != 16000
                or not 1 <= frames <= 480000
            ):
                raise ValueError("Expected 16kHz mono PCM16 WAV, maximum 30 seconds")
            samples = wav.readframes(frames)
            if len(samples) != frames * 2:
                raise ValueError("Truncated audio")
    except (binascii.Error, wave.Error, EOFError) as error:
        raise ValueError("Invalid WAV audio") from error
    return np.frombuffer(samples, dtype="<i2").astype(np.float32) / 32768.0


def encode_audio(samples: NDArray[np.float32], sample_rate: int) -> str:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setparams((1, 2, sample_rate, 0, "NONE", "not compressed"))
        wav.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
    return base64.b64encode(buffer.getvalue()).decode("ascii")
