# data2flow-web

data2flow 화면과 BFF입니다. React Router v8 프레임워크 모드(SSR, Vite) + React 19 + TypeScript로 만들고, 브라우저는 토큰 없이 HttpOnly 세션 쿠키(`data2flow_session`)만 갖습니다. Access·Refresh 토큰은 BFF가 서버 쪽에 보관하고, 브라우저의 API 호출은 `/bff/api/{svc}/**`로 받아 내부 gateway에 Bearer로 중계합니다(ADR-024, design/auth.md §9). 화면 문구는 한국어·영어·일본어·중국어 4개 언어입니다(ADR-037).

- 관련 스펙: IAM(로그인·세션·회원·권한·감사), OPS-07(조직·외부 서비스 설정), M2 수집 경로 화면(DSC·DEV·DSH·ING·SCR·TSD), M3 폐루프(가상) 화면(FLW·ACT·SIM·DEV-03.03), RUL 화면 (정본은 비공개 저장소 `data2flow-docs`)
- 포트: 8080. 프로브는 `/healthz`

## 구조

| 위치 | 내용 |
|---|---|
| `app/bff/` | 세션 쿠키(AES-256-GCM, `kid` 교체), CSRF 토큰 + Origin 검사, Access 캐시(메모리 / 선택 Redis), Refresh 회전·single-flight, gateway 중계, 보안 헤더(CSP nonce·HSTS 등) |
| `app/bff/stream-proxy.server.ts` | 실시간 연결 중계 `/bff/stream/**` → gateway `/api/v1/core/stream/**`(SSE). 브라우저는 세션 쿠키로만 연결하고 Bearer는 BFF가 붙인다 |
| `app/routes/` | 로그인(TOTP 2단계), 초대 수락, 비밀번호 재설정, 가입 신청, 개인정보 안내, 내 정보, 회원·역할·보안 설정·감사 로그·시스템 설정, M2 화면(아래 표) |
| `app/features/{기능}/` | M2 화면별 부품과 화면 모델(검증·요청 본문·변환) |
| `app/lib/`, `app/components/` | 화면 공용 도우미와 부품(공통 시계열 차트, 코드 편집기, 실시간 연결 훅, 공간 선택) |
| `test/` | SSR 통합 테스트(실제 라우트 + MSW 가짜 gateway), 테스트 도구 |

## 환경 변수

| 이름 | 기본값 | 설명 |
|---|---|---|
| `DATA2FLOW_GATEWAY_URL` | `http://data2flow-api-gateway` | 클러스터 내부 gateway |
| `DATA2FLOW_PUBLIC_ORIGIN` | `https://data2flow.java21.net` | CSRF Origin 검사 기준, canonical 주소 |
| `DATA2FLOW_ALLOWED_ORIGINS` | (없음) | 추가 허용 Origin(쉼표). 로컬 개발은 `http://localhost:5173` |
| `DATA2FLOW_SESSION_KEYS` | 운영 필수 | `kid:base64(32바이트)`를 쉼표로. 첫 키로 암호화, 나머지는 복호화만(교체용). k8s Secret |
| `DATA2FLOW_COOKIE_SECURE` | `true` | `false`면 Secure 속성을 뺀다(로컬 http 전용) |
| `DATA2FLOW_SESSION_IDLE_MINUTES` | `30` | 유휴 만료(IAM-03.01, 5~240) |
| `DATA2FLOW_SESSION_ABSOLUTE_HOURS` | `12` | 최대 수명(1~24) |
| `DATA2FLOW_REFRESH_TTL_HOURS` | `6` | 쿠키 Max-Age(Refresh 수명) |
| `DATA2FLOW_GATEWAY_TIMEOUT_MS` | `12000` | gateway 호출 제한 시간 |
| `DATA2FLOW_TRUSTED_PROXY_HOPS` | `1` | X-Forwarded-For 끝에서 건너뛸 신뢰 프록시 수(사용자 IP 결정) |
| `DATA2FLOW_REDIS_URL` | (없음) | 있으면 Access 캐시를 Redis(`data2flow:bff:at:{sid}`)에도 두고 폐기 알림(`data2flow:auth.revocations`)을 구독. data2flow 전용 ACL 사용자일 때만 설정 |
| `DATA2FLOW_SIGNUP_REQUEST_ENABLED` | `false` | 대체값만. 로그인 화면 [가입 신청] 링크와 `/signup`은 core 공개 API `GET /api/v1/core/public/signup-settings`(API-IAM-74)의 조직 설정을 따르고, 그 호출이 실패할 때만 이 값을 쓴다 (IAM-01.08) |

## M2 수집 경로 화면

| 경로 | 화면 | 스펙 |
|---|---|---|
| `/` | 홈: 요약 카드, 공간 쾌적도, 빈 조직 안내 | DSH-01.02, DSH-08.02 |
| `/spaces`, `/spaces/{id}?tab=…` | 공간 트리·속성·목표 환경·운영 시간·평면도, 공간 보기(실시간) | DEV-01.01~04, DEV-11.01, DSH-01.02 |
| `/sites` | 사이트 요약 | DEV-10.01 |
| `/devices`, `/devices/pending`, `/devices/new`, `/devices/{id}?tab=…` | 기기 목록·승인 대기·추가·상세(실시간 차트) | DEV-02.01·02.03·02.04·02.10·13.01 |
| `/models`, `/metrics`, `/device-groups` | 기기 모델, 측정 항목·미검증·별칭, 그룹 | DEV-03.01, DEV-04.01·04.02, DEV-06.01, DEV-07.05 |
| `/explore` | 데이터 탐색(품질·가상 필터, 주석) | TSD-01.04·01.05·03.01·03.04·03.05 |
| `/sources`, `/sources/new`, `/sources/{id}` | 데이터 소스 등록·연결 테스트·상태·실시간 원본 | DSC-01·02·07·09 |
| `/ingest/monitor`, `/ingest/failures` | 수집 흐름 모니터, 실패 메시지 | DSH-03, ING-07.03, OPS-01.02 |
| `/scripts`, `/scripts/{id}` | 스크립트 목록, 편집기(Monaco)·정적 검사·테스트 실행 | SCR-03.01·03.02·04.05 |

- 실시간: 브라우저 `EventSource('/bff/stream/live?topics=…')`(API-DSH-20), `/bff/stream/ingest`(API-ING-03), `/bff/stream/sources/{id}/live`(API-DSC-10). 끊기면 1→30초 백오프로 다시 연결하고, 세션이 끝났으면 모든 탭을 로그인 화면으로 보낸다.
- 차트는 ECharts(Apache-2.0, `echarts/core`에서 필요한 부품만), 편집기는 Monaco(MIT). 둘 다 해당 화면에서만 지연 로딩한다. Monaco의 JS 언어 서비스 워커는 같은 출처 파일이라 CSP(`script-src 'self'`)를 바꾸지 않는다.
- 테마: 사용자 메뉴에서 시스템·라이트·다크(쿠키 `data2flow_theme` + 화면 설정 API-DSH-12).

## M3 폐루프(가상) 화면

| 경로 | 화면 | 스펙 |
|---|---|---|
| `/automation/flows`, `/automation/flows/new`, `/automation/flows/{id}` | 플로우 목록, 편집기(React Flow 캔버스·팔레트·설정 패널·JS 노드 Monaco·적용 확인·버전 비교·롤백·오류 탭) | FLW-01.01·01.02·01.05·01.06·03.07·05.03·05.06 |
| `/automation/templates`, `/automation/approvals` | 템플릿 갤러리("고온이면 냉방" 등, `?template=&spaceId=` 미리 채움), 제어 노드 적용 승인 | FLW-01.05, FLW-05.06 |
| `/devices/{id}?tab=control`, `?tab=commands`, `/control/commands` | 기기 제어 패널(desired/reported/delta, 명령 진행 실시간), 명령 이력 | ACT-02.04·04.02·04.03 |
| `/devices/{id}?tab=virtual`, `/models/{code}?tab=package` | 가상 기기 설정, 모델 제어 드라이버 연결 | SIM-09.02, DEV-03.03 |
| `/sim`, `/sim/catalog`, `/sim/profiles`, `/sim/spaces`, `/sim/scenarios`, `/sim/runs/{id}`, `/sim/replay` | 가상 환경 홈·카탈로그·키트·프로필·가상 공간 물리·시나리오 타임라인·실행 제어(x1~x60)·장애 주입·결과·파일 재생 | SIM-01.01·01.02·04.01·04.02·05.03·06.03·09.01~03 |

- 실시간: 명령 상태 `/bff/stream/live?topics=commands:{deviceId},space:{spaceId}`(`command-status`·`device-update`), 시뮬레이션 실행 `/bff/stream/sim/runs/{id}`(API-SIM-31: `sim.tick`·`sim.event`·`sim.status`·`sim.throttle`).
- 플로우 캔버스는 `@xyflow/react`(MIT, 하위 의존성 MIT·ISC). 라이브 뷰(WebSocket)·시험 실행·서브플로우는 M4에서 만든다.

## 개발

```bash
pnpm install
DATA2FLOW_ALLOWED_ORIGINS=http://localhost:5173 DATA2FLOW_COOKIE_SECURE=false pnpm dev   # http://localhost:5173
pnpm lint
pnpm typecheck
pnpm test:coverage     # server(node: BFF·도우미) + ssr(node: 실제 라우트 + 가짜 gateway, 파일 순차) + client(jsdom: 부품), 커버리지 80%, i18n 키 일치
pnpm build && pnpm start
```

## M1 전 구간 시연 검증(e2e)

`e2e/m1-demo.sh`는 plan/milestones.md §M1 시연을 실제 서비스로 끝까지 돌립니다: 최초 관리자 Job → 관리자 로그인·비밀번호 변경 → 메일 설정·OPERATOR 초대 → 초대 메일(Mailpit) → 초대 수락 → 사용자 로그인 → 회원 관리 API 403·관리자 메뉴 없음 → 쿠키 검사(불투명 세션 쿠키 하나, JWT 없음) → 관리자 강제 로그아웃 → 사용자 다음 요청이 로그인으로 → 감사 로그.

- 공용 인프라(s3·s4)는 쓰지 않습니다. PostgreSQL 18·Valkey 8·RabbitMQ 4·Mailpit을 임시 컨테이너로 띄우고, 끝나면 컨테이너와 프로세스를 모두 지웁니다.
- 형제 디렉터리의 `data2flow-auth`·`data2flow-api-gateway`·`data2flow-core-api`를 빌드해 프로필 `e2e`로 실행하고(기본 `local` 프로필은 루트 `.env`의 공용 인프라 값을 읽으므로 쓰지 않음), 이 저장소는 운영 빌드(`react-router-serve`)로 띄웁니다. 모든 요청은 curl 쿠키 저장소로 BFF(`/login`, `/bff/api/**`, 화면 폼)를 거칩니다.
- 키(JWT·마스터·세션)와 비밀번호는 실행마다 새로 만들어 `WORK_DIR/keys.env`(권한 600)에만 둡니다.

```bash
e2e/m1-demo.sh                          # 빌드 + 시연(약 2분)
SKIP_BUILD=1 WORK_DIR=/tmp/m1 e2e/m1-demo.sh   # 이미 빌드한 jar·build 재사용, 결과·로그 위치 지정
KEEP=1 e2e/m1-demo.sh                   # 끝나도 컨테이너·프로세스를 남긴다(디버깅)
```

필요: docker, Java 21, Node 22 + pnpm, curl, python3, openssl, lsof. 포트 25432·26379·25672·21025·28025·28780~28798을 씁니다.

문구를 추가할 때는 `app/i18n/locales/{ko,en,ja,zh}.json`(공통) 또는 기능별 `app/i18n/features/{기능}/{ko,en,ja,zh}.json` 네 파일에 같은 키를 넣습니다. 기능별 파일은 공통 문구에 깊게 합쳐집니다(`errors` 같은 키도 합쳐짐). 키나 보간 변수가 하나라도 다르면 테스트가 실패합니다.

## M2 수집 경로 시연 검증(e2e)

`e2e/m2-demo.sh`는 plan/milestones.md §M2 시연(시나리오 1의 1~3단계)을 실제 서비스로 끝까지 돌립니다: 관리자 로그인(BFF) → 공간 만들기 → ChirpStack MQTT 소스 저장 전 연결 테스트(최근 메시지 미리보기) → 소스 저장·활성화(상태 `CONNECTED`가 실시간 `sources` 토픽으로 반영) → 아카데미 6종(EM300-TH·EM320-TH·EM500-CO2·AM103·AM107·WS302) ChirpStack v4 업링크 → 기기 PENDING 자동 등록 → 모델·공간 지정 승인 → BFF SSE로 `device-update`·`point` 수신 → 시계열 조회와 1분 집계. 이어서 플랫폼 브로커 직결 기기를 확인합니다: 승인 전 서명 없는 값은 quality 2로 격리 → 승인 때 서명 키 1회 → 서명이 맞으면 quality 0 → 서명 없음·틀린 서명은 `DEVICE_SIGNATURE_INVALID`로 거부(측정값 저장 0건).

- 공용 인프라(s3·s4·`iot-data.java21.net`)는 쓰지 않습니다. PostgreSQL 18·Valkey 8·RabbitMQ 4(stream 플러그인)·Mailpit·Mosquitto 2(ChirpStack 브로커 흉내)를 임시 컨테이너로 띄우고, 업링크는 이 임시 Mosquitto에만 발행합니다. 끝나면 컨테이너와 프로세스를 모두 지웁니다.
- 형제 디렉터리의 `data2flow-auth`·`api-gateway`·`core-api`·`ingress`·`pipeline`을 빌드해 프로필 `e2e`로 실행합니다. `data2flow-contracts`는 로컬 저장소에 설치돼 있어야 합니다(`./mvnw install`). 업링크 본문은 pipeline의 골든 픽스처(`src/test/resources/golden/chirpstack`)에 시각·`deduplicationId`·`fCnt`를 새로 채운 것입니다.
- 키와 비밀번호는 실행마다 새로 만들어 `WORK_DIR/keys.env`(권한 600)에만 둡니다. 결과는 `WORK_DIR/results.txt`, SSE 기록은 `WORK_DIR/sse-*.txt`에 남습니다.

```bash
e2e/m2-demo.sh                          # 빌드 + 시연(약 6분, 1분 집계를 기다림)
SKIP_BUILD=1 WORK_DIR=/tmp/m2 e2e/m2-demo.sh
KEEP=1 e2e/m2-demo.sh                   # 끝나도 컨테이너·프로세스를 남긴다(디버깅)
```

포트 31025·31883·35432·35552·35672·36379·38025·38780~38798을 씁니다.
