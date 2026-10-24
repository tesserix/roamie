import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

import numpy as np
import pytest

from roamie_seamless.api import Translation
from roamie_seamless.audio import decode_audio, encode_audio
from roamie_seamless.model import MODEL_REVISION, load_model


def test_transformers_outputs_are_decoded_for_text_and_audio(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    torch = MagicMock()
    transformers = MagicMock()
    monkeypatch.setitem(sys.modules, "torch", torch)
    monkeypatch.setitem(sys.modules, "transformers", transformers)
    processor = transformers.AutoProcessor.from_pretrained.return_value
    processor.return_value = {"input_ids": [1, 2]}
    processor.decode.return_value = "Bonjour"
    loaded = transformers.SeamlessM4Tv2Model.from_pretrained.return_value
    model = loaded.to.return_value.eval.return_value
    sequence = MagicMock()
    sequence.tolist.return_value = [1, 2, 3]
    waveform = MagicMock()
    samples = waveform.__getitem__.return_value.detach.return_value.cpu.return_value
    samples.float.return_value.numpy.return_value = np.zeros(100, dtype=np.float32)
    model.generate.return_value = SimpleNamespace(
        sequences=[sequence],
        waveform_lengths=[100],
        waveform=waveform,
    )
    infer = load_model()
    result = infer(Translation(text="Hello", source_language="eng", target_language="fra"))
    assert result.text == "Bonjour"
    assert result.audio is None
    processor.decode.assert_called_with([1, 2, 3], skip_special_tokens=True)
    result = infer(
        Translation(
            audio=encode_audio(np.zeros(100, dtype=np.float32), 16000),
            target_language="fra",
            generate_speech=True,
        )
    )
    assert result.audio is not None
    assert len(decode_audio(result.audio)) == 100
    assert result.sample_rate == 16000
    assert model.generate.call_args.kwargs["generate_speech"] is True
    assert (
        transformers.SeamlessM4Tv2Model.from_pretrained.call_args.kwargs["revision"]
        == MODEL_REVISION
    )
