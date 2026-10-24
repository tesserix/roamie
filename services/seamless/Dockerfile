# syntax=docker/dockerfile:1.18
FROM ghcr.io/astral-sh/uv:0.12.5@sha256:e85be844203885286c60ffad8a858d48afb6c5a5c237ca0e67f12e74b8f174b1 AS uv
FROM python:3.12-slim-bookworm@sha256:6a0e06f5ba0b373d051aabd3fffb9b873f27f9a2a3a14bcbe37dee6f0e3bbc70 AS builder
COPY --from=uv /uv /bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY src ./src
RUN uv sync --frozen --extra model --no-dev --no-editable
FROM python:3.12-slim-bookworm@sha256:6a0e06f5ba0b373d051aabd3fffb9b873f27f9a2a3a14bcbe37dee6f0e3bbc70
WORKDIR /app
COPY --from=builder --chown=10001:10001 /app/.venv /app/.venv
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HF_HOME=/cache/huggingface OMP_NUM_THREADS=6 TOKENIZERS_PARALLELISM=false
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["/app/.venv/bin/python", "-m", "roamie_seamless.main"]
