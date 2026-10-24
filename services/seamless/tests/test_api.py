from fastapi.testclient import TestClient

from roamie_seamless.api import create_app


def test_health_is_live_but_translation_is_unready_without_model() -> None:
    client = TestClient(create_app())
    assert client.get("/healthz").status_code == 200
    assert client.get("/readyz").status_code == 503
    response = client.post(
        "/v1/translate",
        json={
            "text": "Hello",
            "source_language": "eng",
            "target_language": "fra",
        },
    )
    assert response.status_code == 503


def test_ready_model_translates_text_and_rejects_invalid_requests() -> None:
    from roamie_seamless.api import Translation, TranslationResult

    calls: list[Translation] = []

    def model(request: Translation) -> TranslationResult:
        calls.append(request)
        return TranslationResult(text="Bonjour", target_language="fra")

    client = TestClient(create_app(model))
    assert client.get("/readyz").status_code == 200
    payload = {"text": "Hello", "source_language": "eng", "target_language": "fra"}
    response = client.post("/v1/translate", json=payload)
    assert response.status_code == 200
    assert response.json()["text"] == "Bonjour"
    assert len(calls) == 1
    for invalid in [
        {**payload, "text": " "},
        {**payload, "text": "a" * 1001},
        {**payload, "target_language": "invalid"},
        {**payload, "source_language": None},
        {**payload, "audio": "AAAA"},
        {**payload, "model": "other"},
        {**payload, "target_language": "ory", "generate_speech": True},
    ]:
        assert client.post("/v1/translate", json=invalid).status_code == 422
    assert len(calls) == 1


def test_overload_is_rejected_and_failed_inference_releases_capacity() -> None:
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from roamie_seamless.api import Translation, TranslationResult

    started, finish = Event(), Event()

    def model(request: Translation) -> TranslationResult:
        started.set()
        assert finish.wait(5)
        raise RuntimeError("private model details")

    client = TestClient(create_app(model))
    payload = {"text": "Hello", "source_language": "eng", "target_language": "fra"}
    with ThreadPoolExecutor() as executor:
        first = executor.submit(client.post, "/v1/translate", json=payload)
        try:
            assert started.wait(5)
            assert client.get("/healthz").status_code == 200
            assert client.post("/v1/translate", json=payload).status_code == 429
        finally:
            finish.set()
        response = first.result()
    assert response.status_code == 503
    assert "private" not in response.text
    assert client.post("/v1/translate", json=payload).status_code == 503


def test_oversized_http_body_is_rejected_before_json_parsing() -> None:
    client = TestClient(create_app())
    response = client.post("/v1/translate", content=b"x" * 1_400_001)
    assert response.status_code == 413
