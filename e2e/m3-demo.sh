#!/usr/bin/env bash
# M3 시연(plan/milestones.md §M3 "폐루프(가상)") 전 구간 로컬 검증:
#   web BFF → api-gateway → auth·core-api
#   simulator(가상 강의실 물리 모델) → data2flow.raw → pipeline → data2flow.telemetry → flow-engine("고온이면 냉방")
#   → 아웃박스 → data2flow.actions → action(제어 창구, virtual 드라이버) → simulator 가상 에어컨 → 물리 모델(온도 하강) → 다시 수집
#   결과는 BFF SSE(command-status·device-update)와 명령 이력으로 확인하고, 같은 시드 두 번 실행의 SHA-256(runs.result.dataSha256)을 비교한다.
#
# 공용 인프라(s3·s4·iot-data.java21.net)는 쓰지 않는다. PostgreSQL 18·Valkey 8·RabbitMQ 4(stream)·Mailpit을 임시 Docker 컨테이너로 띄우고,
# 끝나면(성공·실패 모두) 컨테이너와 프로세스를 지운다(CLAUDE.md §5). MQTT는 쓰지 않는다: simulator는 data2flow.raw에 직접 넣고(SIM-02.07),
# action은 virtual 드라이버만 쓴다(MQTT 드라이버 꺼짐, ADR-029).
#
# 필요: docker, java 21, node 22 + pnpm, curl, python3, openssl, lsof.
#       형제 디렉터리에 data2flow-auth·api-gateway·core-api·pipeline·flow-engine·action·simulator가 있어야 하고,
#       data2flow-contracts가 로컬 저장소에 설치돼 있어야 한다(./mvnw install).
# 사용:
#   e2e/m3-demo.sh                    # 빌드 + 시연(약 12분)
#   SKIP_BUILD=1 e2e/m3-demo.sh       # 이미 만든 jar·build 재사용
#   WORK_DIR=/tmp/m3 e2e/m3-demo.sh   # 생성 키·로그·쿠키·SSE 기록을 둘 곳(기본: mktemp). 키는 실행마다 새로 만든다
#   KEEP=1 e2e/m3-demo.sh             # 끝나도 컨테이너·프로세스를 남긴다(디버깅용)
#   SEED=20260810 e2e/m3-demo.sh      # 재현 실행 시드(기본 20260810)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WEB_DIR="$ROOT/data2flow-web"
WORK_DIR="${WORK_DIR:-$(mktemp -d -t d2f-m3)}"
mkdir -p "$WORK_DIR/logs"
chmod 700 "$WORK_DIR"
P="d2f-m3e2e"                  # 컨테이너 이름 접두사
SEED="${SEED:-20260810}"

PG_PORT=45432; REDIS_PORT=46379; AMQP_PORT=45672; STREAM_PORT=45552; SMTP_PORT=41025; MAILPIT_HTTP=48025
GW_PORT=48780; AUTH_PORT=48781; CORE_PORT=48782; PIPELINE_PORT=48784; FLOW_PORT=48785; ACTION_PORT=48786; SIM_PORT=48787; WEB_PORT=48788
SVC_PORTS=($GW_PORT $AUTH_PORT $CORE_PORT $PIPELINE_PORT $FLOW_PORT $ACTION_PORT $SIM_PORT $WEB_PORT)
WEB="http://localhost:$WEB_PORT"
ORIGIN="$WEB"
MAILPIT="http://127.0.0.1:$MAILPIT_HTTP"
CONTAINERS=("$P-pg" "$P-valkey" "$P-rabbit" "$P-mail")

PIDS=()
PASS=0; FAIL=0
RESULTS="$WORK_DIR/results.txt"; : > "$RESULTS"

log() { printf '\n== %s\n' "$*"; }
ok() { PASS=$((PASS + 1)); printf '  PASS  %s\n' "$*" | tee -a "$RESULTS"; }
ng() {
  FAIL=$((FAIL + 1)); printf '  FAIL  %s\n' "$*" | tee -a "$RESULTS"
  [[ -f "$WORK_DIR/last.body" ]] && printf '        마지막 응답: %s\n' "$(head -c 300 "$WORK_DIR/last.body" | tr '\n' ' ')" | tee -a "$RESULTS"
}
check() { # check "설명" 명령…
  local name="$1"; shift
  if "$@"; then ok "$name"; else ng "$name"; fi
}
info() { printf '        %s\n' "$*" | tee -a "$RESULTS"; }

cleanup() {
  local code=$?
  if [[ "${KEEP:-}" == "1" ]]; then echo "KEEP=1: 컨테이너·프로세스를 남깁니다 (WORK_DIR=$WORK_DIR)"; return; fi
  for pid in "${PIDS[@]:-}"; do [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true; done
  sleep 3
  for pid in "${PIDS[@]:-}"; do [[ -n "$pid" ]] && kill -9 "$pid" 2>/dev/null || true; done
  for port in "${SVC_PORTS[@]}"; do
    lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | xargs kill -9 2>/dev/null || true
  done
  docker rm -f "${CONTAINERS[@]}" >/dev/null 2>&1 || true
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
RABBIT_PASSWORD=$(openssl rand -hex 16)
ADMIN_PASSWORD=Init-$(openssl rand -hex 6)-Aa1
ADMIN_NEW_PASSWORD=Boss-$(openssl rand -hex 6)-Bb2
EOF
# shellcheck disable=SC1091
source "$WORK_DIR/keys.env"

# ---------------------------------------------------------------- 인프라(임시 컨테이너)
log "임시 컨테이너 시작"
docker rm -f "${CONTAINERS[@]}" >/dev/null 2>&1 || true
for port in "${SVC_PORTS[@]}"; do
  for p in $port $((port + 10)); do
    if lsof -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then echo "포트 $p 를 이미 쓰고 있습니다. 비우거나 스크립트의 포트를 바꾸세요"; exit 1; fi
  done
done
docker run -d --name "$P-pg" -p 127.0.0.1:$PG_PORT:5432 \
  -e POSTGRES_DB=data2flow -e POSTGRES_USER=data2flow -e POSTGRES_PASSWORD="$DB_PASSWORD" postgres:18 >/dev/null
docker run -d --name "$P-valkey" -p 127.0.0.1:$REDIS_PORT:6379 valkey/valkey:8 \
  valkey-server --requirepass "$REDIS_PASSWORD" --appendonly no >/dev/null
# Stream(5552)은 플러그인을 켜고, 클라이언트가 받는 광고 주소를 호스트에서 닿는 localhost:STREAM_PORT로 둔다
docker run -d --name "$P-rabbit" -p 127.0.0.1:$AMQP_PORT:5672 -p 127.0.0.1:$STREAM_PORT:5552 \
  -e RABBITMQ_DEFAULT_VHOST=data2flow-dev -e RABBITMQ_DEFAULT_USER=d2f -e RABBITMQ_DEFAULT_PASS="$RABBIT_PASSWORD" \
  -e RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS="-rabbitmq_stream advertised_host localhost advertised_port $STREAM_PORT" \
  rabbitmq:4-management bash -c "rabbitmq-plugins enable --offline rabbitmq_stream rabbitmq_stream_management >/dev/null && exec docker-entrypoint.sh rabbitmq-server" >/dev/null
docker run -d --name "$P-mail" -p 127.0.0.1:$SMTP_PORT:1025 -p 127.0.0.1:$MAILPIT_HTTP:8025 axllent/mailpit:latest >/dev/null

wait_for() { # wait_for 설명 초 명령…
  local name="$1" secs="$2"; shift 2
  for _ in $(seq 1 "$secs"); do if "$@" >/dev/null 2>&1; then echo "  준비됨: $name"; return 0; fi; sleep 1; done
  echo "  시간 초과: $name"; return 1
}
wait_for postgres 60 docker exec "$P-pg" pg_isready -U data2flow -d data2flow
wait_for valkey 30 docker exec "$P-valkey" valkey-cli -a "$REDIS_PASSWORD" ping
wait_for rabbitmq 120 bash -c "docker logs $P-rabbit 2>&1 | grep -q 'Server startup complete'"
wait_for mailpit 30 curl -sf "$MAILPIT/api/v1/info"

# ---------------------------------------------------------------- 빌드
SERVICES=(auth api-gateway core-api pipeline flow-engine action simulator)
if [[ "${SKIP_BUILD:-}" != "1" ]]; then
  log "빌드(테스트 생략)"
  for svc in "${SERVICES[@]}"; do (cd "$ROOT/data2flow-$svc" && ./mvnw -q -B -DskipTests clean package); done
  (cd "$WEB_DIR" && pnpm build >/dev/null)
fi
# JARS_DIR: 다른 곳에서 만든 jar를 쓸 때(예: 작업 중인 저장소 대신 main 빌드). 없으면 형제 저장소의 target
jar_of() { ls ${JARS_DIR:+"$JARS_DIR"/data2flow-"$1"-*.jar} "$ROOT/data2flow-$1"/target/data2flow-"$1"-*.jar 2>/dev/null | grep -v plain | head -1; }

# ---------------------------------------------------------------- 서비스 환경
# 프로필 e2e(설정 파일 없음 = 기본 설정만). 기본 프로필 local은 루트 .env(공용 인프라 접속값)를 읽고 실행 기능을 끄므로 쓰지 않는다.
# 이 시연은 임시 컨테이너만 쓰므로 flow-engine 실행(스트림 소비·타이머·아웃박스)과 action 큐 소비를 켠다(기본값).
# java는 WORK_DIR에서 실행해 상대 경로 ../.env도 닿지 않게 한다
export SPRING_PROFILES_ACTIVE=e2e
cd "$WORK_DIR"
export DATA2FLOW_REDIS_HOST=127.0.0.1 DATA2FLOW_REDIS_PORT=$REDIS_PORT DATA2FLOW_REDIS_PASSWORD="$REDIS_PASSWORD"
COMMON_ENV=(
  DATA2FLOW_DB_HOST=127.0.0.1 DATA2FLOW_DB_PORT=$PG_PORT DATA2FLOW_DB_NAME=data2flow
  DATA2FLOW_DB_USERNAME=data2flow DATA2FLOW_DB_PASSWORD="$DB_PASSWORD"
  DATA2FLOW_RABBITMQ_HOST=127.0.0.1 DATA2FLOW_RABBITMQ_PORT=$AMQP_PORT DATA2FLOW_RABBITMQ_VHOST=data2flow-dev
  DATA2FLOW_RABBITMQ_USERNAME=d2f DATA2FLOW_RABBITMQ_PASSWORD="$RABBIT_PASSWORD" DATA2FLOW_RABBITMQ_STREAM_PORT=$STREAM_PORT
  DATA2FLOW_CORE_URI=http://127.0.0.1:$CORE_PORT
)
CORE_ENV=(
  "${COMMON_ENV[@]}"
  DATA2FLOW_SECRETS_MASTER_KEYS="$MASTER_KEY" DATA2FLOW_SECRETS_ACTIVE_KEY_ID=e2e
  DATA2FLOW_AUTH_BASE_URL=http://127.0.0.1:$AUTH_PORT DATA2FLOW_WEB_BASE_URL="$WEB"
  DATA2FLOW_INGRESS_BASE_URL=http://127.0.0.1:9 DATA2FLOW_PIPELINE_BASE_URL=http://127.0.0.1:$PIPELINE_PORT
  DATA2FLOW_ACTION_BASE_URL=http://127.0.0.1:$ACTION_PORT DATA2FLOW_FLOW_ENGINE_BASE_URL=http://127.0.0.1:$FLOW_PORT
  DATA2FLOW_SIMULATOR_BASE_URL=http://127.0.0.1:$SIM_PORT
  DATA2FLOW_SMTP_HOST=127.0.0.1 DATA2FLOW_SMTP_PORT=$SMTP_PORT
)
CORE_ARGS=(--server.port=$CORE_PORT --management.server.port=$((CORE_PORT + 10)) --data2flow.core.flyway-mode=migrate)

log "최초 관리자 Job(core Flyway migrate + ADMIN 생성)"
env "${CORE_ENV[@]}" DATA2FLOW_BOOTSTRAP_ADMIN_LOGIN_ID=admin01 DATA2FLOW_BOOTSTRAP_ADMIN_EMAIL=admin@example.test \
  DATA2FLOW_BOOTSTRAP_ADMIN_INITIAL_PASSWORD="$ADMIN_PASSWORD" DATA2FLOW_BOOTSTRAP_ORG_NAME="한빛대학교" \
  java -jar "$(jar_of core-api)" "${CORE_ARGS[@]}" --data2flow.core.bootstrap.enabled=true \
  --spring.main.web-application-type=none > "$WORK_DIR/logs/bootstrap.log" 2>&1
check "최초 관리자 Job 완료(ADMIN 생성)" grep -q "부트스트랩 결과" "$WORK_DIR/logs/bootstrap.log"
sql() { docker exec "$P-pg" psql -U data2flow -d data2flow -tAc "$1"; }
ORG=$(sql "SELECT min(id) FROM data2flow_core.organizations")
info "조직 ID $ORG"

log "서비스 시작(pipeline·flow-engine·action·simulator는 자기 스키마를 migrate)"
env "${COMMON_ENV[@]}" HOSTNAME=data2flow-pipeline-e2e-0 java -jar "$(jar_of pipeline)" --server.port=$PIPELINE_PORT \
  --management.server.port=$((PIPELINE_PORT + 10)) --data2flow.pipeline.flyway-mode=migrate \
  > "$WORK_DIR/logs/pipeline.log" 2>&1 & PIDS+=($!)
wait_for "pipeline(스키마)" 120 docker exec "$P-pg" psql -U data2flow -d data2flow -tAc "SELECT 1 FROM data2flow_pipeline.telemetry LIMIT 1"
env "${CORE_ENV[@]}" java -jar "$(jar_of core-api)" "${CORE_ARGS[@]}" > "$WORK_DIR/logs/core-api.log" 2>&1 & PIDS+=($!)
env "${COMMON_ENV[@]}" HOSTNAME=data2flow-flow-engine-e2e-0 java -jar "$(jar_of flow-engine)" --server.port=$FLOW_PORT \
  --management.server.port=$((FLOW_PORT + 10)) --data2flow.flow.flyway-mode=migrate --data2flow.flow.runtime-enabled=true \
  > "$WORK_DIR/logs/flow-engine.log" 2>&1 & PIDS+=($!)
env "${COMMON_ENV[@]}" HOSTNAME=data2flow-action-e2e-0 DATA2FLOW_SIMULATOR_URI=http://127.0.0.1:$SIM_PORT \
  java -jar "$(jar_of action)" --server.port=$ACTION_PORT --management.server.port=$((ACTION_PORT + 10)) \
  --data2flow.action.flyway-mode=migrate --data2flow.action.mqtt.enabled=false \
  > "$WORK_DIR/logs/action.log" 2>&1 & PIDS+=($!)
env "${COMMON_ENV[@]}" HOSTNAME=data2flow-simulator-e2e-0 DATA2FLOW_SIM_ORGANIZATION_IDS="$ORG" \
  java -jar "$(jar_of simulator)" --server.port=$SIM_PORT --management.server.port=$((SIM_PORT + 10)) \
  --data2flow.sim.flyway-mode=migrate \
  > "$WORK_DIR/logs/simulator.log" 2>&1 & PIDS+=($!)
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
  DATA2FLOW_TRUSTED_PROXY_HOPS=0 DATA2FLOW_GATEWAY_TIMEOUT_MS=40000 exec node_modules/.bin/react-router-serve ./build/server/index.js) \
  > "$WORK_DIR/logs/web.log" 2>&1 & PIDS+=($!)

wait_for core-api 150 curl -sf http://127.0.0.1:$((CORE_PORT + 10))/actuator/health/readiness
wait_for pipeline 150 curl -sf http://127.0.0.1:$((PIPELINE_PORT + 10))/actuator/health/readiness
wait_for flow-engine 150 curl -sf http://127.0.0.1:$((FLOW_PORT + 10))/actuator/health/readiness
wait_for action 150 curl -sf http://127.0.0.1:$((ACTION_PORT + 10))/actuator/health/readiness
wait_for simulator 150 curl -sf http://127.0.0.1:$((SIM_PORT + 10))/actuator/health/readiness
wait_for auth 120 curl -sf http://127.0.0.1:$((AUTH_PORT + 10))/actuator/health/readiness
wait_for api-gateway 120 curl -sf http://127.0.0.1:$((GW_PORT + 10))/actuator/health/readiness
wait_for web 60 curl -sf "$WEB/healthz"
check "MQTT 드라이버 꺼짐(action은 virtual 드라이버만)" bash -c "! grep -qi 'mqtt.*connected\|MqttDriver.*created' '$WORK_DIR/logs/action.log'"

# ---------------------------------------------------------------- 도우미
LAST="$WORK_DIR/last"
req() { # 이름 메서드 경로 [curl 인자…] → $LAST.{status,headers,body}
  local jar="$WORK_DIR/$1.jar" method="$2" path="$3"; shift 3
  curl -s -o "$LAST.body" -D "$LAST.headers" -w '%{http_code}' -b "$jar" -c "$jar" -X "$method" "$WEB$path" "$@" > "$LAST.status"
}
status() { cat "$LAST.status"; }
location() { grep -i '^location:' "$LAST.headers" | tail -1 | tr -d '\r' | cut -d' ' -f2-; }
jq_() { python3 -c "import json,sys; d=json.load(open('$LAST.body')); r=d.get('response'); rs=d.get('responses'); print(eval(sys.argv[1]))" "$1"; }
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
sse_count() { grep -cE "^event: ?$2\$" "$1" 2>/dev/null || true; }
space_temp() { jq_ "([(s.get('current') or {}).get('temperature') for s in rs if str(s['spaceId'])=='$SPACE'] or [''])[0]" 2>/dev/null || echo ""; }
iso_now() { python3 -c "import datetime as d; print(d.datetime.now(d.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%fZ'))"; }

# ---------------------------------------------------------------- 1. 관리자 로그인(BFF)
log "1. 관리자 로그인(BFF) → 초기 비밀번호 변경"
T=$(csrf_page admin /login)
form admin /login "$T" intent=credentials loginId=admin01 "password=$ADMIN_PASSWORD" next=/
check "관리자 로그인 302 (got $(status) $(location))" bash -c "[[ '$(status)' == 302 ]]"
T=$(csrf_page admin "/me/security?required=password")
form admin "/me/security" "$T" intent=password "currentPassword=$ADMIN_PASSWORD" "newPassword=$ADMIN_NEW_PASSWORD" "confirmPassword=$ADMIN_NEW_PASSWORD"
check "비밀번호 변경 → 302 / (got $(status) $(location))" bash -c "[[ '$(status)' == 302 && '$(location)' == / ]]"
T=$(csrf_page admin /sim)
check "가상 환경 화면(/sim) 200 (got $(status))" bash -c "[[ '$(status)' == 200 ]]"

# ---------------------------------------------------------------- 2. 가상 강의실 키트
log "2. 가상 강의실 키트 생성(API-SIM-06, 표준 강의실 키트: 온습도 2·CO2·재실·에어컨·공기청정기·환기)"
# 강의실(재실 15명, 외기 35℃)에는 카탈로그 기본 가정용 에어컨(3.5kW)이 모자라므로 조직 프로필(API-SIM-08)로 10kW 천장형을 쓴다
api admin GET /core/sim/catalog "$T"
AC_TYPE=$(jq_ "[t['id'] for t in r['types'] if t['key']=='aircon'][0]")
api admin POST /core/sim/profiles "$T" "{\"name\":\"강의실 천장형 에어컨 10kW\",\"typeId\":\"$AC_TYPE\",\"overrides\":{\"coolingCapacityKw\":10}}"
AC_PROFILE=$(jq_ "r.get('id')")
check "조직 프로필 \"강의실 천장형 에어컨 10kW\" 201 (id=$AC_PROFILE, 유형 $AC_TYPE)" bash -c "[[ '$(status)' == 201 && -n '$AC_PROFILE' ]]"
api admin POST /core/sim/kits/classroom-standard/place "$T" "{\"newSpace\":{\"name\":\"가상 강의실 301\",\"preset\":\"CLASSROOM\"},\"profileOverrides\":{\"aircon\":\"$AC_PROFILE\"}}"
cp "$LAST.body" "$WORK_DIR/kit.json"
SPACE=$(jq_ "r['spaceId']"); DEVICES=$(jq_ "len(r['devices'])")
AIRCON=$(jq_ "[d['deviceId'] for d in r['devices'] if d['typeKey']=='aircon'][0]")
check "키트 배치 201 (공간 $SPACE, 기기 ${DEVICES}대, 에어컨 $AIRCON — 프로필 10kW)" bash -c "[[ '$(status)' == 201 && '$DEVICES' == 7 && -n '$AIRCON' ]]"
BINDINGS=$(jq_ "__import__('json').dumps([f['bindings'] for f in r['suggestedFlows'] if f['templateKey']=='hot-then-cool'][0])")
info "제안 플로우 hot-then-cool 묶음: $BINDINGS"
api admin GET "/core/devices/$AIRCON" "$T"
check "가상 에어컨이 DEV 기기(virtual=true)로 등록 (status=$(jq_ "r.get('status')"), virtual=$(jq_ "r.get('virtual')"))" \
  bash -c "[[ '$(status)' == 200 && '$(jq_ "r.get('virtual')")' == True ]]"

# ---------------------------------------------------------------- 3. 템플릿으로 플로우 생성 → 적용
log "3. \"고온이면 냉방\"(hot-then-cool) 템플릿으로 플로우 생성 → 검증 → 적용"
api admin POST /core/flow-templates/hot-then-cool/instantiate "$T" "{\"name\":\"301호 고온이면 냉방\",\"params\":$BINDINGS}"
cp "$LAST.body" "$WORK_DIR/flow-created.json"
FLOW=$(jq_ "r['flowId']"); DRAFT=$(jq_ "r['draftVersion']")
check "템플릿 플로우 생성 201 (flow=$FLOW, draftVersion=$DRAFT)" bash -c "[[ '$(status)' == 201 && -n '$FLOW' ]]"
api admin POST "/core/flows/$FLOW/validate" "$T" '{}'
check "적용 전 검증 200, 오류 없음 (valid=$(jq_ "r.get('valid')"))" bash -c "[[ '$(status)' == 200 && '$(jq_ "r.get('valid')")' != False ]]"
api admin POST "/core/flows/$FLOW/apply" "$T" "{\"version\":$DRAFT,\"baseVersion\":0,\"acknowledgedRisks\":true,\"memo\":\"M3 시연\"}"
cp "$LAST.body" "$WORK_DIR/flow-applied.json"
check "플로우 적용 200 (appliedVersion=$(jq_ "r.get('appliedVersion')"))" bash -c "[[ '$(status)' == 200 ]]"
APPLY=""
for _ in $(seq 1 60); do
  api admin GET "/core/flows/$FLOW" "$T"
  APPLY=$(jq_ "(r.get('applyStatus') or {}).get('converged')" 2>/dev/null || echo "")
  [[ "$APPLY" == True ]] && break; sleep 1
done
check "flow-engine 적용 확인(applyStatus.converged=$APPLY, 상태 $(jq_ "r['flow'].get('status')"))" bash -c "[[ '$APPLY' == True ]]"

# ---------------------------------------------------------------- 4. "폭염 오후" 시나리오 x60
log "4. \"폭염 오후\" 시나리오(가상 강의실 301, 8/10 12:00 KST부터, 외기 최고 35℃·재실 15명) → x60 실행"
scenario_body() { # 이름 길이(초) 시드
  python3 - "$1" "$2" "$3" "$SPACE" <<'PY'
import json, sys
name, dur, seed, space = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
print(json.dumps({
  "name": name, "spaceIds": [space], "simStartAt": "2026-08-10T03:00:00Z", "durationSec": dur, "seed": seed,
  "useCalendar": False,
  "outdoor": {"mode": "DIURNAL", "diurnal": {"max": 35, "min": 27, "peakHour": 15, "humidity": 55}},
  "events": [{"id": "class", "track": "OCCUPANCY", "at": "2026-08-10T03:20:00Z", "until": "2026-08-10T09:00:00Z",
              "target": {"spaceId": space}, "params": {"count": 15, "activity": 2.0}}],
  "expectations": []}, ensure_ascii=False))
PY
}
api admin POST /core/sim/scenarios "$T" "$(scenario_body "폭염 오후" 10800 "$SEED")"
SCN=$(jq_ "r.get('scenarioId') or r.get('id')")
check "시나리오 \"폭염 오후\" 생성 201 (id=$SCN)" bash -c "[[ '$(status)' == 201 && -n '$SCN' ]]"

# BFF 실시간 연결(브라우저 EventSource처럼 세션 쿠키): 에어컨 명령 결과 + 공간 기기 상태
curl -s -N --max-time 600 -b "$WORK_DIR/admin.jar" -H "Accept: text/event-stream" \
  "$WEB/bff/stream/live?topics=commands:$AIRCON,space:$SPACE" > "$WORK_DIR/sse-live.txt" 2>/dev/null & SSE_PID=$!
PIDS+=($SSE_PID)
sleep 2
api admin POST /core/sim/runs "$T" "{\"scenarioId\":\"$SCN\",\"acceleration\":60,\"timestampPolicy\":\"SIMULATED\",\"seed\":$SEED}"
RUN=$(jq_ "r['runId']")
RUN_T0=$(date +%s)
check "실행 시작 201 RUNNING (run=$RUN, 가속 x$(jq_ "r.get('accelerationEffective')"))" bash -c "[[ '$(status)' == 201 && '$(jq_ "r['status']")' == RUNNING ]]"

# 시뮬레이션 시각·공간 온도를 1초마다 기록하고, 에어컨 명령(action 명령 이력)이 생길 때까지 기다린다
TRACE="$WORK_DIR/trace.tsv"; : > "$TRACE"
CMD_WALL=""; CMD_SIM=""
for _ in $(seq 1 300); do
  api admin GET "/core/sim/runs/$RUN" "$T"; SIMCLOCK=$(jq_ "r.get('simClock')"); RSTATUS=$(jq_ "r.get('status')")
  api admin GET "/core/sim/spaces" "$T"
  TEMP=$(space_temp)
  printf '%s\t%s\t%s\n' "$(date +%s)" "$SIMCLOCK" "$TEMP" >> "$TRACE"
  if [[ -z "$CMD_WALL" ]]; then
    api admin GET "/core/devices/$AIRCON/commands?page=1&size=20" "$T"
    if [[ "$(jq_ "len(rs or [])")" -ge 1 ]]; then CMD_WALL=$(date +%s); CMD_SIM="$SIMCLOCK"; cp "$LAST.body" "$WORK_DIR/commands.json"; break; fi
  fi
  [[ "$RSTATUS" != RUNNING ]] && break
  sleep 1
done
info "실행 기록(실제 초·시뮬레이션 시각·공간 온도): $TRACE"
check "에어컨 명령 발생(실행 후 실제 $(( ${CMD_WALL:-$RUN_T0} - RUN_T0 ))초, 시뮬레이션 $CMD_SIM)" test -n "$CMD_WALL"

# 27℃ 이상이 처음 된 시뮬레이션 시각(기록)과 명령 시각의 차이 = 지속 판정(5분) + 집계(1분) 이내여야 한다
HOT_SIM=$(python3 - "$TRACE" <<'PY'
import sys
for line in open(sys.argv[1]):
    w, sim, t = (line.rstrip("\n").split("\t") + ["", "", ""])[:3]
    try:
        if float(t) >= 27.0: print(sim); break
    except ValueError: pass
PY
)
GAP=$(python3 -c "
import datetime as d,sys
f=lambda s: d.datetime.fromisoformat(s.replace('Z','+00:00'))
a,b='$HOT_SIM','$CMD_SIM'
print(int((f(b)-f(a)).total_seconds()/60) if a and b else '')" 2>/dev/null || echo "")
info "공간 온도 27℃ 도달(시뮬레이션) $HOT_SIM → 명령 $CMD_SIM (${GAP}분)"
check "27℃ 이상 5분 지속 뒤에 명령(도달 후 ${GAP}분, 기대 5~10분)" bash -c "[[ -n '$GAP' && $GAP -ge 5 && $GAP -le 10 ]]"

python3 - "$WORK_DIR/commands.json" > "$WORK_DIR/command.txt" <<'PY'
import json, sys
c = json.load(open(sys.argv[1]))["responses"][0]
src = c.get("source") or {}
a = c.get("args") or {}
ok = (c.get("capability") == "Thermostat" and c.get("command") == "set" and a.get("mode") == "cool"
      and float(a.get("targetTemperature", 0)) == 24.0 and src.get("type") == "FLOW")
print("\t".join(str(x) for x in (c.get("commandId") or c.get("id"), "%s.%s %s" % (c.get("capability"), c.get("command"),
      json.dumps(a, separators=(",", ":"), ensure_ascii=False)), src.get("type"), src.get("flowName") or "", c.get("status"), ok)))
PY
IFS=$'\t' read -r CMD_ID CMD_DESC CMD_SRC CMD_FLOWNAME CMD_STATUS CMD_OK < "$WORK_DIR/command.txt" || true
info "명령 $CMD_ID: $CMD_DESC 출처 $CMD_SRC($CMD_FLOWNAME) 상태 $CMD_STATUS"
check "명령 = Thermostat.set {mode: cool, targetTemperature: 24}, 출처 FLOW" test "$CMD_OK" == True

# 명령이 APPLIED가 되고 가상 온도가 내려가 24±1℃에 머무는지(시뮬레이션 90분) 본다
APPLIED=""
for _ in $(seq 1 30); do
  api admin GET "/core/devices/$AIRCON/commands?page=1&size=20" "$T"
  APPLIED=$(jq_ "rs[0].get('status')"); [[ "$APPLIED" == APPLIED ]] && break; sleep 1
done
check "명령 상태 APPLIED (got $APPLIED)" bash -c "[[ '$APPLIED' == APPLIED ]]"
for _ in $(seq 1 120); do
  api admin GET "/core/sim/runs/$RUN" "$T"; SIMCLOCK=$(jq_ "r.get('simClock')"); RSTATUS=$(jq_ "r.get('status')")
  api admin GET "/core/sim/spaces" "$T"
  TEMP=$(space_temp)
  printf '%s\t%s\t%s\n' "$(date +%s)" "$SIMCLOCK" "$TEMP" >> "$TRACE"
  ELAPSED=$(python3 -c "
import datetime as d
f=lambda s: d.datetime.fromisoformat(s.replace('Z','+00:00'))
print(int((f('$SIMCLOCK')-f('$CMD_SIM')).total_seconds()/60))" 2>/dev/null || echo 0)
  [[ "$ELAPSED" -ge 90 || "$RSTATUS" != RUNNING ]] && break
  sleep 1
done
read -r PEAK SETTLE_MIN SETTLE_MAX SETTLE_N < <(python3 - "$TRACE" "$CMD_SIM" <<'PY'
import sys, datetime as d
f = lambda s: d.datetime.fromisoformat(s.replace('Z', '+00:00'))
cmd = f(sys.argv[2]); rows = []
for line in open(sys.argv[1]):
    w, sim, t = (line.rstrip("\n").split("\t") + ["", "", ""])[:3]
    try: rows.append((f(sim), float(t)))
    except ValueError: pass
peak = max(t for s, t in rows if s >= cmd - d.timedelta(minutes=10))
late = [t for s, t in rows if s >= cmd + d.timedelta(minutes=60)]
print("%.2f %.2f %.2f %d" % (peak, min(late or [0]), max(late or [0]), len(late)))
PY
)
info "명령 뒤 최고 ${PEAK}℃, 명령 60~90분 뒤(시뮬레이션) ${SETTLE_MIN}~${SETTLE_MAX}℃ (${SETTLE_N}개 표본)"
check "가상 온도 하강 후 24±1℃ 안정(${SETTLE_MIN}~${SETTLE_MAX}℃)" \
  python3 -c "import sys; sys.exit(0 if $SETTLE_N > 0 and 23.0 <= $SETTLE_MIN and $SETTLE_MAX <= 25.0 and $PEAK > $SETTLE_MAX else 1)"

kill "$SSE_PID" 2>/dev/null || true; wait "$SSE_PID" 2>/dev/null || true
CS=$(sse_count "$WORK_DIR/sse-live.txt" command-status); DU=$(sse_count "$WORK_DIR/sse-live.txt" device-update)
python3 - "$WORK_DIR/sse-live.txt" "$AIRCON" > "$WORK_DIR/sse-summary.txt" <<'PY'
import json, sys
ev = None; statuses = []; reported = None
for line in open(sys.argv[1], encoding="utf-8", errors="replace"):
    line = line.rstrip("\n")
    if line.startswith("event:"): ev = line[6:].strip()
    elif line.startswith("data:"):
        try: d = json.loads(line[5:].strip())
        except ValueError: continue
        if ev == "command-status": statuses.append(d.get("status"))
        elif ev == "device-update" and str(d.get("deviceId")) == sys.argv[2] and isinstance(d.get("state"), dict):
            reported = (d["state"].get("reported") or {}).get("Thermostat") or reported
print(",".join(s for s in statuses if s), json.dumps(reported, ensure_ascii=False, sort_keys=True))
PY
read -r SSE_STATUSES SSE_REPORTED < "$WORK_DIR/sse-summary.txt" || true
info "SSE command-status ${CS}건 [$SSE_STATUSES], device-update ${DU}건, 에어컨 보고 상태 $SSE_REPORTED"
check "SSE command-status로 명령 진행 수신(APPLIED 포함)" bash -c "[[ '$SSE_STATUSES' == *APPLIED* ]]"
check "SSE device-update로 에어컨 보고 상태(state.reported.Thermostat) 수신" bash -c "[[ '$SSE_REPORTED' == *cool* ]]"
T=$(csrf_page admin "/devices/$AIRCON")
check "기기 상세(명령 이력) 화면 200 (got $(status))" bash -c "[[ '$(status)' == 200 ]]"

api admin POST "/core/sim/runs/$RUN/stop" "$T" '{}'
check "폐루프 실행 정지 (status=$(jq_ "r.get('status')" 2>/dev/null))" bash -c "[[ '$(status)' == 200 ]]"

# ---------------------------------------------------------------- 5. 결정적 재현(같은 시드 = 같은 SHA-256)
log "5. 결정적 재현: 플로우 일시정지 → 같은 시드($SEED)로 \"폭염 오후(재현)\" 1시간을 x60으로 두 번 → dataSha256 비교"
api admin POST "/core/flows/$FLOW/pause" "$T" '{}'
check "플로우 일시정지(제어가 끼어들지 않게) (got $(status))" bash -c "[[ '$(status)' == 200 || '$(status)' == 204 ]]"
api admin POST /core/sim/scenarios "$T" "$(scenario_body "폭염 오후(재현)" 3600 "$SEED")"
SCN2=$(jq_ "r.get('scenarioId') or r.get('id')")
run_to_end() { # 시나리오 → runId, 끝날 때까지 기다림
  local rid=""
  for _ in $(seq 1 30); do
    api admin POST /core/sim/runs "$T" "{\"scenarioId\":\"$1\",\"acceleration\":60,\"seed\":$SEED}"
    [[ "$(status)" == 201 ]] && { rid=$(jq_ "r['runId']"); break; }
    sleep 2   # 앞 실행이 공간을 놓을 때까지(SIM_SPACE_BUSY)
  done
  for _ in $(seq 1 150); do
    api admin GET "/core/sim/runs/$rid" "$T"; [[ "$(jq_ "r.get('status')")" == COMPLETED ]] && break; sleep 1
  done
  echo "$rid"
}
SHA=()
for i in 1 2; do
  R=$(run_to_end "$SCN2")
  api admin GET "/core/sim/runs/$R/report" "$T"
  SHA+=("$(jq_ "r.get('dataSha256')")")
  info "재현 실행 $i: run=$R status=COMPLETED? $(jq_ "not r.get('partial')") 측정값 $(jq_ "r.get('readings')")개 SHA-256=${SHA[$((i - 1))]}"
done
check "같은 시드 두 번 실행의 SHA-256 동일" bash -c "[[ ${#SHA[0]} -eq 64 && '${SHA[0]}' == '${SHA[1]}' ]]"

# ---------------------------------------------------------------- 결과
log "결과: PASS $PASS · FAIL $FAIL (기록 $RESULTS)"
[[ $FAIL -eq 0 ]]
