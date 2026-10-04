# data2flow-web

data2flow 화면과 BFF입니다. React Router v8 프레임워크 모드(SSR, Vite) + React 19 + TypeScript로 만들고, 브라우저는 토큰 없이 HttpOnly 세션 쿠키(`data2flow_session`)만 갖습니다. Access·Refresh 토큰은 BFF가 서버 쪽에 보관하고, 브라우저의 API 호출은 `/bff/api/{svc}/**`로 받아 내부 gateway에 Bearer로 중계합니다(ADR-024, design/auth.md §9). 화면 문구는 한국어·영어·일본어·중국어 4개 언어입니다(ADR-037).

- 관련 스펙: IAM(로그인·세션·회원·권한·감사), OPS-07(조직·외부 서비스 설정), M2 수집 경로 화면(DSC·DEV·DSH·ING·SCR·TSD), M3 폐루프(가상) 화면(FLW·ACT·SIM·DEV-03.03), M4 자동화 완성 화면(RUL·FLW·ACT·OPS-05·06·DSH·DEV-02.07·02.09) (정본은 비공개 저장소 `data2flow-docs`)
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
| `DATA2FLOW_MESSENGER_TELEGRAM_SECRET` | (없음) | `/hooks/messenger/telegram` 비밀 토큰(k8s Secret `data2flow-web`). 없으면 그 채널은 404 |
| `DATA2FLOW_ACTION_URL` | `http://data2flow-action` | 메신저 콜백 내부 중계 대상(gateway를 거치지 않는 유일한 예외, `X-CALLER-SERVICE: data2flow-web`) |
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
| `/automation/templates`, `/automation/approvals` | 템플릿 갤러리(core 템플릿 `hot-then-cool` "고온이면 냉방"·`co2-then-ventilate` "CO2 높으면 환기", `?template=&spaceId=` 미리 채움, FLOW_WRITE만), 제어 노드 적용 승인 | FLW-01.05, FLW-05.06 |
| `/devices/{id}?tab=control`, `?tab=commands`, `/control/commands` | 기기 제어 패널(desired/reported/delta, 명령 진행 실시간), 명령 이력 | ACT-02.04·04.02·04.03 |
| `/devices/{id}?tab=virtual`, `/models/{code}?tab=package` | 가상 기기 설정, 모델 제어 드라이버 연결(DRIVER_MANAGE만) | SIM-09.02, DEV-03.03 |
| `/sim`, `/sim/catalog`, `/sim/profiles`, `/sim/spaces`, `/sim/scenarios`, `/sim/runs/{id}`, `/sim/replay` | 가상 환경 홈·카탈로그·키트·프로필·가상 공간 물리·시나리오 타임라인·실행 제어(x1~x60)·장애 주입·결과·파일 재생 | SIM-01.01·01.02·04.01·04.02·05.03·06.03·09.01~03 |

- 실시간: 명령 상태 `/bff/stream/live?topics=commands:{deviceId},space:{spaceId}`(`command-status` {commandId, deviceId, capability, command, status, reason, message, source{…flowName·userName}}, `device-update` {deviceId, connection, state{reported, delta, reportedVersion, origin, at}}), 시뮬레이션 실행 `/bff/stream/sim/runs/{id}`(API-SIM-31: `sim.tick`·`sim.event`·`sim.status`·`sim.throttle`).
- 플로우 저장·적용(API-FLW-03·07): 초안을 저장할 때마다 새 번호를 받고 응답 `draftVersion`이 다음 저장의 `baseVersion`이다(다르면 409). 적용의 `baseVersion`은 지금 ACTIVE 번호(없으면 0)이고, 제어 노드·실행 모드가 바뀌면 `acknowledgedRisks: true`가 필요하다(없으면 400). 승인 필요 설정이면 202 `{approvalId, version}`. 검증 문제는 `{field, code, message}`이고 `field`의 `nodes[<id>]`·`wires[<i>]`로 노드를 찾는다(ADR-044). 모든 노드(트리거 포함)에 `error` 출력 포트가 있다.
- 플로우 지표: 목록의 `metrics1h`와 엔진 지표(API-FLW-14)를 아직 받을 수 없으면 "지표 없음"으로 보인다.
- 가상 환경: 공간·프리셋 목록은 `GET /core/sim/spaces`·`/core/sim/presets`(프리셋에 `scenarioId`), 오류 상세는 응답 `errors[]`, 파일 재생은 10MB까지(재생 API는 core M4).
- 플로우 캔버스는 `@xyflow/react`(MIT, 하위 의존성 MIT·ISC). 라이브 뷰(WebSocket)·시험 실행·서브플로우는 M4에서 만든다.

## M4 자동화 완성 화면

| 경로 | 화면 | 스펙 |
|---|---|---|
| `/rules`, `/rules/new`, `/rules/{id}`, `/rules/tuning` | 규칙 목록·편집기(조건 빌더: 임계값·지속·히스테리시스·변화율·무수신·반복·복합, 시간 조건, 적용 범위, 템플릿, 정책)·시뮬레이션(히트맵)·튜닝 제안, 데이터 탐색 차트 기준선에서 만들기 | RUL-01.01~01.13, RUL-06.02~06.04 |
| `/alarms`, `/alarms/{id}`, `/alarms/stats`, `/notifications/silences` | 알람 목록(실시간·일괄 확인·토폴로지 묶기·360px)·상세(확인·해제·메모·담당자·타임라인·발송 이력)·통계·무음 | RUL-02.01~02.07, RUL-04.01~04.03, RUL-06.01 |
| `/notifications/policies`, `/notifications/templates`, `/notifications/on-call` | 알림 정책(에스컬레이션·묶기·재알림)·템플릿(변수·미리 보기)·당직 | RUL-03.02~03.06, RUL-05.01·05.03 |
| `/me/notifications` | 내 정보 알림 수신·텔레그램 계정 연결·방해 금지 | OPS-06.05, RUL-05.02·05.04 |
| `/admin/maintenance`, `/admin/channels` | 유지보수 일정, 알림 채널(설정 스키마 폼·테스트 발송·발송 이력·재발송) | OPS-05.01~05.02, OPS-06.01·06.03·06.06 |
| `/automation/flows/{id}` | 라이브 뷰(노드 카운터·상태 배지·샘플)·추적·시험 실행(드라이런)·과거 재생·JS 노드 시험 실행·적용 확인(상태 정책 표시·섀도우)·바이패스·동시 편집 표시·지표·설정·설명서·서브플로우 | FLW-01.04, FLW-03.01~03.06, FLW-05.05, FLW-06.01~06.10, FLW-10.01, FLW-11.01·11.06 |
| `/automation/sink-connections`, `/automation/snapshots`, `/automation/pipelines`(`?promote={flowId}`), `/automation/packages`, `/settings/git-sync` | Sink 연결(테스트·스키마·실패 보관함)·스냅샷·승격 파이프라인과 대상 매핑·확장 노드·Git 동기화 | FLW-04.01, FLW-09.01~09.03, FLW-11.02~11.05 |
| `/control/scenes`, `/control/schedules`, `/control/interlocks`, `/control/drivers`, `/control/capabilities`, `/device-jobs` | 장면(미리 보기)·예약·인터락·드라이버·기능 카탈로그·일괄 작업, 기기 목록 일괄 제어 | ACT-01.04, ACT-02.06·02.07, ACT-03.03~03.06, ACT-05.01·05.03, ACT-06.02, DEV-02.09 |
| `/devices/{id}?tab=control\|operation\|rules\|history` | 표준 컨트롤·수동 우선 남은 시간·LoRaWAN 대기, 가동·효과, 규칙·알람, 변경 이력, 차트 명령 띠, 온보딩 체크리스트 | ACT-04.01·06.05·07.02·08.01·08.02, DEV-02.07, DEV-09.01 |
| (헤더) ⏻, 전역 띠 | 자동화 비상 정지(빨강)·유지보수(주황) 띠, 해제 권한자만 [해제] | ACT-06.03, OPS-05.01 |
| `/`, `/spaces/{id}?tab=alarms`, `/sites` | 홈 알람 카드·최근 알람·자동 제어 타임라인, 공간 알람 탭, SVG 사이트 지도 | DSH-01.01·01.03·02.01·05.04·07.01·09.01 |
| `/sources/{id}?tab=usage`, `/scripts/{id}?tab=usage`, `/sim/catalog?type=new`, `/sim/replay`, `/sim/runs/{id}/report` | 소스·스크립트 사용처, 사용자 정의 가상 기기 유형, 보관 원본 재생(기본, `?mode=file` 파일), 시나리오 기대 결과 | DSC-07.06, SCR-04.04, SIM-04.06·06.01·09.06 |

- 실시간 알람: `EventSource('/bff/stream/alarms')`(API-RUL-14 `alarm.raised`·`alarm.updated`·`alarm.cleared`). 홈·공간은 `/bff/stream/live?topics=home,alarms`(API-DSH-20). `/alarms?state=`는 `status`의 다른 이름이다(홈 알람 카드 링크).
- 플로우 라이브 뷰·편집 참여는 WebSocket(`/bff/stream/flows/{id}`, `/bff/stream/flows/{id}/presence`)이고 BFF가 세션 쿠키·Origin을 확인한 뒤 gateway `/api/v1/core/stream/flows/**`에 Bearer로 중계합니다(API-FLW-40·42). 그래서 운영 서버는 `server.mjs`(react-router-serve와 같은 정적·SSR 처리 + upgrade, SIGTERM 정리)이고 `pnpm start`·Dockerfile이 이것을 씁니다. `pnpm dev`도 Vite 플러그인으로 같은 중계를 씁니다. 추가 의존성: `express`·`@react-router/express`·`ws`·`compression`(모두 MIT).
- 메신저 콜백 `POST /hooks/messenger/{channel}`(design/auth.md §9.3, API-RUL-31): 세션·CSRF 대상이 아니고, 허용 채널은 `telegram`뿐입니다. `X-Telegram-Bot-Api-Secret-Token`을 상수 시간 비교(틀리면 본문을 읽지 않고 401), 1MB 초과 413, `update_id` 중복은 Redis `data2flow:hook:msg:telegram:{id}`(10분, Redis가 없으면 메모리)로 200 무시, 원본 본문을 action `/internal/action/notifications/callbacks/telegram`에 넘기고 기다리지 않고 200을 돌려줍니다.
- 메신저 콜백 비밀값: BFF 환경 변수 `DATA2FLOW_MESSENGER_TELEGRAM_SECRET`(없으면 404)와 core 텔레그램 채널의 `webhookSecret`이 같아야 합니다. action이 같은 헤더를 채널 정의의 `webhookSecret`과 다시 비교하고, 버튼 데이터 `ACK|{alarmId}|{deliveryId}`(또는 `MUTE_30M|…`)를 연결된 계정 권한으로 core `/internal/core/alarms/{id}/ack|mute`에 넘깁니다. action 주소는 `DATA2FLOW_ACTION_URL`(기본 `http://data2flow-action`).
- 비상 정지 띠는 `/bff/stream/live?topics=notifications` 연결로 받는 `emergency-stop` 이벤트(토픽과 관계없이 조직의 모든 연결에 옴)로 그리고 지웁니다. 같은 연결의 `notification`은 오른쪽 아래 알림으로 띄웁니다(읽음 수 없음). 유지보수 띠는 실시간 토픽이 없어 5초마다 조회합니다(API-OPS-23).

## M5 데이터 관리 화면

### 데이터 소스: 커넥터 22종 스키마 폼·출력 연결·엣지

| 경로 | 화면 | 스펙 |
|---|---|---|
| `/sources/new`, `/sources/new/{connectorKey}`, `/sources/{id}/edit` | 커넥터 카탈로그(분류 `CLOUD_HUB` 등 contracts ConnectorCategory, 템플릿 11종), 커넥터 설정 스키마 폼(API-DSC-56 JSON Schema → 탭·필드·검사, 조건부 필드, 배열·객체), 인증 방식 매트릭스, TLS 탭(최소 버전·SNI·인증서 고정·CA 묶음·클라이언트 인증서), 토픽 템플릿 미리 보기·디코더 적용, 단계별 연결 테스트(대기·진행 아이콘, 폴링형 "첫 폴링", 시간 초과, TLS 체인, 원문 복사) | DSC-09.01·09.05·09.06·09.08·09.11·09.12 |
| `/sources/new/webhook` | Webhook 수신 소스: 저장 응답의 수신 URL(`https://data2flow-hook.java21.net/ingest/webhook/{key}`)과 HMAC 비밀값을 한 번만 표시, 목록은 "수신 대기" | DSC-01.03 |
| `/sources/{id}` [복제] → `/sources/{id}/edit?cloned=1` | 복제(비밀값은 복사되지 않음 안내) | DSC-07.05 |
| `/sources?tab=outputs`, `/outputs/new`, `/outputs/{id}` | 출력 연결 목록(분당 전송·실패·지연)·편집(토픽 템플릿 변수 4개만, 공용 브로커 금지, 비밀 헤더는 비밀값으로, 필터·형식·배치)·테스트 발송·1분 지표·실패 보관함 다시 보내기 | DSC-04.01 |
| `/sources/edges`, `/sources/edges/{id}?tab=overview\|config\|update\|logs` | 엣지 등록(토큰·설치 명령 1회), 설정 판 저장·배포·롤백, 업데이트 승인, 재시작·로그 수집·폐기, 등록 전 토큰 재발급 | DSC-08.03 |

- 카탈로그 커넥터(type `CONNECTOR`)는 `connection`을 커넥터 스키마 그대로 보내고, 저장 전에 core `JsonSchemaLite`와 같은 키워드로 브라우저와 BFF가 먼저 검사합니다. 새 커넥터가 생겨도 웹 코드를 바꾸지 않습니다.
- 인증 방식은 스키마 `auth`(enum) 또는 `auth.type`(HTTP 폴링·SSE)에 저장하고, 없으면 지원 방식으로 비밀값 칸만 바꿉니다. API-DSC-02 `secret`은 한 건이라 첫 필수 비밀값(mTLS는 `{cert, key, ca}`)을 넣고 나머지는 저장 뒤 API-DSC-58 `PUT /core/sources/{id}/secrets/{kind}`로 보냅니다. 실패한 종류는 상세 화면에 경고합니다.
- MQTT 구독은 `connection.tls{minVersion, sni, pinnedSha256}`을 저장하고, 다른 커넥터는 스키마에 `tls`가 있을 때만 저장합니다(지금 ingress 스키마에는 없어 CA·클라이언트 인증서만 비밀값으로).
- 토픽 템플릿(DSC-09.08)은 서버 저장 필드가 아직 없어, 기기 ID·측정 항목 위치를 디코더 설정의 토픽 참조(`deviceIdFrom: "topic[i]"`, single-value `metricFrom`)로 옮깁니다. 공간 변수는 미리 보기만 합니다.
- 연결 테스트는 제한 시간(5~30초) + 3초 안에 응답이 없으면 "시간 초과"로 끝냅니다. core API-DSC-57 새 설정 테스트는 기본 유형만 받으므로, 카탈로그 커넥터는 저장한 뒤 상세·편집의 [연결 테스트](`/sources/{id}/test`)로 확인합니다.
- 가짜 core: `test/msw/handlers/sources-m5.ts`(카탈로그·템플릿·스키마는 ingress `connectors/*.schema.json`을 묶은 `test/msw/connector-schemas.json`).

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

## M3 폐루프(가상) 시연 검증(e2e)

`e2e/m3-demo.sh`는 plan/milestones.md §M3 시연을 실제 서비스로 끝까지 돌립니다. 정식 경로는 simulator(가상 강의실 물리 모델) → `data2flow.raw` → pipeline → `data2flow.telemetry` → flow-engine → 아웃박스 → `data2flow.actions` → action(제어 창구, virtual 드라이버) → simulator 가상 에어컨 → 물리 모델 → 다시 수집입니다.

1. 관리자 로그인(BFF)과 초기 비밀번호 변경을 합니다.
2. 조직 프로필 "강의실 천장형 에어컨 10kW"를 만듭니다(API-SIM-08). 카탈로그 기본 에어컨은 3.5kW인데, 재실 15명·외기 35℃에서는 24℃까지 내리지 못하기 때문입니다.
3. 표준 강의실 키트로 "가상 강의실 301"을 만듭니다. 기기는 온습도 2·CO2·재실·에어컨·공기청정기·환기, 모두 7대입니다.
4. 키트가 제안한 묶음으로 "고온이면 냉방"(`hot-then-cool`) 플로우를 만들고, 검증한 뒤 적용합니다. 이어서 flow-engine 적용 확인(`applyStatus.converged`)을 기다립니다.
5. "폭염 오후" 시나리오를 x60으로 실행합니다. 조건은 8/10 12:00 KST 시작, 외기 최고 35℃, 12:20부터 재실 15명입니다.
6. 27℃ 이상이 5분 이어지면 플로우가 `Thermostat.set {mode: cool, targetTemperature: 24}`를 냅니다(출처 FLOW). 명령은 `APPLIED`까지 가고, 가상 온도가 내려가 명령 60~90분 뒤(시뮬레이션) 24±1℃를 유지하는지 봅니다.
7. 확인은 BFF SSE(`/bff/stream/live?topics=commands:{에어컨},space:{공간}`)의 `command-status`·`device-update`와 명령 이력, 기기 상세 화면으로 합니다.
8. 플로우를 일시정지한 뒤, 같은 시드로 "폭염 오후(재현)" 1시간을 x60으로 두 번 실행합니다. 두 실행 결과 리포트의 `dataSha256`(SIM-08.03 결정적 재현)이 같아야 합니다.

- 공용 인프라(s3·s4·`iot-data.java21.net`)는 쓰지 않습니다. PostgreSQL 18·Valkey 8·RabbitMQ 4(stream 플러그인)·Mailpit을 임시 컨테이너로 띄웁니다. MQTT는 전혀 쓰지 않습니다: simulator는 `data2flow.raw`에 직접 넣고, action의 MQTT 드라이버는 끕니다. 끝나면 컨테이너와 프로세스를 모두 지웁니다.
- 형제 디렉터리의 `data2flow-auth`·`api-gateway`·`core-api`·`pipeline`·`flow-engine`·`action`·`simulator`를 빌드해 프로필 `e2e`로 실행합니다. 이 시연에서만 flow-engine 실행과 action 큐 소비를 켭니다. `data2flow-contracts`는 로컬 저장소에 설치돼 있어야 합니다(`./mvnw install`, 공용 모듈 `data2flow-script-sandbox` 포함).
- 키와 비밀번호는 실행마다 새로 만들어 `WORK_DIR/keys.env`(권한 600)에만 둡니다. 남는 기록은 다음과 같습니다: 결과 `WORK_DIR/results.txt`, 실행 기록(실제 초·시뮬레이션 시각·공간 온도) `WORK_DIR/trace.tsv`, SSE 기록 `WORK_DIR/sse-live.txt`.

```bash
e2e/m3-demo.sh                          # 빌드 + 시연(약 12분)
SKIP_BUILD=1 WORK_DIR=/tmp/m3 e2e/m3-demo.sh
SEED=7 KEEP=1 e2e/m3-demo.sh            # 재현 시드를 바꾸고, 끝나도 컨테이너·프로세스를 남긴다(디버깅)
```

포트 41025·45432·45552·45672·46379·48025·48780~48798을 씁니다. 결과 예시는 다음과 같습니다(2026-10-04 기준): 27℃ 도달 8분 뒤(시뮬레이션) 명령이 나갔고, 이때 실행 시작 후 실제 시간은 약 20초였습니다. 명령 직후 최고 28.0℃였고, 시뮬레이션 10분 뒤 24.7℃, 60~90분 뒤 24.2℃였습니다. 재현 실행 두 번의 SHA-256은 `294dbe90…34b72`로 같았습니다.

## M4 자동화 완성 시연 검증(e2e)

`e2e/m4-demo.sh`는 plan/milestones.md §M4 시연(시나리오 2 전체, 시나리오 6, 시나리오 7의 2~3단계)을 실제 서비스로 끝까지 돌립니다. 효과 확인(15분)·지속 판정(5분)·무수신(5분)·게이트웨이 오프라인 기준(120초)은 실제 시간으로 재므로 운영 단계는 측정 시각 `WALL_CLOCK`(x10)으로 돌리고, 15분 효과 확인을 기다리는 동안 시나리오 7과 6을 함께 진행합니다(ADR-054).

1. 관리자 로그인 → 텔레그램 채널 저장(가짜 Bot API, action이 `setWebhook`으로 BFF `/hooks/messenger/telegram`과 비밀 헤더 값을 등록) → 계정 연결(`/start {코드}` 콜백, 틀린 비밀 헤더는 401) → 알림 정책(WARNING 이상 → 관리자 텔레그램).
2. **시나리오 2:** 가상 강의실 키트와 "고온이면 냉방"(27℃ 5분) 플로우 → "폭염 오후" 3시간을 x60으로 흘려 저장(플로우 미적용) → 그 구간 과거 재생(API-FLW-13, 드라이런이라 명령 이력 0건) → 적용 → 온도 센서 고착(29℃) → 5분 뒤 `Thermostat.set {cool, 24}` APPLIED → 15분 뒤 효과 확인 NO_EFFECT → EVT-ACT-04 → "제어 효과 없음" WARNING 알람 → 가짜 텔레그램 알림, 기기 이력(API-DEV-27) → 라이브 뷰(BFF WebSocket `/bff/stream/flows/{id}`)의 `node.stats`.
3. **시나리오 7의 2~3단계:** CO2 고착(1,200ppm) → "CO2 높으면 환기"(30분 지속) 적용 → 지속 타이머 대기 → 평균과 기준 사이에 `transform.js` 노드를 끼워 운영 중 적용 → 같은 타이머 행·같은 만기 유지 → 즉시 롤백 → 그대로 유지.
4. **시나리오 6:** 센서 무수신 규칙(5분, 엔진 컴파일) → 가상 게이트웨이 오프라인 기준 120초 → 게이트웨이 다운 → MAJOR 게이트웨이 알람 1건, 하위 무수신 알람은 SUPPRESSED(PARENT)로 묶임 → 텔레그램 알림 1건 → 메신저 [확인] 콜백(비밀 헤더)으로 ACKNOWLEDGED(같은 `update_id` 재전송은 한 번만) → 복구 → 게이트웨이·하위 알람 함께 해제, 실시간 `alarms` 토픽으로 발생·확인·해제 수신, 장애 구간 수신 공백.

- 공용 인프라(s3·s4·`iot-data.java21.net`·`api.telegram.org`)는 쓰지 않습니다. PostgreSQL 18·Valkey 8·RabbitMQ 4(stream)·Mailpit·Mosquitto(action MQTT 드라이버용, 버림)를 임시 컨테이너로 띄우고, 텔레그램 Bot API는 스크립트가 띄우는 가짜 HTTP 서버(127.0.0.1)로 대신합니다. 웹은 WebSocket 중계가 있는 `node server.mjs`로 띄우고 `DATA2FLOW_MESSENGER_TELEGRAM_SECRET`·`DATA2FLOW_ACTION_URL`을 줍니다. 끝나면 컨테이너와 프로세스를 모두 지웁니다.
- 남는 기록: 결과 `WORK_DIR/results.txt`, 가짜 텔레그램 요청 `WORK_DIR/telegram.jsonl`, 라이브 뷰 `WORK_DIR/live-view.jsonl`, SSE `WORK_DIR/sse-live.txt`, 재생 결과 `WORK_DIR/replay.json`, 서비스 로그 `WORK_DIR/logs`.

```bash
e2e/m4-demo.sh                          # 빌드 + 시연(빌드 뒤 약 25분)
SKIP_BUILD=1 WORK_DIR=/tmp/m4 e2e/m4-demo.sh
JARS_DIR=/path/to/jars SKIP_BUILD=1 e2e/m4-demo.sh   # 다른 곳에서 만든 jar를 먼저 쓴다
KEEP=1 e2e/m4-demo.sh                   # 끝나도 컨테이너·프로세스를 남긴다(디버깅)
```

포트 41883·42025·46432·46552·46672·47379·49025·49780~49799를 씁니다. 결과 예시(2026-10-04, 56개 확인 모두 통과): 과거 재생은 저장된 828건으로 361회 실행하고 냉방 명령 1건(드라이런)을 셌습니다. 운영 적용 뒤 303초에 냉방 명령이 APPLIED였고, 15분 뒤 효과 확인은 29→29℃로 NO_EFFECT였습니다. 게이트웨이 다운 173초 뒤 게이트웨이 알람이 났고 하위 무수신 알람 3건이 묶였으며, 텔레그램 알림은 1건이었습니다. 복구 90초 뒤 게이트웨이·하위 알람이 함께 해제되었습니다. 라이브 뷰는 `node.stats`를 193번 받았습니다.
