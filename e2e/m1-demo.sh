#!/usr/bin/env bash
# M1 시연(plan/milestones.md §M1) 전 구간 로컬 검증: web BFF → api-gateway → auth·core-api.
#
# 공용 인프라(s3·s4)는 쓰지 않는다. PostgreSQL·Valkey·RabbitMQ·Mailpit을 임시 Docker 컨테이너로 띄우고,
# 끝나면(성공·실패 모두) 컨테이너와 프로세스를 지운다(CLAUDE.md §5).
#
# 필요: docker, java 21, node 22 + pnpm, curl, python3, openssl. 형제 디렉터리에 data2flow-auth·api-gateway·core-api가 있어야 한다.
# 사용:
#   e2e/m1-demo.sh                    # 빌드 + 시연
#   SKIP_BUILD=1 e2e/m1-demo.sh       # 이미 만든 jar·build 재사용
#   WORK_DIR=/tmp/m1 e2e/m1-demo.sh   # 생성 키·로그·쿠키를 둘 곳(기본: mktemp). 키는 실행마다 새로 만든다
#   KEEP=1 e2e/m1-demo.sh             # 끝나도 컨테이너·프로세스를 남긴다(디버깅용)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WEB_DIR="$ROOT/data2flow-web"
WORK_DIR="${WORK_DIR:-$(mktemp -d -t d2f-m1)}"
mkdir -p "$WORK_DIR/logs"
chmod 700 "$WORK_DIR"
P="d2f-m1e2e"                  # 컨테이너 이름 접두사

PG_PORT=25432; REDIS_PORT=26379; AMQP_PORT=25672; SMTP_PORT=21025; MAILPIT_HTTP=28025
GW_PORT=28780; AUTH_PORT=28781; CORE_PORT=28782; WEB_PORT=28788
WEB="http://localhost:$WEB_PORT"
ORIGIN="$WEB"
MAILPIT="http://127.0.0.1:$MAILPIT_HTTP"

PIDS=()
PASS=0; FAIL=0
RESULTS="$WORK_DIR/results.txt"; : > "$RESULTS"

log() { printf '\n== %s\n' "$*"; }
ok() { PASS=$((PASS + 1)); printf '  PASS  %s\n' "$*" | tee -a "$RESULTS"; }
ng() {
  FAIL=$((FAIL + 1)); printf '  FAIL  %s\n' "$*" | tee -a "$RESULTS"
  [[ -f "$WORK_DIR/last.body" ]] && printf '        마지막 응답: %s\n' "$(head -c 300 "$WORK_DIR/last.body" | tr '\n' ' ')" | tee -a "$RESULTS"
}
check() { # check "설명" 조건식
  local name="$1"; shift
  if "$@"; then ok "$name"; else ng "$name"; fi
}

cleanup() {
  local code=$?
  if [[ "${KEEP:-}" == "1" ]]; then echo "KEEP=1: 컨테이너·프로세스를 남깁니다 (WORK_DIR=$WORK_DIR)"; return; fi
  for pid in "${PIDS[@]:-}"; do [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true; done
  sleep 2
  for pid in "${PIDS[@]:-}"; do [[ -n "$pid" ]] && kill -9 "$pid" 2>/dev/null || true; done
  # 실행 파일 래퍼가 자식 프로세스를 띄우는 경우(react-router-serve)까지 포트로 한 번 더 정리
  for port in $GW_PORT $AUTH_PORT $CORE_PORT $WEB_PORT; do
    lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true
  done
  docker rm -f "$P-pg" "$P-valkey" "$P-rabbit" "$P-mail" >/dev/null 2>&1 || true
  echo "정리 완료(컨테이너·프로세스 제거). 로그: $WORK_DIR/logs"
  exit $code
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------- 키(실행마다 새로, WORK_DIR에만)
log "키 생성 → $WORK_DIR/keys.env"
umask 077
cat > "$WORK_DIR/keys.env" <<EOF
JWT_KEY=e2e:$(openssl rand -base64 32)
MASTER_KEY=e2e:$(openssl rand -base64 32)
SESSION_KEY=e2e:$(openssl rand -base64 32)
DB_PASSWORD=$(openssl rand -hex 16)
REDIS_PASSWORD=$(openssl rand -hex 16)
ADMIN_PASSWORD=Init-$(openssl rand -hex 6)-Aa1
ADMIN_NEW_PASSWORD=Boss-$(openssl rand -hex 6)-Bb2   # 정책: 아이디·메일 앞부분(admin) 포함 금지
USER_PASSWORD=Oper-$(openssl rand -hex 6)-Cc3
EOF
# shellcheck disable=SC1091
source "$WORK_DIR/keys.env"

# ---------------------------------------------------------------- 인프라(임시 컨테이너)
log "임시 컨테이너 시작"
docker rm -f "$P-pg" "$P-valkey" "$P-rabbit" "$P-mail" >/dev/null 2>&1 || true
for port in $GW_PORT $AUTH_PORT $CORE_PORT $WEB_PORT $((GW_PORT + 10)) $((AUTH_PORT + 10)) $((CORE_PORT + 10)); do
  if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then echo "포트 $port 를 이미 쓰고 있습니다. 비우거나 스크립트의 포트를 바꾸세요"; exit 1; fi
done
docker run -d --name "$P-pg" -p 127.0.0.1:$PG_PORT:5432 \
  -e POSTGRES_DB=data2flow -e POSTGRES_USER=data2flow -e POSTGRES_PASSWORD="$DB_PASSWORD" postgres:18 >/dev/null
docker run -d --name "$P-valkey" -p 127.0.0.1:$REDIS_PORT:6379 valkey/valkey:8 \
  valkey-server --requirepass "$REDIS_PASSWORD" --appendonly no >/dev/null
docker run -d --name "$P-rabbit" -p 127.0.0.1:$AMQP_PORT:5672 \
  -e RABBITMQ_DEFAULT_VHOST=data2flow-dev rabbitmq:4-management >/dev/null
docker run -d --name "$P-mail" -p 127.0.0.1:$SMTP_PORT:1025 -p 127.0.0.1:$MAILPIT_HTTP:8025 axllent/mailpit:latest >/dev/null

wait_for() { # wait_for 설명 초 명령…
  local name="$1" secs="$2"; shift 2
  for _ in $(seq 1 "$secs"); do if "$@" >/dev/null 2>&1; then echo "  준비됨: $name"; return 0; fi; sleep 1; done
  echo "  시간 초과: $name"; return 1
}
wait_for postgres 60 docker exec "$P-pg" pg_isready -U data2flow -d data2flow
wait_for valkey 30 docker exec "$P-valkey" valkey-cli -a "$REDIS_PASSWORD" ping
# rabbitmq-diagnostics를 부팅 중에 부르면 CLI가 다른 Erlang 쿠키를 만들어 영영 실패하므로 로그로 판단한다
wait_for rabbitmq 120 bash -c "docker logs $P-rabbit 2>&1 | grep -q 'Server startup complete'"
wait_for mailpit 30 curl -sf "$MAILPIT/api/v1/info"

# ---------------------------------------------------------------- 빌드
if [[ "${SKIP_BUILD:-}" != "1" ]]; then
  log "빌드(테스트 생략)"
  for svc in auth api-gateway core-api; do (cd "$ROOT/data2flow-$svc" && ./mvnw -q -B -DskipTests clean package); done
  (cd "$WEB_DIR" && pnpm build >/dev/null)
fi
jar_of() { ls "$ROOT/data2flow-$1"/target/data2flow-"$1"-*.jar | grep -v plain | head -1; }

# ---------------------------------------------------------------- 서비스 환경
# 프로필 e2e(설정 파일 없음 = 기본 설정만). 기본 프로필 local은 루트 .env(공용 인프라 접속값)를 읽고
# core 아웃박스 릴레이를 끄므로 쓰지 않는다. java는 WORK_DIR에서 실행해 상대 경로 ../.env도 닿지 않게 한다
export SPRING_PROFILES_ACTIVE=e2e
cd "$WORK_DIR"
export DATA2FLOW_REDIS_HOST=127.0.0.1 DATA2FLOW_REDIS_PORT=$REDIS_PORT DATA2FLOW_REDIS_PASSWORD="$REDIS_PASSWORD"
CORE_ENV=(
  DATA2FLOW_DB_HOST=127.0.0.1 DATA2FLOW_DB_PORT=$PG_PORT DATA2FLOW_DB_NAME=data2flow
  DATA2FLOW_DB_USERNAME=data2flow DATA2FLOW_DB_PASSWORD="$DB_PASSWORD"
  DATA2FLOW_RABBITMQ_HOST=127.0.0.1 DATA2FLOW_RABBITMQ_PORT=$AMQP_PORT DATA2FLOW_RABBITMQ_VHOST=data2flow-dev
  DATA2FLOW_RABBITMQ_USERNAME=guest DATA2FLOW_RABBITMQ_PASSWORD=guest
  DATA2FLOW_SECRETS_MASTER_KEYS="$MASTER_KEY" DATA2FLOW_SECRETS_ACTIVE_KEY_ID=e2e
  DATA2FLOW_AUTH_BASE_URL=http://127.0.0.1:$AUTH_PORT DATA2FLOW_WEB_BASE_URL="$WEB"
)
CORE_ARGS=(--server.port=$CORE_PORT --management.server.port=$((CORE_PORT + 10)) --data2flow.core.flyway-mode=migrate)

log "최초 관리자 Job(Flyway migrate + ADMIN 생성)"
env "${CORE_ENV[@]}" DATA2FLOW_BOOTSTRAP_ADMIN_LOGIN_ID=admin01 DATA2FLOW_BOOTSTRAP_ADMIN_EMAIL=admin@example.test \
  DATA2FLOW_BOOTSTRAP_ADMIN_INITIAL_PASSWORD="$ADMIN_PASSWORD" DATA2FLOW_BOOTSTRAP_ORG_NAME="한빛대학교" \
  java -jar "$(jar_of core-api)" "${CORE_ARGS[@]}" --data2flow.core.bootstrap.enabled=true \
  --spring.main.web-application-type=none > "$WORK_DIR/logs/bootstrap.log" 2>&1
check "최초 관리자 Job 완료(ADMIN 생성)" grep -q "부트스트랩 결과" "$WORK_DIR/logs/bootstrap.log"
check "초기 비밀번호가 로그에 남지 않음" bash -c "! grep -qF -- '$ADMIN_PASSWORD' '$WORK_DIR/logs/bootstrap.log'"

log "서비스 시작"
env "${CORE_ENV[@]}" java -jar "$(jar_of core-api)" "${CORE_ARGS[@]}" > "$WORK_DIR/logs/core-api.log" 2>&1 & PIDS+=($!)
DATA2FLOW_AUTH_JWT_KEYS="$JWT_KEY" DATA2FLOW_AUTH_JWT_ACTIVE_KEY_ID=e2e DATA2FLOW_CORE_URI=http://127.0.0.1:$CORE_PORT \
  java -jar "$(jar_of auth)" --server.port=$AUTH_PORT --management.server.port=$((AUTH_PORT + 10)) \
  > "$WORK_DIR/logs/auth.log" 2>&1 & PIDS+=($!)
DATA2FLOW_AUTH_URI=http://127.0.0.1:$AUTH_PORT DATA2FLOW_CORE_URI=http://127.0.0.1:$CORE_PORT \
  DATA2FLOW_AI_URI=http://127.0.0.1:9 DATA2FLOW_MCP_URI=http://127.0.0.1:9 DATA2FLOW_MCP_HOST=mcp.localhost \
  DATA2FLOW_GATEWAY_TRUSTED_PROXIES='127\.0\.0\.1' \
  java -jar "$(jar_of api-gateway)" --server.port=$GW_PORT --management.server.port=$((GW_PORT + 10)) \
  > "$WORK_DIR/logs/api-gateway.log" 2>&1 & PIDS+=($!)
(cd "$WEB_DIR" && NODE_ENV=production PORT=$WEB_PORT DATA2FLOW_GATEWAY_URL=http://127.0.0.1:$GW_PORT \
  DATA2FLOW_PUBLIC_ORIGIN="$ORIGIN" DATA2FLOW_COOKIE_SECURE=false DATA2FLOW_SESSION_KEYS="$SESSION_KEY" \
  DATA2FLOW_TRUSTED_PROXY_HOPS=0 exec node_modules/.bin/react-router-serve ./build/server/index.js) \
  > "$WORK_DIR/logs/web.log" 2>&1 & PIDS+=($!)

wait_for core-api 120 curl -sf http://127.0.0.1:$((CORE_PORT + 10))/actuator/health/readiness
wait_for auth 120 curl -sf http://127.0.0.1:$((AUTH_PORT + 10))/actuator/health/readiness
wait_for api-gateway 120 curl -sf http://127.0.0.1:$((GW_PORT + 10))/actuator/health/readiness
wait_for web 60 curl -sf "$WEB/healthz"

# ---------------------------------------------------------------- 브라우저 흉내(curl 쿠키 저장소)
# req 이름 메서드 경로 [curl 인자…] → $WORK_DIR/<이름>.{status,headers,body}
LAST="$WORK_DIR/last"   # 마지막 응답(명령 치환 안에서 불러도 같은 파일을 보도록 고정 경로)
req() {
  local jar="$WORK_DIR/$1.jar" method="$2" path="$3"; shift 3
  curl -s -o "$LAST.body" -D "$LAST.headers" -w '%{http_code}' -b "$jar" -c "$jar" -X "$method" "$WEB$path" "$@" > "$LAST.status"
  cat "$LAST.body" >> "$WORK_DIR/all-bodies.txt"; cat "$LAST.headers" >> "$WORK_DIR/all-headers.txt"
}
status() { cat "$LAST.status"; }
location() { grep -i '^location:' "$LAST.headers" | tail -1 | tr -d '\r' | cut -d' ' -f2-; }
json() { python3 -c "import json,sys; d=json.load(open('$LAST.body')); print(eval(sys.argv[1]))" "$1"; }
csrf_of() { # 이름 → 세션의 CSRF 토큰(로그인 화면 HTML의 meta)
  req "$1" GET /login
  python3 -c "import re; m=re.search(r'name=\"csrf-token\" content=\"([^\"]+)\"', open('$LAST.body').read()); print(m.group(1) if m else '')"
}
csrf_page() { req "$1" GET "$2"; python3 -c "import re; m=re.search(r'name=\"csrf-token\" content=\"([^\"]+)\"', open('$LAST.body').read()); print(m.group(1) if m else '')"; }
form() { # 이름 경로 csrf key=value…
  local who="$1" path="$2" token="$3"; shift 3
  local args=(-H "Origin: $ORIGIN" --data-urlencode "_csrf=$token")
  for kv in "$@"; do args+=(--data-urlencode "$kv"); done
  req "$who" POST "$path" "${args[@]}"
}
api() { # 이름 메서드 경로 csrf [JSON]
  local who="$1" method="$2" path="$3" token="$4" body="${5:-}"
  local args=(-H "Origin: $ORIGIN" -H "X-CSRF-TOKEN: $token" -H "Accept: application/json")
  [[ -n "$body" ]] && args+=(-H "Content-Type: application/json" --data "$body")
  [[ "$method" == "POST" ]] && args+=(-H "Idempotency-Key: $(python3 -c 'import uuid; print(uuid.uuid4())')")
  req "$who" "$method" "/bff/api$path" "${args[@]}"
}

# ---------------------------------------------------------------- 1. 관리자 첫 로그인과 비밀번호 변경
log "1. 관리자 첫 로그인(초기 비밀번호) → 비밀번호 변경 강제"
T=$(csrf_of admin)
check "로그인 화면 200, 가입 신청 링크 없음(API-IAM-74 false)" bash -c "[[ $(status) == 200 ]] && ! grep -q 'href=\"/signup\"' '$LAST.body'"
form admin /login "$T" intent=credentials loginId=admin01 "password=$ADMIN_PASSWORD" next=/
check "관리자 로그인 302 → /me/security?required=password (got $(status) $(location))" \
  bash -c "[[ '$(status)' == 302 && '$(location)' == /me/security?required=password ]]"
T=$(csrf_page admin "/me/security?required=password")
form admin "/me/security" "$T" intent=password "currentPassword=$ADMIN_PASSWORD" "newPassword=$ADMIN_NEW_PASSWORD" "confirmPassword=$ADMIN_NEW_PASSWORD"
check "비밀번호 변경 → 302 / (got $(status) $(location))" bash -c "[[ '$(status)' == 302 && '$(location)' == / ]]"
api admin GET /core/accounts/me/sessions "$T"
check "변경 뒤에도 현재 세션 유지(X-SESSION-ID, keepCurrentSession) → 200 (got $(status))" bash -c "[[ '$(status)' == 200 ]]"
check "내 세션 목록에서 현재 세션 current=true" bash -c "[[ \"\$(python3 -c \"import json; d=json.load(open('$LAST.body')); print(any(s.get('current') for s in (d.get('response') or d.get('responses') or [])))\")\" == True ]]"

# ---------------------------------------------------------------- 2. 메일 설정과 초대
log "2. 메일(SMTP=Mailpit) 설정 → OPERATOR 초대"
T=$(csrf_page admin /)
check "관리자 홈에 회원 관리 메뉴가 보인다" grep -q 'href="/admin/members"' "$LAST.body"
api admin PUT /core/external-services/MAIL "$T" "{\"provider\":\"smtp\",\"settings\":{\"host\":\"127.0.0.1\",\"port\":$SMTP_PORT,\"from\":\"no-reply@data2flow.test\"},\"secret\":\"\",\"enabled\":true}"
check "메일 설정 저장 200 (got $(status))" bash -c "[[ '$(status)' == 200 ]]"
api admin POST /core/invitations "$T" '{"emails":["lee.op@example.test"],"name":"이운영","role":"OPERATOR","spaceScope":[]}'
check "초대 생성 2xx, 결과 CREATED (got $(status))" bash -c "[[ '$(status)' == 20* ]] && grep -q CREATED '$LAST.body'"

INVITE_TOKEN=""
for _ in $(seq 1 20); do
  INVITE_TOKEN=$(curl -s "$MAILPIT/api/v1/search?query=to:lee.op@example.test" | python3 -c "
import json,sys,re,urllib.request
d=json.load(sys.stdin)
for m in d.get('messages',[]):
    full=json.load(urllib.request.urlopen('$MAILPIT/api/v1/message/'+m['ID']))
    t=re.search(r'/invitations/([A-Za-z0-9_-]{20,})', (full.get('Text') or '')+(full.get('HTML') or ''))
    if t: print(t.group(1)); break
" || true)
  [[ -n "$INVITE_TOKEN" ]] && break; sleep 1
done
check "Mailpit에서 초대 메일·링크 수신" test -n "$INVITE_TOKEN"

# ---------------------------------------------------------------- 3. 초대 수락
log "3. 초대 수락(아이디·비밀번호 설정)"
T=$(csrf_page user "/invitations/$INVITE_TOKEN")
check "초대 화면 200 (got $(status))" bash -c "[[ '$(status)' == 200 ]]"
form user "/invitations/$INVITE_TOKEN" "$T" loginId=lee.op "newPassword=$USER_PASSWORD" "confirmPassword=$USER_PASSWORD" email=lee.op@example.test privacyConsent=on
check "초대 수락 성공 2xx/3xx (got $(status) $(location))" bash -c "[[ '$(status)' == 2* || '$(status)' == 3* ]] && ! grep -q 'INVITATION_INVALID' '$LAST.body'"

# ---------------------------------------------------------------- 4. 사용자 로그인과 권한
log "4. OPERATOR 로그인 → 회원 관리 API 403, 관리자 메뉴 없음"
T=$(csrf_of user)
form user /login "$T" intent=credentials loginId=lee.op "password=$USER_PASSWORD" next=/
check "사용자 로그인 302 → / (got $(status) $(location))" bash -c "[[ '$(status)' == 302 && '$(location)' == / ]]"
T=$(csrf_page user /)
check "사용자 홈 200, 관리자 메뉴(/admin/members) 없음" bash -c "[[ '$(status)' == 200 ]] && ! grep -q 'href=\"/admin/' '$LAST.body'"
api user GET "/core/users?page=1" "$T"
check "회원 목록 API 403 PERMISSION_DENIED (got $(status))" bash -c "[[ '$(status)' == 403 ]] && grep -q PERMISSION_DENIED '$LAST.body'"
req user GET /admin/members
check "회원 관리 화면 직접 접근 → 403 화면 (got $(status))" bash -c "[[ '$(status)' == 403 ]]"

log "4-1. 브라우저 쿠키에는 불투명 세션 쿠키만"
# curl 쿠키 파일: HttpOnly 쿠키는 줄 앞에 "#HttpOnly_"가 붙는다
COOKIES=$(sed 's/^#HttpOnly_//' "$WORK_DIR/user.jar" | grep -v '^#' | awk 'NF>=7 {print $6}' | sort -u | tr '\n' ' ')
check "쿠키 이름은 data2flow_session 하나뿐 (got: $COOKIES)" bash -c "[[ '$COOKIES' == 'data2flow_session ' ]]"
check "쿠키 값에 JWT(eyJ…) 없음" bash -c "! grep -hq 'eyJ[A-Za-z0-9_-]*\.eyJ' '$WORK_DIR/user.jar' '$WORK_DIR/admin.jar'"
check "모든 응답 본문·헤더에 JWT 없음" bash -c "! grep -qE 'eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+' '$WORK_DIR/all-bodies.txt' '$WORK_DIR/all-headers.txt'"
check "Set-Cookie에 data2flow_refresh 없음" bash -c "! grep -qi 'set-cookie: data2flow_refresh' '$WORK_DIR/all-headers.txt'"
check "세션 쿠키 HttpOnly·SameSite=Lax" bash -c "grep -i 'set-cookie: data2flow_session' '$WORK_DIR/all-headers.txt' | head -1 | grep -qi 'httponly' && grep -i 'set-cookie: data2flow_session' '$WORK_DIR/all-headers.txt' | head -1 | grep -qi 'samesite=lax'"

# ---------------------------------------------------------------- 5. 강제 로그아웃
log "5. 관리자가 사용자 세션 강제 종료 → 사용자 다음 요청은 로그인으로"
T=$(csrf_page admin /)
api admin GET "/core/users?keyword=lee.op&page=1" "$T"
USER_ID=$(python3 -c "import json; d=json.load(open('$LAST.body')); print(next(u['id'] for u in d['responses'] if u['loginId']=='lee.op'))" 2>/dev/null || true)
check "관리자 회원 목록에서 사용자 찾음(id=$USER_ID)" test -n "$USER_ID"
api admin POST "/core/users/$USER_ID/sessions/revoke-all" "$T"
check "강제 로그아웃 200 (got $(status) $(cat "$LAST.body" | head -c 200))" bash -c "[[ '$(status)' == 200 ]]"
# IAM-03.03: 30초 이내(보통 1초) 반영 — core 아웃박스(1초 주기) → auth 블랙리스트 → gateway가 다음 요청에서 거절
START=$(date +%s); REVOKED_AFTER=""
for _ in $(seq 1 30); do
  req user GET /me/profile
  if [[ "$(status)" == 302 ]]; then REVOKED_AFTER=$(( $(date +%s) - START )); break; fi
  sleep 1
done
check "사용자 다음 화면 요청 → 302 로그인(${REVOKED_AFTER:-30+}초 안에 반영, 기준 30초) (got $(status) $(location))" \
  bash -c "[[ -n '$REVOKED_AFTER' && '$(location)' == /login* && '$(location)' == *reason=revoked* ]]"
T=$(csrf_page user /login)
api user GET /core/accounts/me "$T"
check "그 뒤 사용자 API 요청 → 401 (got $(status))" bash -c "[[ '$(status)' == 401 ]]"
api admin GET /core/accounts/me "$(csrf_page admin /)"
check "관리자 세션은 그대로 200 (got $(status))" bash -c "[[ '$(status)' == 200 ]]"

log "6. 감사 로그"
T=$(csrf_page admin /)
api admin GET "/core/audit-logs?page=1&size=100" "$T"
for code in USER_INVITED INVITATION_ACCEPTED SESSION_REVOKED PERSONAL_INFO_ACCESSED PASSWORD_CHANGED; do
  check "감사 $code 기록" grep -q "$code" "$LAST.body"
done

echo
echo "결과: PASS $PASS / FAIL $FAIL   (자세히: $RESULTS, 로그: $WORK_DIR/logs)"
[[ $FAIL -eq 0 ]]
