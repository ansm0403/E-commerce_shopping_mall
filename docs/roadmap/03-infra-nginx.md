# Phase 3 — 인프라: nginx 도입

> 목표: 현재 **Vercel rewrites가 EC2 백엔드(`:4000`)로 직접 프록시**하는 우회 구조를,
> EC2 백엔드 앞단에 **nginx 리버스 프록시**를 두는 구조로 대체한다. (TLS 종단·라우팅·보안 헤더 일원화)

## 현재 형상 (확인된 사실)
- 프론트: **Vercel**. `frontend/next.config.js`의 `rewrites`가 `/api/:path* → ${API_PROXY_TARGET}/:path*`로 EC2 백엔드(`/v1`)에 전달.
- 백엔드: **EC2 + `docker-compose.prod.yaml`** = `postgres` + `redis` + `backend`(`ports: 4000:4000`). **nginx·프론트 서비스 없음.**
- 헬스체크 엔드포인트 존재: `GET /v1/health` (compose healthcheck에서 사용 중).
- 참고 문서: `docs/Modify-proxy.md`, `docs/AWS_Security_group.md`, `docs/deploy-issues.md`.

## 목표 형상
```
[브라우저] → [Vercel(프론트 + rewrites)] → [EC2: nginx :443/:80] → [backend :4000]
                                                       └→ (선택) TLS 종단 / 정적 / 보안헤더
```
- nginx가 EC2의 단일 진입점(80/443) → 내부 `backend:4000`으로 프록시.
- Vercel `API_PROXY_TARGET`을 `https://api.<도메인>`(nginx)로 변경. 백엔드 `4000` 포트는 외부에 직접 노출하지 않음.

## 변경 대상 / 산출물
1. **nginx 서비스 추가**: `docker-compose.prod.yaml`에 `nginx` 서비스(이미지 `nginx:alpine`, `ports: 80:80, 443:443`, `depends_on: backend`).
   - 산출물: `nginx/nginx.conf`(또는 `nginx/conf.d/backend.conf`) — `upstream backend { server backend:4000; }` + `location /` 프록시, `proxy_set_header`(Host, X-Forwarded-For/Proto), `/v1/health` 패스스루.
2. **백엔드 포트 비공개화**: compose에서 `backend`의 `ports: 4000:4000` 제거(컨테이너 네트워크 내부만), nginx만 호스트 포트 노출.
3. **TLS**: Let's Encrypt(certbot) 또는 ALB/CloudFront 중 택1.
   - 단순화: `nginx` + certbot 사이드카(또는 호스트 certbot) → `443` 인증서. 갱신 크론.
4. **보안그룹**: EC2 인바운드를 `80/443`만 허용, `4000` 외부 차단(`docs/AWS_Security_group.md` 갱신).
5. **CORS/CSP 정합**: 백엔드 `CORS_ORIGINS`, 프론트 `next.config.js` CSP `connect-src`를 새 도메인(`https://api.<도메인>`)에 맞춰 갱신. (`main.ts` CORS, `next.config.js` 헤더)
6. **프론트 전환**: `API_PROXY_TARGET`(Vercel 환경변수)을 nginx 도메인으로 변경. `next.config.js`의 rewrites 주석 가이드("nginx 전환 시 …") 반영.

## 범위 구분
- **필수(A)**: nginx 리버스 프록시 + 4000 비공개화 + 보안그룹 정리 → "단일 진입점" 확보.
- **필수(A)**: HTTPS(TLS) 종단.
- **후순위(B)**: nginx 레벨 gzip/캐시/정적 서빙, rate-limit(현재는 앱단 `ThrottlerModule`로 처리 중), 액세스 로그 적재.

## 완료 기준 (DoD)
- 외부에서 `:4000` 직접 접근 불가, `https://api.<도메인>/v1/health` 200.
- Vercel 프론트가 nginx 경유로 백엔드 호출 → 기존 모든 기능 정상.
- 인증서 자동 갱신 동작 확인.

## 주의 (먼저 처리)
- 이 단계 착수 전, README의 ⚠ **정산 이중 prefix 버그**가 정리돼 있어야 경로 혼선이 없다(Phase 1/2에서 선반영).
- 프록시 헤더 누락 시 쿠키(`refreshToken` httpOnly)·`X-Forwarded-Proto` 문제로 인증이 깨질 수 있음 → `secure` 쿠키/HTTPS 전제 확인.
