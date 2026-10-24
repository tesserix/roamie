import importlib

from pydantic_settings import BaseSettings, SettingsConfigDict

from .api import Inference, Translation, TranslationResult
from .audio import decode_audio, encode_audio

MODEL_ID = "facebook/seamless-m4t-v2-large"
MODEL_REVISION = "5f8cc790b19fc3f67a61c105133b20b34e3dcb76"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SEAMLESS_", frozen=True, extra="forbid")
    threads: int = 6


def load_model() -> Inference:
    torch = importlib.import_module("torch")
    transformers = importlib.import_module("transformers")
    settings = Settings()
    torch.set_num_threads(settings.threads)
    torch.set_num_interop_threads(1)
    processor = transformers.AutoProcessor.from_pretrained(
        MODEL_ID,
        revision=MODEL_REVISION,
        trust_remote_code=False,
    )
    model = (
        transformers.SeamlessM4Tv2Model.from_pretrained(
            MODEL_ID,
            revision=MODEL_REVISION,
            torch_dtype=torch.float32,
            low_cpu_mem_usage=True,
            use_safetensors=True,
            trust_remote_code=False,
        )
        .to("cpu")
        .eval()
    )

    def infer(request: Translation) -> TranslationResult:
        if request.text is not None:
            inputs = processor(
                text=request.text,
                src_lang=request.source_language,
                return_tensors="pt",
            )
        else:
            if request.audio is None:
                raise ValueError("Audio required")
            inputs = processor(
                audios=decode_audio(request.audio),
                sampling_rate=16000,
                return_tensors="pt",
            )
        with torch.inference_mode():
            result = model.generate(
                **inputs,
                tgt_lang=request.target_language,
                generate_speech=request.generate_speech,
                return_intermediate_token_ids=request.generate_speech,
                text_max_new_tokens=256,
                text_num_beams=1,
                text_do_sample=False,
                speech_do_sample=False,
            )
        if request.generate_speech:
            text = processor.decode(result.sequences[0].tolist(), skip_special_tokens=True)
            length = int(result.waveform_lengths[0])
            samples = result.waveform[0, :length].detach().cpu().float().numpy()
            return TranslationResult(
                text=text,
                target_language=request.target_language,
                audio=encode_audio(samples, 16000),
                sample_rate=16000,
            )
        return TranslationResult(
            text=processor.decode(result.sequences[0].tolist(), skip_special_tokens=True),
            target_language=request.target_language,
        )

    return infer
