#!/usr/bin/env bash
# M4 시연(plan/milestones.md §M4 "자동화 완성") 전 구간 로컬 검증:
#   시나리오 2 전체: 템플릿 플로우 → 저장된 "폭염 오후" 데이터로 과거 재생(백테스트) → 적용(운영) → 27℃ 5분 지속 → 에어컨 냉방 명령
#                   → 15분 안에 온도가 내려가지 않음(센서 고착) → EVT-ACT-04 command.no-effect → 알람 → 가짜 텔레그램으로 알림 → 라이브 뷰 노드 지표
#   시나리오 7의 2~3단계: 지속 타이머가 걸린 운영 플로우에 변환 노드를 끼워 넣어 적용 → 타이머 유지 → 롤백 → 타이머 유지
#   시나리오 6: 가상 게이트웨이 다운 → 게이트웨이 알람 1건(하위 기기 무수신 알람은 하위로 묶임) → 알림 1건 → 메신저 [확인] 버튼(BFF /hooks/messenger/telegram,
#              비밀 헤더) → 알람 ACKNOWLEDGED → 복구 → 게이트웨이·하위 알람 함께 해제
#
# 공용 인프라(s3·s4·iot-data.java21.net·api.telegram.org)는 쓰지 않는다(CLAUDE.md §5). PostgreSQL 18·Valkey 8·RabbitMQ 4(stream)·Mailpit·Mosquitto를
# 임시 Docker 컨테이너로 띄우고, 텔레그램 Bot API는 이 스크립트가 띄우는 가짜 HTTP 서버(127.0.0.1)로 대신한다. 끝나면(성공·실패 모두) 컨테이너와
# 프로세스를 지운다. simulator는 data2flow.raw에 직접 넣고(SIM-02.07), action은 virtual 드라이버로 제어하며 MQTT 드라이버는 임시 Mosquitto만 본다.
# LoRaWAN·벤더 드라이버는 꺼져 있다(ADR-049).
#
# 필요: docker, java 21, node 22 + pnpm, curl, python3, openssl, lsof.
#       형제 디렉터리에 data2flow-auth·api-gateway·core-api·pipeline·flow-engine·action·simulator가 있어야 하고,
#       data2flow-contracts가 로컬 저장소에 설치돼 있어야 한다(./mvnw install).
# 사용:
#   e2e/m4-demo.sh                    # 빌드 + 시연(빌드 뒤 약 25분: 효과 확인 15분은 실제 시간이라 그동안 시나리오 7·6을 함께 돈다)
#   SKIP_BUILD=1 e2e/m4-demo.sh       # 이미 만든 jar·build 재사용
#   JARS_DIR=/path e2e/m4-demo.sh     # 다른 곳에서 만든 jar(data2flow-<svc>-*.jar)를 먼저 찾는다
#   WORK_DIR=/tmp/m4 e2e/m4-demo.sh   # 생성 키·로그·쿠키·SSE·가짜 텔레그램 기록을 둘 곳(기본: mktemp). 키는 실행마다 새로 만든다
#   KEEP=1 e2e/m4-demo.sh             # 끝나도 컨테이너·프로세스를 남긴다(디버깅용)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WEB_DIR="$ROOT/data2flow-web"
WORK_DIR="${WORK_DIR:-$(mktemp -d -t d2f-m4)}"
mkdir -p "$WORK_DIR/logs"
chmod 700 "$WORK_DIR"
P="d2f-m4e2e"                  # 컨테이너 이름 접두사
SEED="${SEED:-20260810}"

PG_PORT=46432; REDIS_PORT=47379; AMQP_PORT=46672; STREAM_PORT=46552; SMTP_PORT=42025; MAILPIT_HTTP=49025; MQTT_PORT=41883
GW_PORT=49780; AUTH_PORT=49781; CORE_PORT=49782; PIPELINE_PORT=49784; FLOW_PORT=49785; ACTION_PORT=49786; SIM_PORT=49787; WEB_PORT=49788
TG_PORT=49799                  # 가짜 텔레그램 Bot API
SVC_PORTS=($GW_PORT $AUTH_PORT $CORE_PORT $PIPELINE_PORT $FLOW_PORT $ACTION_PORT $SIM_PORT $WEB_PORT)
WEB="http://localhost:$WEB_PORT"
ORIGIN="$WEB"
MAILPIT="http://127.0.0.1:$MAILPIT_HTTP"
CONTAINERS=("$P-pg" "$P-valkey" "$P-rabbit" "$P-mail" "$P-mqtt")
TG_LOG="$WORK_DIR/telegram.jsonl"; : > "$TG_LOG"
TG_CHAT=777001                 # 데모 사용자의 텔레그램 user id(= 개인 chat id)

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
  for port in "${SVC_PORTS[@]}" $TG_PORT; do
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
TG_BOT_TOKEN=$((RANDOM + 100000)):e2e$(openssl rand -hex 12)
TG_SECRET=e2e$(openssl rand -hex 16)
EOF
# shellcheck disable=SC1091
source "$WORK_DIR/keys.env"

# ---------------------------------------------------------------- 가짜 텔레그램 Bot API(127.0.0.1 전용)
# POST /bot{token}/{method} 요청을 telegram.jsonl에 한 줄씩 남기고 Bot API 모양으로 답한다(sendMessage → message_id).
cat > "$WORK_DIR/fake_telegram.py" <<'PY'
import json, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
port, logfile = int(sys.argv[1]), sys.argv[2]
lock = threading.Lock(); seq = [1000]
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b""
        try: body = json.loads(raw or b"{}")
        except ValueError: body = {"raw": raw.decode("utf-8", "replace")}
        parts = self.path.strip("/").split("/")
        token = parts[0][3:] if parts and parts[0].startswith("bot") else ""
        method = parts[1] if len(parts) > 1 else ""
        with lock:
            seq[0] += 1; mid = seq[0]
            with open(logfile, "a", encoding="utf-8") as f:
                f.write(json.dumps({"t": time.time(), "method": method, "token": token, "body": body}, ensure_ascii=False) + "\n")
        if method == "sendMessage":
            result = {"message_id": mid, "date": int(time.time()), "chat": {"id": body.get("chat_id")}, "text": body.get("text")}
        else:
            result = True
        out = json.dumps({"ok": True, "result": result}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(out)))
        self.end_headers(); self.wfile.write(out)
ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
PY

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
docker run -d --name "$P-rabbit" -p 127.0.0.1:$AMQP_PORT:5672 -p 127.0.0.1:$STREAM_PORT:5552 \
  -e RABBITMQ_DEFAULT_VHOST=data2flow-dev -e RABBITMQ_DEFAULT_USER=d2f -e RABBITMQ_DEFAULT_PASS="$RABBIT_PASSWORD" \
  -e RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS="-rabbitmq_stream advertised_host localhost advertised_port $STREAM_PORT" \
  rabbitmq:4-management bash -c "rabbitmq-plugins enable --offline rabbitmq_stream rabbitmq_stream_management >/dev/null && exec docker-entrypoint.sh rabbitmq-server" >/dev/null
docker run -d --name "$P-mail" -p 127.0.0.1:$SMTP_PORT:1025 -p 127.0.0.1:$MAILPIT_HTTP:8025 axllent/mailpit:latest >/dev/null
# 버리는 Mosquitto(익명, 127.0.0.1만): action MQTT 드라이버가 공용 브로커 대신 붙는 곳
printf 'listener 1883\nallow_anonymous true\n' > "$WORK_DIR/mosquitto.conf"
docker run -d --name "$P-mqtt" -p 127.0.0.1:$MQTT_PORT:1883 -v "$WORK_DIR/mosquitto.conf:/mosquitto/config/mosquitto.conf:ro" \
  eclipse-mosquitto:2 >/dev/null
python3 "$WORK_DIR/fake_telegram.py" $TG_PORT "$TG_LOG" > "$WORK_DIR/logs/fake-telegram.log" 2>&1 & PIDS+=($!)

wait_for() { # wait_for 설명 초 명령…
  local name="$1" secs="$2"; shift 2
  for _ in $(seq 1 "$secs"); do if "$@" >/dev/null 2>&1; then echo "  준비됨: $name"; return 0; fi; sleep 1; done
  echo "  시간 초과: $name"; return 1
}
wait_for postgres 60 docker exec "$P-pg" pg_isready -U data2flow -d data2flow
wait_for valkey 30 docker exec "$P-valkey" valkey-cli -a "$REDIS_PASSWORD" ping
wait_for rabbitmq 120 bash -c "docker logs $P-rabbit 2>&1 | grep -q 'Server startup complete'"
wait_for mailpit 30 curl -sf "$MAILPIT/api/v1/info"
wait_for mosquitto 30 bash -c "docker logs $P-mqtt 2>&1 | grep -q 'running'"
wait_for "가짜 텔레그램" 15 curl -sf -X POST "http://127.0.0.1:$TG_PORT/botping/getMe"
: > "$TG_LOG"

# ---------------------------------------------------------------- 빌드
SERVICES=(auth api-gateway core-api pipeline flow-engine action simulator)
if [[ "${SKIP_BUILD:-}" != "1" ]]; then
  log "빌드(테스트 생략)"
  for svc in "${SERVICES[@]}"; do (cd "$ROOT/data2flow-$svc" && ./mvnw -q -B -DskipTests clean package); done
  (cd "$WEB_DIR" && pnpm build >/dev/null)
fi
jar_of() { ls ${JARS_DIR:+"$JARS_DIR"/data2flow-"$1"-*.jar} "$ROOT/data2flow-$1"/target/data2flow-"$1"-*.jar 2>/dev/null | grep -v plain | head -1; }

# ---------------------------------------------------------------- 서비스 환경
# 프로필 e2e(설정 파일 없음 = 기본 설정만). 기본 프로필 local은 루트 .env(공용 인프라 접속값)를 읽으므로 쓰지 않는다.
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
ADMIN_ID=$(sql "SELECT min(id) FROM data2flow_core.app_users WHERE organization_id = $ORG")
info "조직 ID $ORG, 관리자 ID $ADMIN_ID"

log "서비스 시작(pipeline·flow-engine·action·simulator는 자기 스키마를 migrate, action 텔레그램 채널은 가짜 Bot API로)"
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
  --data2flow.action.flyway-mode=migrate \
  --data2flow.action.mqtt.enabled=true --data2flow.action.mqtt.host=127.0.0.1 --data2flow.action.mqtt.port=$MQTT_PORT \
  --data2flow.action.notification.telegram.enabled=true \
  --data2flow.action.notification.telegram.api-base-url=http://127.0.0.1:$TG_PORT \
  --data2flow.action.notification.telegram.webhook-url="$WEB/hooks/messenger/telegram" \
  --data2flow.action.notification.web-base-url="$WEB" \
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
# 운영 서버(server.mjs): SSR + BFF + 라이브 뷰 WebSocket 중계. 메신저 콜백 비밀값과 action 내부 주소를 준다
(cd "$WEB_DIR" && NODE_ENV=production PORT=$WEB_PORT DATA2FLOW_GATEWAY_URL=http://127.0.0.1:$GW_PORT \
  DATA2FLOW_PUBLIC_ORIGIN="$ORIGIN" DATA2FLOW_COOKIE_SECURE=false DATA2FLOW_SESSION_KEYS="$SESSION_KEY" \
  DATA2FLOW_TRUSTED_PROXY_HOPS=0 DATA2FLOW_GATEWAY_TIMEOUT_MS=40000 \
  DATA2FLOW_MESSENGER_TELEGRAM_SECRET="$TG_SECRET" DATA2FLOW_ACTION_URL=http://127.0.0.1:$ACTION_PORT \
  exec node server.mjs ./build/server/index.js) > "$WORK_DIR/logs/web.log" 2>&1 & PIDS+=($!)

wait_for core-api 300 curl -sf http://127.0.0.1:$((CORE_PORT + 10))/actuator/health/readiness
wait_for pipeline 300 curl -sf http://127.0.0.1:$((PIPELINE_PORT + 10))/actuator/health/readiness
wait_for flow-engine 300 curl -sf http://127.0.0.1:$((FLOW_PORT + 10))/actuator/health/readiness
wait_for action 300 curl -sf http://127.0.0.1:$((ACTION_PORT + 10))/actuator/health/readiness
wait_for simulator 300 curl -sf http://127.0.0.1:$((SIM_PORT + 10))/actuator/health/readiness
wait_for auth 300 curl -sf http://127.0.0.1:$((AUTH_PORT + 10))/actuator/health/readiness
wait_for api-gateway 300 curl -sf http://127.0.0.1:$((GW_PORT + 10))/actuator/health/readiness
wait_for web 60 curl -sf "$WEB/healthz"
check "공용 주소 호출 없음(로그에 iot-data.java21.net·s3.java21.net·api.telegram.org 접속 흔적 없음)" \
  bash -c "! grep -hE 'Connect(ing|ed) to .*(iot-data|s3)\\.java21\\.net|api\\.telegram\\.org/bot' '$WORK_DIR'/logs/*.log"

# ---------------------------------------------------------------- 도우미
LAST="$WORK_DIR/last"
req() { # 이름 메서드 경로 [curl 인자…] → $LAST.{status,headers,body}
  local jar="$WORK_DIR/$1.jar" method="$2" path="$3"; shift 3
  curl -s -o "$LAST.body" -D "$LAST.headers" -w '%{http_code}' -b "$jar" -c "$jar" -X "$method" "$WEB$path" "$@" > "$LAST.status"
}
status() { cat "$LAST.status"; }
location() { grep -i '^location:' "$LAST.headers" | tail -1 | tr -d '\r' | cut -d' ' -f2-; }
jq_() { # 마지막 응답 본문에 python 식(d 전체, r = response, rs = responses). 실패하면 빈 문자열
  python3 - "$LAST.body" "$1" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1])); r = d.get("response") if isinstance(d, dict) else None; rs = d.get("responses") if isinstance(d, dict) else None
    print(eval(sys.argv[2]))
except Exception:
    print("")
PY
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
hook() { # 메신저 콜백(텔레그램 update JSON, 비밀 헤더 값)
  curl -s -o "$LAST.body" -w '%{http_code}' -X POST "$WEB/hooks/messenger/telegram" -H "Content-Type: application/json" \
    -H "X-Telegram-Bot-Api-Secret-Token: $2" --data "$1" > "$LAST.status"
}
tg() { # 가짜 텔레그램 기록 질의: python 식(rows = [{method, token, body}])
  python3 - "$TG_LOG" "$1" <<'PY'
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1], encoding="utf-8") if l.strip()]
print(eval(sys.argv[2]))
PY
}
alarm_of() { # 알람 키 → "id status parent"
  sql "SELECT id || ' ' || status || ' ' || coalesce(parent_alarm_id::text, '-') FROM data2flow_core.alarms WHERE organization_id = $ORG AND alarm_key = '$1' ORDER BY id DESC LIMIT 1"
}
poll() { # poll 초 명령… (참이 될 때까지 1초마다)
  local secs="$1"; shift
  for _ in $(seq 1 "$secs"); do if "$@" >/dev/null 2>&1; then return 0; fi; sleep 1; done
  return 1
}
iso() { python3 -c "import datetime as d; print((d.datetime.now(d.timezone.utc)+d.timedelta(seconds=${1:-0})).strftime('%Y-%m-%dT%H:%M:%SZ'))"; }

# ---------------------------------------------------------------- 0. 로그인
log "0. 관리자 로그인(BFF) → 초기 비밀번호 변경"
T=$(csrf_page admin /login)
form admin /login "$T" intent=credentials loginId=admin01 "password=$ADMIN_PASSWORD" next=/
check "관리자 로그인 302 (got $(status) $(location))" bash -c "[[ '$(status)' == 302 ]]"
T=$(csrf_page admin "/me/security?required=password")
form admin "/me/security" "$T" intent=password "currentPassword=$ADMIN_PASSWORD" "newPassword=$ADMIN_NEW_PASSWORD" "confirmPassword=$ADMIN_NEW_PASSWORD"
check "비밀번호 변경 → 302 / (got $(status) $(location))" bash -c "[[ '$(status)' == 302 && '$(location)' == / ]]"
T=$(csrf_page admin /alarms)
check "알람 화면(/alarms) 200 (got $(status))" bash -c "[[ '$(status)' == 200 ]]"

# ---------------------------------------------------------------- 1. 알림 준비: 텔레그램 채널·계정 연결·정책
log "1. 텔레그램 채널(가짜 Bot API) → 계정 연결(/start 코드, BFF 메신저 콜백) → 알림 정책(WARNING 이상 → 관리자 텔레그램)"
api admin POST /core/notification-channels "$T" "{\"type\":\"TELEGRAM\",\"name\":\"운영 텔레그램\",\"config\":{\"chatIds\":[\"-100200300\"],\"botUsername\":\"d2f_e2e_bot\",\"parseMode\":\"PLAIN\"},\"secret\":{\"botToken\":\"$TG_BOT_TOKEN\",\"webhookSecret\":\"$TG_SECRET\"}}"
CHANNEL=$(jq_ "r.get('id') or r.get('channelId')" 2>/dev/null || echo "")
check "텔레그램 채널 생성 201 (id=$CHANNEL)" bash -c "[[ '$(status)' == 201 ]]"
poll 20 bash -c "[[ \$(python3 -c \"import json; print(sum(1 for l in open('$TG_LOG') if json.loads(l)['method']=='setWebhook'))\") -ge 1 ]]" || true
WH=$(tg "[(r['body'].get('url'), r['body'].get('secret_token') == '$TG_SECRET', r['token'] == '$TG_BOT_TOKEN') for r in rows if r['method']=='setWebhook'][-1:]")
info "setWebhook 호출(주소, 비밀 일치, 토큰 일치): $WH"
check "채널 저장 → action이 setWebhook(웹훅 주소 = BFF /hooks/messenger/telegram, 비밀 헤더 값 전달)" \
  bash -c "[[ '$WH' == *'/hooks/messenger/telegram'*'True, True'* ]]"

api admin POST /core/accounts/me/messenger-links/start "$T" '{"channel":"TELEGRAM"}'
LINK_CODE=$(jq_ "r['code']"); DEEPLINK=$(jq_ "r.get('deepLink')")
check "메신저 연결 시작 200 (딥링크 $DEEPLINK)" bash -c "[[ '$(status)' == 200 && '$DEEPLINK' == *start=* ]]"
hook "{\"update_id\":5001,\"message\":{\"message_id\":1,\"from\":{\"id\":$TG_CHAT},\"chat\":{\"id\":$TG_CHAT,\"type\":\"private\"},\"text\":\"/start $LINK_CODE\"}}" "wrong-$TG_SECRET"
check "틀린 비밀 헤더의 메신저 콜백 → 401 (got $(status))" bash -c "[[ '$(status)' == 401 ]]"
hook "{\"update_id\":5002,\"message\":{\"message_id\":1,\"from\":{\"id\":$TG_CHAT},\"chat\":{\"id\":$TG_CHAT,\"type\":\"private\"},\"text\":\"/start $LINK_CODE\"}}" "$TG_SECRET"
check "/start {코드} 메신저 콜백 → 200 (got $(status))" bash -c "[[ '$(status)' == 200 ]]"
LINKED=""
for _ in $(seq 1 20); do
  api admin GET /core/accounts/me/notify-preferences "$T"
  LINKED=$(jq_ "[l['channel'] for l in (r.get('messengerLinks') or r.get('links') or [])]" 2>/dev/null || echo "")
  [[ "$LINKED" == *TELEGRAM* ]] && break; sleep 1
done
check "관리자 계정에 텔레그램 연결됨 ($LINKED)" bash -c "[[ '$LINKED' == *TELEGRAM* ]]"
api admin POST /core/notification-policies "$T" "{\"name\":\"운영 알람 → 텔레그램\",\"minSeverity\":\"WARNING\",\"includeChildren\":true,\"recipients\":[{\"type\":\"USER\",\"id\":\"$ADMIN_ID\"}],\"channels\":[\"TELEGRAM\"],\"renotifyMinutes\":60,\"aggregateWindowSec\":0,\"notifyOnClear\":true}"
check "알림 정책 생성 201 (id=$(jq_ "r.get('id') or r.get('policyId')" 2>/dev/null))" bash -c "[[ '$(status)' == 201 ]]"

# ---------------------------------------------------------------- 2. 시나리오 2 — 1·2단계: 키트, 템플릿 플로우, 백테스트(과거 재생)
log "2-1. 가상 강의실 키트(10kW 에어컨 프로필) → \"고온이면 냉방\" 템플릿 플로우(27℃ 5분)"
api admin GET /core/sim/catalog "$T"
AC_TYPE=$(jq_ "[t['id'] for t in r['types'] if t['key']=='aircon'][0]")
api admin POST /core/sim/profiles "$T" "{\"name\":\"강의실 천장형 에어컨 10kW\",\"typeId\":\"$AC_TYPE\",\"overrides\":{\"coolingCapacityKw\":10}}"
AC_PROFILE=$(jq_ "r.get('id')")
api admin POST /core/sim/kits/classroom-standard/place "$T" "{\"newSpace\":{\"name\":\"가상 강의실 301\",\"preset\":\"CLASSROOM\"},\"profileOverrides\":{\"aircon\":\"$AC_PROFILE\"}}"
cp "$LAST.body" "$WORK_DIR/kit.json"
SPACE=$(jq_ "r['spaceId']")
AIRCON=$(jq_ "[d['deviceId'] for d in r['devices'] if d['typeKey']=='aircon'][0]")
TH_IDS=$(jq_ "','.join(d['deviceId'] for d in r['devices'] if d['typeKey']=='th-sensor' or 'temp' in d['typeKey'])")
CO2_ID=$(jq_ "[d['deviceId'] for d in r['devices'] if 'co2' in d['typeKey']][0]")
SENSOR_IDS=$(jq_ "','.join(d['deviceId'] for d in r['devices'] if d['typeKey'] not in ('aircon','air-purifier','ventilator'))")
check "키트 배치 201 (공간 $SPACE, 에어컨 $AIRCON, 온습도 $TH_IDS, CO2 $CO2_ID, 센서 $SENSOR_IDS)" \
  bash -c "[[ '$(status)' == 201 && -n '$AIRCON' && -n '$TH_IDS' && -n '$CO2_ID' ]]"
BINDINGS=$(jq_ "__import__('json').dumps([f['bindings'] for f in r['suggestedFlows'] if f['templateKey']=='hot-then-cool'][0])")
api admin POST /core/flow-templates/hot-then-cool/instantiate "$T" "{\"name\":\"301호 고온이면 냉방\",\"params\":$BINDINGS}"
FLOW=$(jq_ "r['flowId']"); DRAFT=$(jq_ "r['draftVersion']")
check "템플릿 플로우 생성 201 (flow=$FLOW, 초안 v$DRAFT, 적용 전)" bash -c "[[ '$(status)' == 201 && -n '$FLOW' ]]"

log "2-2. 백테스트: \"폭염 오후\"(3시간)를 x60으로 흘려 데이터를 쌓고(플로우 미적용) → 그 구간으로 과거 재생(API-FLW-13)"
scenario_body() { # 이름 길이(초) 시드 [시작 시각]
  python3 - "$1" "$2" "$3" "$SPACE" "${4:-2026-08-10T03:00:00Z}" <<'PY'
import json, sys, datetime as d
name, dur, seed, space, start = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4], sys.argv[5]
t0 = d.datetime.fromisoformat(start.replace("Z", "+00:00"))
iso = lambda x: x.strftime("%Y-%m-%dT%H:%M:%SZ")
print(json.dumps({
  "name": name, "spaceIds": [space], "simStartAt": start, "durationSec": dur, "seed": seed, "useCalendar": False,
  "outdoor": {"mode": "DIURNAL", "diurnal": {"max": 35, "min": 27, "peakHour": 15, "humidity": 55}},
  "events": [{"id": "class", "track": "OCCUPANCY", "at": iso(t0 + d.timedelta(minutes=20)), "until": iso(t0 + d.timedelta(hours=6)),
              "target": {"spaceId": space}, "params": {"count": 15, "activity": 2.0}}],
  "expectations": []}, ensure_ascii=False))
PY
}
api admin POST /core/sim/scenarios "$T" "$(scenario_body "폭염 오후" 10800 "$SEED")"
SCN=$(jq_ "r.get('scenarioId') or r.get('id')")
api admin POST /core/sim/runs "$T" "{\"scenarioId\":\"$SCN\",\"acceleration\":60,\"timestampPolicy\":\"SIMULATED\",\"seed\":$SEED}"
RUN=$(jq_ "r['runId']")
check "\"폭염 오후\" x60 실행 시작 201 (run=$RUN)" bash -c "[[ '$(status)' == 201 ]]"
RSTATUS=""
for _ in $(seq 1 260); do
  api admin GET "/core/sim/runs/$RUN" "$T"; RSTATUS=$(jq_ "r.get('status')"); [[ "$RSTATUS" == COMPLETED ]] && break; sleep 1
done
check "\"폭염 오후\" 3시간 완료 (status=$RSTATUS)" bash -c "[[ '$RSTATUS' == COMPLETED ]]"
STORED=0
for _ in $(seq 1 30); do
  STORED=$(sql "SELECT count(*) FROM data2flow_pipeline.telemetry WHERE organization_id = $ORG AND metric_key = 'temperature' AND time >= '2026-08-10T03:00:00Z' AND time < '2026-08-10T06:00:00Z'")
  [[ "$STORED" -ge 400 ]] && break; sleep 2
done
info "저장된 온도 측정값(8/10 12:00~15:00 KST) ${STORED}건"
api admin GET "/core/devices/$AIRCON/commands?page=1&size=20" "$T"
check "백테스트용 실행 중에는 명령 없음(플로우 미적용, $(jq_ "len(rs or [])")건)" bash -c "[[ '$(jq_ "len(rs or [])")' == 0 ]]"

api admin POST "/core/flows/$FLOW/replay" "$T" '{"from":"2026-08-10T03:00:00Z","to":"2026-08-10T06:00:00Z"}'
JOB=$(jq_ "r.get('jobId')")
check "과거 재생 요청 202 (job=$JOB)" bash -c "[[ '$(status)' == 202 && -n '$JOB' ]]"
JSTATUS=""
for _ in $(seq 1 180); do
  api admin GET "/core/flow-replays/$JOB" "$T"; JSTATUS=$(jq_ "r.get('status')")
  [[ "$JSTATUS" == SUCCEEDED || "$JSTATUS" == FAILED || "$JSTATUS" == CANCELLED ]] && break; sleep 1
done
cp "$LAST.body" "$WORK_DIR/replay.json"
REPLAY=$(jq_ "'%s %s %s %s' % (r['progress']['processed'], r['result']['executions'], r['result']['actions'].get('command'), __import__('json').dumps(r['result'].get('branchCounts'), separators=(',',':')))" 2>/dev/null || echo "")
info "재생 결과(처리 건수 실행 수 명령 수 분기): $REPLAY"
read -r R_PROCESSED R_EXEC R_CMD R_BRANCH <<< "$REPLAY" || true
check "과거 재생 SUCCEEDED, 저장 데이터로 실행 ${R_EXEC:-?}회·냉방 명령 ${R_CMD:-?}건(드라이런, 실제 명령 없음)" \
  bash -c "[[ '$JSTATUS' == SUCCEEDED && ${R_EXEC:-0} -gt 0 && ${R_CMD:-0} -ge 1 ]]"
api admin GET "/core/devices/$AIRCON/commands?page=1&size=20" "$T"
check "재생은 드라이런: 에어컨 명령 이력 0건 (got $(jq_ "len(rs or [])"))" bash -c "[[ '$(jq_ "len(rs or [])")' == 0 ]]"

# ---------------------------------------------------------------- 3. 시나리오 2 — 3단계: 운영(적용) → 고온 5분 → 냉방 명령
log "3. 운영: 플로우 적용 → 실시간 실행(측정 시각 = 실제 시각, x10) → 온도 센서 고착(29℃) → 27℃ 5분 지속 → 냉방 명령"
api admin POST "/core/flows/$FLOW/validate" "$T" '{}'
api admin POST "/core/flows/$FLOW/apply" "$T" "{\"version\":$DRAFT,\"baseVersion\":0,\"acknowledgedRisks\":true,\"memo\":\"M4 시연 운영 적용\"}"
check "플로우 적용 200 (appliedVersion=$(jq_ "r.get('appliedVersion')" 2>/dev/null))" bash -c "[[ '$(status)' == 200 ]]"
APPLY=""
for _ in $(seq 1 60); do
  api admin GET "/core/flows/$FLOW" "$T"; APPLY=$(jq_ "(r.get('applyStatus') or {}).get('converged')" 2>/dev/null || echo "")
  [[ "$APPLY" == True ]] && break; sleep 1
done
check "flow-engine 적용 확인(converged=$APPLY)" bash -c "[[ '$APPLY' == True ]]"
FLOW_DEF="$WORK_DIR/flow1-def.json"; python3 -c "import json; d=json.load(open('$LAST.body'))['response']; json.dump(d['version']['definition'], open('$FLOW_DEF','w'))"
CONTROL_NODE=$(python3 -c "import json; print([n['id'] for n in json.load(open('$FLOW_DEF'))['nodes'] if n['type']=='action.control'][0])")
THRESH_NODE=$(python3 -c "import json; print([n['id'] for n in json.load(open('$FLOW_DEF'))['nodes'] if n['type']=='condition.threshold'][0])")

# 라이브 뷰(API-FLW-40): BFF WebSocket /bff/stream/flows/{id}를 세션 쿠키로 열어 node.stats를 기록한다
COOKIE=$(python3 - "$WORK_DIR/admin.jar" <<'PY'
import sys
out = []
for line in open(sys.argv[1]):
    if line.startswith("#HttpOnly_"): line = line[len("#HttpOnly_"):]
    elif line.startswith("#") or not line.strip(): continue
    f = line.rstrip("\n").split("\t")
    if len(f) >= 7: out.append(f"{f[5]}={f[6]}")
print("; ".join(out))
PY
)
cat > "$WORK_DIR/live_view.mjs" <<'JS'
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(process.env.WEB_DIR + "/package.json");
const WebSocket = require("ws");
const [url, cookie, origin, out, seconds] = process.argv.slice(2);
const ws = new WebSocket(url, { headers: { Cookie: cookie, Origin: origin } });
const sink = fs.createWriteStream(out, { flags: "a" });
ws.on("open", () => { sink.write(JSON.stringify({ type: "_open" }) + "\n"); ws.send(JSON.stringify({ type: "subscribe", samples: true })); });
ws.on("message", (m) => sink.write(m.toString() + "\n"));
ws.on("close", (code) => { sink.write(JSON.stringify({ type: "_close", code }) + "\n"); process.exit(0); });
ws.on("error", (e) => { sink.write(JSON.stringify({ type: "_error", message: String(e.message) }) + "\n"); });
setInterval(() => { try { ws.send(JSON.stringify({ type: "ping" })); } catch {} }, 20000);
setTimeout(() => { ws.close(); setTimeout(() => process.exit(0), 500); }, Number(seconds) * 1000);
JS
LIVE="$WORK_DIR/live-view.jsonl"; : > "$LIVE"
WEB_DIR="$WEB_DIR" node "$WORK_DIR/live_view.mjs" "ws://localhost:$WEB_PORT/bff/stream/flows/$FLOW" "$COOKIE" "$ORIGIN" "$LIVE" 900 \
  > "$WORK_DIR/logs/live-view.log" 2>&1 & LIVE_PID=$!; PIDS+=($LIVE_PID)

api admin POST /core/sim/scenarios "$T" "$(scenario_body "운영 실시간" 28800 "$((SEED + 1))" "2026-08-10T05:00:00Z")"
SCN_OP=$(jq_ "r.get('scenarioId') or r.get('id')")
api admin POST /core/sim/runs "$T" "{\"scenarioId\":\"$SCN_OP\",\"acceleration\":10,\"timestampPolicy\":\"WALL_CLOCK\",\"seed\":$((SEED + 1))}"
RUN_OP=$(jq_ "r['runId']")
check "운영 실행 시작 201 (run=$RUN_OP, x10, 측정 시각 WALL_CLOCK)" bash -c "[[ '$(status)' == 201 ]]"
FAULTS=()
for d in ${TH_IDS//,/ } $CO2_ID; do
  api admin POST /core/sim/faults "$T" "{\"runId\":\"$RUN_OP\",\"targetType\":\"DEVICE\",\"targetIds\":[\"$d\"],\"kind\":\"STUCK\",\"params\":{\"metric\":\"temperature\",\"value\":29},\"durationSec\":28800}"
  [[ "$(status)" == 201 ]] && FAULTS+=("$(jq_ "(r.get('faultIds') or [''])[0]")")
done
check "온도 센서 고착 장애 주입(temperature = 29℃, ${#FAULTS[@]}대)" bash -c "[[ ${#FAULTS[@]} -ge 2 ]]"
T_RUN=$(date +%s)
CMD_ID=""; CMD_STATUS=""
for _ in $(seq 1 600); do
  api admin GET "/core/devices/$AIRCON/commands?page=1&size=20" "$T"
  if [[ "$(jq_ "len(rs or [])")" -ge 1 ]]; then
    CMD_ID=$(jq_ "rs[-1].get('commandId') or rs[-1].get('id')"); CMD_STATUS=$(jq_ "rs[-1].get('status')")
    [[ "$CMD_STATUS" == APPLIED ]] && break
  fi
  sleep 1
done
T_CMD=$(date +%s)
cp "$LAST.body" "$WORK_DIR/commands.json"
CMD_DESC=$(jq_ "'%s.%s %s 출처 %s' % (rs[-1]['capability'], rs[-1]['command'], __import__('json').dumps(rs[-1].get('args'), ensure_ascii=False), (rs[-1].get('source') or {}).get('type'))" 2>/dev/null || echo "")
info "냉방 명령 $CMD_ID: $CMD_DESC 상태 $CMD_STATUS (운영 실행 $((T_CMD - T_RUN))초 뒤)"
check "27℃ 이상 5분 지속 뒤 냉방 명령 APPLIED (실제 $((T_CMD - T_RUN))초, 기대 300~420초)" \
  bash -c "[[ '$CMD_STATUS' == APPLIED && '$CMD_DESC' == *cool*FLOW* && $((T_CMD - T_RUN)) -ge 290 && $((T_CMD - T_RUN)) -le 480 ]]"
CMD_ID=${CMD_ID:-00000000-0000-0000-0000-000000000000}
EFFECT_DUE=$(sql "SELECT extract(epoch FROM due_at)::bigint FROM data2flow_action.effect_checks WHERE command_id = '$CMD_ID'" 2>/dev/null || echo "")
info "효과 확인 예약: 기한 $(date -r "${EFFECT_DUE:-0}" '+%H:%M:%S' 2>/dev/null) (APPLIED + 15분, 그동안 시나리오 7·6을 진행)"
check "효과 확인 예약(effect_checks PENDING, 냉방 → temperature 하강 15분)" \
  bash -c "[[ '$(sql "SELECT status || ' ' || metric || ' ' || direction || ' ' || within_minutes FROM data2flow_action.effect_checks WHERE command_id = '$CMD_ID'")' == 'PENDING temperature DOWN 15' ]]"

# ---------------------------------------------------------------- 4. 시나리오 7 — 2·3단계: 타이머가 걸린 운영 플로우에 노드 끼워 넣기 → 롤백
log "4. 시나리오 7: CO2 고착(1,200ppm) → \"CO2 높으면 환기\"(30분 지속) 적용 → 대기 타이머 생김 → 변환 노드 끼워 넣어 적용 → 타이머 유지 → 롤백 → 유지"
api admin POST /core/sim/faults "$T" "{\"runId\":\"$RUN_OP\",\"targetType\":\"DEVICE\",\"targetIds\":[\"$CO2_ID\"],\"kind\":\"STUCK\",\"params\":{\"metric\":\"co2\",\"value\":1200},\"durationSec\":28800}"
check "CO2 센서 고착 1,200ppm 201" bash -c "[[ '$(status)' == 201 ]]"
V_BIND=$(python3 - "$WORK_DIR/kit.json" "$SPACE" <<'PY'
import json, sys
k = json.load(open(sys.argv[1]))["response"]
b = [f["bindings"] for f in k["suggestedFlows"] if f["templateKey"] == "co2-then-ventilate"]
p = dict(b[0]) if b else {"spaceId": sys.argv[2]}
p.update({"threshold": 1000, "duration": "PT30M", "durationMin": 30, "thresholdPpm": 1000})
print(json.dumps(p))
PY
)
api admin POST /core/flow-templates/co2-then-ventilate/instantiate "$T" "{\"name\":\"301호 CO2 높으면 환기(30분)\",\"params\":$V_BIND}"
FLOW2=$(jq_ "r['flowId']"); DRAFT2=$(jq_ "r['draftVersion']")
api admin POST "/core/flows/$FLOW2/apply" "$T" "{\"version\":$DRAFT2,\"baseVersion\":0,\"acknowledgedRisks\":true,\"memo\":\"시나리오 7 v$DRAFT2\"}"
check "\"CO2 높으면 환기(30분)\" 적용 200 (flow=$FLOW2 v$DRAFT2)" bash -c "[[ '$(status)' == 200 ]]"
timer_rows() { sql "SELECT string_agg(id::text || '@' || to_char(due_at AT TIME ZONE 'UTC', 'HH24:MI:SS'), ',' ORDER BY id) FROM data2flow_flow.flow_timers WHERE flow_id = '$FLOW2' AND status IN ('PENDING','SCHEDULED','WAITING')" 2>/dev/null; }
timer_any() { sql "SELECT string_agg(id::text || '@' || to_char(due_at AT TIME ZONE 'UTC', 'HH24:MI:SS') || ':' || coalesce(status::text,''), ',' ORDER BY id) FROM data2flow_flow.flow_timers WHERE flow_id = '$FLOW2'" 2>/dev/null; }
TIMERS0=""
for _ in $(seq 1 90); do TIMERS0=$(timer_any); [[ -n "$TIMERS0" ]] && break; sleep 1; done
info "v$DRAFT2 지속 타이머(id@만기:상태): $TIMERS0"
check "CO2 1,200ppm > 1,000 → 30분 지속 판정 타이머 대기 중" test -n "$TIMERS0"
api admin GET "/core/flows/$FLOW2" "$T"
python3 - "$LAST.body" "$WORK_DIR/flow2-v2.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))["response"]
defn = d["version"]["definition"]
nodes, wires = defn["nodes"], defn["wires"]
agg = [n for n in nodes if n["type"] == "transform.aggregate"][0]
thr = [n for n in nodes if n["type"] == "condition.threshold"][0]
x = dict(agg.get("position") or {"x": 0, "y": 0})
nodes.append({"id": "n-js-scale01", "type": "transform.js", "name": "ppm 보정(×1.0)",
              "config": {"code": "msg.payload = msg.payload; return msg;", "outputs": 1},
              "position": {"x": x.get("x", 0) + 120, "y": x.get("y", 0) + 80}})
key_from = "from" if "from" in wires[0] else "source"
key_to = "to" if "to" in wires[0] else "target"
new = []
for w in wires:
    if w[key_from] == agg["id"] and w[key_to] == thr["id"]:
        a = dict(w); a[key_to] = "n-js-scale01"; new.append(a)
        b = dict(w); b[key_from] = "n-js-scale01"; b["port"] = "out"; new.append(b)
    else:
        new.append(w)
defn["wires"] = new
json.dump({"definition": defn, "baseVersion": d["flow"].get("draftVersion") or d["flow"].get("activeVersion")}, open(sys.argv[2], "w"), ensure_ascii=False)
PY
api admin PUT "/core/flows/$FLOW2/draft" "$T" "$(cat "$WORK_DIR/flow2-v2.json")"
DRAFT3=$(jq_ "r.get('draftVersion')")
check "변환 노드(transform.js)를 평균 → 기준 사이에 끼운 초안 저장 200 (v$DRAFT3, 오류 $(jq_ "len((r.get('validation') or {}).get('errors') or [])"))" \
  bash -c "[[ '$(status)' == 200 && -n '$DRAFT3' ]]"
api admin POST "/core/flows/$FLOW2/apply" "$T" "{\"version\":$DRAFT3,\"baseVersion\":$DRAFT2,\"acknowledgedRisks\":true,\"memo\":\"운영 중 노드 끼워 넣기\"}"
check "운영 중 적용 200 (v$DRAFT2 → v$DRAFT3)" bash -c "[[ '$(status)' == 200 ]]"
converged() { # flow 버전
  for _ in $(seq 1 60); do
    api admin GET "/core/flows/$1" "$T"
    [[ "$(jq_ "(r.get('applyStatus') or {}).get('converged') and r['flow'].get('activeVersion')")" == "$2" ]] && return 0; sleep 1
  done; return 1
}
check "flow-engine이 v${DRAFT3}로 수렴" converged "$FLOW2" "$DRAFT3"
sleep 5
TIMERS1=$(timer_any)
info "v$DRAFT3 적용 뒤 타이머: $TIMERS1"
check "지속 타이머 유지(같은 행·같은 만기, 상태 정책 KEEP)" bash -c "[[ -n '$TIMERS0' && '$TIMERS1' == '$TIMERS0' ]]"
api admin POST "/core/flows/$FLOW2/rollback" "$T" "{\"toVersion\":$DRAFT2,\"memo\":\"시나리오 7 롤백\"}"
check "즉시 롤백 요청 200 (→ v$DRAFT2 내용, got $(status))" bash -c "[[ '$(status)' == 200 ]]"
ROLLED=$(jq_ "r.get('appliedVersion') or r.get('activeVersion')" 2>/dev/null || echo "")
for _ in $(seq 1 60); do
  api admin GET "/core/flows/$FLOW2" "$T"
  [[ "$(jq_ "(r.get('applyStatus') or {}).get('converged')")" == True && "$(jq_ "r['flow'].get('activeVersion')")" != "$DRAFT3" ]] && break; sleep 1
done
ACTIVE_AFTER=$(jq_ "r['flow'].get('activeVersion')")
HAS_JS=$(jq_ "any(n['type']=='transform.js' for n in r['version']['definition']['nodes'])" 2>/dev/null || echo "?")
check "롤백 수렴(활성 v$ACTIVE_AFTER, 변환 노드 없음=$([[ "$HAS_JS" == False ]] && echo 예 || echo 아니오))" \
  bash -c "[[ '$ACTIVE_AFTER' != '$DRAFT3' && '$(jq_ "(r.get('applyStatus') or {}).get('converged')")' == True ]]"
sleep 5
TIMERS2=$(timer_any)
info "롤백 뒤 타이머: $TIMERS2"
check "롤백 뒤에도 지속 타이머 유지" bash -c "[[ '$TIMERS2' == '$TIMERS0' ]]"

# ---------------------------------------------------------------- 5. 시나리오 6: 게이트웨이 다운 → 알람 1건 → 메신저 ACK → 복구
log "5. 시나리오 6: 센서 무수신 규칙(5분) + 게이트웨이 오프라인 기준 120초 → 가상 게이트웨이 다운 → 알람 1건·알림 1건 → [확인] → 복구"
RULE_DEVICES="$TH_IDS,$CO2_ID"   # 주기 보고 센서(재실 센서는 바뀔 때만 보고하므로 무수신 규칙에서 뺀다)
RULE_BODY=$(python3 - "$RULE_DEVICES" <<'PY'
import json, sys
print(json.dumps({"name": "301호 센서 무수신", "scope": {"type": "DEVICE", "ids": sys.argv[1].split(","), "includeChildren": False},
                  "condition": {"kind": "noData", "window": "PT5M"}, "severity": "MINOR", "titleTemplate": "{{device.name}} 무수신",
                  "autoClear": True}, ensure_ascii=False))
PY
)
api admin POST /core/rules "$T" "$RULE_BODY"
RULE=$(jq_ "r.get('ruleId')"); RULE_STATUS=$(jq_ "r.get('status')")
check "무수신 규칙 저장 → 엔진 컴파일·적용 (201, rule=$RULE, $RULE_STATUS)" bash -c "[[ '$(status)' == 201 && '$RULE_STATUS' == ACTIVE ]]"
# 규칙 플로우가 각 센서의 메시지를 받아 무수신 타이머(RECHECK)를 건 뒤에 장애를 낸다(처음 받은 뒤부터 무수신을 잰다)
NSENSORS=$(echo "$RULE_DEVICES" | tr ',' '\n' | grep -c .)
RULE_FLOW=$(sql "SELECT flow_id FROM data2flow_core.rules WHERE id = ${RULE:-0}" 2>/dev/null || echo "")
poll 120 bash -c "[[ \$(docker exec $P-pg psql -U data2flow -d data2flow -tAc \"SELECT count(DISTINCT target_key) FROM data2flow_flow.flow_timers WHERE flow_id::text = '$RULE_FLOW' AND status = 'WAITING'\") -ge $NSENSORS ]]" || true
info "규칙 플로우 $RULE_FLOW 무수신 타이머 $(sql "SELECT count(DISTINCT target_key) FROM data2flow_flow.flow_timers WHERE flow_id::text = '$RULE_FLOW' AND status = 'WAITING'")/${NSENSORS}개"
api admin GET "/core/gateways?page=1&size=20" "$T"
GW=$(jq_ "rs[0].get('gatewayId') or rs[0].get('id')"); GW_EUI=$(jq_ "rs[0].get('gatewayEui')")
api admin PATCH "/core/gateways/$GW" "$T" '{"offlineAfterSec":120}'
check "가상 게이트웨이 $GW_EUI(id $GW) 오프라인 기준 120초 (got $(status))" bash -c "[[ '$(status)' == 200 ]]"
TG_BEFORE=$(tg "len(rows)")
# 실시간 알람(API-DSH-20 topic alarms): 장애 동안 BFF SSE로 알람 발생·확인·해제를 받는다
curl -s -N --max-time 900 -b "$WORK_DIR/admin.jar" -H "Accept: text/event-stream" \
  "$WEB/bff/stream/live?topics=alarms,notifications" > "$WORK_DIR/sse-live.txt" 2>/dev/null & SSE_PID=$!; PIDS+=($SSE_PID)
api admin POST /core/sim/faults "$T" "{\"runId\":\"$RUN_OP\",\"targetType\":\"GATEWAY\",\"targetIds\":[\"$GW_EUI\"],\"kind\":\"GATEWAY_DOWN\",\"params\":{},\"durationSec\":86400}"
GW_FAULT=$(jq_ "(r.get('faultIds') or [''])[0]")
T_DOWN=$(date +%s)
check "게이트웨이 다운 장애 주입 201 (fault=$GW_FAULT)" bash -c "[[ '$(status)' == 201 ]]"
GW_KEY="system:GATEWAY_OFFLINE:$GW"
poll 360 bash -c "[[ -n \"\$(docker exec $P-pg psql -U data2flow -d data2flow -tAc \"SELECT 1 FROM data2flow_core.alarms WHERE alarm_key = '$GW_KEY'\")\" ]]" || true
T_GWALARM=$(date +%s)
read -r GW_ALARM GW_STATUS _ <<< "$(alarm_of "$GW_KEY")"
check "게이트웨이 오프라인 MAJOR 알람 발생(다운 $((T_GWALARM - T_DOWN))초 뒤, id=$GW_ALARM $GW_STATUS)" \
  bash -c "[[ -n '$GW_ALARM' && '$GW_STATUS' == ACTIVE && '$(sql "SELECT severity FROM data2flow_core.alarms WHERE id = ${GW_ALARM:-0}")' == MAJOR ]]"
# 하위 기기 무수신 알람(5분 기준)은 게이트웨이 알람 아래로 묶여 SUPPRESSED(PARENT)
children() { sql "SELECT count(*) FROM data2flow_core.alarms WHERE organization_id = $ORG AND rule_id = ${RULE:-0} AND parent_alarm_id = ${GW_ALARM:-0} AND status = 'SUPPRESSED'"; }
poll 420 bash -c "[[ \$(docker exec $P-pg psql -U data2flow -d data2flow -tAc \"SELECT count(*) FROM data2flow_core.alarms WHERE rule_id = ${RULE:-0} AND parent_alarm_id = ${GW_ALARM:-0}\") -ge $NSENSORS ]]" || true
CH=$(children)
OPEN_TOP=$(sql "SELECT count(*) FROM data2flow_core.alarms WHERE organization_id = $ORG AND status IN ('ACTIVE','ACKNOWLEDGED') AND parent_alarm_id IS NULL AND raised_at >= to_timestamp($T_DOWN) AND alarm_key NOT LIKE 'system:COMMAND_NO_EFFECT:%'")
info "하위 무수신 알람 SUPPRESSED(PARENT) ${CH}/${NSENSORS}건, 장애 뒤 열린 최상위 알람 ${OPEN_TOP}건"
check "게이트웨이 장애 = 최상위 알람 1건(하위 무수신 ${CH}건은 묶임)" bash -c "[[ '$OPEN_TOP' == 1 && $CH -ge 1 ]]"
poll 60 bash -c "[[ \$(python3 -c \"import json; print(sum(1 for l in open('$TG_LOG') if json.loads(l)['method']=='sendMessage' and '|$GW_ALARM|' in json.dumps(json.loads(l)['body'])))\") -ge 1 ]]" || true
sleep 20   # 하위 알람 알림이 (잘못) 나가는지 볼 여유
GW_MSGS=$(tg "len([r for r in rows if r['method']=='sendMessage' and '|$GW_ALARM|' in __import__('json').dumps(r['body'])])")
OUTAGE_MSGS=$(tg "len([r for r in rows[$TG_BEFORE:] if r['method']=='sendMessage' and r['body'].get('chat_id') in ($TG_CHAT, '$TG_CHAT') and '효과 없음' not in r['body'].get('text','')])")
ACK_DATA=$(tg "[b['callback_data'] for r in rows if r['method']=='sendMessage' and '|$GW_ALARM|' in __import__('json').dumps(r['body']) for row in r['body'].get('reply_markup',{}).get('inline_keyboard',[]) for b in row if b['callback_data'].startswith('ACK|')][:1]")
ACK_DATA=$(python3 -c "import ast; v=ast.literal_eval('''$ACK_DATA'''); print(v[0] if v else '')")
MSG_ID=$(tg "[r for r in rows if r['method']=='sendMessage' and '|$GW_ALARM|' in __import__('json').dumps(r['body'])][0]['t']" 2>/dev/null || echo "")
info "게이트웨이 알람 텔레그램 ${GW_MSGS}건, 장애 뒤 관리자 텔레그램 ${OUTAGE_MSGS}건, [확인] 버튼 데이터 $ACK_DATA"
check "알림 1건(게이트웨이 알람만, 하위 알람 알림 없음)" bash -c "[[ '$GW_MSGS' == 1 && '$OUTAGE_MSGS' == 1 && -n '$ACK_DATA' ]]"

hook "{\"update_id\":5101,\"callback_query\":{\"id\":\"cbq-e2e-1\",\"from\":{\"id\":$TG_CHAT},\"message\":{\"message_id\":1001,\"chat\":{\"id\":$TG_CHAT}},\"data\":\"$ACK_DATA\"}}" "$TG_SECRET"
check "메신저 [확인] 콜백(비밀 헤더) → BFF 200 (got $(status))" bash -c "[[ '$(status)' == 200 ]]"
poll 30 bash -c "[[ \"\$(docker exec $P-pg psql -U data2flow -d data2flow -tAc \"SELECT status FROM data2flow_core.alarms WHERE id = ${GW_ALARM:-0}\")\" == ACKNOWLEDGED ]]" || true
ACKED=$(sql "SELECT status || ' ' || coalesce(acked_by::text,'-') FROM data2flow_core.alarms WHERE id = ${GW_ALARM:-0}")
check "게이트웨이 알람 ACKNOWLEDGED(확인자 = 연결된 관리자 $ADMIN_ID, got $ACKED)" bash -c "[[ '$ACKED' == 'ACKNOWLEDGED $ADMIN_ID' ]]"
check "텔레그램 버튼 응답(answerCallbackQuery) 호출" bash -c "[[ $(tg "len([r for r in rows if r['method']=='answerCallbackQuery'])") -ge 1 ]]"
hook "{\"update_id\":5101,\"callback_query\":{\"id\":\"cbq-e2e-1\",\"from\":{\"id\":$TG_CHAT},\"message\":{\"message_id\":1001,\"chat\":{\"id\":$TG_CHAT}},\"data\":\"$ACK_DATA\"}}" "$TG_SECRET"
check "같은 update_id 재전송은 한 번만 처리(BFF 200, 상태 그대로)" bash -c "[[ '$(status)' == 200 ]]"

api admin POST "/core/sim/faults/$GW_FAULT/cancel" "$T" '{}'
T_UP=$(date +%s)
check "게이트웨이 복구(장애 취소) (got $(status))" bash -c "[[ '$(status)' == 200 || '$(status)' == 204 ]]"
poll 300 bash -c "[[ \"\$(docker exec $P-pg psql -U data2flow -d data2flow -tAc \"SELECT status FROM data2flow_core.alarms WHERE id = ${GW_ALARM:-0}\")\" == CLEARED ]]" || true
T_CLEAR=$(date +%s)
GW_CLEAR=$(sql "SELECT status || ' ' || coalesce(clear_reason,'-') FROM data2flow_core.alarms WHERE id = ${GW_ALARM:-0}")
OPEN_CHILD=$(sql "SELECT count(*) FROM data2flow_core.alarms WHERE parent_alarm_id = ${GW_ALARM:-0} AND status <> 'CLEARED'")
CLEARED_CHILD=$(sql "SELECT count(*) FROM data2flow_core.alarms WHERE parent_alarm_id = ${GW_ALARM:-0} AND status = 'CLEARED'")
info "복구 $((T_CLEAR - T_UP))초 뒤 게이트웨이 알람 $GW_CLEAR, 하위 해제 ${CLEARED_CHILD}건·남음 ${OPEN_CHILD}건"
check "복구 → 게이트웨이 알람 자동 해제, 하위 알람 함께 해제" bash -c "[[ '$GW_CLEAR' == 'CLEARED AUTO' && '$OPEN_CHILD' == 0 && $CLEARED_CHILD -ge 1 ]]"
sleep 2; kill "$SSE_PID" 2>/dev/null || true
SSE_EVENTS=$(python3 - "$WORK_DIR/sse-live.txt" "${GW_ALARM:-0}" <<'PY'
import json, sys
ev = None; seen = []
for line in open(sys.argv[1], encoding="utf-8", errors="replace"):
    line = line.rstrip("\n")
    if line.startswith("event:"): ev = line[6:].strip()
    elif line.startswith("data:") and ev == "alarm":
        try: d = json.loads(line[5:].strip())
        except ValueError: continue
        if str(d.get("alarmId")) == sys.argv[2]: seen.append(d.get("event") or d.get("state"))
print(",".join(seen))
PY
)
info "BFF SSE /bff/stream/live(alarms) 게이트웨이 알람 이벤트: $SSE_EVENTS"
check "실시간 알람(API-DSH-20 topic alarms)으로 발생·확인·해제 수신" bash -c "[[ '$SSE_EVENTS' == *alarm.raised* && '$SSE_EVENTS' == *alarm.acked* && '$SSE_EVENTS' == *alarm.cleared* ]]"
GAP=$(sql "SELECT count(*) FROM data2flow_pipeline.telemetry WHERE device_id = ${CO2_ID:-0} AND time BETWEEN to_timestamp($T_DOWN + 30) AND to_timestamp($T_UP - 5)")
check "장애 구간 수신 공백(CO2 센서 측정값 ${GAP}건)" bash -c "[[ '$GAP' == 0 ]]"

# ---------------------------------------------------------------- 6. 시나리오 2 — 4·5단계: 효과 없음 → 알림, 라이브 뷰
log "6. 시나리오 2: 15분 뒤 효과 확인 → command.no-effect → 알람·텔레그램 알림 / 라이브 뷰 노드 지표"
NE_KEY="system:COMMAND_NO_EFFECT:$AIRCON:Thermostat"
WAIT=$(( ${EFFECT_DUE:-$(date +%s)} - $(date +%s) + 120 )); [[ $WAIT -lt 30 ]] && WAIT=30
info "효과 확인 기한까지 최대 ${WAIT}초 대기"
poll "$WAIT" bash -c "[[ -n \"\$(docker exec $P-pg psql -U data2flow -d data2flow -tAc \"SELECT 1 FROM data2flow_core.alarms WHERE alarm_key = '$NE_KEY'\")\" ]]" || true
VERDICT=$(sql "SELECT status || ' ' || coalesce(start_value::text,'-') || '→' || coalesce(end_value::text,'-') FROM data2flow_action.effect_checks WHERE command_id = '$CMD_ID'" 2>/dev/null || echo "")
info "효과 확인 결과: $VERDICT"
check "효과 확인 NO_EFFECT(냉방 15분 동안 temperature 하강 0.2 미만)" bash -c "[[ '$VERDICT' == NO_EFFECT* ]]"
check "EVT-ACT-04 command.no-effect → 기기 이력 감사 COMMAND_NO_EFFECT" \
  bash -c "[[ $(sql "SELECT count(*) FROM data2flow_core.audit_logs WHERE organization_id = $ORG AND action = 'COMMAND_NO_EFFECT' AND target_id = '$AIRCON'") -ge 1 ]]"
read -r NE_ALARM NE_STATUS _ <<< "$(alarm_of "$NE_KEY")"
check "\"제어 효과 없음\" WARNING 알람 (id=$NE_ALARM $NE_STATUS)" bash -c "[[ -n '$NE_ALARM' && '$NE_STATUS' == ACTIVE ]]"
poll 60 bash -c "[[ \$(python3 -c \"import json; print(sum(1 for l in open('$TG_LOG') if json.loads(l)['method']=='sendMessage' and '|$NE_ALARM|' in json.dumps(json.loads(l)['body'])))\") -ge 1 ]]" || true
NE_TEXT=$(tg "([r['body'].get('text','').splitlines()[0] for r in rows if r['method']=='sendMessage' and '|$NE_ALARM|' in __import__('json').dumps(r['body'])] or [''])[0].replace(\"'\", '')")
info "텔레그램: $NE_TEXT"
check "효과 없음 알림이 가짜 텔레그램으로 전달(chat $TG_CHAT)" grep -q '효과 없음' <<< "$NE_TEXT"
api admin GET "/core/devices/$AIRCON/history?page=1&size=50" "$T"
check "기기 이력(API-DEV-27)에 효과 없음 표시 (got $(status))" bash -c "[[ '$(status)' == 200 && '$(grep -c NO_EFFECT "$LAST.body")' -ge 1 ]]"

kill "$LIVE_PID" 2>/dev/null || true; sleep 1
LV=$(python3 - "$LIVE" "$THRESH_NODE" "$CONTROL_NODE" <<'PY'
import json, sys
thr, ctl = sys.argv[2], sys.argv[3]
stats = 0; tin = 0; cin = 0; ports = {}; samples = 0; opened = False
for line in open(sys.argv[1], encoding="utf-8"):
    try: m = json.loads(line)
    except ValueError: continue
    t = m.get("type")
    if t == "_open": opened = True
    if t == "node.stats":
        stats += 1
        for n in m.get("nodes") or m.get("stats") or []:
            if n.get("nodeId") == thr:
                tin += n.get("in") or 0
                for p, c in (n.get("out") or {}).items(): ports[p] = ports.get(p, 0) + c
            if n.get("nodeId") == ctl: cin += n.get("in") or 0
    if t == "node.sample": samples += 1
print(opened, stats, tin, cin, json.dumps(ports, separators=(",", ":")), samples)
PY
)
read -r LV_OPEN LV_STATS LV_TIN LV_CIN LV_PORTS LV_SAMPLES <<< "$LV"
info "라이브 뷰: 연결 $LV_OPEN, node.stats ${LV_STATS}회, 기준 노드 입력 ${LV_TIN}·분기 $LV_PORTS, 제어 노드 입력 ${LV_CIN}, 샘플 ${LV_SAMPLES}건"
check "라이브 뷰(BFF WebSocket)로 노드 지표 수신(기준 노드 true 분기, 제어 노드 입력)" \
  bash -c "[[ '$LV_OPEN' == True && ${LV_STATS:-0} -ge 10 && ${LV_TIN:-0} -gt 0 && ${LV_CIN:-0} -ge 1 && '$LV_PORTS' == *true* ]]"

api admin POST "/core/sim/runs/$RUN_OP/stop" "$T" '{}'

# ---------------------------------------------------------------- 결과
log "결과: PASS $PASS · FAIL $FAIL (기록 $RESULTS)"
[[ $FAIL -eq 0 ]]
