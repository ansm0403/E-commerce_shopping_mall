# [Claude 웹에 붙여 넣을 프롬프트] nginx 리버스 프록시 도입 과정 공부하기

> 아래 `---` 구분선 밑 전체를 복사해서 claude.ai 새 대화에 붙여 넣으면 된다.
> (이 파일은 학습 보조용. 저장소 동작과 무관하며 나중에 지워도 된다.)

---

# 역할과 진행 방식 (가장 먼저 읽어라)

너는 **인내심 많은 1:1 튜터**다. 나는 이 대화에서 아래 "학습 자료"에 적힌 내용을 **처음부터 끝까지 이해**하고 싶다.

## 나에 대해
- 신입 백엔드 개발자. 아래 프로젝트는 내 포트폴리오 겸 실서비스다.
- **nginx·TLS·DNS·리버스 프록시 실무 경험이 전혀 없다.** Docker/Docker Compose는 얕게만 써 봤다.
- 학습 자료에 나오는 용어 중 상당수가 낯설다. 예를 들어 `upstream`, `proxy_pass`, `X-Forwarded-For`, `trust proxy`, `certbot`, `webroot`, `HTTP-01`, `HSTS preload`, `A레코드`, `탄력적 IP`, `보안그룹`, `SSE`, `:ro 바인드`, `--force-recreate`, `external 네트워크`, `sameSite lax`, `CSP`, `BFF`, `egress`, `홉(hop)`, `심링크`, `사이드카` 같은 단어는 **나올 때마다 반드시 설명**해 달라.
- 이 학습 자료는 원래 다른 AI 에이전트(저장소를 직접 읽을 수 있는 코딩 도구)에게 넘기려고 쓴 "인수인계 문서"라서, 압축된 표현과 결정 번호(결정 1~16)로 가득하다. 너는 저장소를 직접 볼 수 없으니, 내가 아래에 **실제 파일 내용을 그대로 붙여 넣었다.** 그걸 근거로 설명해라.

## 진행 규칙 (반드시 지켜라)
1. **한 번에 한 주제만.** 아래 "학습 커리큘럼" 순서대로, 주제 하나를 설명하고 끝에 **이해 확인 질문 1~2개**를 던진 뒤 내 답을 기다려라. 내가 "다음"이라고 하기 전에는 다음 주제로 넘어가지 마라.
2. **아주 자세하게, 쉬운 말로.** 비유를 써도 좋다. 단, 비유로 끝내지 말고 실제 동작(요청이 어디로 가고, 어떤 프로그램이 무엇을 읽는지)까지 내려가라.
3. **일반론 금지, 항상 이 프로젝트의 실제 파일과 짝지어라.** "nginx는 리버스 프록시입니다"로 끝내지 말고, "그래서 아래 `default.conf`의 이 줄이 이런 뜻이다"로 연결해라.
4. **모르는 단어는 처음 등장할 때 괄호나 짧은 문단으로 정의**해라. 정의 없이 넘어가면 나는 막힌다.
5. 학습 자료에 "확정 결정"이라고 적힌 것은 이미 내가 결정한 것이다. **더 좋은 대안을 제안하지 말고**, "왜 그렇게 결정했는지"를 이해시키는 데 집중해라. (대안 비교가 이해에 도움 되면 짧게만.)
6. 확실하지 않은 사실(예: 특정 nginx 지시어의 기본값)은 "확실하지 않다"고 말해라. 지어내지 마라.
7. 각 주제가 끝나면 **"한 줄 요약"**을 남기고, 전체가 끝나면 마지막에 **전체 용어 사전**을 정리해 줘라.

## 학습 커리큘럼 (이 순서로)
1. **큰 그림**: 지금 서비스가 어떻게 배포돼 있고(브라우저→Vercel→EC2), 왜 nginx를 넣으려는지
2. **리버스 프록시란**: nginx 설정 파일 `default.conf`를 한 줄씩 해부 (`upstream`, `server`, `listen`, `location`, `proxy_pass` 뒤 슬래시 유무, `client_max_body_size`)
3. **프록시 뒤에서 "진짜 손님 IP"를 아는 법**: `proxy_set_header` 3종, `X-Forwarded-For`, Express의 `trust proxy`, 그리고 왜 운영에서 "AWS IP 40여 종"이 로그인 레이트리밋 키에 찍히는 버그가 생겼는지
4. **SSE 스트리밍과 프록시**: `X-Accel-Buffering: no`, `proxy_read_timeout`이 왜 필요한지
5. **Docker Compose 미니어처**: 연습용 compose 파일을 한 줄씩 (`ports`, `volumes`의 `:ro`, `env_file`, `environment` 덮어쓰기, `depends_on` + `healthcheck`, `external` 네트워크, 왜 backend를 `nx serve`가 아니라 컨테이너로 돌렸는지)
6. **502 함정**: nginx가 컨테이너 이름을 IP로 바꾸는 시점, `--force-recreate`, `nginx -t && nginx -s reload`가 왜 배포 마지막에 필수인지
7. **도메인·DNS**: `ansmoon.dev`, A레코드, 탄력적 IP, Cloudflare "DNS only(회색 구름)"가 왜 필수인지
8. **HTTPS·certbot**: Let's Encrypt, HTTP-01 검증, webroot 방식, "80 전용 nginx로 먼저 발급 → 443 추가" 닭-달걀 문제, 인증서 디렉터리 통째 마운트, 갱신 사이드카
9. **`.dev` HSTS preload**: 왜 브라우저로 http 검증이 안 되고 curl로 해야 하는지
10. **안전한 전환 6단계**: "추가 먼저 → 검증 → 전환 → 관찰 → 옛 문 폐쇄"가 왜 맞는 순서인지, Vercel `API_PROXY_TARGET`이 빌드 시점에 읽히는 함정, 보안그룹에서 4000 닫기
11. **(심화) trust proxy 홉 수와 XFF 위조**: hops=1 vs 2의 차이, 왜 최종적으로 "XFF 정규화 + trust 영구 1"을 택했는지

---

# 프로젝트 배경 (너는 저장소를 못 보니 여기서 파악해라)

- **풀스택 쇼핑몰** 모노레포(Nx + Yarn). 백엔드 **NestJS 11**(Express 기반) + TypeORM + PostgreSQL 18 + Redis. 프론트 **Next.js App Router**.
- **배포 형상(현재)**:
  - 프론트: **Vercel**
  - 백엔드: **AWS EC2 한 대**에서 `docker compose`로 postgres + redis + backend 3개 컨테이너. 백엔드는 **4000 포트를 인터넷에 그대로 노출**하고 있고, **HTTPS 없음(평문 HTTP)**.
  - 브라우저는 EC2를 직접 부르지 않는다. Next.js `rewrites` 기능으로 `https://<vercel도메인>/api/...` 요청을 Vercel 서버가 대신 `http://<EC2 IP>:4000/v1/...`로 넘긴다(서버사이드 프록시). 그래서 브라우저 입장에서 API는 "같은 오리진".
- 백엔드 글로벌 prefix는 `/v1`. 상품 이미지는 `/uploads/*`로 prefix 없이 정적 서빙. 헬스체크 `GET /v1/health`가 배포된 커밋 해시(`version`)를 돌려준다.
- 로그인 레이트리밋: Redis 키 `login:${ip}`로 IP당 10회/5분. 이 `ip`가 프록시 뒤에서 잘못 잡히면 **전 세계 사용자가 키를 공유**하게 된다(실제로 그렇게 됐다. 아래 참고).
- 관리자 AI 어시스턴트가 **SSE(Server-Sent Events)**로 LLM 답변을 스트리밍한다. 경로 `POST /v1/admin/assistant/stream`.

## 왜 nginx를 넣는가 (한 줄)
다음 트랙인 **React Native 앱**은 Vercel rewrites를 못 쓰고 백엔드에 직접 붙는데, iOS/Android가 평문 HTTP를 기본 차단하므로 **백엔드 HTTPS가 앱 개발의 선행조건**이다. 부수 효과로 "4000 포트 전세계 공개"와 "Vercel→EC2 평문 구간"도 해소된다.

---

# 실제 파일들 (설명할 때 이걸 인용해라)

## 파일 1. `nginx/conf.d/default.conf` — 이번에 만든 nginx 설정 (운영에 그대로 갈 파일)

```nginx
# nginx 리버스 프록시 설정 — 결정 3·4·5 반영 (로컬 연습 = 운영과 동일 형상, TLS만 없음)
# 운영 배포 시 이 파일이 그대로 /etc/nginx/conf.d/default.conf 로 :ro 바인드된다(결정 7).

# upstream 별명: "backend_api" = compose 서비스명 backend 의 4000 포트.
# ⚠ nginx 는 시작 시 backend → IP 를 1회만 해석해 영구 캐시한다.
#    backend 재생성으로 IP 가 바뀌면 reload 전까지 502 (결정 8 — 실험 3에서 재현).
upstream backend_api {
    server backend:4000;
}

server {
    listen 80;
    server_name localhost;

    # 상품 이미지 업로드가 기본 1m 제한에 걸려 413 나는 것 방지 (결정 5)
    client_max_body_size 10m;

    location / {
        # 경로 뒤 슬래시 없음 = URI 무변경 통과 → /v1/* 과 /uploads/* 둘 다 커버 (결정 3)
        proxy_pass http://backend_api;

        # 프록시 뒤 백엔드가 원래 요청 정보를 알 수 있게 하는 3종 세트 (결정 4)
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE(LLM 스트리밍)가 첫 토큰 전에 기본 60s 로 끊기는 것 방지 (결정 5)
        # proxy_buffering off 는 불필요 — 백엔드가 X-Accel-Buffering: no 를 이미 보냄
        proxy_read_timeout 300s;
    }
}
```

## 파일 2. `docker-compose.nginx-practice.yaml` — 로컬 연습 전용 compose (운영 미니어처)

```yaml
# ⚠ nginx 로컬 연습 전용(E 주제 2) — 연습 종료 후 삭제해도 되는 파일.
# 운영 미니어처: nginx(호스트 8080→80) → backend(운영 이미지) → 기존 로컬 postgres/redis 재사용.
# 실행: docker compose -f docker-compose.nginx-practice.yaml up -d

name: nginx-practice

services:
  nginx:
    image: nginx:alpine
    ports:
      - "8080:80"            # 호스트 8080 (윈도우 80 충돌 회피). 운영에선 80/443
    volumes:
      # 결정 7: nginx.conf 통째 교체가 아니라 conf.d/default.conf 만 :ro 바인드
      - ./nginx/conf.d/default.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      backend:
        condition: service_healthy   # backend 이름이 해석 가능해진 뒤에 nginx 시작

  backend:
    image: ansmoon/shopping-mall-backend:latest   # EC2에 올라간 것과 같은 08-19 빌드(247a93a)
    ports:
      - "4000:4000"          # 운영의 "옛 문" 재현 — 5단계(폐쇄) 전 상태. 실험 2에서 직접 접속 대조용
    env_file:
      - ./backend/.env       # JWT 시크릿 등 (운영 compose 와 같은 방식)
    environment:
      - NODE_ENV=production
      - POSTGRES_HOST=postgres   # .env 의 localhost:15432 를 컨테이너 세계 기준으로 덮어쓰기
      - POSTGRES_PORT=5432
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - SENTRY_DSN=              # 연습 트래픽이 Sentry 에 흘러가지 않게 비활성(no-op)
      - TRUST_PROXY_HOPS=1       # 로컬은 프록시 1홉(nginx뿐). 운영(Vercel+nginx) 값은 주제 4에서 확정
    healthcheck:                 # 운영 compose 와 동일
      test: ["CMD-SHELL", "curl -f http://localhost:4000/v1/health || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
    # 실험 2-B: trust proxy 코드가 든 로컬 빌드 dist 를 이미지 위에 덮기
    volumes:
      - ./backend/dist:/app/backend/dist:ro

networks:
  default:
    name: shopping-mall-local-network   # 기존 로컬 postgres/redis 가 사는 네트워크에 합류
    external: true                      # 새로 만들지 말고 있는 것을 쓴다
```

## 파일 3. `docker-compose.prod.yaml` — 현재 EC2 운영 compose (nginx 아직 없음)

```yaml
services:
  postgres:
    image: postgres:18-alpine
    restart: unless-stopped
    volumes:
      - /mnt/postgres-data:/var/lib/postgresql
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-postgres}"]
      interval: 30s
      timeout: 10s
      retries: 3

  redis:
    image: redis:alpine
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 30s
      timeout: 10s
      retries: 3

  backend:
    image: ansmoon/shopping-mall-backend:latest
    restart: unless-stopped
    ports:
      - "4000:4000"          # ← 이게 "옛 문". 인터넷에 4000 이 직접 열려 있다
    env_file:
      - .env
    environment:
      - NODE_ENV=production
      - POSTGRES_HOST=postgres
      - POSTGRES_PORT=5432
      - REDIS_HOST=redis
      - REDIS_PORT=6379
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:4000/v1/health || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3

networks:
  default:
    name: shopping-mall-network
```

## 파일 4. `docker-compose.local.yaml` — 로컬 개발용 (postgres/redis만 띄움. 연습 compose가 이 네트워크에 합류한다)

```yaml
services:
  postgres:
    image: postgres:18-alpine
    ports:
      - "15432:5432"         # 호스트 15432 → 컨테이너 5432
    environment:
      POSTGRES_USER: sangmoon
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: sangmoon
    # (volumes/healthcheck 생략)

  redis:
    image: redis:alpine
    ports:
      - "6379:6379"

networks:
  default:
    name: shopping-mall-local-network
```

## 파일 5. `frontend/next.config.js` 중 rewrites 부분 — 지금의 "Vercel 프록시"

```js
// [프록시 방식] — 현재 활성
// /api/* 요청을 EC2 백엔드로 서버사이드 프록시
async rewrites() {
  const apiTarget = process.env.API_PROXY_TARGET || 'http://localhost:4000/v1';
  // 업로드 이미지는 /v1 프리픽스 없이 서빙된다 — API 타깃에서 /v1만 뗀다.
  const uploadsTarget = apiTarget.replace(/\/v1\/?$/, '');
  return [
    { source: '/api/:path*',     destination: `${apiTarget}/:path*` },
    { source: '/uploads/:path*', destination: `${uploadsTarget}/uploads/:path*` },
  ];
},
```

같은 파일의 CSP(Content-Security-Policy) 설정에는 `connect-src 'self' ...`만 있다. 주석에 "프록시 덕에 같은 오리진으로 충분"이라고 적혀 있다. (nginx 전환 후에도 rewrites를 유지하기로 했으므로 이 CSP는 안 바꾼다. 결정 2.)

## 파일 6. `backend/src/main.ts` 발췌 — Express `trust proxy`와 `/uploads` 정적 서빙

```ts
const expressApp = app.getHttpAdapter().getInstance();

// 리버스 프록시(nginx/Vercel) 뒤에서 X-Forwarded-For 로 실제 클라이언트 IP 를 복원한다.
// TRUST_PROXY_HOPS 미설정(기본)이면 완전 비활성 = 기존 동작 그대로 — 프록시 없이 4000 이
// 직접 노출된 현 운영 상태에서 XFF 헤더 위조로 IP 를 속일 수 없어야 하므로 env 로만 켠다.
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS);
if (Number.isInteger(trustProxyHops) && trustProxyHops > 0) {
  expressApp.set('trust proxy', trustProxyHops);
}

// 상품 이미지 정적 서빙 — multer diskStorage 가 './uploads'(CWD 기준)에 저장.
// 글로벌 prefix(v1)를 타지 않아 http://localhost:4000/uploads/<filename> 으로 열린다.
// ⚠ 로컬 디스크 저장이라 컨테이너 재배포 시 파일이 유실된다.
expressApp.use('/uploads', express.static(join(process.cwd(), 'uploads')));

// ... (중략)
const globalPrefix = 'v1';
app.setGlobalPrefix(globalPrefix);
const port = process.env.PORT || 4000;
await app.listen(port);
```

## 파일 7. `backend/src/admin/assistant/assistant.controller.ts` 발췌 — SSE 응답 헤더

```ts
@Post('stream')
async stream(@Body() body: ChatRequestDto, @User('sub') adminUserId: number, @Res() res: Response) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // 프록시 버퍼링 방지
  res.flushHeaders?.();
  for await (const ev of this.assistantService.streamChat({ /* ... */ })) {
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
  }
}
```

---

# 학습 자료 (원문. 인수인계 문서라 압축돼 있다. 이걸 풀어서 가르쳐 달라)

## 확정 결정 16개 (A~D) — 재논의 금지, "왜"만 이해시켜라
1. **nginx + certbot** 채택 (AWS ALB는 월 $17+로 과함, Caddy는 학습가치↓)
2. **웹은 Vercel rewrites 유지**, Vercel 환경변수 `API_PROXY_TARGET` 값만 `https://api.ansmoon.dev/v1`로 교체 → 브라우저 기준 same-origin 유지라 `sameSite:'lax'` refreshToken 쿠키 안 깨짐. **같은 이유로 프론트 CSP 변경도 불필요**
3. nginx 설정: `location /` 하나 + `proxy_pass http://backend_api;`(**경로 뒤 슬래시 없이** = 경로 무변경 통과 — `/v1`과 `/uploads` 둘 다 커버). upstream 별명(backend_api) 사용
4. `proxy_set_header` 3종(Host / X-Forwarded-For `$proxy_add_x_forwarded_for` / X-Forwarded-Proto) + 백엔드 Express `trust proxy` 세트
5. SSE에 `proxy_buffering off`는 **불필요** — 백엔드가 이미 `X-Accel-Buffering: no`를 보낸다(nginx가 알아듣는 신호). **긴 `proxy_read_timeout`(300s)만 필요**(기본 60초라 LLM 첫 토큰 전에 끊길 수 있음). 업로드용 `client_max_body_size 10m`(기본 1m → 413)
6. `backend`의 `ports: "4000:4000"` 제거 + 보안그룹 4000 차단 — **맨 마지막 단계에서만**
7. 설정 파일은 `./nginx/conf.d/default.conf` → `/etc/nginx/conf.d/default.conf` **:ro 바인드** (nginx.conf 통째 교체 아님 — 이미지 기본값 상속)
8. **배포 마지막에 `nginx -t && nginx -s reload` 필수** — nginx는 시작 시 backend 이름→IP를 1회만 해석·영구 캐시. 배포로 backend 재생성 → 내부 IP 변경 → reload 없으면 502
9. 도메인 **`ansmoon.dev` 구매 완료**(Cloudflare Registrar, 연 $12.20). `api.` 등 서브도메인 확장 전략
10. DNS: **A레코드 한 줄**(`api` → EC2 탄력적 IP), **Proxy status는 반드시 "DNS only"(회색 구름)**
11. 순서 고정: 도메인 → A레코드 → certbot (HTTP-01이 80 포트로 직접 방문 검증)
12. certbot **webroot** 방식. 최초 1회 부트스트랩: 80 전용 nginx → 발급 → 443 설정 추가 후 reload (인증서 없이는 443 설정의 nginx가 시작 자체를 못 하는 닭-달걀)
13. 인증서 마운트: `./certbot/conf` ↔ `/etc/letsencrypt` **디렉터리 통째**(live/만 마운트하면 심링크 끊김)
14. 갱신: certbot 사이드카(12h `renew` 루프) + nginx 6h reload
15. 갱신 실패 감지: Let's Encrypt 만료 경고 메일 + UptimeRobot 무료(`https://api.ansmoon.dev/v1/health`)
16. ⚠ **`.dev`는 HSTS preload TLD** — 브라우저가 http를 강제 https 승격. **발급 전 검증은 curl로** (LE 검증 서버는 브라우저가 아니라 무관, HTTP-01 정상 동작)

## 직전 DB 트랙이 남긴 사실
- **IP 문제 실측 확정**: 백엔드에는 IP를 읽는 경로가 둘 있다. 경로 B(NestJS `@Ip()` 데코레이터 — 로그인 등)에는 **AWS IP 40여 종**이 찍히고, 경로 A(감사 인터셉터가 `X-Forwarded-For` 헤더를 수동 파싱)에는 본인 IP가 찍힌다. 로그인 레이트리밋 키(`login:${ip}`, IP당 10회/5분)가 오염돼 **전 세계가 키 공유** = 실질 버그. (→ 커리큘럼 3에서 "왜 `@Ip()`는 Vercel 서버의 IP를 손님으로 착각하는지" 설명해 달라)
- **배포 표준 절차**: 로컬 build→push / EC2 `pull → migrate → up -d → 헬스체크+버전 단언` → **(nginx 도입 후) `nginx -t && nginx -s reload`가 마지막에 추가됨**
- `/v1/health`가 `version`(커밋 해시) 반환 — 검증 단계에서 "nginx 경유 버전 == 직접 접속 버전" 단언에 활용
- `/uploads`는 컨테이너 디스크 저장이라 재배포 시 유실. 컨테이너 내 경로 `/app/uploads`

## E(안전한 전환) — 대원칙 + 6단계 지도
원칙: **"추가 먼저 → 새 경로 검증 → 트래픽 전환 → 관찰 → 옛 문 폐쇄는 맨 마지막."**
옛 문(4000)이 살아있는 한 대부분의 롤백 = 아무것도 안 하기.
```
0 로컬 연습 → 1 EC2에 nginx 80만 추가(기존 무영향) → 2 DNS+certbot 발급
→ 3 443 개통+curl 검증 → 4 Vercel 값 교체(유일한 전환점) → 5 며칠 관찰 후 4000 폐쇄
```
- 4단계 함정: rewrites는 **빌드 시점**에 env를 읽음 → 교체·롤백 모두 **재배포 필요**(분 단위). `API_PROXY_TARGET` 소비처 4곳(rewrites / 로그인·로그아웃·리프레시 BFF / server-api.ts)이 전부 같은 변수라 값 하나로 일괄 전환됨
- 5단계: SSH(22) 규칙은 안 건드림(자해 사고 구조적 불가). 한 번에 한 규칙만

## 로컬 연습(0단계) — 미니어처 설계와 실험 3종
로컬 미니어처(운영과 같은 모양, TLS만 없음): `nginx(호스트 8080 → 컨테이너 80) → backend(운영 이미지 그대로) → postgres/redis`

backend를 `nx serve`가 아니라 **컨테이너로** 돌린 이유:
① `proxy_pass http://backend:4000`의 "이름으로 부르는 구조"를 그대로 만들어야 설정이 EC2로 이식됨
② backend가 컨테이너여야 502 함정(내부 IP 변경)이 재현됨 — 두 이유는 한 뿌리(이름→IP 캐시)

실험 3종(**이미 전부 실행해서 성공했다.** 결과를 보고 "왜 그렇게 나왔는지"를 설명해 달라):
1. **프록시 기본** — `curl http://localhost:8080/v1/health` 통과, `/uploads` 통과, 슬래시 없는 proxy_pass의 경로 무변경 확인. 결과: 8080 경유와 4000 직접 접속의 `version`이 같은 `247a93a`.
2. **IP 관찰** — trust proxy 없을 때 Redis에 `rate:login:::ffff:<nginx 컨테이너 IP 172.x>` 키가 찍혔다(= 백엔드가 nginx를 손님으로 착각. 운영 "AWS IP 40여 종" 문제의 축소판). `TRUST_PROXY_HOPS=1`을 켜니 진짜 입구 IP가 찍혔다.
3. **502 재현** — backend를 `--force-recreate`로 다시 만들되 옛 IP 자리를 다른 컨테이너가 선점하게 해서 IP를 강제로 바꿈 → nginx 로그에 `connect() refused, upstream <옛 IP>` → 이때 **4000 직접 접속은 200**(backend 자체는 멀쩡) → `docker compose exec nginx nginx -s reload` → 즉시 복구. (참고: recreate가 우연히 같은 IP를 재사용하면 502가 안 날 수도 있다.)

## (심화) 주제 4 — trust proxy 홉 수와 XFF 위조 (이미 결정됨)
- 실측: `hops=1`이면 위조 XFF 무력(nginx가 진짜 IP를 덧붙이므로). `hops=2`면 nginx에 직접 접속한(1홉) 클라이언트가 보낸 위조 XFF `6.6.6.6`이 그대로 기록됨.
- 그런데 로그인은 Vercel의 BFF(서버 라우트 → 백엔드 직결) 경로라 요청에 **브라우저의 진짜 IP가 애초에 실려 오지 않는다**. 그래서 nginx 설정만으로는 "AWS IP 40종" 버그를 못 고친다. Vercel에 고정 egress IP 대역도 없다.
- 채택안 = **"XFF 정규화 + trust 영구 1"**: Vercel 쪽 코드(Next middleware + BFF fetch 헬퍼)가 `x-proxy-secret`과 `x-client-ip`를 넣어 보내고, 백엔드 정규화 미들웨어가 비밀이 일치하면 XFF를 `x-client-ip` 한 값으로 교체(원문은 `x-original-forwarded-for`에 보존, 비밀 env 없으면 no-op). → 웹 / BFF / RN·직접 접속 3경로 모두 정확하고 위조 불가.
- 4단계를 4a(수송로만 HTTPS로 전환, hops=1)와 4b(비밀+정규화 배포 = IP 복원)로 나눠 독립 롤백.

## 앞으로 남은 것 (참고만)
- 주제 3: EC2에 80 추가 / A레코드 / certbot 부트스트랩 / 443 — 단계별 실패 모드·롤백
- 주제 5: 4000 폐쇄 + uploads 휘발 처리 여부
- F: 각 단계 검증 명령(curl/nslookup/docker compose exec)
- 최종: 로드맵 문서 v2 + 외부 액션 체크리스트

---

# 시작

위 규칙대로 **커리큘럼 1번(큰 그림)**부터 시작해라. 시작하기 전에, 내가 붙여 넣은 자료를 읽고 **네가 이해한 현재 배포 구조를 텍스트 다이어그램으로 한 번 그려서 나에게 확인**받아라. 그 뒤 설명을 시작하고, 끝에 이해 확인 질문을 던져라.
