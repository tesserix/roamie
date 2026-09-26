ARG RUST_BUILDER=rust:1.97-slim-bookworm@sha256:2775a09d208ff0d7c1f50490c45b62db929e87ba1dcbc3f2132ac71a704bcdd3
ARG TESSERIX_RUNTIME=ghcr.io/tesserix/base-debian-runtime:20260919@sha256:0d23c4cc3f5be86a1a20207828340a76de1e45bbc4cdc86ccfac2c74e565ee79

FROM ${RUST_BUILDER} AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY services ./services
RUN cargo build --locked --release -p roamie-api --bin roamie-api

FROM ${TESSERIX_RUNTIME}
# Memory videos are rendered with ffmpeg and captioned with DejaVu Sans.
USER root
RUN apt-get update \
    && apt-get install --no-install-recommends -y ffmpeg fonts-dejavu-core \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/*
USER 10001:10001
COPY --from=build --chown=10001:10001 /src/target/release/roamie-api /app/roamie-api
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--", "/app/roamie-api"]
