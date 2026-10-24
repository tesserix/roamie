import json
import logging
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from importlib.resources import files
from threading import Lock
from typing import Annotated, Self

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .body_limit import BodyLimit

LANGUAGES = json.loads(files("roamie_seamless").joinpath("languages.json").read_text())
logger = logging.getLogger(__name__)


class Translation(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")
    text: Annotated[str, Field(min_length=1, max_length=1000)] | None = None
    audio: Annotated[str, Field(min_length=1, max_length=1_300_000)] | None = None
    source_language: str | None = None
    target_language: str
    generate_speech: bool = False

    @model_validator(mode="after")
    def validate_input(self) -> Self:
        if (self.text is None) == (self.audio is None):
            raise ValueError("Provide exactly one of text or audio")
        if self.text is not None and (not self.text.strip() or self.source_language is None):
            raise ValueError("Text needs nonblank content and source_language")
        if self.source_language is not None and self.source_language not in LANGUAGES["text"]:
            raise ValueError("Unsupported source_language")
        if self.target_language not in LANGUAGES["text"]:
            raise ValueError("Unsupported target_language")
        if self.generate_speech and self.target_language not in LANGUAGES["speech"]:
            raise ValueError("Speech output is unavailable for target_language")
        return self


class TranslationResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")
    text: str
    target_language: str
    audio: str | None = None
    sample_rate: int | None = None


type Inference = Callable[[Translation], TranslationResult]


class Runtime:
    def __init__(self, inference: Inference | None = None) -> None:
        self.inference = inference
        self.lock = Lock()


def create_app(
    inference: Inference | None = None,
    *,
    lifespan: Callable[[FastAPI], AbstractAsyncContextManager[None]] | None = None,
) -> FastAPI:
    app = FastAPI(lifespan=lifespan)
    app.add_middleware(BodyLimit)
    runtime = Runtime(inference)
    app.state.runtime = runtime

    @app.get("/healthz")
    def health() -> dict[str, str]:
        return {"status": "alive"}

    @app.get("/readyz")
    def ready() -> dict[str, str]:
        if runtime.inference is None:
            raise HTTPException(503, "model_not_ready")
        return {"status": "ready"}

    @app.post("/v1/translate")
    def translate(request: Translation) -> TranslationResult:
        if runtime.inference is None:
            raise HTTPException(503, "model_not_ready")
        if not runtime.lock.acquire(blocking=False):
            raise HTTPException(429, "model_busy", headers={"Retry-After": "5"})
        try:
            return runtime.inference(request)
        except ValueError as error:
            raise HTTPException(422, "invalid_audio") from error
        except Exception as error:
            logger.exception("inference_failed")
            raise HTTPException(503, "inference_failed") from error
        finally:
            runtime.lock.release()

    return app
