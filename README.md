# data2flow-web

data2flow 화면과 BFF입니다. React Router v8 프레임워크 모드(SSR, Vite) + React 19 + TypeScript로 만들고, 브라우저는 토큰 없이 HttpOnly 세션 쿠키(`data2flow_session`)만 갖습니다. Access·Refresh 토큰은 BFF가 서버 쪽에 보관하고, 브라우저의 API 호출은 `/bff/api/{svc}/**`로 받아 내부 gateway에 Bearer로 중계합니다(ADR-024, design/auth.md §9). 화면 문구는 한국어·영어·일본어·중국어 4개 언어입니다(ADR-037).

- 관련 스펙: IAM(로그인·세션·회원·권한·감사), OPS-07(조직·외부 서비스 설정), M2 수집 경로 화면(DSC·DEV·DSH·ING·SCR·TSD), M3 폐루프(가상) 화면(FLW·ACT·SIM·DEV-03.03), M4 자동화 완성 화면(RUL·FLW·ACT·OPS-05·06·DSH·DEV-02.07·02.09), M5 데이터 관리 화면(DSH-04·06·08.04·11·13.01 등), M6 분석·AI 화면(ANA·AIA·IAM-05·DSH-04.04·SCR-03.07) (정본은 비공개 저장소 `data2flow-docs`)
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
| `DATA2FLOW_PREVIEW_LOGIN_ID`·`DATA2FLOW_PREVIEW_LOGIN_PASSWORD` | (없음, 꺼짐) | **로컬 미리보기 전용**(OPS-08.01, ADR-057). 둘 다 있으면 로그인 폼에 이 아이디·비밀번호를 미리 채우고 "로컬 미리보기: 관리자 계정이 미리 채워져 있습니다" 안내를 보인다. `DATA2FLOW_PUBLIC_ORIGIN`의 호스트가 `localhost`·`127.0.0.1`이고 `DATA2FLOW_COOKIE_SECURE=false`일 때만 켜지고, 그 밖에는 경고 로그만 남기고 꺼진다(운영 주소·Secure 쿠키에서는 넣어도 켜지지 않음). 값은 `e2e/local-preview.sh`가 실행 때 `~/.data2flow-preview/keys.env`에서 넘기며 저장소·매니페스트에 넣지 않는다 |

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

### 평면도·공간 탐색·외부 맥락(floor)

| 경로 | 화면 | 스펙 |
|---|---|---|
| `/spaces/{id}?tab=floorplan` | 평면도 보기: 마커 현재값 + 상태 색·기호(✔ 정상·▲ 알람·✕ 오프라인), 마커 팝업(현재값 전체·[기기 상세]), `space:{id}` 실시간 갱신, [히트 컬러](IDW 보간, 색약 친화 팔레트, 범례 최저~최고, "보간 추정"), 확대·이동. 편집은 `&edit=1`(DEV_ADMIN) | DSH-02.02, DSH-02.03 |
| `/spaces/{건물}?tab=floorplan&floor={층}`, `/spaces/{층}?tab=floorplan` | 층 전환 바(▲▼, URL에 층 유지, 층마다 확대 초기화) | DSH-12.04 |
| `/spaces/{건물}?tab=model3d` | [3D] IFC 모델 목록·열람(매핑 요소는 공간 상태 색, 매핑 없음 회색, 열람 전용), IFC 올리기(.ifc ≤200MB)·공간 연결·삭제(DEV_ADMIN) | DSH-12.04 |
| (공간 화면 머리) | 위치 경로 사이트 › 건물 › 층(평면도) › 실, `?from=portfolio`면 앞에 포트폴리오 | DSH-09.02 |
| `/spaces/{id}?tab=schedule` | 운영 모드 수동 지정·해제(DEV_PLACE, API-DEV-08 POST) | DEV-11.02 화면 |
| `/calendar` | 조직 달력: 월·주·목록, 유형 색 + 출처 기호(✎ 수동·★ 공휴일·⇩ iCal), 범위 필터, 일정 추가·수정·삭제(DEV_PLACE), 자동 일정은 운영 모드 영향만 | DEV-12.01 |
| `/sources/context`, `/sources/context/{siteId}` | 외부 맥락: 기상청 날씨(격자 nx·ny)·대기질(가까운 측정소 5곳)·공휴일·학사일정(iCal URL/파일, 카테고리 → 유형 매핑) 켜기·설정(SRC_ADMIN), 지금 갱신, 호출량 막대 90일(80% 경고·100% 중지·비용) | DSC-06.01·06.02·06.04·06.05 |

- core API: `GET /core/buildings/{id}/floors`, `GET|POST /core/buildings/{id}/models`, `GET|DELETE …/models/{mid}`, `PUT …/models/{mid}/space-mapping`, `…/file`(API-DSH-24), `GET|POST /core/calendar-events`, `GET|PATCH|DELETE /core/calendar-events/{id}`(API-DEV-100~102), `POST /core/spaces/{id}/override-mode`, `GET /core/sites/{id}/context-sources`, `PUT …/context-sources/{type}`, `GET /core/sources/{id}/api-usage?days=90`, `POST /core/sources/{id}/refresh-now`, `GET /core/external/airkorea-stations`, `POST /core/sources/ical/upload`(API-DSC-40~45).
- core 평면도 응답(API-DSH-03)은 마커 좌표만 주므로 현재값·연결 상태는 공간 요약(API-DSH-02)과 실시간 `device-update`로 채우고, 열린 알람이 있으면 알람 상태로 그린다. 히트 컬러 보간은 화면에서 계산한다(SVG 격자, 캔버스 없음).
- 3D 렌더링(web-ifc + three.js)은 넣지 않았다. [3D] 탭은 IFC 공간 요소를 상태 색 타일로 보여 주고 원본은 [IFC 내려받기]로 연다.

### 데이터 비교·내보내기·가져오기·보관·저장 지표

| 경로 | 화면 | 스펙 |
|---|---|---|
| `/explore` | 여러 측정 항목·기기 비교(단위별 축 2개, 단위 3개 이상이면 정규화 보기 제안, 50개면 추가 버튼 비활성), 기간 1년, [내보내기] 대화상자(형식·긴/넓은 형식 예시 3행·품질·시간대·예상 행 수, 진행 중 3개면 막음, [정기 내보내기로 저장]) | TSD-03.03, TSD-04.01 |
| `/exports?tab=jobs\|schedules\|dictionary` | 내보내기 작업(진행 중이면 5초마다 다시 읽음, 다운로드·취소), 정기 내보내기(반복·기간·메일/S3·SFTP·[연결 테스트]·켜기/끄기), 데이터 사전(판 번호·측정 항목·품질 코드·공간 계층, HTML·JSON) | TSD-04.01·04.03·07.02·07.04 |
| `/imports`, `/imports/new`, `/imports/{id}` | 가져오기: CSV(앞 20행 미리 보기·시각 파싱 실패 줄·열 매핑) 또는 InfluxDB(URL·org·bucket·토큰·기간·field 매핑) → 미리 실행 → [가져오기 실행], 진행률·오류 목록 내려받기 | TSD-04.02 |
| `/settings/data-retention` | 데이터 보관(조직 기본 13종·재정의·저장 현황·장기 보관 파일 목록), 기간이 줄면 영향 미리 보기 후 확인 토큰으로 저장. 저장은 ADMIN, INTEGRATOR는 보기 | TSD-05.01, TSD-02.01·05.03 |
| `/admin/system` | 시스템 상태 중 저장 지표(DB 용량·상위 테이블·DB 크기 추이·디스크 여유, 20% 미만 경고) | OPS-01.03 |

- 큰 파일 중계: `/bff/api/**` 제한 시간(`DATA2FLOW_GATEWAY_TIMEOUT_MS`)은 응답 머리까지만 셉니다. 1년치 CSV처럼 본문이 오래 걸리는 내려받기는 브라우저가 끊을 때까지 흘려보내고, 브라우저가 끊으면 gateway 요청도 끊습니다. 데이터 가져오기 CSV(`POST /bff/api/core/imports`, multipart)는 버퍼에 담지 않고 2GB까지 흘려보냅니다(응답 머리 제한 30분). 그 밖의 요청 본문은 10MB 그대로입니다.
- 내보내기 다운로드는 core가 준 서명 주소(`/api/v1/core/exports/{id}/file?expires=&signature=`, 1시간)를 `/bff/api/core/…`로 바꿔 엽니다. 완료 알림 SSE(EVT-TSD-01)는 core 실시간 토픽에 아직 없어 목록을 5초마다 다시 읽습니다.
- 권한: 내보내기 TS_EXPORT, 가져오기 TS_IMPORT, 보관 TS_POLICY(+ 저장은 ADMIN), 데이터 사전 TS_READ, 저장 지표 OPS_MANAGE.
### 기기·모델(검색식·모델 교환·표준 내보내기·게이트웨이·표시 단위)

| 경로 | 화면 | 스펙 |
|---|---|---|
| `/devices?q=…&saved=…` | 검색식 입력(입력 중 문법 검사·오류 열 밑줄·자동완성), 저장된 검색(공유), 결과 수·소요 시간, 선택 기기·공간 [표준 형식 내보내기](DTDL v3·NGSI-LD·Brick, NGSI-LD 주기 전송) | DEV-13.03, DEV-13.04 |
| `/models`, `/models/{code}` | 모델 [가져오기](미리 보기 → 가져오기, data2flow·DTDL), [내보내기(data2flow)]·[내보내기(DTDL)] | DEV-03.04 |
| `/gateways`, `/gateways/{id}?period=24h\|7d\|30d` | 게이트웨이 목록(24시간 수신 기기·업링크), 상세(시간대별 업링크·RSSI 분포 차트, 기기별 평균 RSSI·SNR·최적 경로 비율, 이름·공간·오프라인 기준 수정) | DEV-05.02 |
| `/metrics`(조직 기본), `/me/profile`(본인) | 표시 단위 ℃/℉. 기기 상세 현재값·데이터 차트와 데이터 탐색 차트가 표시 단위로 바뀌고 저장값은 그대로(22.0℃ → 71.6℉) | DEV-04.04 |

- API: 검색식 `GET /core/devices?q=`(API-DEV-133, `counts{total,tookMs}`, 400 `DEVICE_QUERY_INVALID`의 `response.column`), 저장된 검색 API-DEV-134, 모델 API-DEV-44·45(multipart `file`·`format`·`createMissingMetrics`·`dryRun`), 표준 내보내기 API-DEV-135(202 `{jobId}` → `GET /core/export-jobs/{id}`, 끝나지 않았으면 2초마다) · 파일 `/core/export-jobs/{id}/file`, NGSI-LD 주기 전송 API-DEV-136, 게이트웨이 API-DEV-60~62, 조직 단위 API-DEV-57, 사용자 단위 API-DSH-12 `temperatureUnit`(`effectiveTemperatureUnit`).
- 실패 응답의 `response`는 BFF 화면 도우미에서 `ApiFailure.detail`로 읽는다(검색식 오류 열). 검색식은 서버가 열을 세므로 앞뒤 공백을 그대로 보낸다.
- 검색식 문법 검사(`app/features/devmodel/model/query.ts`)는 core `DeviceQueryParser`와 같은 문법·열 번호이고, 판정은 서버가 다시 한다.
### 현장 작업(작업 지시·자산·QR·현장 설치·모바일)

| 경로 | 화면 | 스펙 |
|---|---|---|
| `/work-orders?view=mine\|all\|dueSoon\|overdue&spaceId=&deviceId=`, `/work-orders/{id}`, `/work-orders/plans` | 작업 지시 목록(통계: 열린·지연·평균 처리 시간, 마감 임박 48시간)·생성·상세(체크리스트·첨부·댓글·상태 전이·유형별 완료 결과)·정기 점검 계획(DEV_ADMIN) | DEV-08.02·08.05·08.06 |
| `/devices/{id}?tab=asset` | 자산 정보(시리얼·구매·설치·보증 만료·공급처·사진)와 QR 라벨(미리 보기·재발급·PDF 인쇄) | DEV-08.01, DEV-09.04 |
| `/devices/installation?siteId=` | 설치 현황판(층별 예정·완료·확인·문제, 칸 → 기기·체크리스트, 목록 라벨 인쇄, 실시간 `space:{사이트}`의 `commissioning`) | DEV-13.06 |
| `/d/{qrToken}` | QR 딥링크: 로그인(`next`) → core `GET /qr/{token}` → 302 `/m/devices/{id}`, 재발급된 라벨·권한 밖은 404 안내 | DEV-09.04 |
| `/m/alarms`, `/m/spaces`, `/m/work-orders`, `/m/work-orders/{id}`, `/m/notifications`, `/m/scan`, `/m/devices/{id}` | 모바일 셸(하단 탭, 오프라인 띠, 360px·44px 버튼): 알람·공간·작업(체크·사진·완료)·내 알림·QR 스캔·기기 상세 | DSH-13.04, DEV-09.04 |
| `/m/commission?token=` | 현장 설치: QR 스캔 → 기기 확인·공간 → 평면도 위치(비율 x·y) → 사진 0~5장 → 저장 → 첫 수신 대기(10분, 점검 체크리스트) | DEV-13.05 |

- 오프라인 대기열(BR-DSH-22, BR-DEV-37): 연결이 없을 때 만든 체크·사진·완료·현장 설치를 IndexedDB(`data2flow-field`, 없으면 메모리)에 넣은 순서대로 보관했다가 `online` 이벤트에 보냅니다. 작업마다 처음 정한 `Idempotency-Key`(현장 설치는 `clientOpId`)를 다시 보내므로 같은 작업은 한 번만 반영됩니다. 409 `COMMISSION_CONFLICT`는 서버 기록과 내 입력을 나란히 보여 줍니다.
- QR 스캔은 브라우저 `BarcodeDetector`(후면 카메라)를 쓰고, 없거나 카메라를 거부하면 라벨 주소·토큰을 직접 넣습니다. 새 의존성은 없습니다(QR 그림은 기존 `qrcode`, MIT).
- `/bff/api` 중계는 multipart 업로드를 60MB까지 받습니다(첨부·자산 사진 파일당 20MB, 현장 설치 사진 5장). PDF 등 바이너리 응답은 `Content-Disposition`과 함께 그대로 넘깁니다.
- 작업 지시 목록 API에 기기 필터가 없어 기기별 보기(`deviceId`)·모바일 기기 상세는 그 기기 공간으로 거른 뒤 대상 기기로 다시 거릅니다.
### 대시보드·키오스크·공유 링크·브랜딩

| 경로 | 화면 | 스펙 |
|---|---|---|
| `/dashboards?tab=mine\|shared\|favorite` | 대시보드 목록(카드·기본 표시·복제·기본으로·JSON 내보내기·가져오기·삭제, 키오스크에 넣기) | DSH-04.07 |
| `/dashboards/{id}?var-space=31` | 대시보드 보기(변수·시간 범위·집계·새로고침, 위젯 메뉴: 데이터 표로 보기·PNG·CSV·전체 화면, 드래그 확대 동기화·[초기화], 대시보드 PNG, 기능 투어) | DSH-04.05, DSH-06.01, DSH-08.04, DSH-11.01·11.03·11.04, NFR-01.09 |
| `/dashboards/{id}/edit` | 편집(위젯 라이브러리, 24열 격자 끌어 놓기·크기 조정·복제·삭제와 키보드 조작, 위젯 설정·옵션 스키마 폼, 대시보드 설정·변수, 저장 충돌 모달) | DSH-04.01, DSH-04.05 |
| `/kiosk?boards=1,2&interval=60` | 키오스크(앱 틀 없음, 자동 순환·진행 막대·시계, 세션 유지) | DSH-06.02 |
| `/share/{token}`, `/share/d/{token}` | 공유 링크 보기(로그인 없음, 읽기 전용) | DSH-06.03 |
| `/admin/branding` | 브랜딩(로고 2종·파비콘·로그인 배경, 주 색상 대비 경고, 문구·메일 서명, 미리 보기). 웹 헤더 로고·주 색상에 적용 | DSH-13.01 |

- 첫 화면(NFR-01.09): loader가 정의(API-DSH-06)와 읽는 순서로 앞쪽 위젯 12개의 데이터(API-DSH-09)를 병렬로 받아 서버에서 그린다(위젯 하나가 2초를 넘기면 그 위젯만 브라우저가 다시 받음). 이후 갱신은 위젯마다 따로(`/bff/api/core/dashboards/{id}/widgets/{wid}/data`), 변수가 바뀌면 그 변수를 쓰는 위젯만 다시 요청한다. 실시간(LIVE)은 `telemetry:{기기}.{항목}` `point`를 받으면 그 위젯만 1초 묶음으로 다시 조회한다.
- 공유 링크: 화면은 세션을 쓰지 않고 gateway 공개 경로 `GET /api/v1/core/public/share/{token}`만 부른다. 위젯 데이터는 BFF 공개 경로 `GET /share/{token}/widgets/{wid}/data?q=`(쿠키·CSRF 없음, 범위·집계·변수만 골라 `POST …/public/share/{token}/widgets/{wid}/data`로 중계). 응답에 `Referrer-Policy: no-referrer`·`X-Robots-Tag: noindex`, hreflang·canonical 없음. 토큰 경로 레이트 리밋은 gateway 몫(TC-DSH-068). core가 주는 공유 주소는 `/share/{token}`(문서 00-navigation은 `/share/d/{token}`이라 둘 다 받는다).
- 키오스크 세션: 화면이 4분마다 `GET /bff/api/core/accounts/me`를 보내 유휴 만료를 늦추고, Access 만료는 BFF가 Refresh로 서버 쪽에서 갱신해 화면을 다시 불러오지 않는다. 지금 보이는 대시보드 하나만 그리고 순환하면 이전 부품을 내려 차트를 dispose한다(24시간 메모리 소크 TC-DSH-064는 staging Playwright 몫).
- 브랜딩 자산은 BFF 공개 경로 `/branding/assets/{id}`(→ `/api/v1/core/public/branding/assets/{id}`, 이미지 형식만, CSP sandbox)로 내려준다.
- 차트 기본 팔레트(`app/lib/palette.ts`)는 색약 3종 시뮬레이션에서도 인접 색 ΔE00 ≥ 10, 배경 대비 ≥ 3:1(TC-DSH-098). 상태는 색 + 아이콘·글자.
- 기본 대시보드로 지정하면 화면 설정 `home: DASHBOARD`도 함께 바꿔 `/`가 그 대시보드로 열린다(`/?summary`는 홈 요약).

### 스크립트·수식·재처리·데이터 품질

| 경로 | 화면 | 스펙 |
|---|---|---|
| `/scripts/{id}?tab=tests\|config\|ops` | 테스트 케이스(저장·모두 실행·차이), 설정값(`ctx.config`, 비밀값 이름 거부), 운영(버전별 처리·오류·평균·p95, 배포 시점 선, 성능 경고와 원인 후보, 오류 스냅샷 100건 → [이 입력으로 테스트], 로그 수집 30분) | SCR-03.03·03.05·04.02·05.01·05.02·05.03 |
| `/scripts/{id}` 배포 대화상자 | 배포 전 테스트 케이스 n/n(실패하면 배포 불가, ADMIN 강제 배포 사유 10자 이상), 배포 뒤 [지난 데이터 재처리](응답 `reprocessSuggestion`으로 미리 채움)·[미검증 측정 항목 확인·승인] | SCR-03.03·03.06, 시나리오 4 |
| `/scripts?dialog=create` | 템플릿 고르기와 코드·기본 설정값 미리보기 | SCR-01.05 |
| `/scripts/modules`, `/scripts/modules/{id}` | 공유 모듈 목록·편집기(DRAFT 저장, 버전 배포, 버전별 사용 스크립트, 사용 중 버전 삭제 불가) | SCR-04.01 |
| `/scripts/formulas` | 수식 항목(측정 키·함수 자동완성과 칩, 입력 중 문법 검사·오류 위치 밑줄, 24시간 미리 보기, 저장·배포) | SCR-01.06 |
| `/ingest/reprocess` | 재처리 작업(기간 31일·소스·기기 → 미리 보기 → 확인 → 생성, 진행률, 취소). `?sourceId=&deviceIds=&from=&to=&memo=` 미리 채움 | ING-01.04, SCR-03.06 |
| `/ingest/quality` | 데이터 품질(순위·최하위 10개·문제 유형 분포·30일 추이, 점수 → 기기 문제 구간 차트) | ING-06.02 |

- API: core `ScriptM5Controller`(API-SCR-10~14·18~22), `IngestController`(API-ING-09·10·12·13), `IngestInsightController`(API-ING-14, `GET /core/ingest/quality/summary`·`/trend`).
- 재처리 진행률은 core에 실시간 토픽이 없어 진행 중 작업이 있을 때 5초마다 목록을 다시 읽습니다(API-ING-03 `ingest.reprocess`는 대체됨).
- 수식 문법 검사는 화면이 즉시 알려 주기 위한 것이고 정본 검사는 pipeline(API-SCR-37)입니다.
### 데이터 소스: 커넥터 카탈로그 스키마 폼·출력 연결·엣지

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

## M6 분석·AI 화면

| 경로 | 화면 | 스펙 |
|---|---|---|
| `/analytics/templates`, `/analytics/templates/{key}?version=` | 템플릿 갤러리(질문으로 찾기 400ms, 카테고리 탭·범용/도메인 칩은 URL 쿼리, [실행 가능한 템플릿만] + 공간 → 실행 못 하는 카드는 "데이터 없음" 배지와 함께 끝으로), 설명서 9항목·버전 | ANA-01.01·01.04~01.07, ANA-08.01 |
| `/analytics/new?template={key}` | 분석 만들기 마법사: ① 템플릿 → ② 데이터 연결(역할 후보 API-ANA-19, 기기×측정 항목·공간 집계·파생 항목) → ③ 기간(최근 N일·고정, 집계 단위, 정상 데이터만, 가상 포함) → ④ 파라미터(JSON Schema 폼) → ⑤ 충분성(OK·WARN 확인·FAIL 막음, [1h로 바꾸기] 같은 해결 버튼)·이름·즉시/일정(매일·매주·cron 최소 1시간)·[저장만]/[저장 후 실행]. 초안은 sessionStorage | ANA-03.01~03.04, ANA-04.01 |
| `/analytics`, `/analytics/{id}` | 분석 목록(마지막 실행·다음 일정·"일정 중지됨"·실시간, [다시 실행]·[삭제]), 실행이 있으면 최근 실행 결과로 이동 | ANA-04.01·04.02 |
| `/analytics/{id}/runs/{runId}` | 실행 결과: 진행(상태 스트림·5초 폴링 대체·[취소]), 핵심 수치(추정치 범위), ChartSpec 차트(공통 렌더러, [표로 보기]·[대시보드에 고정]), 표([맞음]/[오탐]), 근거, 주의 문구, 실행 비교, 내보내기(CSV·PNG 화면에서, PDF는 API-ANA-12), 오른쪽 탭(결과 읽는 법·AI 해설·메타정보와 모델 상태), 실패·시간 초과·취소·보관 만료 | ANA-04.02·04.04, ANA-05.01~05.08, ANA-07.01, ANA-08.02·08.05 |
| (결과 화면 AI 해설 탭) | AI 해설: 스트리밍, 검증 상태(숫자 확인됨·미검증 + 불일치 숫자 강조), 숫자마다 근거(핵심 수치·표·차트) 링크, [다시 만들기], 이전 판. AI 꺼짐(409)이면 탭·버튼 없음, 제공자 없음(503)이면 "AI 사용 불가" | ANA-05.04, AIA-01.01~01.03, AIA-07.01 |
| `/analytics/models` | 모델 관리(버전·상태·학습 기간·MAE/MAPE·정밀도·드리프트, [재학습]·후보 [적용], 성능이 낮으면 확인 뒤 force) | ANA-07.01~07.04 |
| `/dashboards/{id}` | 분석 결과 위젯(`analysis`): 최근 성공 결과의 차트·핵심 수치, 결과 시각·결과 링크, "삭제된 분석" | DSH-04.04, ANA-05.06 |
| `/scripts/{id}` | 편집기 오른쪽 AI 작성 도우미: 샘플·요구사항 → 초안 + 정적 검사·시험 실행 결과, [오류로 고쳐 달라고 하기](시도 5회), [편집기에 넣기](저장·배포는 사람) | SCR-03.07, AIA-04.01~04.03 |
| `/me/tokens`, `/admin/tokens?tab=all\|accounts\|pending` | API 토큰·MCP 토큰(원문 한 번만, 쓰기·제어 범위는 승인 대기, 교체 유예 0~24시간, 만료 7일 전 경고, 마지막 사용 시각·IP), 서비스 계정(만들기·비활성화·키 발급), 승인 대기([승인]·[거절]) | IAM-04.07, IAM-05.01~05.03 |
| `/ai/mcp` | MCP 연결 안내(엔드포인트, Claude Desktop·Claude Code·일반 클라이언트 예시, 도구 이름·버전·범위), 내 MCP 토큰 | AIA-08.01·08.04 |
| `/settings/ai?tab=settings\|usage\|eval` | AI 설정(제공자 NONE·FAKE 상태 띠, 준비 중·배포 불가 표시, 한도·보관·평가 기준), 사용량(일·기능·사용자, 비용, 오늘 한도 대비), 평가(평가 셋·실행 결과·[평가 실행]) | AIA-07.04~07.07 |
| (모든 화면 오른쪽 아래) | [도움말] 대화(HELP 모드, 화면 주소를 맥락으로, 근거 문서 카드, 대화 목록·전체 삭제). 조직 AI가 꺼져 있으면 버튼을 숨긴다 | AIA-09.01 |

- core API: `/core/analytics/**`(API-ANA-01~25), 상태 스트림 `/bff/stream/analytics/runs/{id}`(API-ANA-16, `run-status`·`run-done`), `/core/dashboards/{id}/widgets/pin-analysis`(API-DSH-08), `/core/api-tokens`(+`approve`·`reject`·`rotate`, `owner=me|all`, `kind=MCP`), `/core/service-accounts`(+`disable`). ai API: `/ai/commentaries`(POST는 SSE), `/ai/script-assists`, `/ai/settings`, `/ai/usage`·`/ai/usage/me`, `/ai/evals/cases|runs`, `/ai/mcp/tools`, `/ai/conversations`(HELP).
- POST 스트림(해설·도움말)은 EventSource가 GET만 되므로 `fetch` 본문을 SSE로 읽는다(`app/features/ai/model/sse.ts`). BFF는 `/bff/api/ai/**`의 `Accept: text/event-stream`을 그대로 넘기고 본문을 흘려보낸다.
- 결과 CSV·PNG는 화면에서 바로 만든다(UTF-8 BOM). API-ANA-12의 CSV·PNG `downloadPath`(`/bff/download/{exportId}`)는 BFF에 내려받기 경로가 없어 쓰지 않고, PDF만 비동기로 요청해 알림 센터로 받는다.
- 권한: 분석 조회 ANALYTICS_READ(VIEWER 이상), 마법사·실행·모델 ANALYTICS_RUN, AI 해설 생성 ANALYTICS_RUN + AI_USE, 피드백 ALARM_HANDLE(O 이상), 고정 DASHBOARD_WRITE, 토큰 발급 API_TOKEN_ISSUE(VIEWER 제외), 관리 화면 ADMIN. 데이터 품질 화면(UI-ING-06)은 VIEWER에게도 ANALYTICS_READ가 있어 화면 권한을 INGEST_READ·ANALYTICS_RUN으로 좁혔다.

## 개발

```bash
pnpm install
DATA2FLOW_ALLOWED_ORIGINS=http://localhost:5173 DATA2FLOW_COOKIE_SECURE=false pnpm dev   # http://localhost:5173
pnpm lint
pnpm typecheck
pnpm test:coverage     # server(node: BFF·도우미) + ssr(node: 실제 라우트 + 가짜 gateway, 파일 순차) + client(jsdom: 부품), 커버리지 80%, i18n 키 일치
pnpm build && pnpm start
```

## 로컬 화면 미리보기(Mac)

`e2e/local-preview.sh`는 플랫폼 전체(서비스 11개)를 내 컴퓨터에 띄워 브라우저로 화면을 둘러보게 합니다(OPS-08.01). 공용 s3·s4 인프라 대신 로컬 Docker에 PostgreSQL 18·Valkey 8·RabbitMQ 4·Mailpit·Mosquitto를 띄우는데, 이것은 **미리보기에만 허용한 예외**입니다(ADR-057). 시연 스크립트(m1~m4)와 달리 끝나도 계속 떠 있고, `stop`으로 내립니다.

```bash
e2e/local-preview.sh                  # 빌드 + 시작(처음 10~20분), 끝나면 URL·아이디·비밀번호를 출력
SKIP_BUILD=1 e2e/local-preview.sh     # 지난번 빌드 재사용(약 5분, 견본 데이터 3분 포함)
KEEP_DATA=1 e2e/local-preview.sh      # DB·RabbitMQ를 Docker 볼륨에 남겨 다시 시작해도 데이터 유지
e2e/local-preview.sh status           # 컨테이너·서비스 상태, 접속 정보
e2e/local-preview.sh logs core-api    # 서비스 로그 따라 보기
e2e/local-preview.sh stop             # 프로세스 + 컨테이너 정지(볼륨·키·빌드는 남김)
e2e/local-preview.sh reset            # stop + 볼륨·키 삭제
e2e/local-preview.sh seed             # 떠 있는 상태에서 관리자 로그인 확인 + 견본 데이터만 다시(이미 있으면 건너뜀)
e2e/local-preview.sh restart web      # web만 다시 빌드(origin/main)해서 web 프로세스만 다시 시작(SKIP_BUILD=1이면 빌드 생략)
e2e/local-preview.sh restart ingress  # 서비스 하나만 다시 빌드·시작(web·core-api·pipeline·ingress·ai·analytics). 나머지는 그대로
e2e/local-preview.sh seed-real        # 떠 있는 미리보기에 실제 아카데미 센서 연결(구독만) + 실제 데이터 견본
KEEP_DATA=1 REAL_SOURCE=1 SKIP_BUILD=1 e2e/local-preview.sh   # 시작 + 가상 견본 + 실제 센서 견본을 한 번에
```

- **주소:** 웹 <http://localhost:3000>(아이디 `admin01`, 비밀번호는 출력과 `status`에 나옴), Mailpit <http://localhost:48025>, RabbitMQ 관리 화면 <http://localhost:45767>.
- **로그인 미리 채우기:** 로그인 화면에 관리자 `admin01`의 아이디·비밀번호가 미리 채워져 있어 누구든 [로그인]만 누르면 관리자 홈으로 들어갑니다. 스크립트가 최초 로그인 때 초기 비밀번호를 `keys.env`의 `ADMIN_PASSWORD`로 바꿔 두므로 비밀번호 변경 화면을 거치지 않습니다. BFF는 웹 주소가 `localhost`·`127.0.0.1`이고 Secure 쿠키가 꺼져 있을 때만 이 기능을 켭니다. 끄려면 `PREVIEW_AUTOFILL=0`으로 시작하거나 `PREVIEW_AUTOFILL=0 SKIP_BUILD=1 e2e/local-preview.sh restart web`.
- **다시 시작할 때:** `KEEP_DATA=1`로 다시 띄우면 기존 관리자·견본 데이터를 그대로 씁니다. 견본 기록(`sample.env`)이 없어도 DB에 "가상 강의실 301"이 있으면 다시 만들지 않습니다. 시작은 됐는데 로그인·견본 단계에서 멈췄다면 서비스를 내리지 말고 `e2e/local-preview.sh seed`만 다시 실행합니다.
- **견본 데이터:** 가상 강의실 301(표준 키트: 온습도 2·CO2·재실·에어컨·공기청정기·환기), 지난 3시간 측정값(x60으로 채움), "301호 고온이면 냉방" 플로우 적용, 실시간 시뮬레이터 실행(x1, 7일, 바깥 30~36℃, 매일 09~18시 수업 25명, 시작 시각이 수업 밖이면 처음 2시간 특강 30명). 실내가 27℃를 5분 넘기면 플로우가 가상 에어컨을 켭니다. 견본 기기는 가상 기기라 기기 목록에서 **"가상 포함"**을 켜야 보입니다(`/devices?virtual=true`). `SAMPLE=0`이면 견본을 만들지 않고, `SAMPLE_BACKFILL=0`이면 지난 3시간 채우기를 건너뜁니다.
- **빌드 대상:** 각 저장소의 `origin/main`(먼저 fetch, `PREVIEW_REF=main`이면 로컬 main)을 `~/.data2flow-preview/src`로 내보내 빌드합니다. 작업 중인 체크아웃·브랜치는 건드리지 않고, Maven 산출물은 `~/.data2flow-preview/m2`에 설치합니다(`~/.m2`는 읽기만). ingress·ai·analytics는 빌드·시작에 실패하면 건너뜁니다.
- **안전:** 모든 포트는 127.0.0.1에만 열립니다. 루트 `.env`를 읽지 않고(프로필 `e2e`), ingress는 버리는 Mosquitto에만 붙으며 공용 호스트(`iot-data`·`s3`·`s4.java21.net`)를 막습니다. action은 virtual 드라이버만 쓰고 MQTT·LoRaWAN·LG ThinQ·SmartThings 드라이버, 텔레그램, 출력 연결 발송은 꺼져 있습니다.

### 실제 아카데미 센서 연결(seed-real, ADR-057 보완)

가상 견본만으로는 실제 센서가 어떻게 보이는지 알 수 없어서, 미리보기에 한해 아카데미 센서 브로커 `wss://iot-data.java21.net/mqtt`를 **구독만** 하는 예외를 둡니다. DB·RabbitMQ·Redis는 그대로 로컬 Docker이고, 공용 s3·s4에는 여전히 접속하지 않습니다.

`seed-real`은 아래를 차례로 하고, 이미 있는 것은 이름으로 찾아 다시 만들지 않습니다(만든 ID는 `~/.data2flow-preview/real.env`, 비밀값 없음).

1. ingress가 실제 센서 모드가 아니면 ingress 하나만 다시 띄웁니다(`iot-data`만 열고 `s3`·`s4`는 계속 막음). client-id는 `data2flow-ingress-dev-<이름>-<n>`(기본 로그인 사용자 이름·1, `REAL_SOURCE_DEV`·`REAL_SOURCE_ORDINAL`로 바꿈)이고 다음 시작에도 같은 값을 씁니다. 같은 client-id로 두 곳에서 접속하면 서로 끊기므로 n을 고정합니다.
2. 데이터 소스 `academy-chirpstack`(MQTT 구독, 토픽 `application/+/device/+/event/up`, 디코더 ChirpStack v4)를 등록합니다. 자격증명은 루트 `.env`에서 **`MQTT_BASIC_AUTH` 한 줄만** 읽어 BFF로 보내고(core가 암호화 저장), 화면·로그·파일에 남기지 않습니다(`D2F_ENV_FILE`로 파일을 바꿀 수 있음).
3. 첫 수신을 기다립니다(`REAL_SOURCE_WAIT`, 기본 240초). 센서는 보통 1~5분마다 보냅니다.
4. 공간 "아카데미"(SITE) 아래 센서 태그 `location`별 방(기본 "실습실", 회의실 센서는 "회의실")을 만들고, 승인 대기 기기를 이름 앞부분으로 모델(AM103·AM107·EM300-TH·EM320-TH·EM500-CO2·WS302)에 맞춰 승인합니다. 이름 뒤에 태그의 위치(`spot`)를 붙입니다. 새 센서가 들어오면 `seed-real`을 다시 실행하면 됩니다.
5. 실습실 평면도(개략도 SVG)와 센서 위치 표시, 대시보드 **"아카데미 실습실 실시간"**(평균 온도·습도·CO2, TVOC·조도·소음 현재값, 센서별 온도·CO2 추이, 평면도, 재실 활동·소음 추이, 기기별 최신값 표 2개, 연결 상태, 알람 목록)을 만듭니다.
6. 규칙 3개: 고CO2(1000ppm 이상 5분 → 주의), 고온(28℃ 이상 10분 → 주의), 소음(LAeq 70dB 이상 → 정보). 알림 정책·채널을 붙이지 않아 **화면 알람만** 생깁니다.
7. 분석 4개: CO2 1000ppm 도달 예측(2시간마다), 쾌적도(매일 07:00), 온도 센서 건강·재실·활용률 추정(매주 월 07:00). 데이터 충분성 검사를 통과하면 바로 실행하고, 모자라면(처음 연결 직후는 모두 "데이터 부족") 일정 실행으로 걸어 둡니다. 도달 예측은 2시간, 쾌적도는 1일, 나머지는 7일 데이터가 쌓이면 결과가 나옵니다.
8. 플로우 "실습실 CO2 높으면 가상 환기": 실습실 실제 CO2 센서 평균이 1000ppm을 5분 넘기면 **가상 강의실 301의 가상 환기 장치**를 켭니다. 실제 기기에는 제어 대상을 붙이지 않습니다(가상 견본이 없으면 건너뜀).
9. 데이터 내보내기 1건(최근 1시간 실습실 온도·CO2 CSV, 내보내기 화면에서 내려받기).

둘러볼 곳: 대시보드 `/dashboards/<id>`(시작 끝에 주소 출력), 공간 `/spaces/<실습실 id>?tab=floorplan`, 기기 `/devices`, 데이터 소스 `/sources`, 규칙 `/rules`, 알람 `/alarms`, 플로우 `/automation/flows`, 내보내기 `/exports`.

- **다음 시작:** `real.env`가 있으면 다음 시작부터 ingress가 실제 센서 모드로 뜨고 견본 단계에서 `seed-real`도 이어서 합니다. 끄려면 `REAL_SOURCE=0 SKIP_BUILD=1 e2e/local-preview.sh restart ingress`(이번만) 또는 `real.env`를 지웁니다. `KEEP_DATA` 없이 시작하면 DB가 비므로 소스·승인·견본을 새로 만듭니다(client-id 정보만 남김).
- **안전:** 공용 브로커에는 발행하지 않습니다(ingress는 구독만 함). 실제 센서에는 제어 대상(드라이버)을 붙이지 않고, 플로우는 가상 환기 장치만 켭니다. 알림 채널은 꺼진 그대로입니다.
- **analytics 메모:** 미리보기는 analytics를 uvicorn `http=h11`로 띄웁니다. core의 JDK HttpClient가 평문 POST에 `Upgrade: h2c`를 붙이는데 uvicorn 기본(httptools)은 이때 본문을 버려 분석 만들기·충분성 검사가 400(`ANALYSIS_BINDING_INVALID`)이 되기 때문입니다.
- **키·로그:** 키와 비밀번호는 `~/.data2flow-preview/keys.env`(권한 600, 저장소 밖), 로그는 `~/.data2flow-preview/logs/<서비스>.log`.
- **필요:** Docker Desktop, Java 21+, Node 22+ + pnpm, python3 3.12+, git, curl, openssl, lsof. 메모리 8GB 이상 여유. 포트 3000·45718~45799·48025를 씁니다.

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
