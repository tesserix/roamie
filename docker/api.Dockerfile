# syntax=docker/dockerfile:1.18
ARG RUST_BUILDER=rust:1.97-slim-bookworm@sha256:2775a09d208ff0d7c1f50490c45b62db929e87ba1dcbc3f2132ac71a704bcdd3
ARG TESSERIX_RUNTIME=ghcr.io/tesserix/base-debian-runtime:20261017@sha256:5788bfc1e9bc4763484c875dcabcd972c7db8d16aecb9e1d58e40441ea60879a

FROM ${RUST_BUILDER} AS build
RUN apt-get update \
    && apt-get install --no-install-recommends -y pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY services/api ./services/api
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/src/target \
    cargo build --locked --release -p roamie-api --bin roamie-api \
    && mkdir -p /out \
    && cp target/release/roamie-api /out/roamie-api \
    && cp -P target/release/libonnxruntime*.so* /out/

FROM ${TESSERIX_RUNTIME}
# Memory videos are rendered with ffmpeg and captioned with DejaVu Sans.
USER root
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install --no-install-recommends -y ffmpeg fonts-dejavu-core \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/*
USER 10001:10001
COPY --from=build --chown=10001:10001 /out/ /app/
ENV LD_LIBRARY_PATH=/app
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--", "/app/roamie-api"]
