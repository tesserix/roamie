# Speech gate model

`silero-vad-v6.2.onnx` is the unmodified Silero VAD v6.2 model, licensed under the accompanying MIT license.

Source: https://github.com/snakers4/silero-vad/blob/v6.2/src/silero_vad/data/silero_vad.onnx

SHA-256: `1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3`

The model is embedded in the API binary. Audio is decoded to mono 16 kHz PCM, then checked in 512-sample frames with recurrent state reset for each recording. Three consecutive frames with speech probability at least 0.5 are required before a recording reaches the translation model. This admits short replies while rejecting the captured non-speech clips that previously produced invented turns.

Processing accepts at most 2 MiB of encoded audio and one minute of decoded audio. Decoding has a three-second timeout, a restricted pipe protocol, and a bounded output buffer. Two processing slots limit concurrent decoding and inference. Inference retains its slot if a caller cancels. Startup validates the model runtime before serving health checks.

FFmpeg and ONNX Runtime are required in the runtime image. The CI media job installs FFmpeg and runs the full API suite with `RUSTFLAGS='--cfg media_tests'`, including real decoding, full phrases, short replies, and non-speech rejection. These checks do not identify intended speakers or suppress unrelated background conversations.
