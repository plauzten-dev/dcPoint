# syntax=docker/dockerfile:1.7
FROM rust:1-slim-bookworm AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY migrations migrations
COPY src src
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release --locked --bin dcpoint-server && cp target/release/dcpoint-server /dcpoint-server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY --from=build /dcpoint-server /usr/local/bin/dcpoint-server
USER 10001
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s CMD curl -fsS http://127.0.0.1:8080/api/v1/health || exit 1
CMD ["dcpoint-server"]
