# Speech gate model

`silero-vad-v6.2.onnx` is the unmodified Silero VAD v6.2 model, licensed under the accompanying MIT license.

Source: https://github.com/snakers4/silero-vad/blob/v6.2/src/silero_vad/data/silero_vad.onnx

SHA-256: `1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3`

The model is embedded in the API binary. Audio is decoded to mono 16 kHz PCM, then checked in 512-sample frames with recurrent state reset for each recording. Three consecutive frames with speech probability at least 0.5 are required before a recording reaches the translation model. This admits short replies while rejecting the captured non-speech clips that previously produced invented turns.

Processing accepts at most 2 MiB of encoded audio and one minute of decoded audio. Decoding has a three-second timeout, a restricted pipe protocol, and a bounded output buffer. Two processing slots limit concurrent decoding and inference. Inference retains its slot if a caller cancels. Startup validates the model runtime before serving health checks.

FFmpeg and ONNX Runtime are required in the runtime image. The CI media job installs FFmpeg and runs the full API suite with `RUSTFLAGS='--cfg media_tests'`, including real decoding, full phrases, short replies, and non-speech rejection. These checks do not identify intended speakers or suppress unrelated background conversations.

## Session speaker embeddings

`wespeaker-resnet34-lm.onnx` is the float ONNX conversion of WeSpeaker ResNet34-LM for VoxCeleb, distributed by the ONNX Community from the pyannote/WeSpeaker model. Attribution: the WeSpeaker contributors, pyannote model contributors and ONNX Community conversion contributors. Original model: https://huggingface.co/pyannote/wespeaker-voxceleb-resnet34-LM . Conversion: https://huggingface.co/onnx-community/wespeaker-voxceleb-resnet34-LM .

The weights are licensed under [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/); the full licence is in `LICENSE.wespeaker`. The weights are unmodified. Revision, file path and SHA-256 are pinned in `wespeaker-source.json`. SHA-256: `3955447b0499dc9e0a4541a895df08b03c69098eba4e56c02b5603e9f7f4fcbb`.

The model is embedded in the API binary; it is not downloaded at runtime. Its input is mean-centred 80-bin Kaldi filterbank features at 16 kHz, 25 ms frame length, 10 ms frame shift, Hamming window and zero dither. A maximum three-second window is used, with at least two seconds of recording and sufficient non-silent frames. Short clips do not create speaker references. The float model is used because the evaluated int8 graph's ConvInteger operator was unavailable on the development Mac runtime.

Embeddings are 256 normalized floats. An active hands-free session can provide at most two references per side. With two known sides, a match requires similarity at least 0.4 and a margin at least 0.2; with only one side learned, similarity must be at least 0.65. These thresholds are conservative routing gates supported by the supplied synthetic fixtures, not biometric identity guarantees or proof for every real voice. Low-evidence new-language turns ask for clarification. See ADR-0023 for retention, compatibility, cost and remaining acceptance requirements.
