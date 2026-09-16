# Phase 3 — 인프라: nginx 리버스 프록시 + HTTPS **(v2 · 완주 기록)**

> **v1 → v2 안내**: v1(42줄)은 착수 **전** 스케치였고, 설계·연습·실행을 거치며 **5건이 뒤집혔다**(§9 표).
> v2는 **완주 후 기록**이다 — 무엇을 왜 그렇게 정했고, 무엇이 실측으로 뒤집혔으며, 어디서 넘어졌는지를 남긴다.
>
> - **이 문서** = "머리"(결정과 근거). **[03-infra-nginx-runbook.md](./03-infra-nginx-runbook.md)** = "손"(복붙 절차·트러블슈팅).
> - 완주일: **2026-09-15**. 운영 중인 형상: `https://api.ansmoon.dev` → nginx → backend (신 EC2 `15.164.185.156`).
> - 전제 트랙: [ex-db-migration.md](./ex-db-migration.md)(2026-08-19 종료), before 데이터: [ex-db-migration-before-capture.md](./ex-db-migration-before-capture.md)

---

## 0. 왜 했나 — 한 문장

**다음 트랙인 RN 앱이 백엔드에 직접 붙는데, iOS/Android 가 평문 HTTP 를 차단하므로 백엔드 HTTPS 가 앱 개발의 선행조건이다.**
부수 효과로 두 가지가 함께 해소됐다: ① 4000 포트 전세계 공개 ② Vercel→EC2 구간이 평문이던 문제.

착수 시점에 구 AWS 계정의 프리티어가 만료돼, **계정 이관과 한 흐름으로 묶었다**(§3-3).

---

## 1. 형상 — before / after

```
[before]  브라우저 → Vercel(rewrites) → http://43.201.118.88:4000   (평문, 4000 전세계 공개)
                                          └ 구 AWS 계정, nginx 없음

[after]   브라우저 → Vercel(rewrites) → https://api.ansmoon.dev ─┐
          RN 앱(예정) ────────────────────────────────────────┤
                                                              ↓
                                        [EC2 15.164.185.156]  nginx :80/:443
                                                              ↓ (컨테이너 네트워크)
                                                       backend :4000 → postgres / redis
                                        4000·5432·6379 는 호스트에 미노출, SG 는 22/80/443 만
```

- **웹의 경로는 구조가 안 바뀌었다** — Vercel rewrites 를 그대로 두고 **환경변수 값만** 교체했다(결정 2). 브라우저 입장에서는 계속 same-origin 이라 `sameSite:'lax'` refreshToken 쿠키도, 프론트 CSP 도 건드릴 필요가 없었다.
- **RN 은 이 그림에 그냥 합류한다** — 이미 HTTPS 단일 진입점이 있으므로 인프라 추가 작업이 없다.

---

## 2. 확정 결정 16개 (의제 A~D)

> 설계 대화에서 하나씩 확정한 것들. **★ 표시는 이후 실측으로 수정된 항목**(수정 내용 병기).

### A. 무엇으로 TLS 를 끊을 것인가

| # | 결정 | 근거 |
|---|---|---|
| 1 | **nginx + certbot** 채택 | ALB 는 월 $17+ 로 과하고(트래픽 대비), Caddy 는 자동 TLS 가 편하지만 **학습 가치가 낮다**. nginx 는 실무 표준이고 설정을 직접 이해하게 된다 |
| 12 | certbot **webroot** 방식, 최초 1회 **부트스트랩** | 인증서가 없으면 443 설정의 nginx 는 **기동 자체가 안 된다**(ssl_certificate 파일 부재) → 80 전용 conf 로 먼저 띄우고 → 발급 → 최종 conf 로 교체·reload. 이 닭-달걀 때문에 conf 파일을 **2종**으로 나눴다 |
| 13 | 인증서는 `./certbot/conf` ↔ `/etc/letsencrypt` **디렉터리 통째** 마운트 | `live/` 안은 `../../archive/...` **심링크**다. live 만 마운트하면 링크가 끊겨 nginx 가 인증서를 못 읽는다 |
| 14 | 갱신 = certbot 사이드카(12h `renew` 루프) + nginx 6h `reload` 루프 | 갱신은 만료 30일 전부터만 실제 동작(그 전엔 "not yet due"). 갱신된 파일을 nginx 가 다시 읽어야 하므로 reload 가 짝이다 |
| 15 | ~~갱신 실패 감지 = LE 만료 경고 메일 + UptimeRobot 무료~~ ⛔ **무효(2026-09-16)** — 전제 두 개가 모두 틀렸다(§7-2 정정) | 취지("자동화는 조용히 실패하는 게 가장 위험하다")는 옳으나 **수단이 둘 다 존재하지 않았다.** 대책은 [관측 지도 §7 ③](./ex-observability-map.md) |

### B. nginx 설정을 어떻게 쓸 것인가

| # | 결정 | 근거 |
|---|---|---|
| 3 | `location /` **하나** + `proxy_pass http://backend_api;` (**경로 뒤 슬래시 없이**) | 슬래시가 없으면 URI **무변경 통과** → `/v1/*` 과 `/uploads/*` 를 한 블록으로 커버. 슬래시를 붙이면 경로가 잘려 `/uploads` 가 깨진다 |
| 4 ★ | `proxy_set_header` 3종(Host / X-Forwarded-For `$proxy_add_x_forwarded_for` / X-Forwarded-Proto) + 백엔드 `trust proxy` | **★ 당초 `trust proxy 2` → 최종 `1`**. 근거는 §5(위조 실측) |
| 5 ★ | SSE 는 **`proxy_read_timeout 300s`만** 필요. 업로드용 `client_max_body_size 10m` | **★ 당초 `proxy_buffering off` 도 넣으려 했으나 불필요 판명** — 백엔드가 이미 `X-Accel-Buffering: no` 를 보낸다([assistant.controller.ts:64](../../backend/src/admin/assistant/assistant.controller.ts#L64)). nginx 는 이 헤더를 알아듣고 해당 응답만 버퍼링을 끈다. 반면 기본 60초 read timeout 은 LLM 첫 토큰 전에 끊길 수 있어 연장이 필요했다. 기본 `client_max_body_size 1m` 는 상품 이미지 업로드에서 413 을 낸다 |
| 7 ★ | 설정은 **`conf.d/default.conf` 바인드**(nginx.conf 통째 교체 아님) | 이미지 기본값(worker, gzip, mime 등)을 상속받는 게 안전하다. **★ 파일 단위 `:ro` 바인드 → 디렉터리(`conf.d/`) 바인드로 변경** — 부트스트랩→최종본을 `cp` 로 교체할 때 파일 바인드는 inode 가 바뀌어 컨테이너가 옛 내용을 계속 보기 때문 |
| 8 | 배포 마지막에 **`nginx -t && nginx -s reload` 필수** | nginx 는 시작 시 `backend` 이름→IP 를 **1회만 해석하고 영구 캐시**한다. 배포로 backend 컨테이너가 재생성되면 내부 IP 가 바뀌고, reload 전까지 **502**. §4 실험 3에서 재현했다 |

### C. 도메인과 DNS

| # | 결정 | 근거 |
|---|---|---|
| 9 | 도메인 **`ansmoon.dev`** 구매(Cloudflare Registrar, 연 $12.20 ≈ 1.7만원) | 서브도메인으로 확장(`api.` / 추후 `shop.` 등) |
| 10 | DNS 는 **A레코드 한 줄**(`api` → 탄력적 IP), Proxy status **"DNS only"(회색 구름)** | 주황(Proxied)이면 Cloudflare IP 가 응답해 ① HTTP-01 검증 경로가 꼬이고 ② TLS 가 Cloudflare 에서 끊겨 "직접 TLS 종단"을 배우려는 목적이 사라진다 |
| 11 | 순서 고정: **도메인 → A레코드 → certbot** | HTTP-01 은 LE 서버가 `http://api.ansmoon.dev/.well-known/...` 을 **직접 방문**해 검증한다. DNS 가 먼저 가리켜야 성립 |
| 16 | **`.dev` 는 HSTS preload TLD** → 발급 전 검증은 **curl 로만** | 브라우저가 http 를 강제로 https 로 승격시켜, 443 이 아직 없는 단계에서 "연결 실패"처럼 보여 오판한다. LE 검증 서버는 브라우저가 아니므로 HTTP-01 은 정상 동작한다 |

### D. 전환과 폐쇄

| # | 결정 | 근거 |
|---|---|---|
| 2 | **웹은 Vercel rewrites 유지**, 환경변수 `API_PROXY_TARGET` **값만** `https://api.ansmoon.dev/v1` 로 교체 | 브라우저 기준 same-origin 이 유지되므로 refreshToken 쿠키(`sameSite:'lax'`)가 안 깨지고, 프론트 CSP 변경도 불필요. **v1 의 "rewrites 제거" 계획을 뒤집은 결정**(§9) |
| 6 ★ | backend 의 `ports: "4000:4000"` 제거 + SG 4000 차단은 **맨 마지막** | **★ 계정 이관과 통합되며 "새 EC2 는 처음부터 4000 을 안 연다"로 대체**(§3-3) |

---

## 3. 안전한 전환 설계 (의제 E)

### 3-1. 대원칙

> **"추가 먼저 → 새 경로 검증 → 트래픽 전환 → 관찰 → 옛 문 폐쇄는 맨 마지막."**

옛 문(구 EC2 의 4000)이 살아 있는 한 **대부분의 롤백은 "아무것도 안 하기"** 가 된다. 이 원칙 덕에 전환 전 단계(1~3)에서 무엇이 실패해도 운영 트래픽은 영향을 받지 않았다.

### 3-2. 6단계 지도

```
0 로컬 연습 → 1 nginx 80 추가 → 2 DNS + certbot 발급 → 3 443 개통·검증
→ 4 Vercel 값 교체(유일한 전환점) → 5 관찰 후 옛 문 폐쇄
```

- **4단계의 함정**: rewrites 는 **빌드 시점**에 환경변수를 읽는다 → 값 저장만으로는 무효, **재배포 필요**. 롤백도 마찬가지로 재배포(분 단위). `API_PROXY_TARGET` 소비처 4곳(rewrites / 로그인·로그아웃·리프레시 BFF / `server-api.ts`)이 전부 같은 변수라 **값 하나로 일괄 전환**된다.
- **5단계**: SSH(22) 규칙은 건드리지 않는다(자해 사고 구조적 불가). 한 번에 한 규칙만.

### 3-3. AWS 계정 이관과의 통합 (2026-09-12 결정)

구 계정 프리티어 만료로 새 계정이 필요해졌고, 이관과 nginx 도입을 **합치는 쪽이 일이 줄었다**:

| 합쳤을 때의 이점 | 설명 |
|---|---|
| **Vercel 전환 1회** | 따로 했다면 "IP 교체 1회 + 도메인 교체 1회" = 2회 |
| **"옛 문 폐쇄" 단계 소멸** | 새 EC2 는 **태어날 때부터 4000 을 SG 에 안 연다**. 롤백 대상은 관찰 기간 내내 살아 있는 **구 EC2 전체** |
| **대원칙의 완벽한 실사판** | 구 EC2 = 옛 문. 새 경로를 다 지어놓고 검증한 뒤 전환 |

구 EC2 조사 결과 "서버의 실체"는 단순했다 — 실제로 쓰이던 파일은 `docker-compose.prod.yaml` 과 `.env` **2개뿐**이고(`~/Shopping-mall` 체크아웃은 4월자 잔재), 데이터는 전부 mock 이라 pg_dump 이관 대신 **migrate + seed** 로 재현했다.

이관 과정에서 구 `.env` 의 문제 3건도 정리했다: **중복 정의**(`POSTGRES_*`·`JWT_*` 가 두 번씩 — 뒤 값이 이기고 있었다), **오타**(`LLM_PROVIER` → 코드는 `LLM_PROVIDER` 를 읽으므로 무효였고 기본값으로 우연히 동작), **V1 잔재**(`PORTONE_IMP_KEY/SECRET` — 현재 코드는 V2 `PORTONE_API_SECRET` 만 사용).

---

## 4. 로컬 연습 실측 (E 주제 2 · 2026-08-26)

운영을 건드리기 전에 **같은 모양의 미니어처**를 로컬에 지었다(TLS 만 없음):
`nginx(8080→80) → backend(운영과 같은 이미지, 컨테이너) → 기존 로컬 postgres/redis`

backend 를 `nx serve` 가 아니라 **컨테이너로** 돌린 이유는 둘인데 뿌리는 하나다(이름→IP 캐시):
① `proxy_pass http://backend:4000` 의 "이름으로 부르는 구조"를 그대로 만들어야 설정이 EC2 로 이식된다
② backend 가 컨테이너여야 **502 함정이 재현**된다

| 실험 | 관찰 결과 |
|---|---|
| **① 프록시 기본** | `curl :8080/v1/health` 200(`version` 이 직접 호출과 동일), `/uploads/<파일>` 통과 → 슬래시 없는 `proxy_pass` 의 **경로 무변경**을 확인 |
| **② IP 관찰** | trust proxy 없을 때 Redis 에 `rate:login:::ffff:172.18.0.5`(= **nginx 컨테이너 IP**)가 찍힘 — 운영의 "AWS IP 40여 종" 문제의 축소판. `TRUST_PROXY_HOPS=1` 을 켜자 `rate:login:172.18.0.1`(진짜 입구 IP)로 교정 |
| **③ 502 재현** | backend 재생성 → IP `.4`→`.6` 변경 → nginx 는 **옛 IP 로 계속 연결 시도**(`connect() failed (111) ... upstream: "http://172.18.0.4:4000"`) → **502**. 이때 backend 직접 호출은 **200**(서버는 멀쩡) → `nginx -s reload` 로 **즉시 복구** |

> 💡 실험 ③ 의 부산물: `--force-recreate` 가 **같은 IP 를 재사용하면 502 가 안 난다.** "가끔 되니까 괜찮겠지"가 가장 위험한 형태 — 그래서 배포 절차에 reload 를 **무조건** 넣었다(결정 8).

이 연습 덕분에 운영에서 **처음 보는 문제가 없었다.** 실제로 EC2 에서도 `nginx -t`/`reload` 를 아는 상태로 시작했다.

---

## 5. 클라이언트 IP 문제 — before 데이터와 설계 변천 (이 트랙의 핵심 서사)

### 5-1. before: 같은 사람이 매번 다른 사람으로 기록되고 있었다

DB 리셋 전 실측([before-capture §2](./ex-db-migration-before-capture.md)):

| 경로 | 구현 | 기록된 IP | 판정 |
|---|---|---|---|
| **A** | 감사 인터셉터가 **XFF 를 직접 파싱** | `112.163.229.139`(본인 실제 공인 IP) | 정상 |
| **B** | `@Ip()` = Express `request.ip` | **`::ffff:` + AWS IP 40여 종** | **버그** |

경로 B 에는 로그인·로그아웃·리프레시·회원가입·로그인실패가 전부 포함된다. `trust proxy` 가 없으면 Express 는 **직전 홉(Vercel 서버리스)의 IP** 를 손님으로 본다. 결과적으로 로그인 레이트리밋 키(`login:${ip}`, IP 당 10회/5분)가 오염돼 **전 세계가 키를 공유**하는 실질 버그였다.

### 5-2. 설계가 두 번 뒤집힌 과정

**1안 (잠정) — `trust proxy 2` + 감사로그에 XFF 원문 병기**
웹은 실제로 2홉(Vercel + nginx)이니 2가 맞다는 발상. → **로컬 실측으로 폐기.**

| 로컬 실험(2-C) | 위조 `X-Forwarded-For: 6.6.6.6` 을 보냈을 때 기록된 IP |
|---|---|
| `hops=1` | `172.18.0.1` — **위조 무력**(nginx 가 `$proxy_add_x_forwarded_for` 로 진짜 IP 를 **뒤에** 덧붙이고, 백엔드는 뒤에서 1개만 신뢰) |
| `hops=2` | **`6.6.6.6`** — 위조 성공 |

즉 hops=2 로 가면 **nginx 에 직접 붙는 누구나**(=미래의 RN 앱과 동일한 1홉 위치) IP 를 마음대로 위조해 레이트리밋을 우회할 수 있다. 위험이 발생하는 시점은 RN 출시가 아니라 **hops=2 를 배포하는 순간**이다.

**2안 — nginx 에서 경로별로 IP 확정**(`set_real_ip_from` + 호스트 분리) → **폐기.** 두 가지가 걸렸다:
- Vercel 은 일반 요금제에서 **고정 아웃바운드 IP 대역을 주지 않는다** → `set_real_ip_from` 이 성립 불가
- 더 결정적으로, **로그인은 rewrites 가 아니라 BFF** 다. Next 라우트 핸들러가 서버사이드 `fetch` 로 백엔드를 부르므로, 그 요청 안에는 **브라우저의 IP 가 애초에 들어 있지 않다.** nginx 가 무슨 짓을 해도 복원할 수 없다

**3안 (확정) — "XFF 정규화 + trust 영구 1"**

```
nginx      : 지금 설정 그대로 ($proxy_add_x_forwarded_for = 원문 체인 보존)
backend    : TRUST_PROXY_HOPS=1 (영구 — 홉 수 트레이드오프 자체가 사라짐)
Vercel 코드: 항상 두 헤더를 붙인다
             x-proxy-secret : 공유 비밀
             x-client-ip    : 진짜 손님 IP (인바운드 값을 믿지 말고 반드시 덮어쓰기)
backend    : 비밀이 맞으면 XFF 를 x-client-ip 한 값으로 교체, 원문은 x-original-forwarded-for 로 보존
             비밀이 없거나 틀리면 아무것도 안 함 → trust 1 이 nginx 가 붙인 소켓 IP 를 채택
```

세 경로가 전부 정확하고 전부 위조 불가가 된다: 웹(rewrites) ✅ / 로그인(BFF) ✅ / RN·직접 접속 ✅.
**RN 이 나와도 설정 변경이 0** 이라는 게 이 안의 핵심 이점이다.

> 📌 이 3안의 코드 작업은 **아직 미완(§10 의 12-1)**. 현재 운영은 "수송로만 전환된 4a 상태"이고, 웹의 기록 IP 의미는 구 EC2 시절과 **동일**하다(악화 없음). 완료 시점이 v2 의 "after 데이터"가 된다.

### 5-3. after (현재까지)

전환 직후 실측: `rate:login:13.217.205.204` — **Vercel/AWS 대역 IP**(= 4a 단계의 기대값). 실패 신호였던 `172.x`(nginx 컨테이너 IP)가 **아님**을 확인해 `TRUST_PROXY_HOPS=1` 이 동작함을 검증했다.

---

## 6. 검증 결과 (의제 F)

### 6-1. 단계별 관문

| 단계 | 검증 명령 / 방법 | 결과 |
|---|---|---|
| nginx 80 (IP) | `curl http://<EIP>/v1/health` | 200, `version` 이 backend 직접 호출과 동일 |
| DNS | `nslookup api.ansmoon.dev 1.1.1.1` | A → 탄력적 IP(회색 구름) |
| 인증서 | certbot `--dry-run` → 본발급 | `The dry run was successful.` → `Successfully received certificate.` |
| 443 | `curl https://api.ansmoon.dev/v1/health` | 200 + version |
| 80→443 | `curl -I http://api.ansmoon.dev/v1/health` | `301` + `location: https://...` |
| ACME 예외 | `curl -o /dev/null -w "%{http_code}" http://api.ansmoon.dev/.well-known/acme-challenge/x` | **404**(301 이 아님 = 갱신 통로가 리다이렉트에 안 먹힘) |
| 인증서 내용 | `openssl s_client ... | openssl x509 -noout -issuer -dates` | issuer = Let's Encrypt, 만료 약 90일 뒤 |
| 갱신 리허설 | certbot `renew --dry-run` | `all simulated renewals succeeded` |
| 전환 후 기능 | 브라우저(운영 도메인) | 상품/리뷰/AI요약, 데모 로그인, 대시보드, **SSE 스트리밍**, **이미지 업로드** 전부 정상 |
| IP 관찰 | Redis `rate:login:*` | `13.217.205.204`(정상), 로그인 성공은 `refresh:<userId>:<uuid>` 키로 확인 |

### 6-2. `version` 필드의 역할

`/v1/health` 가 반환하는 `version`(빌드 시 주입한 커밋 해시)이 **"어느 코드가 지금 돌고 있는가"의 단언**으로 쓰였다. nginx 경유 응답과 backend 직접 응답의 version 이 같은지 비교하면, 프록시가 **엉뚱한 곳을 가리키고 있지 않음**까지 한 번에 확인된다.

### 6-3. curl 을 써야 하는 지점

`.dev` 는 HSTS preload TLD 라 **브라우저로는 http 단계를 검증할 수 없다**(결정 16). 구체적으로 §6(80 검증)·§7(DNS 확인)·§8-4(301 확인, ACME 예외 확인)는 전부 curl 이어야 한다. 443 이 열린 뒤부터는 브라우저를 써도 된다.

---

## 7. 운영

### 7-1. 배포 표준 절차 (DB 트랙 절차 + nginx 한 줄)

```bash
# [로컬] build → push(:latest + :<sha> 2태그)
# [EC2]
docker compose -f docker-compose.prod.yaml pull backend
docker compose -f docker-compose.prod.yaml run --rm backend node backend/dist/migrate.js   # 마이그레이션 있을 때만
docker compose -f docker-compose.prod.yaml up -d
docker compose -f docker-compose.prod.yaml exec nginx nginx -t && \
docker compose -f docker-compose.prod.yaml exec nginx nginx -s reload      # ⚠ 추가된 한 줄 — 없으면 502
curl -s https://api.ansmoon.dev/v1/health                                   # version == 새 sha
```

마이그레이션은 `exec` 가 아니라 **`run --rm`** 이다 — `migrate.js` 는 **새 이미지 안**에 있는데 기존 컨테이너는 구 이미지로 만들어졌기 때문(DB 트랙에서 확정).

### 7-2. 인증서 자동 갱신

certbot 사이드카가 12시간마다 `renew` 를 시도하고(만료 30일 전부터 실제 갱신), nginx 는 6시간마다 `reload` 로 새 인증서를 재적재한다.

> ⚠ **정정 (2026-09-16)** — 이 자리에 원래 *"감시 2겹: LE 만료 경고 메일 + UptimeRobot"* 이라고 적었으나 **둘 다 틀렸다.**
> ① **Let's Encrypt 는 2025-06-04 자로 만료 알림 메일 서비스를 종료**했다([공지](https://letsencrypt.org/2025/06/26/expiration-notification-service-has-ended)). `--email` 로 넣은 주소는 계정용이고 만료 메일은 오지 않는다.
> ② UptimeRobot **무료 플랜은 HTTPS 모니터의 인증서를 검사하지 않는다** — 만료 *전* 경고가 없다.
> ③ 갱신 루프는 `renew --quiet` 라 **실패해도 로그가 남지 않는다**(certbot 컨테이너 로그 0바이트 실측).
>
> 즉 현재 인증서 감시는 2겹이 아니라 **사실상 0겹**이다. 갱신이 실패해도 만료일에 API 가 죽기 전까지 아무도 모른다.
> 대책과 우선순위는 [ex-observability-map.md §3-1 ④ · §7 ③](./ex-observability-map.md). 런북 §10 의 결정 15 도 같은 이유로 무효다.

### 7-3. uploads 휘발 문제 (이월 과제 해소)

셀러 상품 이미지는 multer diskStorage 로 컨테이너 안(`/app/uploads`)에 저장돼 **재배포마다 유실**됐다. 이번에 compose 에 호스트 볼륨 한 줄(`./uploads:/app/uploads`)을 넣어 해소했다. 호스트 디렉터리는 컨테이너 유저 소유여야 한다(`chown 999:999` — nestjs uid/gid). nginx 정적 서빙 전환은 **하지 않았다**(백엔드 `express.static` 이 이미 동작하고 트래픽이 미미해 실익이 없다). S3 전환은 계속 파킹.

---

## 8. 겪은 함정 6건

> 전부 [런북 §13](./03-infra-nginx-runbook.md) 에 증상→처방으로 기록했다. 여기엔 **왜 그런가**를 남긴다.

| # | 함정 | 원인 |
|---|---|---|
| 1 | **502 (내부 IP 변경)** | nginx 가 upstream 이름을 시작 시 1회만 해석·캐시. 로컬에서 미리 겪어 운영에선 놀라지 않았다 |
| 2 | **Windows 에서 `chmod 400` 이 안 듣는다** | Git Bash 의 chmod 는 Windows ACL 을 실제로 바꾸지 않는다. `.ssh` 폴더에서 상속된 권한 4개(그중 하나는 **옛 계정의 고아 SID** = `UNKNOWN\UNKNOWN`) 때문에 OpenSSH 가 키를 **무시** → `Permission denied (publickey)`. 처방은 `icacls /inheritance:r /grant:r` |
| 3 | **Vercel 임시 배포 주소로 테스트 → POST 만 500** | 확인하던 주소가 운영 도메인이 아니라 배포별 임시 주소(`...-<해시>-sangmoons-projects.vercel.app`)였다. 브라우저는 **POST 에만 `Origin` 헤더를 붙이고 GET 에는 안 붙인다** → 목록·상세(GET)는 멀쩡, 로그인·회원가입(POST)만 CORS 거부. **매우 오해하기 쉬운 증상** |
| 4 | **ssh 원격 실행 시 `docker compose exec` 실패** | TTY 가 없어서. `-T` 를 붙여야 한다(EC2 에 접속해 직접 칠 때는 불필요) |
| 5 | `docker build` 의 **마지막 `.` 누락** | 빌드 컨텍스트 인자가 없으면 `requires 1 argument`. 여러 줄 명령을 복붙할 때 끝이 잘리기 쉽다 |
| 6 | **`PROTOCOL=http` / `HOST=localhost:4000` 잔재** | 구 `.env` 를 그대로 가져오며 남았다. 커서 페이지네이션의 `next` URL 을 이 값으로 만들어([common.service.ts:397](../../backend/src/common/common.service.ts#L397)) 공개 API 가 `http://localhost:4000/...` 를 응답에 뱉는다. 웹은 `nextCursor` 만 쓰고 `next` 를 따라가지 않아 **여태 안 터졌다** — RN 이 먼저 밟을 지뢰 |

### 부수 발견 — "프록시 뒤에서는 CORS 가 무의미하다"는 오판

[main.ts:54](../../backend/src/main.ts#L54) 주석은 *"운영은 Vercel 프록시 덕에 브라우저가 EC2 를 직접 호출하지 않아 사실상 무의미"* 라고 적혀 있다. **틀렸다.** 함정 3 이 그 증거다 — **Next rewrites 는 브라우저의 `Origin` 헤더를 그대로 백엔드에 전달**하므로, 백엔드의 CORS 검사는 프록시 뒤에서도 **실제로 작동한다**.

그런데 여기에 역설이 있다. 이 상황에서 CORS 허용목록은 **보안 장치로는 거의 쓸모가 없다** — 공격자는 `Origin` 을 **아예 안 보내면** 그냥 통과한다(curl 실측: Origin 없음 → CORS 통과, 400). 즉 **공격자는 못 막고 정상 사용자만 막는** 상태다. 진짜 방어선은 JWT·레이트리밋·`DemoAccountGuard` 이며, CORS 는 "브라우저에서의 실수 방지" 수준으로 보는 게 맞다. 게다가 거부 응답이 **500**(서버 오류)으로 나가는 것도 잘못이다 — **403** 이어야 한다(§10 의 12-7).

---

## 9. v1 → v2 변경점 (모순 5건)

| # | v1 의 서술 | v2 확정 | 왜 뒤집혔나 |
|---|---|---|---|
| 1 | "**rewrites 블록 제거** + `API_PROXY_TARGET` 제거" | **유지 + 값만 교체** | 제거하면 브라우저가 EC2 를 **직접** 호출하게 되어 cross-origin 이 된다 → `sameSite:'lax'` refreshToken 쿠키가 깨지고 CSP `connect-src` 도 고쳐야 한다. 값만 바꾸면 same-origin 이 유지돼 **아무것도 안 깨진다**(결정 2) |
| 2 | 산출물 "`nginx/nginx.conf`(또는 conf.d/backend.conf)" | **`nginx/conf.d/default.conf`**(디렉터리 바인드), **부트스트랩/최종 2종** | nginx.conf 통째 교체는 이미지 기본값을 잃는다. 또 인증서 닭-달걀 때문에 conf 가 2단계로 필요하다(결정 7·12) |
| 3 | "TLS: certbot **또는 ALB/CloudFront 중 택1**" | **certbot webroot 확정** | ALB 월 $17+ 는 이 규모에 과함. 학습 목적도 고려(결정 1) |
| 4 | "프론트 CSP `connect-src` 를 새 도메인으로 갱신" | **불필요** | 프록시를 유지하므로 브라우저는 여전히 Vercel 도메인만 호출한다. 실제로 CSP 는 손대지 않았고 전환 후 정상 |
| 5 | 주의: "**정산 이중 prefix 버그**가 정리돼 있어야 한다" | **이미 해소된 낡은 내용** | Step 0(`84a83f4`)과 감사로그 트랙에서 일괄 수정 완료 |

추가로 v1 에 **없던** 것들이 v2 의 실질이다: trust proxy·클라이언트 IP 문제(§5), 로컬 연습(§4), 계정 이관 통합(§3-3), SSE·업로드용 nginx 설정(결정 5), 502 함정(결정 8).

---

## 10. 남은 과제

| # | 내용 | 상태 |
|---|---|---|
| 12-1 | **4b — 진짜 손님 IP 복원**(§5-2 의 3안 구현: Vercel 측 헤더 주입 + 백엔드 정규화 미들웨어) | 설계 확정, 코드 미착수. 완료 시 v2 의 "after 데이터" 확보 |
| 12-2 | PortOne 웹훅 등록 — `https://api.ansmoon.dev/v1/payments/webhook`, 웹훅버전 **V2** / 모드 **테스트** / json | 사용자 결정으로 보류. 현재 미등록이라 `handleWebhook` 은 **죽은 코드** |
| 12-3 | 웹훅 서명 검증(Standard Webhooks) | 파킹(수신 즉시 PortOne 재조회라 위조 결제완료는 현재도 불가) |
| 12-4 | `next.config.js:176-179` 주석 정정("nginx 전환 시 rewrites 제거"는 폐기된 v1 설계) | 미착수 |
| 12-7 | CORS 거부를 500 → **403**, `main.ts:54` 주석 정정(§8 부수 발견) | 미착수 |
| 12-8 | `.env` 의 `PROTOCOL=https` / `HOST=api.ansmoon.dev` 교정(§8 함정 6) | **RN 착수 전 권장** |
| 12-9 | (선택) 커스텀 도메인 `shop.ansmoon.dev` 를 Vercel 에 연결 | 추가 비용 0. 브랜드 일관성 + 도메인 영구 고정 |
| — | `scripts/deploy.sh`, Dockerfile prod-deps 구조 | DB 트랙 파킹 승계 |

---

## 부록 A. 외부 액션 체크리스트 (시공 순서)

> 코드가 아니라 **웹 콘솔에서 사람이 해야 하는 일** 목록. 재현·인수인계용.

| # | 액션 | 위치 | 상태 |
|---|---|---|---|
| 1 | 도메인 `ansmoon.dev` 구매 (연 $12.20 ≈ 1.7만원) | Cloudflare Registrar | ✅ 완료 |
| 2 | 새 AWS 계정 생성 + 결제수단 등록, 프리티어 방식 확인 | AWS Billing → Free Tier | ✅ 완료 |
| 3 | EC2 인스턴스 생성 (t3.small / Ubuntu 24.04 / 서울) | AWS EC2 | ✅ 완료 |
| 4 | 키 페어 생성·다운로드 (`shoppingApp-key-v2.pem`) | AWS EC2 | ✅ 완료 (Windows 는 `icacls` 필수 — §8 함정 2) |
| 5 | 보안그룹 인바운드 **22(내 IP) / 80 / 443** — 4000 은 만들지 않음 | AWS EC2 | ✅ 완료 |
| 6 | **탄력적 IP** 할당 + 인스턴스 연결 | AWS EC2 | ✅ 완료 (`15.164.185.156`) |
| 7 | **A레코드** `api` → 탄력적 IP, **DNS only(회색 구름)** | Cloudflare DNS | ✅ 완료 |
| 8 | LE 등록 이메일 지정 (`kirianir@naver.com`) | certbot 명령 인자 | ✅ 완료 |
| 9 | **`API_PROXY_TARGET`** → `https://api.ansmoon.dev/v1` + **캐시 없이 재배포** | Vercel → Settings → Environment Variables | ✅ 완료 |
| 10 | UptimeRobot 모니터 등록 (`/v1/health`, 5분, 메일 알림) | UptimeRobot | ✅ 완료 (2026-09-15). 탐지 **5분 33초** 실측 — ⚠ 알림 메일이 **스팸함**으로 가므로 발신 주소 등록 필요([관측 지도 §7 ①](./ex-observability-map.md)) |
| 11 | 구 EC2 **중지 → 종료** + EBS 삭제 확인 + **탄력적 IP 릴리스** | 구 AWS 계정 | ⬜ **미완 (과금 중)** |
| 12 | PortOne 웹훅 등록 (V2 / 테스트 / json) | admin.portone.io | ⬜ 보류(12-2) |

## 부록 B. 이 트랙의 산출물

| 파일 | 역할 |
|---|---|
| [`nginx/default.bootstrap.conf`](../../nginx/default.bootstrap.conf) | 80 전용 — ACME 검증 + 프록시. 발급 전 단계와 로컬 연습에서 사용 |
| [`nginx/default.conf`](../../nginx/default.conf) | 최종 — 80(ACME + 301) / 443(TLS 종단 + 프록시) |
| [`docker-compose.prod.yaml`](../../docker-compose.prod.yaml) | nginx + certbot 사이드카, backend 포트 미노출, `TRUST_PROXY_HOPS=1`, uploads 볼륨 |
| [`docker-compose.nginx-practice.yaml`](../../docker-compose.nginx-practice.yaml) | 로컬 미니어처(연습 전용, 삭제 가능) |
| [`backend/src/main.ts`](../../backend/src/main.ts) | env 게이트 trust proxy — `TRUST_PROXY_HOPS` 미설정이면 **완전 무동작**이라 언제 배포해도 안전 |
| [`03-infra-nginx-runbook.md`](./03-infra-nginx-runbook.md) | 복붙 런북 §0~§13 + 부록 A |
