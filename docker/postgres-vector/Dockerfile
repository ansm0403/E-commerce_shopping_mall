# Match the PostgreSQL 18.3 Alpine image observed locally, including libc/collation.
FROM postgres:18-alpine@sha256:52098013b4b64a746626437d38afc03cabff6cdeb4d3d92e2342aa95f0ce56ea AS builder

ARG PGVECTOR_VERSION=0.8.7
RUN apk add --no-cache build-base clang19 llvm19-dev git \
    && git clone --depth 1 --branch "v${PGVECTOR_VERSION}" https://github.com/pgvector/pgvector.git /tmp/pgvector \
    && make -C /tmp/pgvector OPTFLAGS="" \
    && make -C /tmp/pgvector install DESTDIR=/opt/pgvector

FROM postgres:18-alpine@sha256:52098013b4b64a746626437d38afc03cabff6cdeb4d3d92e2342aa95f0ce56ea
COPY --from=builder /opt/pgvector/usr/local/ /usr/local/
LABEL org.opencontainers.image.description="PostgreSQL 18.3 Alpine with pgvector 0.8.7"
