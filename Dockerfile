# 멀티스테이지 빌드를 위한 NX 모노레포 Dockerfile

# Stage 1: Base image with Node.js and Yarn
FROM node:20-slim AS base
WORKDIR /app

# 빌드 도구 설치 (네이티브 모듈 빌드용)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Yarn v4 설치 및 설정
RUN corepack enable && corepack prepare yarn@4.10.3 --activate

# Stage 2: Dependencies 설치
FROM base AS deps
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn
RUN yarn install

# Stage 3: Build stage (backend only)
# frontend는 Vercel에서 자체 빌드하므로 제외
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# workspace symlink이 deps 스테이지의 절대경로를 가리키므로 재생성 필요
RUN yarn install

# NX 캐시 클리어 및 빌드
RUN npx nx reset
RUN NX_DAEMON=false npx nx sync
RUN NX_DAEMON=false npx nx build backend --prod

# Stage 4: Production dependencies
FROM base AS prod-deps
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn
RUN yarn workspaces focus --production

# Stage 5: Backend production image
FROM node:20-slim AS backend-prod
WORKDIR /app

# 보안을 위한 non-root 사용자 생성
RUN groupadd -r nodejs && useradd -r -g nodejs nestjs

# curl 설치 (healthcheck용)
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# 필요한 파일들 복사
COPY --from=prod-deps --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/backend/dist ./backend/dist
COPY --from=builder --chown=nestjs:nodejs /app/shared ./shared

# multer DiskStorage가 부팅 시 mkdir './uploads' 호출 → /app은 root 소유라 권한 부여 필요
RUN mkdir -p /app/uploads && chown nestjs:nodejs /app/uploads

# 배포 버전 식별: 빌드 시 --build-arg GIT_SHA=$(git rev-parse --short HEAD) 로 주입.
# /v1/health 가 version 으로 노출한다. 미주입 시 'unknown'.
ARG GIT_SHA=unknown
ENV APP_VERSION=${GIT_SHA}

USER nestjs
EXPOSE 4000
CMD ["node", "backend/dist/main.js"]

# 주의: backend-prod가 마지막 stage여야 함.
# --target 없이 docker build 시 마지막 stage가 빌드되므로 development stage를 두면 안 됨.
# 개발용 빌드는 Dockerfile.dev 또는 docker-compose.dev.yaml 사용.
