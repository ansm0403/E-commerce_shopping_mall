# Build pgvector on the exact PostgreSQL image a data directory already runs on (same minor version, libc, collation).
# Default: the PostgreSQL 18.3 Alpine image of the local search probe DB.
# Production (PostgreSQL 18.6, 2026-10-14):
#   docker build --build-arg POSTGRES_IMAGE=postgres:18-alpine@sha256:d3e1620b530c944afa6e887d22eb899824da68e19c52024bf98f5220c88a65b2 #     --build-arg LLVM_VERSION=21 -t ansmoon/postgres-vector:18.6-0.8.7 docker/postgres-vector
# LLVM_VERSION must match the base image's JIT toolchain: `pg_config --configure` shows CLANG=clang-<N>.
ARG POSTGRES_IMAGE=postgres:18-alpine@sha256:52098013b4b64a746626437d38afc03cabff6cdeb4d3d92e2342aa95f0ce56ea
FROM ${POSTGRES_IMAGE} AS builder

ARG PGVECTOR_VERSION=0.8.7
ARG LLVM_VERSION=19
RUN apk add --no-cache build-base "clang${LLVM_VERSION}" "llvm${LLVM_VERSION}-dev" git \
    && git clone --depth 1 --branch "v${PGVECTOR_VERSION}" https://github.com/pgvector/pgvector.git /tmp/pgvector \
    && make -C /tmp/pgvector OPTFLAGS="" \
    && make -C /tmp/pgvector install DESTDIR=/opt/pgvector

FROM ${POSTGRES_IMAGE}
COPY --from=builder /opt/pgvector/usr/local/ /usr/local/
LABEL org.opencontainers.image.description="PostgreSQL 18 Alpine (base pinned by POSTGRES_IMAGE) with pgvector 0.8.7"
