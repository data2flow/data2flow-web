#!/usr/bin/env bash
# M5·M6 시연(plan/milestones.md §M5 "데이터 관리 완성", §M6 "분석·AI") 통합 확인 대본.
#
#   5단계(시나리오 4): 새 벤더 MQTT 센서를 코드 배포 없이 연결 → DECODE 스크립트 직접 작성 → 시험 실행·시험 케이스 통과 → 배포
#                     → 미검증 측정 항목 승인 → 과거 원본 재처리로 값이 채워짐. 커넥터별 계약 시험은 각 저장소 IT 결과 요약만.
#                     1년치 가상 데이터를 채워 CSV 내보내기 행 수 확인.
#   6단계(시나리오 5의 1·2·4단계): 질문으로 분석 템플릿 찾기 → 충분성 → 실행 → AI 해설(가짜 제공자 FAKE, "숫자 확인됨")
#                     → 대시보드 고정 → 개입 효과 검증 템플릿 실행. 시나리오 4의 AI 스크립트 초안(FAKE).
#                     MCP 토큰(장기 열쇠) 발급 → /mcp 읽기 도구 호출(도구 목록·list_devices) → 범위 밖 도구는 목록에 없음.
#
#   ※ LLM 실제 키는 없다(ADR-040). AI 해설·스크립트 초안은 가짜 제공자 FAKE(결정적, 데이터 구획의 숫자만 인용)로 확인한다.
#
# 두 가지 방식
#   e2e/m56-demo.sh                     기본: 임시 Docker 컨테이너(PostgreSQL 18·Valkey·RabbitMQ 4·Mosquitto·Mailpit)와 서비스 11개를
#                                       이 스크립트가 고유 포트로 띄우고 처음부터 끝까지 확인한 뒤 모두 지운다(빌드 뒤 약 10분).
#                                       메모리를 많이 쓰므로(서비스 11개) 미리보기가 떠 있으면 먼저 멈추는 편이 좋다.
#   e2e/m56-demo.sh --against-preview   지금 떠 있는 로컬 미리보기(e2e/local-preview.sh, http://localhost:3000)에 붙어서 확인한다.
#                                       미리보기를 다시 시작하지 않고 견본 데이터도 지우지 않는다. 시연용으로 만든 것은 이름에 "[시연]"이
#                                       붙는다(다시 돌리면 이름으로 찾아 재사용). 관리자 비밀번호는 ~/.data2flow-preview/keys.env에서 읽고 출력하지 않는다.
#
# 안전(CLAUDE.md §5): 공용 인프라(s3·s4·iot-data.java21.net·ChirpStack)에는 아무것도 보내지 않는다. 새 벤더 메시지 발행은
#   로컬 버리는 Mosquitto(127.0.0.1)에만 한다 — 기본 방식은 이 스크립트의 임시 컨테이너, --against-preview는 미리보기의 d2f-preview-mqtt.
#   발행 대상이 127.0.0.1이 아니면 확인기가 멈춘다.
#
# 필요: docker, java 21, node 22 + pnpm, python3(3.12+, analytics), curl, openssl, lsof
# 환경 변수: SKIP_BUILD=1(기본 방식: 이미 만든 jar·build·venv 재사용), JARS_DIR(jar를 먼저 찾을 곳), WORK_DIR(기본 mktemp), KEEP=1(끝나도 남김),
#   EXPORT_DAYS(1년치 채우기 일수, 기본 365), D2F_PREVIEW_HOME(기본 ~/.data2flow-preview), VENV_DIR(analytics venv 재사용),
#   FROM_PREVIEW_BUILD=1(기본 방식에서 미리보기가 만든 jar·web·venv를 재사용 — 빌드 생략)
set -euo pipefail

MODE=fresh
case "${1:-}" in
  --against-preview) MODE=preview;;
  ""|--fresh) ;;
  -h|--help) sed -n '2,30p' "$0"; exit 0;;
  *) echo "알 수 없는 인자: $1 (--against-preview | --fresh)" >&2; exit 2;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WEB_DIR="$ROOT/data2flow-web"
CHECKER="$SCRIPT_DIR/m56-demo.py"
command -v python3 >/dev/null || { echo "python3가 필요합니다" >&2; exit 1; }

# ================================================================ --against-preview
if [[ $MODE == preview ]]; then
  STATE="${D2F_PREVIEW_HOME:-$HOME/.data2flow-preview}"
  KEYS="$STATE/keys.env"
  [[ -f "$KEYS" ]] || { echo "미리보기 키가 없습니다($KEYS). 먼저 e2e/local-preview.sh 로 띄우세요" >&2; exit 1; }
  curl -sf -m 5 http://127.0.0.1:3000/healthz >/dev/null || { echo "미리보기 web(http://localhost:3000)이 응답하지 않습니다(e2e/local-preview.sh status)" >&2; exit 1; }
  docker inspect -f '{{.State.Running}}' d2f-preview-mqtt 2>/dev/null | grep -q true \
    || { echo "미리보기의 버리는 Mosquitto(d2f-preview-mqtt)가 떠 있지 않습니다" >&2; exit 1; }
  WORK_DIR="${WORK_DIR:-$(mktemp -d -t d2f-m56)}"; mkdir -p "$WORK_DIR"; chmod 700 "$WORK_DIR"
  # 비밀번호는 환경 변수로만 넘기고 출력하지 않는다
  ADMIN_PASSWORD="$(sed -n 's/^ADMIN_PASSWORD=//p' "$KEYS")"
  echo "== M5·M6 시연 확인(미리보기에 붙음: http://localhost:3000, 기록 $WORK_DIR)"
  D2F_MODE=preview D2F_WEB=http://localhost:3000 D2F_GATEWAY=http://127.0.0.1:45780 D2F_MCP_HOST=mcp.localhost \
    D2F_ADMIN_LOGIN=admin01 D2F_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
    D2F_MQTT_HOST=127.0.0.1 D2F_MQTT_PORT=45718 D2F_MQTT_CONTAINER=d2f-preview-mqtt D2F_PG_CONTAINER=d2f-preview-pg \
    D2F_WORK_DIR="$WORK_DIR" D2F_EXPORT_DAYS="${EXPORT_DAYS:-365}" D2F_REPO_ROOT="$ROOT" \
    python3 "$CHECKER"
  exit $?
fi

# ================================================================ 기본: 임시 컨테이너 + 서비스 11개
WORK_DIR="${WORK_DIR:-$(mktemp -d -t d2f-m56)}"
mkdir -p "$WORK_DIR/logs"; chmod 700 "$WORK_DIR"
P="d2f-m56e2e"
PG_PORT=51432; REDIS_PORT=51379; AMQP_PORT=51672; STREAM_PORT=51552; SMTP_PORT=51025; MAILPIT_HTTP=51825; MQTT_PORT=51883
GW_PORT=51780; AUTH_PORT=51781; CORE_PORT=51782; INGRESS_PORT=51783; PIPELINE_PORT=51784; FLOW_PORT=51785; ACTION_PORT=51786
SIM_PORT=51787; AI_PORT=51788; ANALYTICS_PORT=51789; WEB_PORT=51770; ANALYTICS_WORKER_MGMT=51811  # 관리 포트는 서비스 포트+10(51790~51799)
SVC_PORTS=($GW_PORT $AUTH_PORT $CORE_PORT $INGRESS_PORT $PIPELINE_PORT $FLOW_PORT $ACTION_PORT $SIM_PORT $AI_PORT $ANALYTICS_PORT $WEB_PORT)
WEB="http://localhost:$WEB_PORT"; ORIGIN="$WEB"
CONTAINERS=("$P-pg" "$P-valkey" "$P-rabbit" "$P-mail" "$P-mqtt")
PIDS=()

cleanup() {
  local code=$?
  if [[ "${KEEP:-}" == 1 ]]; then echo "KEEP=1: 컨테이너·프로세스를 남깁니다(WORK_DIR=$WORK_DIR)"; return; fi
  for pid in "${PIDS[@]:-}"; do [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true; done
  sleep 3
  for pid in "${PIDS[@]:-}"; do [[ -n "$pid" ]] && kill -9 "$pid" 2>/dev/null || true; done
  for port in "${SVC_PORTS[@]}" $ANALYTICS_WORKER_MGMT; do
    lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | xargs kill -9 2>/dev/null || true
  done
  docker rm -f "${CONTAINERS[@]}" >/dev/null 2>&1 || true
  echo "정리 완료(컨테이너·프로세스 제거). 로그: $WORK_DIR/logs"
  exit $code
}
trap cleanup EXIT INT TERM

wait_for() { # 설명 초 명령…
  local name="$1" secs="$2"; shift 2
  for _ in $(seq 1 "$secs"); do if "$@" >/dev/null 2>&1; then echo "  준비됨: $name"; return 0; fi; sleep 1; done
  echo "  시간 초과: $name"; return 1
}

echo "== 키 생성 → $WORK_DIR/keys.env"
umask 077
cat > "$WORK_DIR/keys.env" <<EOF
JWT_KEY=e2e:$(openssl rand -base64 32)
MASTER_KEY=e2e:$(openssl rand -base64 32)
SESSION_KEY=e2e:$(openssl rand -base64 32)
DB_PASSWORD=$(openssl rand -hex 16)
REDIS_PASSWORD=$(openssl rand -hex 16)
RABBIT_PASSWORD=$(openssl rand -hex 16)
ADMIN_INITIAL_PASSWORD=Init-$(openssl rand -hex 6)-Aa1
ADMIN_PASSWORD=Boss-$(openssl rand -hex 6)-Bb2
EOF
# shellcheck disable=SC1091
source "$WORK_DIR/keys.env"

echo "== 임시 컨테이너 시작"
for port in "${SVC_PORTS[@]}"; do
  for p in $port $((port + 10)); do
    if lsof -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then echo "포트 $p 를 이미 쓰고 있습니다" >&2; exit 1; fi
  done
done
docker rm -f "${CONTAINERS[@]}" >/dev/null 2>&1 || true
docker run -d --name "$P-pg" -p 127.0.0.1:$PG_PORT:5432 \
  -e POSTGRES_DB=data2flow -e POSTGRES_USER=data2flow -e POSTGRES_PASSWORD="$DB_PASSWORD" pgvector/pgvector:pg18 >/dev/null
docker run -d --name "$P-valkey" -p 127.0.0.1:$REDIS_PORT:6379 valkey/valkey:8 \
  valkey-server --requirepass "$REDIS_PASSWORD" --appendonly no >/dev/null
docker run -d --name "$P-rabbit" --hostname "$P-rabbit" -p 127.0.0.1:$AMQP_PORT:5672 -p 127.0.0.1:$STREAM_PORT:5552 \
  -e RABBITMQ_DEFAULT_VHOST=data2flow-dev -e RABBITMQ_DEFAULT_USER=d2f -e RABBITMQ_DEFAULT_PASS="$RABBIT_PASSWORD" \
  -e RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS="-rabbitmq_stream advertised_host localhost advertised_port $STREAM_PORT" \
  rabbitmq:4-management bash -c "rabbitmq-plugins enable --offline rabbitmq_stream rabbitmq_stream_management >/dev/null && exec docker-entrypoint.sh rabbitmq-server" >/dev/null
docker run -d --name "$P-mail" -p 127.0.0.1:$SMTP_PORT:1025 -p 127.0.0.1:$MAILPIT_HTTP:8025 axllent/mailpit:latest >/dev/null
# 버리는 Mosquitto(익명, 127.0.0.1만): ingress의 플랫폼 브로커 자리이자 새 벤더 센서 메시지를 발행할 곳
printf 'listener 1883\nallow_anonymous true\n' > "$WORK_DIR/mosquitto.conf"
docker run -d --name "$P-mqtt" -p 127.0.0.1:$MQTT_PORT:1883 -v "$WORK_DIR/mosquitto.conf:/mosquitto/config/mosquitto.conf:ro" \
  eclipse-mosquitto:2 >/dev/null
wait_for postgres 60 docker exec "$P-pg" pg_isready -U data2flow -d data2flow
wait_for valkey 30 docker exec "$P-valkey" valkey-cli -a "$REDIS_PASSWORD" ping
wait_for rabbitmq 120 bash -c "docker logs $P-rabbit 2>&1 | grep -q 'Server startup complete'"
wait_for mosquitto 30 bash -c "docker logs $P-mqtt 2>&1 | grep -q 'running'"
# ai의 도움말 색인(help_chunks)은 public.vector를 쓴다(운영은 DB 초기 구성에서 설치, local-preview.sh와 같음)
for i in 1 2 3 4 5; do docker exec "$P-pg" psql -U data2flow -d data2flow -qtAc "CREATE EXTENSION IF NOT EXISTS vector SCHEMA public" >/dev/null 2>&1 && break; sleep 2; done

# ---------------------------------------------------------------- 빌드
SERVICES=(auth api-gateway core-api pipeline flow-engine action simulator ingress ai)
VENV="$WORK_DIR/venv"; [[ -n "${VENV_DIR:-}" ]] && VENV="$VENV_DIR"
# FROM_PREVIEW_BUILD=1: 로컬 미리보기가 만든 빌드(~/.data2flow-preview의 jar·web build·analytics venv)를 그대로 쓴다(빌드 생략)
if [[ "${FROM_PREVIEW_BUILD:-}" == 1 ]]; then
  PV="${D2F_PREVIEW_HOME:-$HOME/.data2flow-preview}"
  SKIP_BUILD=1; JARS_DIR="$PV/jars"; VENV="$PV/venv"; WEB_DIR="$PV/src/web"
fi
if [[ "${SKIP_BUILD:-}" != 1 ]]; then
  echo "== 빌드(테스트 생략, 로그 $WORK_DIR/logs/build-*.log)"
  (cd "$ROOT/data2flow-contracts" && ./mvnw -q -B -DskipTests install) > "$WORK_DIR/logs/build-contracts.log" 2>&1
  for svc in "${SERVICES[@]}"; do
    (cd "$ROOT/data2flow-$svc" && ./mvnw -q -B -DskipTests clean package) > "$WORK_DIR/logs/build-$svc.log" 2>&1 \
      || { echo "$svc 빌드 실패: $WORK_DIR/logs/build-$svc.log" >&2; exit 1; }
  done
  (cd "$WEB_DIR" && pnpm build) > "$WORK_DIR/logs/build-web.log" 2>&1
fi
if [[ ! -x "$VENV/bin/python" ]]; then
  python3 -m venv "$VENV" && "$VENV/bin/pip" install -q "$ROOT/data2flow-analytics" > "$WORK_DIR/logs/build-analytics.log" 2>&1 \
    || { echo "analytics venv 설치 실패: $WORK_DIR/logs/build-analytics.log" >&2; exit 1; }
fi
jar_of() { ls ${JARS_DIR:+"$JARS_DIR"/data2flow-"$1".jar "$JARS_DIR"/data2flow-"$1"-*.jar} "$ROOT/data2flow-$1"/target/data2flow-"$1"-*.jar 2>/dev/null | grep -v -e plain -e sources | head -1; }

# ---------------------------------------------------------------- 서비스 환경(프로필 e2e: 루트 .env를 읽지 않는다)
export SPRING_PROFILES_ACTIVE=e2e
cd "$WORK_DIR"
export DATA2FLOW_REDIS_HOST=127.0.0.1 DATA2FLOW_REDIS_PORT=$REDIS_PORT DATA2FLOW_REDIS_PASSWORD="$REDIS_PASSWORD"
unset MQTT_BASIC_AUTH DATA2FLOW_DB_ADMIN_USERNAME DATA2FLOW_DB_ADMIN_PASSWORD 2>/dev/null || true
COMMON_ENV=(
  DATA2FLOW_DB_HOST=127.0.0.1 DATA2FLOW_DB_PORT=$PG_PORT DATA2FLOW_DB_NAME=data2flow
  DATA2FLOW_DB_USERNAME=data2flow DATA2FLOW_DB_PASSWORD="$DB_PASSWORD"
  DATA2FLOW_RABBITMQ_HOST=127.0.0.1 DATA2FLOW_RABBITMQ_PORT=$AMQP_PORT DATA2FLOW_RABBITMQ_VHOST=data2flow-dev
  DATA2FLOW_RABBITMQ_USERNAME=d2f DATA2FLOW_RABBITMQ_PASSWORD="$RABBIT_PASSWORD" DATA2FLOW_RABBITMQ_STREAM_PORT=$STREAM_PORT
  DATA2FLOW_CORE_URI=http://127.0.0.1:$CORE_PORT DATA2FLOW_DEV_NAME=m56 DATA2FLOW_DEVELOPER=m56
)
CORE_ENV=(
  "${COMMON_ENV[@]}"
  DATA2FLOW_SECRETS_MASTER_KEYS="$MASTER_KEY" DATA2FLOW_SECRETS_ACTIVE_KEY_ID=e2e
  DATA2FLOW_AUTH_BASE_URL=http://127.0.0.1:$AUTH_PORT DATA2FLOW_WEB_BASE_URL="$WEB"
  DATA2FLOW_INGRESS_BASE_URL=http://127.0.0.1:$INGRESS_PORT DATA2FLOW_PIPELINE_BASE_URL=http://127.0.0.1:$PIPELINE_PORT
  DATA2FLOW_ACTION_BASE_URL=http://127.0.0.1:$ACTION_PORT DATA2FLOW_FLOW_ENGINE_BASE_URL=http://127.0.0.1:$FLOW_PORT
  DATA2FLOW_SIMULATOR_BASE_URL=http://127.0.0.1:$SIM_PORT DATA2FLOW_WEBHOOK_BASE_URL="$WEB"
  DATA2FLOW_SMTP_HOST=127.0.0.1 DATA2FLOW_SMTP_PORT=$SMTP_PORT
  DATA2FLOW_ANALYTICS_BASE_URL=http://127.0.0.1:$ANALYTICS_PORT DATA2FLOW_AI_BASE_URL=http://127.0.0.1:$AI_PORT
)
sargs() { local p="$1"; echo "--server.port=$p --server.address=127.0.0.1 --management.server.port=$((p + 10)) --management.server.address=127.0.0.1"; }
run_java() { # 이름 포트 [env…] -- [인자…]
  local svc="$1" port="$2"; shift 2
  local envs=()
  while [[ $# -gt 0 && "$1" != "--" ]]; do envs+=("$1"); shift; done
  [[ $# -gt 0 ]] && shift
  # shellcheck disable=SC2046
  env HOSTNAME="data2flow-$svc-dev-m56-0" ${envs[@]+"${envs[@]}"} java -Xmx512m -jar "$(jar_of "$svc")" $(sargs "$port") "$@" \
    > "$WORK_DIR/logs/$svc.log" 2>&1 & PIDS+=($!)
}
sql() { docker exec "$P-pg" psql -U data2flow -d data2flow -tAc "$1" 2>/dev/null; }

echo "== 최초 관리자 Job(core Flyway migrate + ADMIN 생성)"
# shellcheck disable=SC2046
env "${CORE_ENV[@]}" DATA2FLOW_BOOTSTRAP_ADMIN_LOGIN_ID=admin01 DATA2FLOW_BOOTSTRAP_ADMIN_EMAIL=admin@example.test \
  DATA2FLOW_BOOTSTRAP_ADMIN_INITIAL_PASSWORD="$ADMIN_INITIAL_PASSWORD" DATA2FLOW_BOOTSTRAP_ORG_NAME="한빛대학교" \
  java -jar "$(jar_of core-api)" $(sargs $CORE_PORT) --data2flow.core.flyway-mode=migrate --data2flow.core.bootstrap.enabled=true \
  --spring.main.web-application-type=none > "$WORK_DIR/logs/bootstrap.log" 2>&1
grep -q "부트스트랩 결과" "$WORK_DIR/logs/bootstrap.log" || { echo "최초 관리자 Job 실패: $WORK_DIR/logs/bootstrap.log" >&2; exit 1; }
ORG=$(sql "SELECT min(id) FROM data2flow_core.organizations")

echo "== 서비스 시작(로그 $WORK_DIR/logs)"
run_java pipeline $PIPELINE_PORT "${COMMON_ENV[@]}" -- --data2flow.pipeline.flyway-mode=migrate
wait_for "pipeline(스키마)" 180 docker exec "$P-pg" psql -U data2flow -d data2flow -tAc "SELECT 1 FROM data2flow_pipeline.telemetry LIMIT 1"
run_java core-api $CORE_PORT "${CORE_ENV[@]}" -- --data2flow.core.flyway-mode=migrate
run_java flow-engine $FLOW_PORT "${COMMON_ENV[@]}" -- --data2flow.flow.flyway-mode=migrate --data2flow.flow.runtime-enabled=true
# action: virtual 드라이버만(MQTT·LoRaWAN·벤더 드라이버·텔레그램·출력 연결 발송 끔)
run_java action $ACTION_PORT "${COMMON_ENV[@]}" DATA2FLOW_SIMULATOR_URI=http://127.0.0.1:$SIM_PORT DATA2FLOW_ACTION_LORAWAN_ENABLED=false \
  DATA2FLOW_ACTION_LG_THINQ_ENABLED=false DATA2FLOW_ACTION_SMARTTHINGS_ENABLED=false DATA2FLOW_ACTION_OUTPUT_SENDER_ENABLED=false -- \
  --data2flow.action.flyway-mode=migrate --data2flow.action.mqtt.enabled=false --data2flow.action.notification.telegram.enabled=false
run_java simulator $SIM_PORT "${COMMON_ENV[@]}" DATA2FLOW_SIM_ORGANIZATION_IDS="$ORG" -- --data2flow.sim.flyway-mode=migrate
# ingress: 공용 호스트(iot-data·s3·s4) 차단, 플랫폼 브로커 자리는 버리는 Mosquitto
run_java ingress $INGRESS_PORT "${COMMON_ENV[@]}" DATA2FLOW_INGRESS_DENIED_HOSTS=iot-data.java21.net,s3.java21.net,s4.java21.net \
  DATA2FLOW_INGRESS_ENV=dev -- \
  --data2flow.ingress.core-uri=http://127.0.0.1:$CORE_PORT --data2flow.ingress.developer=m56 --data2flow.ingress.instance-ordinal=0 \
  --data2flow.ingress.stream.host=127.0.0.1 --data2flow.ingress.stream.port=$STREAM_PORT --data2flow.ingress.stream.virtual-host=data2flow-dev \
  --data2flow.ingress.stream.username=d2f --data2flow.ingress.stream.password="$RABBIT_PASSWORD" --data2flow.ingress.stream.use-configured-address=true \
  --spring.rabbitmq.host=127.0.0.1 --spring.rabbitmq.port=$AMQP_PORT --spring.rabbitmq.virtual-host=data2flow-dev \
  --spring.rabbitmq.username=d2f --spring.rabbitmq.password="$RABBIT_PASSWORD" \
  --data2flow.ingress.platform-broker.url=tcp://127.0.0.1:$MQTT_PORT
# ai: 실제 LLM 키 없음. 기본 NONE, 고를 수 있는 제공자에 FAKE(시연용 결정적 구현)를 연다
run_java ai $AI_PORT "${COMMON_ENV[@]}" DATA2FLOW_ANALYTICS_URI=http://127.0.0.1:$ANALYTICS_PORT \
  DATA2FLOW_PIPELINE_BASE_URL=http://127.0.0.1:$PIPELINE_PORT DATA2FLOW_WEB_BASE_URL="$WEB" \
  DATA2FLOW_AI_ALLOWED_PROVIDERS=NONE,FAKE,ANTHROPIC -- --data2flow.ai.flyway-mode=migrate
# analytics(Python): migrate → API + 작업자. uvicorn을 127.0.0.1·h11로(local-preview.sh와 같은 이유)
ANALYTICS_LAUNCH='
import sys, uvicorn
_Config = uvicorn.Config
def _local(app, **kw):
    kw["host"] = "127.0.0.1"; kw["http"] = "h11"
    return _Config(app, **kw)
uvicorn.Config = _local
from data2flow_analytics.__main__ import main
main(["data2flow_analytics", sys.argv[1]])'
ANALYTICS_ENV=("${COMMON_ENV[@]}" DATA2FLOW_PROFILE=local DATA2FLOW_ANALYTICS_REALTIME_ENABLED=false
  DATA2FLOW_ANALYTICS_STORE_DIR="$WORK_DIR/analytics-store" DATA2FLOW_ANALYTICS_WORKER_THREADS=1)
mkdir -p "$WORK_DIR/analytics-store"
env "${ANALYTICS_ENV[@]}" DATA2FLOW_FLYWAY_MODE=migrate "$VENV/bin/python" -c "$ANALYTICS_LAUNCH" migrate > "$WORK_DIR/logs/analytics-migrate.log" 2>&1
env "${ANALYTICS_ENV[@]}" HOSTNAME=data2flow-analytics-dev-m56-0 PORT=$ANALYTICS_PORT MANAGEMENT_PORT=$((ANALYTICS_PORT + 10)) \
  "$VENV/bin/python" -c "$ANALYTICS_LAUNCH" api > "$WORK_DIR/logs/analytics.log" 2>&1 & PIDS+=($!)
env "${ANALYTICS_ENV[@]}" HOSTNAME=data2flow-analytics-worker-dev-m56-0 MANAGEMENT_PORT=$ANALYTICS_WORKER_MGMT \
  "$VENV/bin/python" -c "$ANALYTICS_LAUNCH" worker > "$WORK_DIR/logs/analytics-worker.log" 2>&1 & PIDS+=($!)
run_java auth $AUTH_PORT DATA2FLOW_AUTH_JWT_KEYS="$JWT_KEY" DATA2FLOW_AUTH_JWT_ACTIVE_KEY_ID=e2e DATA2FLOW_CORE_URI=http://127.0.0.1:$CORE_PORT --
run_java api-gateway $GW_PORT DATA2FLOW_AUTH_URI=http://127.0.0.1:$AUTH_PORT DATA2FLOW_CORE_URI=http://127.0.0.1:$CORE_PORT \
  DATA2FLOW_AI_URI=http://127.0.0.1:$AI_PORT DATA2FLOW_MCP_URI=http://127.0.0.1:$AI_PORT DATA2FLOW_MCP_HOST=mcp.localhost \
  DATA2FLOW_GATEWAY_TRUSTED_PROXIES='127\.0\.0\.1' --
(cd "$WEB_DIR" && NODE_ENV=production HOST=127.0.0.1 PORT=$WEB_PORT DATA2FLOW_GATEWAY_URL=http://127.0.0.1:$GW_PORT \
  DATA2FLOW_PUBLIC_ORIGIN="$ORIGIN" DATA2FLOW_COOKIE_SECURE=false DATA2FLOW_SESSION_KEYS="$SESSION_KEY" \
  DATA2FLOW_TRUSTED_PROXY_HOPS=0 DATA2FLOW_GATEWAY_TIMEOUT_MS=40000 DATA2FLOW_ACTION_URL=http://127.0.0.1:$ACTION_PORT \
  exec node server.mjs ./build/server/index.js) > "$WORK_DIR/logs/web.log" 2>&1 & PIDS+=($!)

for pair in core-api:$CORE_PORT pipeline:$PIPELINE_PORT flow-engine:$FLOW_PORT action:$ACTION_PORT simulator:$SIM_PORT \
            ingress:$INGRESS_PORT ai:$AI_PORT analytics:$ANALYTICS_PORT auth:$AUTH_PORT api-gateway:$GW_PORT; do
  wait_for "${pair%%:*}" 300 curl -sf "http://127.0.0.1:$(( ${pair##*:} + 10 ))/actuator/health/readiness" \
    || { echo "${pair%%:*} 시작 실패: $WORK_DIR/logs/${pair%%:*}.log" >&2; exit 1; }
done
wait_for analytics-worker 120 curl -sf "http://127.0.0.1:$ANALYTICS_WORKER_MGMT/actuator/health/readiness" || true
wait_for web 60 curl -sf "http://127.0.0.1:$WEB_PORT/healthz"
if grep -hE 'Connect(ing|ed) to .*(iot-data|s3|s4)\.java21\.net' "$WORK_DIR"/logs/*.log >/dev/null 2>&1; then
  echo "공용 인프라 접속 흔적이 로그에 있습니다. 중단합니다" >&2; exit 1
fi

set +e
D2F_MODE=fresh D2F_WEB="$WEB" D2F_GATEWAY=http://127.0.0.1:$GW_PORT D2F_MCP_HOST=mcp.localhost \
  D2F_ADMIN_LOGIN=admin01 D2F_ADMIN_PASSWORD="$ADMIN_PASSWORD" D2F_ADMIN_INITIAL_PASSWORD="$ADMIN_INITIAL_PASSWORD" \
  D2F_MQTT_HOST=127.0.0.1 D2F_MQTT_PORT=$MQTT_PORT D2F_MQTT_CONTAINER="$P-mqtt" D2F_PG_CONTAINER="$P-pg" \
  D2F_WORK_DIR="$WORK_DIR" D2F_EXPORT_DAYS="${EXPORT_DAYS:-365}" D2F_REPO_ROOT="$ROOT" \
  python3 "$CHECKER"
CODE=$?
set -e
exit $CODE
