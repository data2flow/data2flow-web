# data2flow-web

data2flow 화면과 BFF입니다. React Router v8 프레임워크 모드(SSR, Vite) + React 19 + TypeScript로 만들고, 브라우저는 토큰 없이 HttpOnly 세션 쿠키(`data2flow_session`)만 갖습니다. Access·Refresh 토큰은 BFF가 서버 쪽에 보관하고, 브라우저의 API 호출은 `/bff/api/{svc}/**`로 받아 내부 gateway에 Bearer로 중계합니다(ADR-024, design/auth.md §9). 화면 문구는 한국어·영어·일본어·중국어 4개 언어입니다(ADR-037).

- 관련 스펙: IAM(로그인·세션·회원·권한·감사), OPS-07(조직·외부 서비스 설정), DSH, FLW·RUL 화면 (정본은 비공개 저장소 `data2flow-docs`)
- 포트: 8080. 프로브는 `/healthz`

## 구조

| 위치 | 내용 |
|---|---|
| `app/bff/` | 세션 쿠키(AES-256-GCM, `kid` 교체), CSRF 토큰 + Origin 검사, Access 캐시(메모리 / 선택 Redis), Refresh 회전·single-flight, gateway 중계, 보안 헤더(CSP nonce·HSTS 등) |
| `app/routes/` | 로그인(TOTP 2단계), 초대 수락, 비밀번호 재설정, 가입 신청, 개인정보 안내, 내 정보, 회원·역할·보안 설정·감사 로그·시스템 설정 |
| `app/lib/`, `app/components/` | 화면 공용 도우미와 부품 |
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
| `DATA2FLOW_SIGNUP_REQUEST_ENABLED` | `false` | 로그인 화면 [가입 신청] 링크와 `/signup` (IAM-01.08) |

## 개발

```bash
pnpm install
DATA2FLOW_ALLOWED_ORIGINS=http://localhost:5173 DATA2FLOW_COOKIE_SECURE=false pnpm dev   # http://localhost:5173
pnpm lint
pnpm typecheck
pnpm test:coverage     # server(node: BFF·SSR 통합) + client(jsdom: 부품) 두 프로젝트, 커버리지 80%, i18n 키 일치
pnpm build && pnpm start
```

문구를 추가할 때는 `app/i18n/locales/{ko,en,ja,zh}.json` 네 파일에 같은 키를 넣습니다. 키나 보간 변수가 하나라도 다르면 테스트가 실패합니다.
