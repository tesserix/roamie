# syntax=docker/dockerfile:1.18@sha256:dabfc0969b935b2080555ace70ee69a5261af8a8f1b4df97b9e7fbcf6722eddf
FROM ghcr.io/astral-sh/uv:0.12.5@sha256:e85be844203885286c60ffad8a858d48afb6c5a5c237ca0e67f12e74b8f174b1 AS uv
FROM python:3.14-alpine@sha256:f6a589d43c42b9e7f7dc67a12d37132491f362859a5d750607710cc56da3bc72 AS builder
USER root
COPY --from=uv /uv /bin/uv
ENV UV_PROJECT_ENVIRONMENT=/app/.venv
WORKDIR /app
COPY pyproject.toml uv.lock LICENSE README.md ./
COPY src ./src
RUN uv sync --frozen --no-dev --no-editable
FROM python:3.14-alpine@sha256:f6a589d43c42b9e7f7dc67a12d37132491f362859a5d750607710cc56da3bc72
RUN python -m pip uninstall --yes pip && \
    python -c "import shutil,sysconfig; from pathlib import Path; shutil.rmtree(Path(sysconfig.get_path('stdlib')) / 'ensurepip')"
WORKDIR /app
COPY --from=builder --chown=10001:10001 /app/.venv /app/.venv
USER 10001:10001
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
EXPOSE 8080
ENTRYPOINT ["/app/.venv/bin/python", "-m", "expedia_recommendations_mcp.main"]
