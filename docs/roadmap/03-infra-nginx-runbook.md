# 새 EC2 구축 + nginx/HTTPS 도입 런북 (Phase 3 — AWS 계정 이관 통합판)

> **이 문서는 복붙 런북이다.** 위에서 아래로 순서대로 실행한다. 순서를 바꾸면 안 된다.
> 각 단계에 **[정상]** 과 **[멈춤]** 을 적어뒀다. 멈춤 신호가 보이면 **다음 단계로 넘어가지 말고** §13 을 본다.
>
> **왜 "이관"과 "nginx"를 한 런북에 합쳤나**: 구 계정 프리티어가 끝나 새 계정으로 옮기는 김에, 새 EC2 를
> **처음부터 nginx+HTTPS 형상으로** 짓는다. 구 EC2 는 §9 전환 때까지 운영 트래픽을 계속 받으므로 **무중단**이고,
> 새 EC2 는 태어날 때부터 4000 을 안 연다. Vercel 전환은 단 1회(§9), 롤백은 Vercel 값 원복 1회.
>
> 예상 소요: 실작업 2~3시간 + 관찰 며칠. 가장 긴 구간은 이미지 빌드(~20분)와 DNS 전파 대기(수분~수십분).
> 설계 근거·결정 16개·로컬 연습 실측은 `03-infra-nginx.md`(v2, 작성 예정) 에 정리한다. 이 문서는 "손"만 담당.
>
> **표기**: `[로컬]` = 내 PC Git Bash / `[구EC2]` = 43.201.118.88 / `[신EC2]` = 새 계정 인스턴스 / `[콘솔]` = 웹 UI 외부 액션

---

## 0. 사전 조건 (하나라도 아니면 시작하지 말 것)

| # | 확인 | 방법 |
|---|---|---|
| 1 | 로컬 연습 완료 | ✅ 2026-08-26 실험 3종 통과(프록시 통과 / IP·trust proxy / 502→reload) |
| 2 | 이 트랙 파일 4개가 저장소에 있다 | `ls nginx/default.bootstrap.conf nginx/default.conf docker-compose.prod.yaml backend/src/main.ts` 전부 존재 + `git diff backend/src/main.ts` 에 `TRUST_PROXY_HOPS` 블록 |
| 3 | 도메인 `ansmoon.dev` 보유, Cloudflare 대시보드 로그인 가능 | ✅ 구매 완료(연 $12.20) |
| 4 | 새 AWS 계정 생성·결제수단 등록 완료, 콘솔 로그인 가능 | 새 계정 콘솔 우상단 → **Billing → Free Tier** 에서 프리티어 방식 확인(2025-07 이후 계정은 "크레딧 $100~200, 6개월" 방식). 여기서 본 잔여 크레딧/기간을 메모 |
| 5 | 구 EC2 SSH 가능 | `ssh -i ~/.ssh/shoppingApp-key.pem ubuntu@43.201.118.88 hostname` → `ip-172-31-43-205` |
| 6 | Docker Desktop 실행 중 + `docker login` 된 상태 | `docker info --format "{{.Username}}"` → `ansmoon` |
| 7 | 구 EC2 백업 로컬 사본 존재 | `ls ~/Desktop/fullstack/db-backups/20260817/` → `ec2.env.backup` 포함 4개 |

> 💡 **이 런북에서 "확인" 이란**: 브라우저가 아니라 **curl** 이다. `.dev` 도메인은 브라우저가 무조건 https 로
> 승격시키므로(HSTS preload) http 단계 검증을 브라우저로 하면 "연결 실패"처럼 보여 오판한다(결정 16).

---

## 1. [로컬] 이미지 빌드 + 태그 2종 + 푸시

> ✅ **코드 커밋·푸시는 2026-09-13 에 완료됐다** — `c6006ca`(이 트랙 본체) 포함 3커밋이 **main 에 직푸시**됨
> (PR 없이 진행하기로 결정). 따라서 아래 1-1 은 **이미 끝난 단계**이고, 지금 할 일은 1-2(빌드·푸시)뿐이다.
> 이 트랙 산출물을 더 고친 뒤 배포할 때만 1-1 을 다시 쓴다.

**왜 새 이미지가 필요한가**: 현재 Hub 의 `247a93a` 에는 `TRUST_PROXY_HOPS` 코드가 없다. 그 이미지를 nginx 뒤에 두면
모든 손님이 nginx 컨테이너 IP 로 보여 **로그인 레이트리밋을 전 세계가 공유**한다(로컬 실험 2-A 에서 재현). 반드시 새 빌드.

```bash
cd ~/Desktop/fullstack/shopping_mall

# 1-1. (완료됨 — 재작업 시에만) main 에서 이 트랙 산출물만 담아 커밋·푸시
#      ⚠ PR_DRAFT.md(파일 자체가 "커밋 금지" 명시)·.yarn/install-state.gz 는 제외한다
# git add backend/src/main.ts nginx/ docker-compose.prod.yaml \
#         docker-compose.nginx-practice.yaml .gitignore docs/roadmap/03-infra-nginx-runbook.md
# git commit -m "feat(infra): ..." && git push origin main

# 1-2. 최신 main 인지 확인한 뒤 빌드 + 푸시 (⚠ 20분 내외)
git checkout main && git pull
git status --short          # .yarn/install-state.gz 와 PR_DRAFT.md 외에는 깨끗해야 한다

GIT_SHA=$(git rev-parse --short HEAD)
echo $GIT_SHA               # 현재 7925788 — 이 값을 메모. §6·§8·§9 의 "버전 단언"에 계속 쓴다

docker build --build-arg GIT_SHA=$GIT_SHA \
  -t ansmoon/shopping-mall-backend:latest \
  -t ansmoon/shopping-mall-backend:$GIT_SHA .
docker push ansmoon/shopping-mall-backend:latest
docker push ansmoon/shopping-mall-backend:$GIT_SHA
```

- **[정상]** 푸시 끝에 `latest: digest: sha256:...` 와 `<GIT_SHA>: digest: sha256:...` 두 번
- **[멈춤]** 빌드 에러 → `yarn nx build backend` 로 로컬 재현 후 수정
- 💡 `:latest` 를 덮어썼지만 **구 EC2 는 pull 을 안 하는 한 영향 없다**(컨테이너는 이미 받아둔 이미지로 돈다). 구 EC2 에서 `pull`/`up -d` 를 실행하지 말 것 — 구 이미지에 없는 nginx 형상 compose 가 없어도, trust proxy 코드는 env 없이 무동작이라 사실 무해하지만 원칙상 구 EC2 는 이제 손대지 않는다.

---

## 2. [콘솔·새 계정] EC2 생성 + 탄력적 IP + 보안그룹 (외부 액션)

EC2 → **인스턴스 시작**:

| 항목 | 값 | 비고 |
|---|---|---|
| 리전 | **아시아 태평양(서울) ap-northeast-2** | 구 EC2 와 동일 (Vercel·사용자 지연 동일 유지) |
| 이름 | `shopping-mall` | |
| AMI | **Ubuntu Server 24.04 LTS (x86_64)** | 구 EC2 와 동일 |
| 인스턴스 유형 | **t3.small** (2 vCPU / 2GB) | 구 EC2 와 동일. §0-4 크레딧이 빠듯하면 t3.micro(1GB)+스왑도 가능하나 이미지 1.85GB·postgres·nginx 동거라 small 권장 |
| 키 페어 | **새로 생성** `shoppingApp-key-v2` (RSA, .pem) | 다운로드된 파일을 `~/.ssh/shoppingApp-key-v2.pem` 으로 이동. ⚠ **Windows 는 `chmod 400` 이 듣지 않는다** — 아래 PowerShell 로 권한을 좁혀야 한다(안 하면 `UNPROTECTED PRIVATE KEY FILE` 로 키가 무시됨) |
| 네트워크 → 보안그룹 | **새로 생성** `shopping-mall-sg`, 인바운드 규칙 3개(아래) | **4000 은 만들지 않는다** |
| 스토리지 | **20 GiB gp3** | 구 EC2 는 루트 19G(52% 사용) + DB 전용 5G 였다. 데이터가 mock(67MB) 이라 이번엔 루트 하나로 간다(선택: 부록 A 로 분리 가능) |

**보안그룹 인바운드 규칙** (한 번에 하나씩 추가, 저장 후 다시 열어 3개인지 확인):

| 유형 | 포트 | 소스 | 용도 |
|---|---|---|---|
| SSH | 22 | **내 IP** | 관리. 집 IP 가 바뀌면 이 규칙만 갱신 |
| HTTP | 80 | 0.0.0.0/0 | certbot 검증 + https 리다이렉트 |
| HTTPS | 443 | 0.0.0.0/0 | 실서비스 |

**[Windows] 키 파일 권한 좁히기** (PowerShell. `.ssh` 폴더에서 상속된 권한 + 옛 계정의 고아 SID 를 제거하고 본인만 읽기):

```powershell
$key = "$env:USERPROFILE\.ssh\shoppingApp-key-v2.pem"
icacls $key /inheritance:r /grant:r "$($env:USERDOMAIN)\$($env:USERNAME):(R)"
icacls $key      # → "<PC명>\<계정>:(R)" 한 줄만 남아야 정상
```

**탄력적 IP**: EC2 → 네트워크 및 보안 → **탄력적 IP** → 할당(리전 서울) → **작업 → 탄력적 IP 주소 연결** → 위 인스턴스.
할당된 주소를 메모: 이후 이 문서에서 **`<EIP>`** 로 부른다.

- **[정상]** 인스턴스 상태 `실행 중`, 퍼블릭 IPv4 = `<EIP>`, 보안그룹 인바운드 3개(22/80/443)
- **[멈춤]** 인스턴스에 탄력적 IP 가 아닌 자동 할당 IP 만 보임 → 연결 안 됨. 재부팅 시 IP 가 바뀌어 DNS 가 죽으므로 반드시 연결
- 💡 **왜 탄력적 IP 인가**: §7 에서 DNS 를 이 IP 에 고정한다. 자동 할당 IP 는 인스턴스 중지/시작마다 바뀐다. 실행 중인 인스턴스에 연결된 탄력적 IP 는 무료(미연결 상태로 놔두면 과금).

```bash
# [로컬] 접속 확인 (첫 접속은 fingerprint yes)
ssh -i ~/.ssh/shoppingApp-key-v2.pem ubuntu@<EIP> 'hostname; lsb_release -ds; free -h | head -2'
```

- **[정상]** `ip-172-31-...` / `Ubuntu 24.04.x LTS` / Mem 1.9Gi, **Swap 0B**(다음 단계에서 만든다)

---

## 3. [신EC2] OS 준비: 스왑 + Docker + 디렉터리

```bash
ssh -i ~/.ssh/shoppingApp-key-v2.pem ubuntu@<EIP>

# 3-1. 스왑 2GB (구 EC2 와 동일 — 2GB RAM 에서 빌드/시드 시 OOM 방지)
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h | grep Swap                      # → Swap: 2.0Gi

# 3-2. Docker (공식 편의 스크립트 → docker engine + compose v2 플러그인)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
exit                                     # ⚠ 그룹 반영을 위해 반드시 재접속
```

```bash
ssh -i ~/.ssh/shoppingApp-key-v2.pem ubuntu@<EIP>
docker compose version                   # → Docker Compose version v2.x
docker ps                                # → 빈 목록(에러 없이)

# 3-3. 디렉터리 — 구 EC2 와 같은 이름(대문자 S). ⚠ git clone 하지 않는다(구 EC2 의 "잔재 체크아웃 함정" 재발 방지):
#      compose 는 image: 방식이라 소스가 필요 없고, 필요한 파일 4개만 §4 에서 scp 로 넣는다.
mkdir -p ~/Shopping-mall/nginx/conf.d ~/Shopping-mall/certbot/www ~/Shopping-mall/certbot/conf ~/Shopping-mall/uploads
sudo mkdir -p /mnt/postgres-data         # compose 의 postgres 볼륨 경로(구 EC2 와 동일 경로 유지)
sudo chown 999:999 ~/Shopping-mall/uploads   # 백엔드 컨테이너 유저(nestjs uid 999) 가 써야 하므로
ls -ldn ~/Shopping-mall/uploads          # → drwxrwxr-x ... 999 999
exit
```

- **[정상]** 위 각 주석대로. `docker ps` 가 `permission denied` 면 재접속을 안 한 것
- 💡 `/mnt/postgres-data` 는 이번엔 루트 디스크의 평범한 디렉터리다(부록 A 로 별도 EBS 로 바꿀 수 있음). 경로를 유지한 이유는 compose 를 그대로 쓰기 위해서

---

## 4. [로컬] 파일 4개 전송 + `.env` 정리본 만들기

```bash
cd ~/Desktop/fullstack/shopping_mall
NEW=ubuntu@<EIP>; KEY=~/.ssh/shoppingApp-key-v2.pem

# 4-1. compose + nginx 설정 2종
scp -i $KEY docker-compose.prod.yaml        $NEW:~/Shopping-mall/
scp -i $KEY nginx/default.bootstrap.conf    $NEW:~/Shopping-mall/nginx/
scp -i $KEY nginx/default.conf              $NEW:~/Shopping-mall/nginx/

# 4-2. 구 EC2 의 .env 를 로컬(저장소 밖)로 가져온다
mkdir -p ~/Desktop/fullstack/db-backups/20260913
scp -i ~/.ssh/shoppingApp-key.pem ubuntu@43.201.118.88:~/Shopping-mall/.env ~/Desktop/fullstack/db-backups/20260913/ec2.env.old
cp ~/Desktop/fullstack/db-backups/20260913/ec2.env.old ~/Desktop/fullstack/db-backups/20260913/ec2.env.new
```

**4-3. `ec2.env.new` 를 VS Code 로 열어 정리** (`code ~/Desktop/fullstack/db-backups/20260913/ec2.env.new`).
구 파일에는 조사에서 확인된 문제 3건이 있다. 값은 그대로 두고 **줄만** 정리한다:

| 문제 | 조치 |
|---|---|
| `POSTGRES_USER`·`POSTGRES_PASSWORD`·`POSTGRES_DB`·`JWT_SECRET`·`JWT_REFRESH_SECRET` 가 **두 번씩** 있음 | 각각 **아래쪽(나중) 것만** 남기고 위쪽 삭제(compose 는 나중 값을 쓰므로 현재 동작과 동일) |
| `LLM_PROVIER=...` (오타, 코드는 `LLM_PROVIDER` 를 읽음) | `LLM_PROVIDER=gemini` 로 수정 |
| `PORTONE_IMP_KEY`·`PORTONE_IMP_SECRET` (V1 잔재, 코드 미사용) | 두 줄 삭제 (V2 는 `PORTONE_API_SECRET` 만 쓴다) |
| `TEST_POSTGRES_DB`, `POSTGRES_HOST`, `POSTGRES_PORT` | 운영 무관/compose 가 덮어씀. 있어도 무해하나 삭제 권장 |

정리 후 남아야 하는 변수(값은 본인 것): `POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB PORT PROTOCOL HOST MAIL_HOST MAIL_PORT MAIL_SECURE MAIL_USER MAIL_PASSWORD MAIL_FROM_NAME MAIL_FROM_ADDRESS FRONTEND_URL CORS_ORIGINS JWT_SECRET JWT_REFRESH_SECRET PORTONE_API_SECRET DEMO_LOGIN_ENABLED DEMO_ADMIN_EMAIL DEMO_ADMIN_PASSWORD SENTRY_DSN LLM_PROVIDER GEMINI_API_KEY GEMINI_MODEL`

```bash
# 4-4. 중복 검사 — 아무것도 안 나와야 정상
grep -E '^[A-Z]' ~/Desktop/fullstack/db-backups/20260913/ec2.env.new | cut -d= -f1 | sort | uniq -d
# 4-5. 전송
scp -i $KEY ~/Desktop/fullstack/db-backups/20260913/ec2.env.new $NEW:~/Shopping-mall/.env
ssh -i $KEY $NEW 'cd ~/Shopping-mall && ls -la && grep -c "^[A-Z]" .env'
```

- **[정상]** 4-4 출력 없음 / 4-5 마지막에 `docker-compose.prod.yaml`, `.env`, `nginx/`, `certbot/`, `uploads/` 가 보이고 변수 수 **25**
- **[멈춤]** `TRUST_PROXY_HOPS` 를 `.env` 에 넣고 싶어지더라도 넣지 말 것 — compose 의 `environment` 에 이미 있다(인프라 형상과 한 세트라 그쪽이 맞다)

---

## 5. [신EC2] 부트스트랩 설정 배치 + 문법 검사

```bash
ssh -i ~/.ssh/shoppingApp-key-v2.pem ubuntu@<EIP>
cd ~/Shopping-mall

# 인증서가 없으므로 지금은 80 전용(bootstrap) 설정만 conf.d 에 넣는다 (결정 12 닭-달걀)
cp nginx/default.bootstrap.conf nginx/conf.d/default.conf

# compose 파일 자체 검증 (env 치환·문법)
docker compose -f docker-compose.prod.yaml config --quiet && echo COMPOSE_OK
```

- **[정상]** `COMPOSE_OK`
- **[멈춤]** `variable is not set` 류 → `.env` 의 POSTGRES_* 확인

---

## 6. [신EC2] 기동 → 마이그레이션 → 시드 → IP 로 검증

```bash
# 6-1. 이미지 받기 (backend 1.85GB — 2~3분)
docker compose -f docker-compose.prod.yaml pull

# 6-2. 마이그레이션 (run --rm: postgres/redis 가 먼저 뜨고, 일회성 컨테이너가 스키마를 만든다)
docker compose -f docker-compose.prod.yaml run --rm backend node backend/dist/migrate.js
docker compose -f docker-compose.prod.yaml run --rm backend node backend/dist/migrate.js check
```

- **[정상]** `Migration Init... has been executed successfully.` → check 에서 `✓ 모든 마이그레이션 적용됨`
- **[멈춤]** `password authentication failed` → `.env` 정리 중 POSTGRES_* 를 잘못 남김(§4-3). `/mnt/postgres-data` 를 비우고(`sudo rm -rf /mnt/postgres-data/*`) 다시

```bash
# 6-3. 전체 기동 (backend healthy 후 nginx 가 뜬다 — 첫 헬스체크가 30초 뒤라 40초쯤 기다린다)
docker compose -f docker-compose.prod.yaml up -d
sleep 45; docker compose -f docker-compose.prod.yaml ps
```

- **[정상]** postgres/redis/backend `Up (healthy)`, nginx `Up`, certbot `Up`. **backend 의 PORTS 열이 비어 있다**(4000 미공개 — 의도)
- **[멈춤]** nginx 가 `Restarting` → `docker compose -f docker-compose.prod.yaml logs nginx --tail 20` → §13-A

```bash
# 6-4. 부팅 시드(roles/categories) + 시드 배치 (DB 런북 §6·§7 과 동일)
docker compose -f docker-compose.prod.yaml exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT (SELECT count(*) FROM roles) roles, (SELECT count(*) FROM categories) categories;"'
docker compose -f docker-compose.prod.yaml run --rm \
  -e NODE_SEED=true -e SEED_PRODUCTS=true -e SEED_DAYS=30 backend node backend/dist/main.js
```

- **[정상]** `roles=3, categories=27` → 시드 로그가 `✓ 데모 관리자 생성 완료` … `✅ Seed 완료!` 로 끝남(1~2분). `⚠ DEMO_ADMIN_EMAIL ... 미설정` 이면 `.env` 에서 그 두 줄이 빠진 것

```bash
# 6-5. 검증 ① 컨테이너 안에서 backend 직접 — 호스트 4000 이 없으니 exec 로 (DB 런북의 curl localhost:4000 은 이제 안 된다)
docker compose -f docker-compose.prod.yaml exec backend curl -s localhost:4000/v1/health; echo
# 6-6. 검증 ② nginx 경유, 로컬 PC 에서 IP 로 (exit 후 [로컬])
```

```bash
# [로컬]
curl -s http://<EIP>/v1/health; echo
curl -s -o /dev/null -w "%{http_code}\n" http://<EIP>/uploads/none.png
```

- **[정상]** ①②의 health 가 **동일 JSON** 이고 둘 다 `"version":"<§1 GIT_SHA>"`. `/uploads/none.png` 는 **404**(nginx 가 아니라 백엔드까지 갔다는 뜻 — nginx 자체 404 는 HTML, 백엔드 404 는 JSON. `-o /dev/null` 을 빼고 보면 구분된다)
- **[멈춤]** ② 가 타임아웃 → 보안그룹 80 누락(§2). ② 가 **502** → §13-B(reload). version 이 `247a93a` → §1 푸시 전 이미지. `pull` 후 `up -d` 재실행 + **nginx reload**(backend 재생성 = IP 변경 가능)

> 여기까지 오면 "IP 로 부르는 nginx → backend" 가 새 계정에서 성립한 것이다. 아직 도메인·인증서·Vercel 은 손대지 않았고
> 구 EC2 가 서비스를 계속 받고 있다. **여기서 문제가 생겨도 롤백할 것이 없다.**

---

## 7. [콘솔·Cloudflare] A 레코드 → DNS 검증

Cloudflare → `ansmoon.dev` → **DNS → Records → Add record**:

| Type | Name | IPv4 address | Proxy status | TTL |
|---|---|---|---|---|
| **A** | **api** | `<EIP>` | **DNS only (회색 구름)** ← 반드시 | Auto |

- 💡 **왜 회색 구름인가**(결정 10): 주황(Proxied)이면 `api.ansmoon.dev` 가 Cloudflare IP 로 응답한다. 그러면 ① certbot 의 HTTP-01 검증이 Cloudflare 를 통과해야 하고 ② TLS 가 Cloudflare 에서 끊겨 우리가 배우려는 "직접 TLS 종단" 구조가 아니게 된다. 이 트랙은 DNS 만 맡긴다.

```bash
# [로컬] 전파 확인 — Cloudflare 권위 서버(1.1.1.1)에 직접 물으면 보통 1분 내
nslookup api.ansmoon.dev 1.1.1.1
# 이름으로 nginx 경유 (⚠ 브라우저 말고 curl — HSTS)
curl -s http://api.ansmoon.dev/v1/health; echo
```

- **[정상]** `Address: <EIP>` / health JSON + version
- **[멈춤]** `NXDOMAIN` → 레코드 저장 안 됨 또는 Name 에 `api.ansmoon.dev` 를 통째로 넣어 `api.ansmoon.dev.ansmoon.dev` 가 된 경우(Name 은 `api` 만). Cloudflare IP(104.x/172.67.x) 가 나옴 → 주황 구름. 회색으로 바꾸고 1~2분 후 재확인

---

## 8. [신EC2] 인증서 발급(dry-run → 본발급) → 최종 설정 교체 → 443 검증

```bash
ssh -i ~/.ssh/shoppingApp-key-v2.pem ubuntu@<EIP>
cd ~/Shopping-mall

# 8-1. 리허설 — LE 는 실패 5회/시간 레이트리밋이 있다. 마운트 오타를 본발급으로 소모하지 않도록 반드시 dry-run 먼저
docker compose -f docker-compose.prod.yaml run --rm --entrypoint certbot certbot \
  certonly --webroot -w /var/www/certbot -d api.ansmoon.dev \
  --email kirianir@naver.com --agree-tos --no-eff-email --dry-run
```

- **[정상]** 끝에 `The dry run was successful.`
- **[멈춤]** `Invalid response ... 404` → nginx 의 acme 경로가 webroot 를 못 봄: `nginx/conf.d/default.conf` 가 bootstrap 본인지, compose 의 `./certbot/www` 두 마운트가 같은지 확인. `Timeout during connect` → SG 80 / DNS(§7). `DNS problem: NXDOMAIN` → §7 미전파

```bash
# 8-2. 본발급 (같은 명령에서 --dry-run 만 제거)
docker compose -f docker-compose.prod.yaml run --rm --entrypoint certbot certbot \
  certonly --webroot -w /var/www/certbot -d api.ansmoon.dev \
  --email kirianir@naver.com --agree-tos --no-eff-email
sudo ls -l certbot/conf/live/api.ansmoon.dev/
```

- **[정상]** `Successfully received certificate.` + `This certificate expires on <약 90일 뒤>` / `ls` 에 `fullchain.pem privkey.pem` (→ `../../archive/...` 심링크)

```bash
# 8-3. 최종 설정으로 교체 + 문법 검사 + reload (이 순서. -t 가 실패하면 reload 하지 않는다)
cp nginx/default.conf nginx/conf.d/default.conf
docker compose -f docker-compose.prod.yaml exec nginx nginx -t
docker compose -f docker-compose.prod.yaml exec nginx nginx -s reload

# 8-4. 갱신 루프도 미리 리허설 (본 갱신은 만료 30일 전부터 사이드카가 12h 마다 자동)
docker compose -f docker-compose.prod.yaml run --rm --entrypoint certbot certbot renew --dry-run
exit
```

- **[정상]** `syntax is ok` / `test is successful` / reload 는 `signal process started` / renew dry-run 은 `Congratulations, all simulated renewals succeeded`
- **[멈춤]** `-t` 가 `cannot load certificate` → 8-2 가 안 됐거나 경로 오타. **reload 하지 말고**(기존 80 설정이 계속 살아 있다) 원인 수정

```bash
# [로컬] 443 전 구간 검증
curl -s https://api.ansmoon.dev/v1/health; echo                                  # ① TLS + 프록시
curl -sI http://api.ansmoon.dev/v1/health | grep -iE "^HTTP|^location"           # ② 80 → 301 https
curl -s -o /dev/null -w "%{http_code}\n" http://api.ansmoon.dev/.well-known/acme-challenge/x   # ③ acme 경로는 리다이렉트 제외
echo | openssl s_client -connect api.ansmoon.dev:443 -servername api.ansmoon.dev 2>/dev/null | openssl x509 -noout -issuer -dates   # ④ 발급자·만료일
```

- **[정상]** ① health JSON + version ② `HTTP/1.1 301` + `location: https://api.ansmoon.dev/v1/health` ③ **404**(301 이 아님) ④ `issuer= ... Let's Encrypt`, `notAfter=` 약 90일 뒤
- 이제 브라우저로 `https://api.ansmoon.dev/v1/health` 를 열어도 된다(자물쇠 확인). http 는 여전히 브라우저로 시험하지 말 것

> 📌 **여기가 "새 경로 검증 완료" 지점.** 새 EC2 는 완전한 HTTPS API 가 됐고, 아직 아무 사용자도 타지 않는다.
> 마지막 관문(§9) 전에 하루 정도 두고 `docker compose ps` 로 재시작 루프가 없는지 한 번 더 보는 것을 권한다.

---

## 9. [콘솔·Vercel] 유일한 전환점 — `API_PROXY_TARGET` 교체 + 재배포

Vercel → 프로젝트 → **Settings → Environment Variables** → `API_PROXY_TARGET`:

| 항목 | 현재(메모해 둘 것 — 롤백 값) | 새 값 |
|---|---|---|
| Production | `http://43.201.118.88:4000/v1` (확인해 정확히 기록) | **`https://api.ansmoon.dev/v1`** |

저장 → **Deployments → 최신 Production 배포 → ⋯ → Redeploy** (⚠ 저장만으로는 무효 — rewrites 는 **빌드 시점**에 env 를 읽는다. 재배포 대화상자에서 "Use existing Build Cache" 는 **체크 해제**).

- 💡 소비처 4곳(`next.config.js` rewrites / `api/auth/{login,logout,refresh}` BFF / `lib/server-api.ts`)이 전부 같은 변수라 값 하나로 일괄 전환된다. `/uploads` rewrite 는 값에서 `/v1` 을 떼어 쓰므로 그대로 따라온다.
- **롤백 = 위 표의 "현재" 값으로 되돌리고 같은 방식으로 Redeploy**(분 단위). 구 EC2 는 §11 전까지 그대로 살아 있으므로 즉시 복귀된다.

배포 `Ready` 후 **브라우저**(이제부터는 브라우저가 맞다 — Vercel 사이트는 same-origin 이라 HSTS 무관):

| 확인 | 기대 | 이게 검증하는 것 |
|---|---|---|
| 상점 목록·상품 상세 | 이미지 포함 정상 | rewrites → https 경로 |
| 로그인(데모 관리자) → 새로고침해도 유지 | 성공 | BFF → https + refresh 쿠키 왕복 |
| 관리자 대시보드 | 차트 그려짐 | server-api.ts (RSC) |
| 관리자 → AI 어시스턴트에 질문 | 토큰이 **흘러나오듯** 표시 | SSE 가 `proxy_read_timeout 300s` 아래서 정상 |
| 셀러 상품 등록에서 이미지 업로드 | 성공 + 표시 | `client_max_body_size 10m` + uploads 볼륨 권한(uid 999) |

```bash
# [신EC2] 전환 직후 IP 관찰 — 로그인 레이트리밋 키에 "무엇"이 찍히는지
ssh -i ~/.ssh/shoppingApp-key-v2.pem ubuntu@<EIP> 'cd ~/Shopping-mall && docker compose -f docker-compose.prod.yaml exec redis redis-cli --scan --pattern "rate:login:*"'
```

- **[정상]** `rate:login:<Vercel/AWS 대역 IP>` — ⚠ **아직 진짜 손님 IP 가 아닌 게 정상이다.** 이 단계(4a)는 "수송로만" 바꾼 것이라 기록 IP 의 의미는 구 EC2 시절과 동일하다. 진짜 IP 복원은 §12-1(4b)에서 한다. 단, `rate:login:172.x.x.x`(nginx 컨테이너 IP)가 보이면 **[멈춤]** — `TRUST_PROXY_HOPS=1` 이 안 먹은 것(§1 이미지·compose 확인)

---

## 10. 관찰 기간 (3~7일) + UptimeRobot

- [콘솔·UptimeRobot] 무료 계정 → New Monitor → HTTP(s) → URL `https://api.ansmoon.dev/v1/health`, 간격 5분, 알림 이메일 `kirianir@naver.com` (결정 15 — LE 만료 경고 메일과 이중 안전망)
- 매일 한 번: Sentry `#sentry-errors` 채널 조용한지, UptimeRobot 100% 인지
- 이 기간 동안 **구 EC2 는 손대지 않는다**(롤백 대상). 새 EC2 에 문제가 있으면 §9 롤백 → 원인 수정 → 재전환

**이 기간 이후의 배포 표준 절차**(DB 런북 §1·§5·§6 에 nginx 한 줄이 추가된 형태):
```bash
# [로컬] build/push 2태그 → [신EC2]:
cd ~/Shopping-mall
docker compose -f docker-compose.prod.yaml pull backend
docker compose -f docker-compose.prod.yaml run --rm backend node backend/dist/migrate.js   # 마이그레이션이 있을 때
docker compose -f docker-compose.prod.yaml up -d
docker compose -f docker-compose.prod.yaml exec nginx nginx -t && docker compose -f docker-compose.prod.yaml exec nginx nginx -s reload   # ⚠ 필수 — backend 재생성 = IP 변경 = reload 전까지 502
curl -s https://api.ansmoon.dev/v1/health   # version == 새 GIT_SHA
```

---

## 11. [콘솔·구 계정] 구 EC2 종료 = "옛 문 폐쇄"

관찰 기간 이상 없음이 확인된 뒤에만. 순서대로, 되돌릴 수 있는 것부터:

1. **인스턴스 중지**(종료 아님) → 하루 더 관찰. 문제 생기면 시작 + §9 롤백
2. 구 EC2 백업 로컬 사본 최종 확인: `ls ~/Desktop/fullstack/db-backups/20260817/ ~/Desktop/fullstack/db-backups/20260913/`
3. **인스턴스 종료**(terminate) → 연결된 EBS(루트, `/mnt/postgres-data` 5G) 삭제 확인 → 탄력적 IP 가 있었다면 **릴리스**(미연결 EIP 는 과금)
4. Billing 에서 미결제 잔액 0 확인 → 계정 해지(선택; 해지 전 S3·기타 리소스 없음 확인)
5. 로컬 `~/.ssh/shoppingApp-key.pem` 은 보관만(삭제 불요). 이 문서의 `43.201.118.88` 언급은 역사 기록으로 남긴다

- 💡 새 EC2 는 4000 을 애초에 안 열었으므로, 원 계획의 "5단계: SG 4000 규칙 삭제 + ports 제거" 는 이 §11 로 **통째 대체**됐다

---

## 12. 후속 작업 (이 런북 완주 후 각각 별도 진행)

| # | 내용 | 비고 |
|---|---|---|
| 12-1 | **4b — 진짜 손님 IP 복원**: Vercel 측 코드(middleware + BFF fetch 헬퍼)가 `x-proxy-secret` + `x-client-ip`(**덮어쓰기**) 주입 → 백엔드 정규화 미들웨어(비밀 일치 시 XFF 를 그 한 값으로 교체, 원문은 `x-original-forwarded-for` 보존, 비밀 env 없으면 no-op) | 설계 확정(2026-08-29). 코드 작성 후 별도 미니 런북. 이후 Redis 키가 진짜 IP 로 바뀌는 것이 v2 문서의 "after 데이터" |
| 12-2 | PortOne 웹훅 등록: `https://api.ansmoon.dev/v1/payments/webhook`, 웹훅버전 **결제모듈 V2**, 모드 **테스트**, `application/json` → 호출 테스트 | 사용자 결정: 나중에. 도메인 기준이라 서버가 또 바뀌어도 불변 |
| 12-3 | 웹훅 서명 검증(Standard Webhooks, `PORTONE_WEBHOOK_SECRET`) | 파킹. 수신 즉시 PortOne 재조회라 위조 결제완료는 현재도 불가 |
| 12-4 | `frontend/next.config.js:176-179` 주석 정정 — "nginx 전환 시 rewrites 제거" 는 v1 설계(폐기). 실제로는 유지 + 값만 교체 | 문서 v2 와 함께 |
| 12-5 | `03-infra-nginx.md` v2 작성 + 외부 액션 체크리스트 (결정 16개·로컬 실측·이관 통합 사유·trust proxy 결정 변천) | E·F 종료 산출물 |
| 12-6 | `scripts/deploy.sh`(§10 표준 절차 스크립트화), Dockerfile prod-deps 구조 | DB 트랙 파킹 승계 |

---

## 13. 트러블슈팅

**A. nginx 가 뜨지 않음 / Restarting**
```bash
docker compose -f docker-compose.prod.yaml logs nginx --tail 20
```
| 로그 | 원인 → 조치 |
|---|---|
| `host not found in upstream "backend"` | backend 가 아직 없음/unhealthy. `ps` 로 backend 확인 후 `up -d nginx` |
| `cannot load certificate "/etc/letsencrypt/live/..."` | 발급 전에 최종 conf 를 넣음. `cp nginx/default.bootstrap.conf nginx/conf.d/default.conf` 후 `up -d nginx` → §8 순서대로 |
| `unknown directive "http2"` | nginx 1.25 미만(`nginx:alpine` 최신이면 해당 없음). `docker compose pull nginx` |
| `open() "/etc/nginx/conf.d/default.conf" failed` | `nginx/conf.d/` 가 비어 있음(§5 cp 누락) |

**B. 502 Bad Gateway** — 로컬 실험 3 그대로. backend 가 재생성돼 IP 가 바뀌었는데 nginx 가 옛 IP 를 들고 있다.
```bash
docker compose -f docker-compose.prod.yaml exec nginx nginx -s reload
```
확인: `docker compose -f docker-compose.prod.yaml logs nginx --tail 5` 에 `connect() failed (111: Connection refused) ... upstream: "http://172.x.x.x:4000"` 가 있었으면 정확히 이 경우. backend 자체가 죽은 경우(`ps` 에서 unhealthy)는 `logs backend` 로.

**C. certbot 실패** — §8-1 표 참조. 추가로 `too many failed authorizations` 가 나오면 레이트리밋(1시간 대기). dry-run 을 건너뛰었을 때만 생긴다.

**D. 브라우저에서 `http://api.ansmoon.dev` 가 "연결할 수 없음"** — 고장이 아니다. `.dev` HSTS preload 로 브라우저가 https 를 강제하는데 §8 전엔 443 이 없다. curl 로 확인한다.

**E. `docker: permission denied while trying to connect`** — §3-2 후 재접속 안 함. `exit` 후 다시 ssh.

**F. 셀러 이미지 업로드 500 / `EACCES: permission denied, open '/app/uploads/...'`** — `sudo chown 999:999 ~/Shopping-mall/uploads` (§3-3). 확인 `ls -ldn ~/Shopping-mall/uploads` → `999 999`.

**G. `curl localhost:4000/v1/health` 가 EC2 호스트에서 실패** — 정상. 4000 은 이제 호스트에 없다. `docker compose -f docker-compose.prod.yaml exec backend curl -s localhost:4000/v1/health`.

**H. Cloudflare 에서 526/525 또는 인증서 발급이 계속 404** — 주황 구름. 회색(DNS only)으로.

**I. Vercel 전환 후 로그인만 실패(401/네트워크 에러)** — BFF 가 `API_PROXY_TARGET` 을 빌드 시점에 읽는다. Redeploy 를 캐시 없이 했는지 확인. 값 끝에 `/v1` 이 빠지지 않았는지(`https://api.ansmoon.dev/v1`).

**K. [Windows] `Permission denied (publickey)` / `UNPROTECTED PRIVATE KEY FILE` / `Connection closed by ... port 22`**
세 증상 모두 같은 원인 — 키 파일 권한이 넓어 OpenSSH 가 키를 **무시**한 것이다(서버·키 자체 문제가 아님). §2 의 "[Windows] 키 파일 권한 좁히기" 를 실행한다.
확인: `icacls $key` 출력이 `<PC명>\<계정>:(R)` **한 줄뿐**이어야 한다. `(I)` 표시(상속)나 `UNKNOWN\UNKNOWN`(옛 계정의 고아 SID)가 보이면 아직 안 고쳐진 것.
실측(2026-09-14): `.ssh` 폴더에서 상속된 SYSTEM/Administrators/사용자/고아SID 4개가 원인이었고, 위 명령으로 해소됨.

**J. 자주 하는 실수**
| 증상 | 원인 |
|---|---|
| `no such service` | `-f docker-compose.prod.yaml` 누락 |
| `docker-compose: command not found` | `docker compose`(공백) |
| health 에 version 이 `247a93a` | §1 이미지를 pull 못 함. `pull` → `up -d` → **nginx reload** |
| 최종 conf 로 바꿨는데 예전처럼 동작 | `nginx -s reload` 누락. 또는 `cp` 가 아니라 에디터 저장으로 바꿈(디렉터리 바인드라 이것도 되긴 하나 `-t` 후 reload 는 어차피 필요) |
| 시드가 "이미 있다"며 스킵 | 멱등 동작. 갈아엎으려면 `-e SEED_RESET=true` |

---

## 부록 A. (선택) postgres 데이터를 별도 EBS 로 분리하기 — 구 EC2 형상 그대로

mock 데이터라 필수 아님. 인스턴스를 갈아엎어도 DB 를 살리고 싶을 때만. **§6 전에** 한다(데이터가 생긴 뒤엔 이동 절차가 추가됨).

1. [콘솔] EBS → 볼륨 생성(gp3 5GiB, **인스턴스와 같은 가용영역**) → 작업 → 볼륨 연결 → 디바이스 `/dev/sdf`
2. [신EC2]
```bash
lsblk                                   # nvme1n1 5G 가 보인다 (마운트 없음)
sudo mkfs.ext4 /dev/nvme1n1
sudo mount /dev/nvme1n1 /mnt/postgres-data
UUID=$(sudo blkid -s UUID -o value /dev/nvme1n1)
echo "UUID=$UUID /mnt/postgres-data ext4 defaults,nofail 0 2" | sudo tee -a /etc/fstab   # nofail: 볼륨이 없어도 부팅은 되게(구 EC2 와 동일)
df -h /mnt/postgres-data                 # 4.9G
```
compose 는 변경 없음(경로 동일).
