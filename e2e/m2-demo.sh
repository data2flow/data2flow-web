#!/usr/bin/env bash
# M2 시연(plan/milestones.md §M2, 시나리오 1의 1~3단계) 전 구간 로컬 검증:
#   web BFF → api-gateway → auth·core-api,  로컬 Mosquitto(ChirpStack 흉내) → ingress → data2flow.raw → pipeline → DB·data2flow.telemetry → core SSE
#
# 공용 인프라(s3·s4·iot-data.java21.net)는 쓰지 않는다. PostgreSQL 18·Valkey 8·RabbitMQ 4(stream)·Mailpit·Mosquitto 2를 임시 Docker
# 컨테이너로 띄우고, 끝나면(성공·실패 모두) 컨테이너와 프로세스를 지운다(CLAUDE.md §5). 업링크 발행은 이 임시 Mosquitto에만 한다.
#
# 필요: docker, java 21, node 22 + pnpm, curl, python3, openssl, lsof.
#       형제 디렉터리에 data2flow-auth·api-gateway·core-api·ingress·pipeline이 있어야 하고, data2flow-contracts가 로컬 저장소에 설치돼 있어야 한다.
# 사용:
#   e2e/m2-demo.sh                    # 빌드 + 시연(약 6분: 1분 집계를 기다린다)
#   SKIP_BUILD=1 e2e/m2-demo.sh       # 이미 만든 jar·build 재사용
#   WORK_DIR=/tmp/m2 e2e/m2-demo.sh   # 생성 키·로그·쿠키를 둘 곳(기본: mktemp). 키는 실행마다 새로 만든다
#   KEEP=1 e2e/m2-demo.sh             # 끝나도 컨테이너·프로세스를 남긴다(디버깅용)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WEB_DIR="$ROOT/data2flow-web"
GOLDEN="$ROOT/data2flow-pipeline/src/test/resources/golden/chirpstack"
WORK_DIR="${WORK_DIR:-$(mktemp -d -t d2f-m2)}"
mkdir -p "$WORK_DIR/logs"
chmod 700 "$WORK_DIR"
P="d2f-m2e2e"                  # 컨테이너 이름 접두사

PG_PORT=35432; REDIS_PORT=36379; AMQP_PORT=35672; STREAM_PORT=35552; SMTP_PORT=31025; MAILPIT_HTTP=38025; MQTT_PORT=31883
GW_PORT=38780; AUTH_PORT=38781; CORE_PORT=38782; INGRESS_PORT=38783; PIPELINE_PORT=38784; WEB_PORT=38788
SVC_PORTS=($GW_PORT $AUTH_PORT $CORE_PORT $INGRESS_PORT $PIPELINE_PORT $WEB_PORT)
WEB="http://localhost:$WEB_PORT"
ORIGIN="$WEB"
MAILPIT="http://127.0.0.1:$MAILPIT_HTTP"
CONTAINERS=("$P-pg" "$P-valkey" "$P-rabbit" "$P-mail" "$P-mqtt")

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
# ChirpStack이 쓰는 MQTT 브로커 역할(이 시연 전용, 익명 허용). 공용 브로커에는 붙지도 발행하지도 않는다
docker run -d --name "$P-mqtt" -p 127.0.0.1:$MQTT_PORT:1883 eclipse-mosquitto:2 \
  sh -c 'printf "listener 1883\nallow_anonymous true\npersistence false\n" > /tmp/m.conf && exec mosquitto -c /tmp/m.conf' >/dev/null

wait_for() { # wait_for 설명 초 명령…
  local name="$1" secs="$2"; shift 2
  for _ in $(seq 1 "$secs"); do if "$@" >/dev/null 2>&1; then echo "  준비됨: $name"; return 0; fi; sleep 1; done
  echo "  시간 초과: $name"; return 1
}
wait_for postgres 60 docker exec "$P-pg" pg_isready -U data2flow -d data2flow
wait_for valkey 30 docker exec "$P-valkey" valkey-cli -a "$REDIS_PASSWORD" ping
wait_for rabbitmq 120 bash -c "docker logs $P-rabbit 2>&1 | grep -q 'Server startup complete'"
wait_for mailpit 30 curl -sf "$MAILPIT/api/v1/info"
wait_for mosquitto 30 docker exec "$P-mqtt" mosquitto_sub -h 127.0.0.1 -t '$SYS/broker/version' -C 1 -W 2

# ---------------------------------------------------------------- 빌드
if [[ "${SKIP_BUILD:-}" != "1" ]]; then
  log "빌드(테스트 생략)"
  for svc in auth api-gateway core-api ingress pipeline; do (cd "$ROOT/data2flow-$svc" && ./mvnw -q -B -DskipTests clean package); done
  (cd "$WEB_DIR" && pnpm build >/dev/null)
fi
jar_of() { ls "$ROOT/data2flow-$1"/target/data2flow-"$1"-*.jar | grep -v plain | head -1; }

# ---------------------------------------------------------------- 서비스 환경
# 프로필 e2e(설정 파일 없음 = 기본 설정만). 기본 프로필 local은 루트 .env(공용 인프라 접속값)를 읽으므로 쓰지 않는다.
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
  DATA2FLOW_INGRESS_BASE_URL=http://127.0.0.1:$INGRESS_PORT DATA2FLOW_PIPELINE_BASE_URL=http://127.0.0.1:$PIPELINE_PORT
)
CORE_ARGS=(--server.port=$CORE_PORT --management.server.port=$((CORE_PORT + 10)) --data2flow.core.flyway-mode=migrate)

log "최초 관리자 Job(core Flyway migrate + ADMIN 생성)"
env "${CORE_ENV[@]}" DATA2FLOW_BOOTSTRAP_ADMIN_LOGIN_ID=admin01 DATA2FLOW_BOOTSTRAP_ADMIN_EMAIL=admin@example.test \
  DATA2FLOW_BOOTSTRAP_ADMIN_INITIAL_PASSWORD="$ADMIN_PASSWORD" DATA2FLOW_BOOTSTRAP_ORG_NAME="한빛대학교" \
  java -jar "$(jar_of core-api)" "${CORE_ARGS[@]}" --data2flow.core.bootstrap.enabled=true \
  --spring.main.web-application-type=none > "$WORK_DIR/logs/bootstrap.log" 2>&1
check "최초 관리자 Job 완료(ADMIN 생성)" grep -q "부트스트랩 결과" "$WORK_DIR/logs/bootstrap.log"

log "서비스 시작(pipeline이 자기 스키마를 먼저 migrate)"
env "${COMMON_ENV[@]}" HOSTNAME=data2flow-pipeline-e2e-0 java -jar "$(jar_of pipeline)" --server.port=$PIPELINE_PORT \
  --management.server.port=$((PIPELINE_PORT + 10)) --data2flow.pipeline.flyway-mode=migrate \
  > "$WORK_DIR/logs/pipeline.log" 2>&1 & PIDS+=($!)
wait_for "pipeline(스키마)" 120 docker exec "$P-pg" psql -U data2flow -d data2flow -tAc "SELECT 1 FROM data2flow_pipeline.telemetry LIMIT 1"
env "${CORE_ENV[@]}" java -jar "$(jar_of core-api)" "${CORE_ARGS[@]}" > "$WORK_DIR/logs/core-api.log" 2>&1 & PIDS+=($!)
# ingress: 소스 설정은 core가 준다. 플랫폼 브로커 주소는 이 시연의 Mosquitto(공용 iot-data가 아님). 개발자 client-id(-dev-e2e-0)
env "${COMMON_ENV[@]}" HOSTNAME=data2flow-ingress-0 java -jar "$(jar_of ingress)" --server.port=$INGRESS_PORT \
  --management.server.port=$((INGRESS_PORT + 10)) \
  --data2flow.ingress.core-uri=http://127.0.0.1:$CORE_PORT --data2flow.ingress.developer=e2e \
  --data2flow.ingress.stream.host=127.0.0.1 --data2flow.ingress.stream.port=$STREAM_PORT \
  --data2flow.ingress.stream.virtual-host=data2flow-dev --data2flow.ingress.stream.username=d2f \
  --data2flow.ingress.stream.password="$RABBIT_PASSWORD" --data2flow.ingress.stream.use-configured-address=true \
  --spring.rabbitmq.host=127.0.0.1 --spring.rabbitmq.port=$AMQP_PORT --spring.rabbitmq.virtual-host=data2flow-dev \
  --spring.rabbitmq.username=d2f --spring.rabbitmq.password="$RABBIT_PASSWORD" \
  --data2flow.ingress.platform-broker.url=tcp://127.0.0.1:$MQTT_PORT \
  > "$WORK_DIR/logs/ingress.log" 2>&1 & PIDS+=($!)
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
wait_for ingress 150 curl -sf http://127.0.0.1:$((INGRESS_PORT + 10))/actuator/health/readiness
wait_for auth 120 curl -sf http://127.0.0.1:$((AUTH_PORT + 10))/actuator/health/readiness
wait_for api-gateway 120 curl -sf http://127.0.0.1:$((GW_PORT + 10))/actuator/health/readiness
wait_for web 60 curl -sf "$WEB/healthz"

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
sql() { docker exec "$P-pg" psql -U data2flow -d data2flow -tAc "$1"; }
sse() { # sse 출력파일 초 토픽 — 브라우저 EventSource처럼 세션 쿠키로 BFF 실시간 연결
  curl -s -N --max-time "$2" -b "$WORK_DIR/admin.jar" -H "Accept: text/event-stream" "$WEB/bff/stream/live?topics=$3" > "$1" 2>/dev/null || true
}
sse_count() { grep -cE "^event: ?$2\$" "$1" 2>/dev/null || true; }

# 아카데미 6종 ChirpStack v4 업링크(pipeline 골든 픽스처를 바탕으로 시각·deduplicationId·fCnt·값을 새로 채움)
cat > "$WORK_DIR/uplink.py" <<'PY'
import json, sys, uuid, datetime, random
golden, fcnt = sys.argv[1], int(sys.argv[2])
d = json.load(open(golden))
now = datetime.datetime.now(datetime.timezone.utc)
d["deduplicationId"] = str(uuid.uuid4())
d["time"] = now.isoformat(timespec="milliseconds").replace("+00:00", "Z")
d["fCnt"] = fcnt
for rx in d.get("rxInfo", []):
    rx["nsTime"] = d["time"]
obj = d.get("object", {})
for k, v in list(obj.items()):
    if isinstance(v, (int, float)) and k in ("temperature", "humidity", "co2", "LAeq"):
        obj[k] = round(v + random.uniform(-0.5, 0.5), 1)
dev = d["deviceInfo"]["devEui"]
print("application/%s/device/%s/event/up" % (d["deviceInfo"]["applicationId"], dev.lower()))
print(json.dumps(d, ensure_ascii=False, separators=(",", ":")))
PY
MODELS=(em300-th-normal em320-th em500-co2 am103 am107 ws302)
FCNT=1000
publish_uplink() { # 골든 이름 → 로컬 Mosquitto에 QoS 1 발행
  FCNT=$((FCNT + 1))
  local out topic payload
  out=$(python3 "$WORK_DIR/uplink.py" "$GOLDEN/$1.json" "$FCNT")
  topic=$(sed -n 1p <<< "$out"); payload=$(sed -n 2p <<< "$out")
  printf '%s' "$payload" | docker exec -i "$P-mqtt" mosquitto_pub -h 127.0.0.1 -q 1 -t "$topic" -s
}
publish_all() { for m in "${MODELS[@]}"; do publish_uplink "$m"; done; }
publish_raw() { # 토픽 본문(파일) — 플랫폼 브로커 기기 흉내
  docker exec -i "$P-mqtt" mosquitto_pub -h 127.0.0.1 -q 1 -t "$1" -s < "$2"
}

# ---------------------------------------------------------------- 1. 관리자 로그인(BFF)
log "1. 관리자 로그인(BFF) → 초기 비밀번호 변경"
T=$(csrf_page admin /login)
form admin /login "$T" intent=credentials loginId=admin01 "password=$ADMIN_PASSWORD" next=/
check "관리자 로그인 302 (got $(status) $(location))" bash -c "[[ '$(status)' == 302 ]]"
T=$(csrf_page admin "/me/security?required=password")
form admin "/me/security" "$T" intent=password "currentPassword=$ADMIN_PASSWORD" "newPassword=$ADMIN_NEW_PASSWORD" "confirmPassword=$ADMIN_NEW_PASSWORD"
check "비밀번호 변경 → 302 / (got $(status) $(location))" bash -c "[[ '$(status)' == 302 && '$(location)' == / ]]"
DEMO_START=$(date +%s)
T=$(csrf_page admin /sources)
check "소스 화면(/sources) 200 (got $(status))" bash -c "[[ '$(status)' == 200 ]]"

log "1-1. 공간(사이트 → 건물 → 층 → 실습실)"
api admin POST /core/spaces "$T" '{"type":"SITE","name":"광주캠퍼스","timezone":"Asia/Seoul"}'; SITE=$(jq_ "r['id']")
api admin POST /core/spaces "$T" "{\"parentId\":\"$SITE\",\"type\":\"BUILDING\",\"name\":\"본관\"}"; BLD=$(jq_ "r['id']")
api admin POST /core/spaces "$T" "{\"parentId\":\"$BLD\",\"type\":\"FLOOR\",\"name\":\"3층\"}"; FLR=$(jq_ "r['id']")
api admin POST /core/spaces "$T" "{\"parentId\":\"$FLR\",\"type\":\"ROOM\",\"name\":\"실습실\"}"; ROOM=$(jq_ "r['id']")
check "실습실 공간 생성 201 (id=$ROOM)" bash -c "[[ '$(status)' == 201 && -n '$ROOM' ]]"
api admin GET "/core/device-models?page=1&size=100" "$T"
python3 -c "import json; d=json.load(open('$LAST.body')); print('\n'.join(m['code']+' '+m['id'] for m in d.get('responses') or []))" > "$WORK_DIR/models.txt"
check "기본 모델 6종 시드(EM300-TH·EM320-TH·EM500-CO2·AM103·AM107·WS302)" \
  bash -c "[[ \$(grep -cE '^(EM300-TH|EM320-TH|EM500-CO2|AM103|AM107|WS302) ' '$WORK_DIR/models.txt') == 6 ]]"
model_id() { awk -v c="$1" '$1==c {print $2}' "$WORK_DIR/models.txt"; }

# ---------------------------------------------------------------- 2. ChirpStack 소스 등록 전 연결 테스트
log "2. ChirpStack MQTT 소스: 저장 전 연결 테스트(최근 메시지 미리보기)"
CS_CONN="{\"url\":\"tcp://127.0.0.1:$MQTT_PORT\",\"protocolVersion\":\"5.0\",\"qos\":1,\"keepaliveSec\":60,\"cleanStart\":false,\"auth\":\"NONE\"}"
CS_TOPICS='[{"topic":"application/+/device/+/event/up","qos":1}]'
TEST_BODY="{\"code\":\"academy-chirpstack\",\"name\":\"아카데미 ChirpStack\",\"type\":\"MQTT_SUBSCRIBE\",\"connectorKey\":\"mqtt\",\"connection\":$CS_CONN,\"topics\":$CS_TOPICS,\"decoderKey\":\"chirpstack-v4\"}"
( sleep 3; publish_uplink em300-th-normal; publish_uplink am107; publish_uplink ws302 ) & PUB=$!
api admin POST "/core/sources/test?timeoutSec=8" "$T" "$TEST_BODY"
wait $PUB || true
cp "$LAST.body" "$WORK_DIR/connection-test.json"
PREVIEW=$(jq_ "len(r.get('preview') or [])" 2>/dev/null || echo 0)
check "연결 테스트 200, 단계 실패 없음(ok=$(jq_ "r.get('ok')" 2>/dev/null))" bash -c "[[ '$(status)' == 200 ]] && ! grep -q '\"FAILED\"' '$LAST.body'"
check "연결 테스트 미리보기에 최근 메시지 ${PREVIEW}건(기대 ≥1)" bash -c "[[ ${PREVIEW:-0} -ge 1 ]]"

log "2-1. 소스 저장·활성화 → 상태 CONNECTED가 실시간(sources 토픽)으로 화면에 반영(DSC-02.01, 5초)"
sse "$WORK_DIR/sse-sources.txt" 25 sources & SSE_SRC=$!
sleep 2
CREATED_AT=$(python3 -c 'import time; print(time.time())')
api admin POST /core/sources "$T" "${TEST_BODY%\}},\"unknownDevicePolicy\":\"AUTO_REGISTER\",\"activate\":true}"
CS_SOURCE=$(jq_ "r['id']")
check "소스 생성 201·ACTIVE (id=$CS_SOURCE, lifecycle=$(jq_ "r.get('lifecycle')"))" bash -c "[[ '$(status)' == 201 && '$(jq_ "r.get('lifecycle')")' == ACTIVE ]]"
STATE=""
for _ in $(seq 1 30); do
  api admin GET "/core/sources/$CS_SOURCE" "$T"; STATE=$(jq_ "r.get('state')")
  [[ "$STATE" == CONNECTED ]] && break; sleep 1
done
check "소스 상태 CONNECTED (got $STATE)" bash -c "[[ '$STATE' == CONNECTED ]]"
wait $SSE_SRC || true
SSE_STATE_LAT=$(python3 - "$WORK_DIR/sse-sources.txt" "$CS_SOURCE" "$CREATED_AT" <<'PY'
import json, sys, datetime
path, sid, t0 = sys.argv[1], sys.argv[2], float(sys.argv[3])
ev = None
for line in open(path, encoding="utf-8", errors="replace"):
    line = line.rstrip("\n")
    if line.startswith("event:"):
        ev = line[6:].strip()
    elif line.startswith("data:") and ev == "source-state":
        d = json.loads(line[5:].strip())
        if str(d.get("sourceId")) == sid and d.get("state") == "CONNECTED":
            at = datetime.datetime.fromisoformat(d["at"].replace("Z", "+00:00")).timestamp()
            print("%.1f" % (at - t0)); break
PY
)
check "SSE source-state CONNECTED 수신(생성 후 ${SSE_STATE_LAT:-없음}초, 이벤트 $(sse_count "$WORK_DIR/sse-sources.txt" source-state)건)" test -n "$SSE_STATE_LAT"
T=$(csrf_page admin "/sources/$CS_SOURCE")
check "소스 상세 화면 200 (got $(status))" bash -c "[[ '$(status)' == 200 ]]"

# ---------------------------------------------------------------- 3. 첫 업링크 → PENDING 자동 등록
log "3. 아카데미 6종 첫 업링크 → 기기 PENDING 자동 등록"
publish_all
PENDING=0
for _ in $(seq 1 60); do
  api admin GET "/core/devices?status=PENDING&sourceId=$CS_SOURCE&page=1&size=50" "$T"
  PENDING=$(python3 -c "import json; print(json.load(open('$LAST.body')).get('totalCount', 0))")
  [[ "$PENDING" -ge 6 ]] && break; sleep 1
done
cp "$LAST.body" "$WORK_DIR/pending.json"
check "승인 대기(PENDING) 기기 ${PENDING}대(기대 6)" bash -c "[[ $PENDING -eq 6 ]]"
T=$(csrf_page admin /devices/pending)
check "승인 대기 화면 200 (got $(status))" bash -c "[[ '$(status)' == 200 ]]"

# ---------------------------------------------------------------- 4. 모델·공간 지정 승인
log "4. 모델·공간 지정 승인(기기마다 해당 모델)"
python3 - "$WORK_DIR/pending.json" "$GOLDEN" > "$WORK_DIR/approve-plan.txt" <<'PY'
import json, sys, glob, os
pending = json.load(open(sys.argv[1]))["responses"]
profile = {}
for f in glob.glob(os.path.join(sys.argv[2], "*.json")):
    if f.endswith(".expected.json"): continue
    d = json.load(open(f))
    profile[d["deviceInfo"]["devEui"].lower()] = d["deviceInfo"].get("deviceProfileName")
for p in pending:
    print(p["id"], p["version"], profile.get(p["externalId"].lower(), "?"), p["externalId"])
PY
APPROVED=0
while read -r DEV VER CODE EXT; do
  api admin POST /core/devices/approve "$T" "{\"items\":[{\"deviceId\":\"$DEV\",\"baseVersion\":$VER}],\"modelId\":\"$(model_id "$CODE")\",\"spaceId\":\"$ROOM\"}"
  if [[ "$(status)" == 200 && "$(jq_ "r['results'][0]['ok']")" == True ]]; then APPROVED=$((APPROVED + 1)); fi
  echo "$DEV $CODE $EXT" >> "$WORK_DIR/devices.txt"
done < "$WORK_DIR/approve-plan.txt"
check "승인 ${APPROVED}/6 (모델 EM300-TH·EM320-TH·EM500-CO2·AM103·AM107·WS302, 공간 실습실)" bash -c "[[ $APPROVED -eq 6 ]]"
api admin GET "/core/devices?status=ACTIVE&spaceId=$ROOM&page=1&size=50" "$T"
check "실습실 ACTIVE 기기 $(jq_ "d.get('totalCount')")대" bash -c "[[ '$(jq_ "d.get('totalCount')")' == 6 ]]"
EM300=$(awk '$2=="EM300-TH" {print $1}' "$WORK_DIR/devices.txt")
AM107=$(awk '$2=="AM107" {print $1}' "$WORK_DIR/devices.txt")

# ---------------------------------------------------------------- 5. 실시간 차트(SSE)
log "5. 실시간 값(BFF SSE): space → device-update, telemetry → point"
sleep 3   # 승인 설정 변경이 pipeline 기기 캐시에 닿을 시간
sse "$WORK_DIR/sse-live.txt" 25 "space:$ROOM,telemetry:$EM300.temperature,telemetry:$AM107.co2" & SSE_LIVE=$!
sleep 3
LIVE_T0=$(date +%s)
for _ in 1 2 3; do publish_all; sleep 2; done
wait $SSE_LIVE || true
DU=$(sse_count "$WORK_DIR/sse-live.txt" device-update); PT=$(sse_count "$WORK_DIR/sse-live.txt" point)
check "SSE ready 이벤트(토픽 수락)" grep -qE '^event: ?ready' "$WORK_DIR/sse-live.txt"
check "SSE device-update ${DU}건(기대 ≥6)" bash -c "[[ $DU -ge 6 ]]"
check "SSE point ${PT}건(EM300 temperature·AM107 co2, 기대 ≥2)" bash -c "[[ $PT -ge 2 ]]"
LIVE_SEC=$(( $(date +%s) - DEMO_START ))
check "로그인부터 실시간 값 표시까지 ${LIVE_SEC}초(기준 30분)" bash -c "[[ $LIVE_SEC -lt 1800 ]]"
{ grep -E -A1 '^event: ?point' "$WORK_DIR/sse-live.txt" | grep '^data:' | head -2 | sed 's/^/        /'; } || true

# ---------------------------------------------------------------- 6. 저장값·집계 조회
log "6. 시계열 조회(저장값)와 1분 집계"
FROM=$(python3 -c "import datetime as d; print((d.datetime.now(d.timezone.utc)-d.timedelta(minutes=30)).strftime('%Y-%m-%dT%H:%M:%SZ'))")
TO=$(python3 -c "import datetime as d; print((d.datetime.now(d.timezone.utc)+d.timedelta(minutes=5)).strftime('%Y-%m-%dT%H:%M:%SZ'))")
api admin GET "/core/telemetry/series?deviceId=$EM300&metrics=temperature,humidity&from=$FROM&to=$TO&resolution=raw" "$T"
RAWN=$(jq_ "sum(len(s.get('points') or []) for s in r.get('series') or [])" 2>/dev/null || echo 0)
check "EM300 temperature·humidity 원본 점 ${RAWN}개(기대 ≥4)" bash -c "[[ ${RAWN:-0} -ge 4 ]]"
TOTAL=$(sql "SELECT count(*) FROM data2flow_pipeline.telemetry WHERE device_id IN ($(cut -d' ' -f1 "$WORK_DIR/devices.txt" | paste -sd, -))")
check "DB telemetry 6대 측정값 ${TOTAL}건" bash -c "[[ ${TOTAL:-0} -ge 60 ]]"
echo "  1분 집계를 기다립니다(분이 끝나고 grace 30초 뒤 계산, 최대 150초)"
AGG=0
for _ in $(seq 1 30); do
  api admin GET "/core/telemetry/series?deviceId=$EM300&metrics=temperature&from=$FROM&to=$TO&resolution=1m" "$T"
  AGG=$(jq_ "sum(len(s.get('points') or []) for s in r.get('series') or [])" 2>/dev/null || echo 0)
  [[ "${AGG:-0}" -ge 1 ]] && break; sleep 5
done
check "1분 집계 조회(resolution=1m) 버킷 ${AGG}개 (resolutionUsed=$(jq_ "r.get('resolutionUsed')" 2>/dev/null))" bash -c "[[ ${AGG:-0} -ge 1 ]]"
AGG_ROWS=$(sql "SELECT count(*) FROM data2flow_pipeline.telemetry_1m WHERE device_id IN ($(cut -d' ' -f1 "$WORK_DIR/devices.txt" | paste -sd, -))")
check "DB telemetry_1m 행 ${AGG_ROWS}개" bash -c "[[ ${AGG_ROWS:-0} -ge 1 ]]"

# ---------------------------------------------------------------- 7. 플랫폼 브로커 직결 기기(격리·서명)
log "7. 플랫폼 브로커 기기: 승인 전 quality 2 격리 → 승인(서명 키 1회) → 서명 맞으면 quality 0, 서명 없음·틀림은 거부"
api admin POST /core/sources "$T" '{"code":"platform","name":"플랫폼 브로커","type":"PLATFORM_BROKER","connection":{"deviceKeyPattern":"{externalId}"},"decoderKey":"generic-json","decoderConfig":{"deviceIdFrom":"topic[1]","timePath":"$.ts","timeFormat":"EPOCH_MS","metrics":[{"path":"$.co2","key":"co2"},{"path":"$.temperature","key":"temperature"}]},"unknownDevicePolicy":"AUTO_REGISTER","activate":true}'
PB_SOURCE=$(jq_ "r['id']")
check "플랫폼 브로커 소스 생성 201 (id=$PB_SOURCE)" bash -c "[[ '$(status)' == 201 ]]"
for _ in $(seq 1 30); do api admin GET "/core/sources/$PB_SOURCE" "$T"; [[ "$(jq_ "r.get('state')")" == CONNECTED ]] && break; sleep 1; done
check "플랫폼 브로커 소스 CONNECTED (got $(jq_ "r.get('state')"))" bash -c "[[ '$(jq_ "r.get('state')")' == CONNECTED ]]"
PB_TOPIC="devices/esp32-co2-02/telemetry"
body() { python3 -c "import json,time; print(json.dumps({'co2':$1,'temperature':$2,'ts':int(time.time()*1000)},separators=(',',':')),end='')" > "$WORK_DIR/pb-body.json"; }
body 812 23.4; publish_raw "$PB_TOPIC" "$WORK_DIR/pb-body.json"; sleep 1
body 806 23.5; publish_raw "$PB_TOPIC" "$WORK_DIR/pb-body.json"
PB_DEV=""
for _ in $(seq 1 30); do
  PB_DEV=$(sql "SELECT id FROM data2flow_core.devices WHERE source_id=$PB_SOURCE AND external_id='esp32-co2-02'")
  [[ -n "$PB_DEV" ]] && [[ $(sql "SELECT count(*) FROM data2flow_pipeline.telemetry WHERE device_id=$PB_DEV") -ge 4 ]] && break; sleep 1
done
check "서명 없는 첫 메시지 → 기기 PENDING 등록(id=$PB_DEV, status=$(sql "SELECT status FROM data2flow_core.devices WHERE id=${PB_DEV:-0}"))" \
  bash -c "[[ -n '$PB_DEV' && \$(docker exec $P-pg psql -U data2flow -d data2flow -tAc \"SELECT status FROM data2flow_core.devices WHERE id=$PB_DEV\") == PENDING ]]"
Q_PRE=$(sql "SELECT string_agg(DISTINCT quality::text, ',') || ' / ' || count(*) FROM data2flow_pipeline.telemetry WHERE device_id=${PB_DEV:-0}")
check "승인 전 값은 저장하되 quality 2만(격리) — quality/건수 = $Q_PRE" bash -c "[[ '$Q_PRE' == '2 / 4' ]]"
api admin GET "/core/telemetry/series?deviceId=$PB_DEV&metrics=co2&from=$FROM&to=$TO&resolution=raw" "$T"
check "격리 값은 기본 시계열 조회(정상 품질)에서 빠짐 (점 $(jq_ "sum(len(s.get('points') or []) for s in r.get('series') or [])")개)" \
  bash -c "[[ '$(jq_ "sum(len(s.get('points') or []) for s in r.get('series') or [])")' == 0 ]]"

PB_VER=$(sql "SELECT version FROM data2flow_core.devices WHERE id=${PB_DEV:-0}")
api admin POST /core/devices/approve "$T" "{\"items\":[{\"deviceId\":\"$PB_DEV\",\"baseVersion\":${PB_VER:-0}}],\"modelId\":\"$(model_id AM103)\",\"spaceId\":\"$ROOM\"}"
SIGNING_KEY=$(jq_ "r['results'][0].get('signingKey') or ''")
check "승인 응답에 서명 키 1회(길이 ${#SIGNING_KEY})" bash -c "[[ ${#SIGNING_KEY} -ge 20 ]]"
printf '%s' "$SIGNING_KEY" > "$WORK_DIR/signing.key"
api admin GET "/core/devices/$PB_DEV/credentials" "$T"
check "자격 다시 조회해도 서명 키 원문 없음" bash -c "! grep -qF -- '$SIGNING_KEY' '$LAST.body'"
check "DB에 평문 없음, 암호문만(signing_key_enc)" bash -c "[[ \$(docker exec $P-pg psql -U data2flow -d data2flow -tAc \"SELECT count(*) FROM data2flow_core.device_credentials WHERE device_id=$PB_DEV AND signing_key_enc IS NOT NULL AND position(convert_to('$SIGNING_KEY','UTF8') in signing_key_enc)=0\") == 1 ]]"
sign_body() { python3 - "$WORK_DIR/signing.key" "$WORK_DIR/pb-body.json" "$1" <<'PY'
import hmac, hashlib, sys
key = open(sys.argv[1]).read().encode(); body = open(sys.argv[2], "rb").read()
sig = hmac.new(key if sys.argv[3] != "wrong" else b"not-the-key", body, hashlib.sha256).hexdigest()
open(sys.argv[2] + ".signed", "wb").write(b"v1." + sig.encode() + b"." + body)
PY
}
# ingress 키 캐시: 자격 설정 변경(CREDENTIAL)으로 바로, 늦어도 30초마다 갱신. 서명 메시지가 quality 0이 될 때까지 다시 보낸다
Q0=0
for i in $(seq 1 12); do
  body $((820 + i)) 23.6; sign_body ok; publish_raw "$PB_TOPIC" "$WORK_DIR/pb-body.json.signed"; sleep 3
  Q0=$(sql "SELECT count(*) FROM data2flow_pipeline.telemetry WHERE device_id=$PB_DEV AND quality=0")
  [[ "$Q0" -ge 2 ]] && break
done
check "승인 후 서명 맞는 메시지 → quality 0 저장(${Q0}건, ${i}회 발행)" bash -c "[[ $Q0 -ge 2 ]]"
# 승인 직후 pipeline 기기 캐시가 바뀌기 전 몇 초 동안 온 값은 안전하게 quality 2로 격리된다(정상으로 들어가지는 않는다)
PRE_Q2=$(sql "SELECT count(*) FROM data2flow_pipeline.telemetry WHERE device_id=$PB_DEV AND quality=2 AND ((metric_key='co2' AND value IN (812,806)) OR (metric_key='temperature' AND value IN (23.4,23.5)))")
check "격리된 승인 전 값 4건은 기기에 남고 quality 2 유지(${PRE_Q2}건)" bash -c "[[ $PRE_Q2 -eq 4 ]]"
BEFORE=$(sql "SELECT count(*) FROM data2flow_pipeline.telemetry WHERE device_id=$PB_DEV")
body 999 30.0; publish_raw "$PB_TOPIC" "$WORK_DIR/pb-body.json"                          # 서명 없음
body 998 30.1; sign_body wrong; publish_raw "$PB_TOPIC" "$WORK_DIR/pb-body.json.signed"  # 다른 키
REJ=0
for _ in $(seq 1 30); do
  REJ=$(sql "SELECT count(*) FROM data2flow_pipeline.raw_messages WHERE source_id=$PB_SOURCE AND status='INVALID' AND error_code='DEVICE_SIGNATURE_INVALID'")
  [[ "$REJ" -ge 2 ]] && break; sleep 1
done
AFTER=$(sql "SELECT count(*) FROM data2flow_pipeline.telemetry WHERE device_id=$PB_DEV")
check "서명 없음·틀린 서명 → DEVICE_SIGNATURE_INVALID 거부 원본 ${REJ}건, 측정값 추가 $((AFTER - BEFORE))건(기대 0)" bash -c "[[ $REJ -ge 2 && $AFTER -eq $BEFORE ]]"
SIGREJ=$(curl -s http://127.0.0.1:$((INGRESS_PORT + 10))/actuator/prometheus | awk '/^data2flow_ingest_signature_rejected_total/ {s+=$2} END {print s+0}')
check "ingress 지표 data2flow_ingest_signature_rejected_total = ${SIGREJ}" bash -c "[[ ${SIGREJ%.*} -ge 1 ]]"

# ---------------------------------------------------------------- 8. 로그 점검
log "8. 로그 점검"
check "서명 키 원문이 어떤 로그에도 없음" bash -c "! grep -rqF -- '$SIGNING_KEY' '$WORK_DIR/logs'"
check "공용 브로커(iot-data.java21.net)에 접속하지 않음" bash -c "! grep -q 'iot-data.java21.net' '$WORK_DIR/logs/ingress.log'"

echo
echo "결과: PASS $PASS / FAIL $FAIL   (자세히: $RESULTS, 로그: $WORK_DIR/logs)"
[[ $FAIL -eq 0 ]]
