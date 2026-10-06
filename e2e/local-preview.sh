#!/usr/bin/env bash
# data2flow 로컬 화면 미리보기(OPS-08.01, ADR-057): Mac에서 플랫폼 전체를 띄워 브라우저로 화면을 둘러본다.
#
# 무엇을 하나
#   1. 각 서비스 저장소의 main(기본 origin/main, 먼저 fetch)을 ~/.data2flow-preview/src 로 내보내 빌드한다.
#      개발 중인 작업 디렉터리·브랜치는 건드리지 않고, Maven 산출물은 ~/.data2flow-preview/m2 에 설치한다(~/.m2 는 읽기만).
#   2. PostgreSQL 18(pgvector)·Valkey 8·RabbitMQ 4(stream)·Mailpit·Mosquitto를 고정 이름(d2f-preview-*)·고정 포트(127.0.0.1)의
#      로컬 Docker 컨테이너로 띄운다. KEEP_DATA=1이면 DB·RabbitMQ 데이터를 Docker 볼륨에 남겨 다시 띄워도 이어진다.
#   3. 서비스 11개(web·api-gateway·auth·core-api·ingress·pipeline·flow-engine·action·simulator·ai·analytics)를 띄운다.
#      ingress·ai·analytics는 아직 띄울 것이 없거나 실패하면 건너뛴다(나머지는 계속).
#   4. 최초 관리자를 만들고(아이디·비밀번호 출력), 견본 데이터(가상 강의실 키트, 지난 3시간 데이터, "고온이면 냉방" 플로우 적용,
#      실시간 시뮬레이터 실행)를 준비한다.
#
# 안전(CLAUDE.md §5, ADR-057): 공용 인프라(s3·s4·iot-data.java21.net·ChirpStack)에는 접속하지 않는다. 루트 .env를 읽지 않도록
#   프로필은 e2e, 작업 디렉터리는 ~/.data2flow-preview/run 이다. MQTT는 이 스크립트가 띄우는 버리는 Mosquitto에만 붙고,
#   action의 실제 드라이버(MQTT·LoRaWAN·LG ThinQ·SmartThings)·텔레그램·출력 연결 발송은 꺼져 있다(virtual 드라이버만).
#   예외(ADR-057 보완, 사용자 요청 2026-10-06): seed-real(또는 REAL_SOURCE=1)을 쓰면 ingress가 아카데미 센서 브로커
#   wss://iot-data.java21.net/mqtt 를 **구독만** 한다(발행 0, client-id data2flow-ingress-dev-<이름>-<n>, 자격증명은
#   루트 .env의 MQTT_BASIC_AUTH 한 줄만 읽어 로컬 DB에 암호화 저장, 출력하지 않음). DB·RabbitMQ·Redis는 여전히 로컬 Docker이고,
#   실제 센서 기기에는 드라이버를 붙이지 않으며 규칙은 화면 알람까지만(알림 채널 없음).
#
# 필요: macOS(또는 Linux), Docker Desktop, Java 21+, Node 22+ + pnpm, python3(3.12+, analytics용), git, curl, openssl, lsof.
#       이 저장소(data2flow-web)와 같은 폴더에 data2flow-* 저장소들이 있어야 한다(D2F_ROOT로 바꿀 수 있다).
# 사용:
#   e2e/local-preview.sh                 # 빌드 + 시작(처음엔 빌드 포함 10~20분, 견본 데이터 준비 약 4분)
#   SKIP_BUILD=1 e2e/local-preview.sh    # 지난번 빌드 재사용
#   KEEP_DATA=1 e2e/local-preview.sh     # DB·RabbitMQ를 Docker 볼륨에 남긴다(stop 뒤 다시 시작해도 데이터 유지)
#   e2e/local-preview.sh status          # 컨테이너·서비스 상태
#   e2e/local-preview.sh stop            # 서비스 프로세스 + 컨테이너 정지(볼륨·키·빌드는 남김)
#   e2e/local-preview.sh reset           # stop + 볼륨·키·견본 기록 삭제(빌드는 남김)
#   e2e/local-preview.sh logs core-api   # 서비스 로그 따라 보기
#   e2e/local-preview.sh seed            # 떠 있는 상태에서 관리자 로그인 확인 + 견본 데이터만 다시(이미 있으면 건너뜀)
#   e2e/local-preview.sh restart web     # web만 다시 빌드($REF)하고 web 프로세스만 다시 시작(SKIP_BUILD=1이면 빌드 생략)
#   e2e/local-preview.sh restart ingress # 서비스 하나만 다시 빌드·시작(web·core-api·pipeline·ingress·ai·analytics). 나머지는 그대로
#   e2e/local-preview.sh seed-real       # 떠 있는 미리보기에 실제 아카데미 센서 연결(구독만): 소스·공간·승인·평면도·대시보드·규칙·분석·플로우·내보내기
#                                        # (e2e/local-preview-real.py, 이미 있으면 다시 만들지 않음, 기록 ~/.data2flow-preview/real.env)
#   REAL_SOURCE=1 e2e/local-preview.sh   # 시작 + 견본 + seed-real 한 번에(한 번 연결하면 다음 시작부터 자동, 끄려면 REAL_SOURCE=0)
# 환경 변수: PREVIEW_REF(기본 origin/main, 로컬 main을 쓰려면 main), NO_FETCH=1, SAMPLE=0(견본 데이터 생략),
#   SAMPLE_BACKFILL=0(지난 3시간 데이터 생략), D2F_PREVIEW_HOME(기본 ~/.data2flow-preview), PREVIEW_JAVA_OPTS(기본 -Xmx512m,
#   ingress·ai는 -Xmx384m), PREVIEW_AUTOFILL=0(로그인 폼에 관리자 아이디·비밀번호를 미리 채우지 않음. 기본은 채움 — localhost 미리보기에서만 켜진다),
#   REAL_SOURCE_DEV(client-id 개발자 이름, 기본 로그인 사용자 이름), REAL_SOURCE_ORDINAL(client-id 끝 번호, 기본 1),
#   REAL_SOURCE_WAIT(첫 승인 대기 기기를 기다리는 초, 기본 240), D2F_ENV_FILE(MQTT_BASIC_AUTH를 읽을 파일, 기본 $D2F_ROOT/.env)
set -euo pipefail

if [ -z "${BASH_VERSION:-}" ]; then echo "bash로 실행하세요" >&2; exit 1; fi

# ---------------------------------------------------------------- 위치
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -z "${D2F_ROOT:-}" ]; then
  # 워크트리에서 실행해도 원래 저장소들의 부모 폴더를 찾는다
  common="$(git -C "$SCRIPT_DIR" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
  if [ -n "$common" ] && [ -d "$(dirname "$(dirname "$common")")/data2flow-core-api" ]; then
    D2F_ROOT="$(dirname "$(dirname "$common")")"
  else
    D2F_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
  fi
fi
STATE="${D2F_PREVIEW_HOME:-$HOME/.data2flow-preview}"
LOGS="$STATE/logs"; PIDS="$STATE/pids"; SRC="$STATE/src"; JARS="$STATE/jars"; RUN_DIR="$STATE/run"
KEYS="$STATE/keys.env"; SAMPLE_ENV="$STATE/sample.env"; REAL_ENV="$STATE/real.env"
REF="${PREVIEW_REF:-origin/main}"
JAVA_OPTS_DEFAULT="${PREVIEW_JAVA_OPTS:--Xmx512m}"

# ---------------------------------------------------------------- 고정 이름·포트(모두 127.0.0.1)
P="d2f-preview"
CONTAINERS="$P-pg $P-valkey $P-rabbit $P-mail $P-mqtt"
VOLUMES="$P-pgdata $P-rabbitdata"
PG_PORT=45732; REDIS_PORT=45779; AMQP_PORT=45772; STREAM_PORT=45752; RABBIT_UI=45767; SMTP_PORT=45725
MAILPIT_HTTP=48025; MQTT_PORT=45718
GW_PORT=45780; AUTH_PORT=45781; CORE_PORT=45782; INGRESS_PORT=45783; PIPELINE_PORT=45784; FLOW_PORT=45785
ACTION_PORT=45786; SIM_PORT=45787; AI_PORT=45788; ANALYTICS_PORT=45789; WEB_PORT=3000
ANALYTICS_WORKER_MGMT=45800   # analytics 작업자(API 없음)의 관리 포트
WEB="http://localhost:$WEB_PORT"; ORIGIN="$WEB"; WEB_LOCAL="http://127.0.0.1:$WEB_PORT"
MAILPIT="http://localhost:$MAILPIT_HTTP"
ADMIN_LOGIN=admin01

# 서비스 이름 → 포트 (bash 3.2: 연관 배열 없이)
port_of() {
  case "$1" in
    api-gateway) echo $GW_PORT;; auth) echo $AUTH_PORT;; core-api) echo $CORE_PORT;; ingress) echo $INGRESS_PORT;;
    pipeline) echo $PIPELINE_PORT;; flow-engine) echo $FLOW_PORT;; action) echo $ACTION_PORT;; simulator) echo $SIM_PORT;;
    ai) echo $AI_PORT;; analytics) echo $ANALYTICS_PORT;; analytics-worker) echo $ANALYTICS_WORKER_MGMT;;
    web) echo $WEB_PORT;; *) echo 0;;
  esac
}
JAVA_SERVICES="auth api-gateway core-api pipeline flow-engine action simulator ingress ai"
OPTIONAL_SERVICES="ingress ai analytics analytics-worker"
ALL_SERVICES="pipeline core-api flow-engine action simulator ingress ai analytics analytics-worker auth api-gateway web"

say() { printf '\n== %s\n' "$*"; }
note() { printf '   %s\n' "$*"; }
die() { printf '\n[중단] %s\n' "$*" >&2; exit 1; }
is_optional() { case " $OPTIONAL_SERVICES " in *" $1 "*) return 0;; esac; return 1; }

pid_alive() { [ -f "$PIDS/$1.pid" ] && kill -0 "$(cat "$PIDS/$1.pid")" 2>/dev/null; }
listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
ready_url() {
  case "$1" in
    web) echo "$WEB_LOCAL/healthz";;
    analytics-worker) echo "http://127.0.0.1:$ANALYTICS_WORKER_MGMT/actuator/health/readiness";;
    *) echo "http://127.0.0.1:$(( $(port_of "$1") + 10 ))/actuator/health/readiness";;
  esac
}
wait_for() { # 설명 초 명령…
  local name="$1" secs="$2" i; shift 2
  for i in $(seq 1 "$secs"); do if "$@" >/dev/null 2>&1; then note "준비됨: $name"; return 0; fi; sleep 1; done
  note "시간 초과: $name"; return 1
}

# ---------------------------------------------------------------- stop / status / reset / logs
stop_all() {
  say "서비스 정지"
  local svc pid i
  for svc in $ALL_SERVICES; do
    if pid_alive "$svc"; then kill -TERM "$(cat "$PIDS/$svc.pid")" 2>/dev/null || true; fi
  done
  for i in $(seq 1 30); do
    local alive=0
    for svc in $ALL_SERVICES; do pid_alive "$svc" && alive=1; done
    [ $alive = 0 ] && break; sleep 1
  done
  for svc in $ALL_SERVICES; do
    if pid_alive "$svc"; then kill -9 "$(cat "$PIDS/$svc.pid")" 2>/dev/null || true; note "강제 종료: $svc"; fi
    rm -f "$PIDS/$svc.pid"
  done
  say "컨테이너 정지(볼륨은 남김)"
  # shellcheck disable=SC2086
  docker rm -f $CONTAINERS >/dev/null 2>&1 || true
  note "정지 완료. 로그: $LOGS"
}

status_all() {
  say "컨테이너"
  docker ps -a --filter "name=$P-" --format '   {{.Names}}\t{{.Status}}' 2>/dev/null || note "docker에 연결할 수 없습니다"
  say "서비스(프로세스 · 준비 상태)"
  local svc st
  for svc in $ALL_SERVICES; do
    if pid_alive "$svc"; then
      if curl -sf -m 3 "$(ready_url "$svc")" >/dev/null 2>&1; then st="실행 중 · 준비됨"; else st="실행 중 · 준비 안 됨"; fi
      printf '   %-12s pid %-7s %s (포트 %s)\n' "$svc" "$(cat "$PIDS/$svc.pid")" "$st" "$(port_of "$svc")"
    else
      printf '   %-12s 꺼짐\n' "$svc"
    fi
  done
  if [ -f "$REAL_ENV" ]; then
    say "실제 센서 연결(구독만)"
    note "client-id $(sed -n 's/^REAL_CLIENT_ID=//p' "$REAL_ENV") · 소스 $(sed -n 's/^REAL_SOURCE_ID=//p' "$REAL_ENV") · 끄기: REAL_SOURCE=0 $0 restart ingress"
  fi
  if [ -f "$KEYS" ]; then
    # shellcheck disable=SC1090
    . "$KEYS"
    say "접속"
    note "웹      $WEB   (아이디 $ADMIN_LOGIN / 비밀번호 $ADMIN_PASSWORD)"
    note "Mailpit $MAILPIT"
    note "로그    $LOGS"
  fi
}

CMD="${1:-start}"
case "$CMD" in
  stop) stop_all; exit 0;;
  status) status_all; exit 0;;
  reset)
    stop_all
    # shellcheck disable=SC2086
    docker volume rm $VOLUMES >/dev/null 2>&1 || true
    rm -f "$KEYS" "$SAMPLE_ENV" "$REAL_ENV"
    note "볼륨·키·견본 기록 삭제(빌드는 $STATE 에 남김)"; exit 0;;
  logs)
    [ -n "${2:-}" ] || die "사용: $0 logs <서비스>  (예: core-api, web)"
    exec tail -n 100 -f "$LOGS/$2.log";;
  start|seed|seed-real) ;;
  restart)
    case "${2:-}" in web|core-api|pipeline|ingress|ai|analytics) ;;
      *) die "사용: $0 restart <web|core-api|pipeline|ingress|ai|analytics>  (그 서비스만 다시 빌드·시작)";; esac;;
  *) die "알 수 없는 명령: $CMD (start | stop | status | reset | logs <서비스> | seed | seed-real | restart <서비스>)";;
esac
RESTART_SVC="${2:-}"

# 실제 센서 연결(ADR-057 보완): REAL_SOURCE=1/0이 있으면 그것을, 없으면 지난번 seed-real 기록(real.env)을 따른다
REAL_DEV_DEFAULT="$(id -un | tr 'A-Z' 'a-z' | tr -cd 'a-z0-9')"
REAL_DEV="${REAL_SOURCE_DEV:-${REAL_DEV_DEFAULT:-dev}}"; REAL_ORDINAL="${REAL_SOURCE_ORDINAL:-1}"
REAL=0
if [ "$CMD" = seed-real ] || [ "${REAL_SOURCE:-}" = 1 ]; then REAL=1
elif [ "${REAL_SOURCE:-}" != 0 ] && [ -f "$REAL_ENV" ]; then REAL=1; fi
if [ -f "$REAL_ENV" ]; then
  # 지난번 값(client-id가 바뀌지 않게). 환경 변수로 준 값이 우선
  REAL_DEV="${REAL_SOURCE_DEV:-$(sed -n 's/^REAL_DEV=//p' "$REAL_ENV")}"; REAL_DEV="${REAL_DEV:-${REAL_DEV_DEFAULT:-dev}}"
  REAL_ORDINAL="${REAL_SOURCE_ORDINAL:-$(sed -n 's/^REAL_ORDINAL=//p' "$REAL_ENV")}"; REAL_ORDINAL="${REAL_ORDINAL:-1}"
fi
REAL_CLIENT_ID="data2flow-ingress-dev-$REAL_DEV-$REAL_ORDINAL"

if [ "$CMD" != start ]; then
  # seed / seed-real / restart <서비스>: 떠 있는 미리보기에 붙는다. 다른 서비스·컨테이너는 건드리지 않는다
  [ -f "$KEYS" ] || die "키가 없습니다($KEYS). 먼저 $0 로 시작하세요"
  for svc in core-api auth api-gateway; do pid_alive "$svc" || die "$svc 가 떠 있지 않습니다. 먼저 $0 로 시작하세요(상태: $0 status)"; done
  docker inspect -f '{{.State.Running}}' "$P-pg" 2>/dev/null | grep -q true || die "$P-pg 컨테이너가 떠 있지 않습니다"
fi

# ---------------------------------------------------------------- 사전 점검
if [ "$CMD" = start ]; then
say "사전 점검"
for t in docker java node pnpm python3 git curl openssl lsof; do command -v "$t" >/dev/null 2>&1 || die "$t 가 필요합니다"; done
docker info >/dev/null 2>&1 || die "Docker Desktop이 실행 중이 아닙니다"
JAVA_MAJOR="$(java -version 2>&1 | head -1 | sed -E 's/.*version "([0-9]+).*/\1/')"
[ "${JAVA_MAJOR:-0}" -ge 21 ] 2>/dev/null || die "Java 21 이상이 필요합니다(지금: $(java -version 2>&1 | head -1))"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || die "Node 22 이상이 필요합니다(지금: $(node -v))"
for r in auth api-gateway core-api pipeline flow-engine action simulator contracts web; do
  [ -d "$D2F_ROOT/data2flow-$r/.git" ] || [ -f "$D2F_ROOT/data2flow-$r/.git" ] || die "$D2F_ROOT/data2flow-$r 저장소가 없습니다(D2F_ROOT 확인)"
done
for svc in $ALL_SERVICES; do
  if pid_alive "$svc"; then die "이미 실행 중입니다($svc). 상태: $0 status, 정지: $0 stop"; fi
done
for port in $WEB_PORT $GW_PORT $AUTH_PORT $CORE_PORT $INGRESS_PORT $PIPELINE_PORT $FLOW_PORT $ACTION_PORT $SIM_PORT $AI_PORT $ANALYTICS_PORT; do
  listening "$port" && die "포트 $port 를 다른 프로그램이 쓰고 있습니다(lsof -iTCP:$port -sTCP:LISTEN)"
  [ "$port" = $WEB_PORT ] || { listening $((port + 10)) && die "포트 $((port + 10)) 를 다른 프로그램이 쓰고 있습니다"; }
done
mkdir -p "$LOGS" "$PIDS" "$SRC" "$JARS" "$RUN_DIR" "$STATE/m2"
chmod 700 "$STATE"
note "저장소 위치 $D2F_ROOT, 작업 폴더 $STATE"
fi

# ---------------------------------------------------------------- 키(처음 한 번 만들고 재사용, git 밖)
if [ ! -f "$KEYS" ]; then
  say "키 생성 → $KEYS"
  ( umask 077
    cat > "$KEYS" <<EOF
# data2flow 로컬 미리보기 전용 키(이 컴퓨터에만, 커밋 금지). reset 하면 지워진다
JWT_KEY=pv:$(openssl rand -base64 32)
MASTER_KEY=pv:$(openssl rand -base64 32)
SESSION_KEY=pv:$(openssl rand -base64 32)
DB_PASSWORD=$(openssl rand -hex 16)
REDIS_PASSWORD=$(openssl rand -hex 16)
RABBIT_PASSWORD=$(openssl rand -hex 16)
ADMIN_INITIAL_PASSWORD=Init-$(openssl rand -hex 6)-Aa1
ADMIN_PASSWORD=Preview-$(openssl rand -hex 5)-Aa1
EOF
  )
fi
chmod 600 "$KEYS"
# shellcheck disable=SC1090
. "$KEYS"

# ---------------------------------------------------------------- 빌드
export_src() { # 저장소 이름(data2flow-<name>) → $SRC/<name>, 커밋을 VERSIONS에 남긴다
  local name="$1" repo="$D2F_ROOT/data2flow-$1" sha
  if [ "${NO_FETCH:-}" != 1 ] && [ "${REF#origin/}" != "$REF" ]; then
    git -C "$repo" fetch -q origin "${REF#origin/}" 2>/dev/null || note "fetch 실패($name): 마지막으로 받은 $REF 사용"
  fi
  sha="$(git -C "$repo" rev-parse --short "$REF" 2>/dev/null)" || return 1
  rm -rf "$SRC/$name"; mkdir -p "$SRC/$name"
  git -C "$repo" archive --format=tar "$REF" | tar -x -C "$SRC/$name"
  printf '%s %s %s\n' "$name" "$REF" "$sha" >> "$JARS/VERSIONS.new"
}
build_web() { # data2flow-web $REF → $SRC/web, 의존성 설치 + SSR 빌드
  export_src web || die "data2flow-web에 $REF 가 없습니다"
  (cd "$SRC/web" && CI=true pnpm install --frozen-lockfile && pnpm build) > "$LOGS/build-web.log" 2>&1 \
    || die "web 빌드 실패: $LOGS/build-web.log"
  note "빌드됨: web"
}
MVN_REPO_ARGS="-Dmaven.repo.local=$STATE/m2 -Dmaven.repo.local.tail=$HOME/.m2/repository"
mvn_build() { # 이름 goal
  # shellcheck disable=SC2086
  (cd "$SRC/$1" && ./mvnw -q -B -DskipTests $MVN_REPO_ARGS "$2") > "$LOGS/build-$1.log" 2>&1
}

build_contracts() {
  export_src contracts || die "data2flow-contracts에 $REF 가 없습니다"
  mvn_build contracts install || die "contracts 빌드 실패: $LOGS/build-contracts.log"
  note "contracts 설치됨($STATE/m2)"
}
build_java() { # 서비스 → $JARS/data2flow-<서비스>.jar (실패하면 1)
  local svc="$1" jar
  rm -f "$JARS/data2flow-$svc.jar"
  { [ -d "$D2F_ROOT/data2flow-$svc" ] && export_src "$svc" && [ -f "$SRC/$svc/pom.xml" ]; } || return 1
  mvn_build "$svc" package || return 1
  jar="$(ls "$SRC/$svc"/target/data2flow-"$svc"-*.jar 2>/dev/null | grep -v -e plain -e sources | head -1)"
  [ -n "$jar" ] || return 1
  cp "$jar" "$JARS/data2flow-$svc.jar"; note "빌드됨: $svc"
}
build_analytics() { # 미리보기 전용 venv(python 3.12+)
  [ -d "$D2F_ROOT/data2flow-analytics" ] && export_src analytics && [ -f "$SRC/analytics/pyproject.toml" ] \
    && { [ -x "$STATE/venv/bin/python" ] || python3 -m venv "$STATE/venv"; } \
    && "$STATE/venv/bin/pip" install -q --upgrade "$SRC/analytics" > "$LOGS/build-analytics.log" 2>&1 \
    && note "빌드됨: analytics(venv $STATE/venv)"
}

if [ "$CMD" = restart ]; then
  if [ "${SKIP_BUILD:-}" != 1 ]; then
    say "빌드: $RESTART_SVC 만($REF → $SRC/$RESTART_SVC)"
    : > "$JARS/VERSIONS.new"; drop="$RESTART_SVC"
    case "$RESTART_SVC" in
      web) build_web;;
      analytics) build_analytics || die "analytics 빌드 실패: $LOGS/build-analytics.log";;
      *) build_contracts; drop="$RESTART_SVC|contracts"
         build_java "$RESTART_SVC" || die "$RESTART_SVC 빌드 실패: $LOGS/build-$RESTART_SVC.log";;
    esac
    if [ -f "$JARS/VERSIONS" ]; then grep -vE "^($drop) " "$JARS/VERSIONS" >> "$JARS/VERSIONS.new" || true; fi
    mv "$JARS/VERSIONS.new" "$JARS/VERSIONS"
    if [ -f "$JARS/SKIPPED" ]; then grep -vx "$RESTART_SVC" "$JARS/SKIPPED" > "$JARS/SKIPPED.new" || true; mv "$JARS/SKIPPED.new" "$JARS/SKIPPED"; fi
  fi
  case "$RESTART_SVC" in
    web) [ -f "$SRC/web/build/server/index.js" ] || die "web 빌드가 없습니다";;
    analytics) [ -x "$STATE/venv/bin/python" ] || die "analytics venv가 없습니다";;
    *) [ -f "$JARS/data2flow-$RESTART_SVC.jar" ] || die "$RESTART_SVC jar가 없습니다";;
  esac
elif [ "$CMD" = seed ] || [ "$CMD" = seed-real ]; then
  :
elif [ "${SKIP_BUILD:-}" != 1 ]; then
  say "빌드: 각 저장소 $REF 를 $SRC 로 내보내 빌드(테스트 생략, 로그 $LOGS/build-*.log)"
  : > "$JARS/VERSIONS.new"; rm -f "$JARS/SKIPPED"
  build_contracts
  for svc in $JAVA_SERVICES; do
    build_java "$svc" && continue
    is_optional "$svc" || die "$svc 빌드 실패: $LOGS/build-$svc.log"
    echo "$svc" >> "$JARS/SKIPPED"; note "건너뜀: $svc(소스 없음 또는 빌드 실패, $LOGS/build-$svc.log)"
  done
  # analytics(Python): 미리보기 전용 venv
  if ! build_analytics; then
    echo analytics >> "$JARS/SKIPPED"; note "건너뜀: analytics(python 3.12+ venv 설치 실패, $LOGS/build-analytics.log)"
  fi
  # web: 의존성 설치 + SSR 빌드
  build_web
  mv "$JARS/VERSIONS.new" "$JARS/VERSIONS"
else
  say "빌드 생략(SKIP_BUILD=1): $JARS 재사용"
  for svc in auth api-gateway core-api pipeline flow-engine action simulator; do
    [ -f "$JARS/data2flow-$svc.jar" ] || die "$svc jar가 없습니다. SKIP_BUILD 없이 한 번 빌드하세요"
  done
  [ -f "$SRC/web/build/server/index.js" ] || die "web 빌드가 없습니다. SKIP_BUILD 없이 한 번 빌드하세요"
fi
skipped() { [ -f "$JARS/SKIPPED" ] && grep -qx "$1" "$JARS/SKIPPED"; }

# ---------------------------------------------------------------- 인프라(로컬 Docker, 127.0.0.1에만)
if [ "$CMD" = start ]; then
if [ "${KEEP_DATA:-}" = 1 ]; then say "인프라 컨테이너 시작(KEEP_DATA=1: 데이터 볼륨 유지)"; else say "인프라 컨테이너 시작(임시 데이터, stop 하면 사라짐)"; fi
# shellcheck disable=SC2086
docker rm -f $CONTAINERS >/dev/null 2>&1 || true
PG_VOL=(); RABBIT_VOL=()
if [ "${KEEP_DATA:-}" = 1 ]; then
  PG_VOL=(-v "$P-pgdata:/var/lib/postgresql"); RABBIT_VOL=(-v "$P-rabbitdata:/var/lib/rabbitmq")
fi
docker run -d --name "$P-pg" -p 127.0.0.1:$PG_PORT:5432 ${PG_VOL[@]+"${PG_VOL[@]}"} \
  -e POSTGRES_DB=data2flow -e POSTGRES_USER=data2flow -e POSTGRES_PASSWORD="$DB_PASSWORD" pgvector/pgvector:pg18 >/dev/null
docker run -d --name "$P-valkey" -p 127.0.0.1:$REDIS_PORT:6379 valkey/valkey:8 \
  valkey-server --requirepass "$REDIS_PASSWORD" --appendonly no >/dev/null
docker run -d --name "$P-rabbit" --hostname "$P-rabbit" -p 127.0.0.1:$AMQP_PORT:5672 -p 127.0.0.1:$STREAM_PORT:5552 \
  -p 127.0.0.1:$RABBIT_UI:15672 ${RABBIT_VOL[@]+"${RABBIT_VOL[@]}"} \
  -e RABBITMQ_DEFAULT_VHOST=data2flow-dev -e RABBITMQ_DEFAULT_USER=d2f -e RABBITMQ_DEFAULT_PASS="$RABBIT_PASSWORD" \
  -e RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS="-rabbitmq_stream advertised_host localhost advertised_port $STREAM_PORT" \
  rabbitmq:4-management bash -c "rabbitmq-plugins enable --offline rabbitmq_stream rabbitmq_stream_management >/dev/null && exec docker-entrypoint.sh rabbitmq-server" >/dev/null
docker run -d --name "$P-mail" -p 127.0.0.1:$SMTP_PORT:1025 -p 127.0.0.1:$MAILPIT_HTTP:8025 axllent/mailpit:latest >/dev/null
# 버리는 Mosquitto(익명, 127.0.0.1만): ingress의 플랫폼 브로커 자리. 공용 iot-data 브로커 대신
printf 'listener 1883\nallow_anonymous true\n' > "$RUN_DIR/mosquitto.conf"
docker run -d --name "$P-mqtt" -p 127.0.0.1:$MQTT_PORT:1883 -v "$RUN_DIR/mosquitto.conf:/mosquitto/config/mosquitto.conf:ro" \
  eclipse-mosquitto:2 >/dev/null
wait_for postgres 90 docker exec "$P-pg" pg_isready -U data2flow -d data2flow || die "postgres 시작 실패(docker logs $P-pg)"
# ai의 도움말 색인(help_chunks)은 public.vector를 쓴다(운영은 DB 초기 구성에서 설치). 이미지 pgvector/pgvector:pg18(PostgreSQL 라이선스)
for i in 1 2 3 4 5; do docker exec "$P-pg" psql -U data2flow -d data2flow -qtAc "CREATE EXTENSION IF NOT EXISTS vector SCHEMA public" >/dev/null 2>&1 && break; sleep 2; done
wait_for valkey 30 docker exec "$P-valkey" valkey-cli -a "$REDIS_PASSWORD" ping || die "valkey 시작 실패"
wait_for rabbitmq 180 bash -c "docker logs $P-rabbit 2>&1 | grep -q 'Server startup complete'" || die "rabbitmq 시작 실패(docker logs $P-rabbit)"
wait_for mailpit 30 curl -sf "$MAILPIT/api/v1/info" || die "mailpit 시작 실패"
wait_for mosquitto 30 bash -c "docker logs $P-mqtt 2>&1 | grep -q running" || die "mosquitto 시작 실패"
fi
sql() { docker exec "$P-pg" psql -U data2flow -d data2flow -tAc "$1" 2>/dev/null; }

# ---------------------------------------------------------------- 서비스 환경
# 프로필 e2e(설정 파일 없음 = 기본 설정만). 기본 프로필 local은 루트 .env(공용 인프라 접속값)를 읽으므로 쓰지 않는다
export SPRING_PROFILES_ACTIVE=e2e
export DATA2FLOW_REDIS_HOST=127.0.0.1 DATA2FLOW_REDIS_PORT=$REDIS_PORT DATA2FLOW_REDIS_PASSWORD="$REDIS_PASSWORD"
unset MQTT_BASIC_AUTH DATA2FLOW_DB_ADMIN_USERNAME DATA2FLOW_DB_ADMIN_PASSWORD 2>/dev/null || true
COMMON_ENV=(
  DATA2FLOW_DB_HOST=127.0.0.1 DATA2FLOW_DB_PORT=$PG_PORT DATA2FLOW_DB_NAME=data2flow
  DATA2FLOW_DB_USERNAME=data2flow DATA2FLOW_DB_PASSWORD="$DB_PASSWORD"
  DATA2FLOW_RABBITMQ_HOST=127.0.0.1 DATA2FLOW_RABBITMQ_PORT=$AMQP_PORT DATA2FLOW_RABBITMQ_VHOST=data2flow-dev
  DATA2FLOW_RABBITMQ_USERNAME=d2f DATA2FLOW_RABBITMQ_PASSWORD="$RABBIT_PASSWORD" DATA2FLOW_RABBITMQ_STREAM_PORT=$STREAM_PORT
  DATA2FLOW_CORE_URI=http://127.0.0.1:$CORE_PORT DATA2FLOW_DEV_NAME=preview DATA2FLOW_DEVELOPER=preview
)
INGRESS_URL=http://127.0.0.1:$INGRESS_PORT; skipped ingress && INGRESS_URL=http://127.0.0.1:9
CORE_ENV=(
  "${COMMON_ENV[@]}"
  DATA2FLOW_SECRETS_MASTER_KEYS="$MASTER_KEY" DATA2FLOW_SECRETS_ACTIVE_KEY_ID=pv
  DATA2FLOW_AUTH_BASE_URL=http://127.0.0.1:$AUTH_PORT DATA2FLOW_WEB_BASE_URL="$WEB"
  DATA2FLOW_INGRESS_BASE_URL=$INGRESS_URL DATA2FLOW_PIPELINE_BASE_URL=http://127.0.0.1:$PIPELINE_PORT
  DATA2FLOW_ACTION_BASE_URL=http://127.0.0.1:$ACTION_PORT DATA2FLOW_FLOW_ENGINE_BASE_URL=http://127.0.0.1:$FLOW_PORT
  DATA2FLOW_SIMULATOR_BASE_URL=http://127.0.0.1:$SIM_PORT DATA2FLOW_WEBHOOK_BASE_URL="$WEB"
  DATA2FLOW_SMTP_HOST=127.0.0.1 DATA2FLOW_SMTP_PORT=$SMTP_PORT
  DATA2FLOW_ANALYTICS_BASE_URL=http://127.0.0.1:$ANALYTICS_PORT DATA2FLOW_AI_BASE_URL=http://127.0.0.1:$AI_PORT
)
spring_args() { # 서비스 → 공통 인자(포트, 127.0.0.1에만 열기)
  local port; port="$(port_of "$1")"
  echo "--server.port=$port --server.address=127.0.0.1 --management.server.port=$((port + 10)) --management.server.address=127.0.0.1"
}
java_opts() {
  case "$1" in
    core-api) echo "${PREVIEW_JAVA_OPTS:--Xmx768m}";;
    ingress|ai) echo "${PREVIEW_JAVA_OPTS:--Xmx384m -XX:+UseSerialGC}";;   # 메모리 16GB Mac에서도 함께 띄울 수 있게 낮게
    *) echo "$JAVA_OPTS_DEFAULT";;
  esac
}
start_proc() { # 이름 작업폴더 명령… (stop 때까지 백그라운드 유지, pid 파일 기록)
  local name="$1" dir="$2"; shift 2
  ( cd "$dir" && exec nohup "$@" ) > "$LOGS/$name.log" 2>&1 < /dev/null &
  echo $! > "$PIDS/$name.pid"
}
start_java() { # 이름 [env…] -- [추가 인자…]
  local svc="$1"; shift
  local envs=() args=()
  while [ $# -gt 0 ] && [ "$1" != "--" ]; do envs+=("$1"); shift; done
  [ $# -gt 0 ] && shift
  args=("$@")
  # shellcheck disable=SC2046
  start_proc "$svc" "$RUN_DIR" env HOSTNAME="data2flow-$svc-dev-preview-0" ${envs[@]+"${envs[@]}"} \
    java $(java_opts "$svc") -jar "$JARS/data2flow-$svc.jar" $(spring_args "$svc") ${args[@]+"${args[@]}"}
}

# web: SSR + BFF + 라이브 뷰 WebSocket 중계(server.mjs). 로그인 폼 미리 채우기(OPS-08.01)는 BFF가
# localhost 주소 + Secure 쿠키 꺼짐일 때만 받아들인다(app/bff/config.server.ts previewLoginFrom). 비밀번호는 keys.env에서 실행 때만 넘긴다
start_web() {
  local autofill=()
  if [ "${PREVIEW_AUTOFILL:-1}" != 0 ]; then
    autofill=(DATA2FLOW_PREVIEW_LOGIN_ID="$ADMIN_LOGIN" DATA2FLOW_PREVIEW_LOGIN_PASSWORD="$ADMIN_PASSWORD")
  fi
  start_proc web "$SRC/web" env NODE_ENV=production HOST=127.0.0.1 PORT=$WEB_PORT DATA2FLOW_GATEWAY_URL=http://127.0.0.1:$GW_PORT \
    DATA2FLOW_PUBLIC_ORIGIN="$ORIGIN" DATA2FLOW_COOKIE_SECURE=false DATA2FLOW_SESSION_KEYS="$SESSION_KEY" \
    DATA2FLOW_TRUSTED_PROXY_HOPS=0 DATA2FLOW_GATEWAY_TIMEOUT_MS=40000 DATA2FLOW_ACTION_URL=http://127.0.0.1:$ACTION_PORT \
    ${autofill[@]+"${autofill[@]}"} node server.mjs ./build/server/index.js
}

# ingress: 소스 설정은 core가 준다. 플랫폼 브로커 자리는 버리는 로컬 Mosquitto(어느 모드든 공용 브로커에 발행하지 않는다).
#   기본: 공용 호스트(iot-data·s3·s4)를 모두 막는다. 실제 센서 모드(REAL=1): iot-data만 열어 "구독만" 하고 s3·s4는 계속 막는다.
#   client-id는 data2flow-ingress-dev-<이름>-<n>(BR-DSC-01) — 같은 ID가 두 곳에서 접속하면 서로 끊기므로 n을 고정해 둔다
start_ingress() {
  local denied=iot-data.java21.net,s3.java21.net,s4.java21.net dev=preview ordinal=0
  if [ "$REAL" = 1 ]; then denied=s3.java21.net,s4.java21.net; dev="$REAL_DEV"; ordinal="$REAL_ORDINAL"; fi
  start_java ingress "${COMMON_ENV[@]}" DATA2FLOW_INGRESS_DENIED_HOSTS=$denied DATA2FLOW_INGRESS_ENV=dev \
    HOSTNAME="data2flow-ingress-dev-$dev-$ordinal" DATA2FLOW_DEV_NAME="$dev" -- \
    --data2flow.ingress.core-uri=http://127.0.0.1:$CORE_PORT --data2flow.ingress.developer="$dev" \
    --data2flow.ingress.instance-ordinal="$ordinal" \
    --data2flow.ingress.stream.host=127.0.0.1 --data2flow.ingress.stream.port=$STREAM_PORT \
    --data2flow.ingress.stream.virtual-host=data2flow-dev --data2flow.ingress.stream.username=d2f \
    --data2flow.ingress.stream.password="$RABBIT_PASSWORD" --data2flow.ingress.stream.use-configured-address=true \
    --spring.rabbitmq.host=127.0.0.1 --spring.rabbitmq.port=$AMQP_PORT --spring.rabbitmq.virtual-host=data2flow-dev \
    --spring.rabbitmq.username=d2f --spring.rabbitmq.password="$RABBIT_PASSWORD" \
    --data2flow.ingress.platform-broker.url=tcp://127.0.0.1:$MQTT_PORT
}
# analytics(Python): 마이그레이션(로컬 DB에만) → API(127.0.0.1) + 작업자(실행 대기열). uvicorn을 127.0.0.1에만 열도록 감싼다.
#   http=h11: core의 JDK HttpClient는 평문 POST에 "Upgrade: h2c"를 붙이는데, uvicorn 기본(httptools)은 이때 본문을 버려
#   분석 만들기·충분성 검사가 400(ANALYSIS_BINDING_INVALID)이 된다. h11은 업그레이드를 무시하고 본문을 그대로 읽는다
ANALYTICS_LAUNCH='
import sys, uvicorn
_Config = uvicorn.Config
def _local(app, **kw):
    kw["host"] = "127.0.0.1"
    kw["http"] = "h11"
    return _Config(app, **kw)
uvicorn.Config = _local
from data2flow_analytics.__main__ import main
main(["data2flow_analytics", sys.argv[1]])'
ANALYTICS_ENV=(
  "${COMMON_ENV[@]}" DATA2FLOW_PROFILE=local DATA2FLOW_ANALYTICS_REALTIME_ENABLED=false
  DATA2FLOW_ANALYTICS_STORE_DIR="$STATE/analytics-store" DATA2FLOW_ANALYTICS_WORKER_THREADS=1
)
start_analytics() {
  mkdir -p "$STATE/analytics-store"
  ( cd "$RUN_DIR" && env "${ANALYTICS_ENV[@]}" DATA2FLOW_FLYWAY_MODE=migrate "$STATE/venv/bin/python" -c "$ANALYTICS_LAUNCH" migrate ) \
    > "$LOGS/analytics-migrate.log" 2>&1 || { note "analytics 마이그레이션 실패: $LOGS/analytics-migrate.log"; return 1; }
  start_proc analytics "$RUN_DIR" env "${ANALYTICS_ENV[@]}" HOSTNAME=data2flow-analytics-dev-preview-0 PORT=$ANALYTICS_PORT \
    MANAGEMENT_PORT=$((ANALYTICS_PORT + 10)) "$STATE/venv/bin/python" -c "$ANALYTICS_LAUNCH" api
  start_proc analytics-worker "$RUN_DIR" env "${ANALYTICS_ENV[@]}" HOSTNAME=data2flow-analytics-worker-dev-preview-0 \
    MANAGEMENT_PORT=$ANALYTICS_WORKER_MGMT "$STATE/venv/bin/python" -c "$ANALYTICS_LAUNCH" worker
}
start_service() { # 서비스 하나 시작(전체 시작과 restart가 같이 쓴다)
  case "$1" in
    pipeline) start_java pipeline "${COMMON_ENV[@]}" -- --data2flow.pipeline.flyway-mode=migrate;;
    core-api) start_java core-api "${CORE_ENV[@]}" -- --data2flow.core.flyway-mode=migrate;;
    flow-engine) start_java flow-engine "${COMMON_ENV[@]}" -- --data2flow.flow.flyway-mode=migrate --data2flow.flow.runtime-enabled=true;;
    # action: virtual 드라이버만. MQTT·LoRaWAN·벤더 드라이버, 텔레그램, 출력 연결 발송은 끈다
    action) start_java action "${COMMON_ENV[@]}" DATA2FLOW_SIMULATOR_URI=http://127.0.0.1:$SIM_PORT \
      DATA2FLOW_ACTION_LORAWAN_ENABLED=false DATA2FLOW_ACTION_LG_THINQ_ENABLED=false DATA2FLOW_ACTION_SMARTTHINGS_ENABLED=false \
      DATA2FLOW_ACTION_OUTPUT_SENDER_ENABLED=false -- \
      --data2flow.action.flyway-mode=migrate --data2flow.action.mqtt.enabled=false \
      --data2flow.action.notification.telegram.enabled=false --data2flow.action.notification.web-base-url="$WEB";;
    simulator) start_java simulator "${COMMON_ENV[@]}" DATA2FLOW_SIM_ORGANIZATION_IDS="$(sql "SELECT min(id) FROM data2flow_core.organizations")" -- \
      --data2flow.sim.flyway-mode=migrate;;
    ingress) start_ingress;;
    # ai: LLM 키 없음 → 기본 제공자 NONE(수치 요약 템플릿). 시연용 가짜 제공자 FAKE는 고를 수 있게 열어 둔다
    #     (AI 설정 화면 또는 e2e/m56-demo.sh가 FAKE 평가 뒤 전환, ADR-040). 스키마 data2flow_ai(pgvector)는 로컬 DB에만 migrate
    ai) start_java ai "${COMMON_ENV[@]}" DATA2FLOW_ANALYTICS_URI=http://127.0.0.1:$ANALYTICS_PORT \
      DATA2FLOW_PIPELINE_BASE_URL=http://127.0.0.1:$PIPELINE_PORT DATA2FLOW_WEB_BASE_URL="$WEB" \
      DATA2FLOW_AI_ALLOWED_PROVIDERS=NONE,FAKE,ANTHROPIC -- --data2flow.ai.flyway-mode=migrate;;
    analytics) start_analytics;;
    auth) start_java auth DATA2FLOW_AUTH_JWT_KEYS="$JWT_KEY" DATA2FLOW_AUTH_JWT_ACTIVE_KEY_ID=pv DATA2FLOW_CORE_URI=http://127.0.0.1:$CORE_PORT --;;
    api-gateway) start_java api-gateway DATA2FLOW_AUTH_URI=http://127.0.0.1:$AUTH_PORT DATA2FLOW_CORE_URI=http://127.0.0.1:$CORE_PORT \
      DATA2FLOW_AI_URI=$AI_URL DATA2FLOW_MCP_URI=$AI_URL DATA2FLOW_MCP_HOST=mcp.localhost \
      DATA2FLOW_GATEWAY_TRUSTED_PROXIES='127\.0\.0\.1' --;;
    web) start_web;;
  esac
}
stop_service() { # 서비스 하나 정지(TERM → 20초 → KILL)
  local svc="$1" i
  if pid_alive "$svc"; then
    kill -TERM "$(cat "$PIDS/$svc.pid")" 2>/dev/null || true
    for i in $(seq 1 25); do pid_alive "$svc" || break; sleep 1; done
    pid_alive "$svc" && { kill -9 "$(cat "$PIDS/$svc.pid")" 2>/dev/null || true; note "강제 종료: $svc"; }
  fi
  rm -f "$PIDS/$svc.pid"
}
# 공용 인프라 접속 흔적 점검. 실제 센서 모드에서는 iot-data 구독이 정상이므로 s3·s4만 본다(발행은 ingress 구조 시험이 막는다)
check_public_access() {
  local pat='(iot-data|s3|s4)\.java21\.net'
  [ "$REAL" = 1 ] && pat='(s3|s4)\.java21\.net'
  if grep -hE "Connect(ing|ed) to .*$pat" "$LOGS"/*.log >/dev/null 2>&1; then
    die "공용 인프라 접속 흔적이 로그에 있습니다. 즉시 정지합니다: $0 stop"
  fi
}
AI_URL=http://127.0.0.1:$AI_PORT; skipped ai && AI_URL=http://127.0.0.1:9

if [ "$CMD" = restart ]; then
  say "$RESTART_SVC 다시 시작(다른 서비스·컨테이너는 그대로)"
  if [ "$RESTART_SVC" = ingress ] && [ "$REAL" = 1 ]; then
    # 같은 client-id 두 번 접속 금지: 이 컴퓨터에 다른 ingress가 떠 있으면 멈춘다(우리 pid는 아래에서 정지)
    others=$(pgrep -f 'data2flow-ingress.*\.jar' | grep -vx "$(cat "$PIDS/ingress.pid" 2>/dev/null || echo none)" || true)
    [ -z "$others" ] || die "다른 ingress 프로세스(pid $others)가 떠 있습니다. client-id가 겹치지 않게 먼저 정리하세요"
  fi
  stop_service "$RESTART_SVC"
  [ "$RESTART_SVC" = analytics ] && stop_service analytics-worker
  port="$(port_of "$RESTART_SVC")"
  for i in $(seq 1 10); do listening "$port" || break; sleep 1; done
  listening "$port" && die "포트 $port 를 다른 프로그램이 쓰고 있습니다"
  start_service "$RESTART_SVC"
  for svc in $RESTART_SVC $( [ "$RESTART_SVC" = analytics ] && echo analytics-worker ); do
    [ -f "$PIDS/$svc.pid" ] || die "$svc 시작 실패: $LOGS/$svc.log"
    wait_for "$svc" 300 bash -c "curl -sf '$(ready_url "$svc")' || { kill -0 $(cat "$PIDS/$svc.pid") || exit 0; exit 1; }" \
      && pid_alive "$svc" || die "$svc 시작 실패: $LOGS/$svc.log"
    note "$svc 다시 시작됨 (pid $(cat "$PIDS/$svc.pid"))"
  done
  check_public_access
  [ "$RESTART_SVC" = ingress ] && note "ingress client-id: $( [ "$REAL" = 1 ] && echo "$REAL_CLIENT_ID(실제 센서 구독)" || echo "data2flow-ingress-dev-preview-0(로컬 Mosquitto만)")"
  exit 0
fi

# ---------------------------------------------------------------- 최초 관리자(빈 DB일 때만)
FRESH=0
if [ "$CMD" != start ]; then
  :
elif [ -z "$(sql "SELECT 1 FROM data2flow_core.organizations LIMIT 1" || true)" ]; then
  FRESH=1
  rm -f "$SAMPLE_ENV"
  # 빈 DB: 실제 센서 기록은 client-id 정보만 남기고 ID는 버린다(seed-real이 새로 만든다)
  if [ -f "$REAL_ENV" ]; then
    grep -E '^(REAL_DEV|REAL_ORDINAL|REAL_CLIENT_ID)=' "$REAL_ENV" > "$REAL_ENV.keep" || true; mv "$REAL_ENV.keep" "$REAL_ENV"
  fi
  say "최초 관리자 Job(core Flyway migrate + ADMIN 생성)"
  # shellcheck disable=SC2046
  ( cd "$RUN_DIR" && env "${CORE_ENV[@]}" DATA2FLOW_BOOTSTRAP_ADMIN_LOGIN_ID=$ADMIN_LOGIN \
      DATA2FLOW_BOOTSTRAP_ADMIN_EMAIL=admin@preview.localhost DATA2FLOW_BOOTSTRAP_ADMIN_INITIAL_PASSWORD="$ADMIN_INITIAL_PASSWORD" \
      DATA2FLOW_BOOTSTRAP_ORG_NAME="한빛대학교(미리보기)" \
      java $(java_opts core-api) -jar "$JARS/data2flow-core-api.jar" $(spring_args core-api) --data2flow.core.flyway-mode=migrate \
      --data2flow.core.bootstrap.enabled=true --spring.main.web-application-type=none ) > "$LOGS/bootstrap.log" 2>&1 \
    || die "최초 관리자 Job 실패: $LOGS/bootstrap.log"
  grep -q "부트스트랩 결과" "$LOGS/bootstrap.log" || die "최초 관리자 Job 결과가 없습니다: $LOGS/bootstrap.log"
  note "관리자 $ADMIN_LOGIN 생성"
else
  note "기존 데이터 사용(KEEP_DATA 볼륨): 관리자 생성 생략"
fi
ORG=$(sql "SELECT min(id) FROM data2flow_core.organizations")

# ---------------------------------------------------------------- 서비스 시작
if [ "$CMD" = start ]; then
say "서비스 시작(로그 $LOGS/<서비스>.log)"
start_service pipeline
wait_for "pipeline(스키마)" 180 docker exec "$P-pg" psql -U data2flow -d data2flow -tAc "SELECT 1 FROM data2flow_pipeline.telemetry LIMIT 1" \
  || die "pipeline 시작 실패: $LOGS/pipeline.log"
for svc in core-api flow-engine action simulator; do start_service $svc; done
skipped ingress || start_service ingress
skipped ai || start_service ai
if ! skipped analytics && [ -x "$STATE/venv/bin/python" ]; then start_service analytics || echo analytics >> "$JARS/SKIPPED"; fi
for svc in auth api-gateway web; do start_service $svc; done

STARTED=""; FAILED=""
for svc in core-api flow-engine action simulator auth api-gateway web ingress ai analytics analytics-worker; do
  if skipped "${svc%-worker}" || [ ! -f "$PIDS/$svc.pid" ]; then FAILED="$FAILED $svc(건너뜀)"; continue; fi
  if wait_for "$svc" 300 bash -c "curl -sf '$(ready_url "$svc")' || { kill -0 $(cat "$PIDS/$svc.pid") || exit 0; exit 1; }" \
     && pid_alive "$svc"; then
    STARTED="$STARTED $svc"
  else
    is_optional "$svc" || die "$svc 시작 실패: $LOGS/$svc.log (정리: $0 stop)"
    note "건너뜀: $svc 시작 실패($LOGS/$svc.log)"; FAILED="$FAILED $svc(시작 실패)"
    pid_alive "$svc" && kill "$(cat "$PIDS/$svc.pid")" 2>/dev/null || true
    rm -f "$PIDS/$svc.pid"
  fi
done
STARTED="pipeline$STARTED"
check_public_access
else
  STARTED=""; FAILED=""
  for svc in $ALL_SERVICES; do pid_alive "$svc" && STARTED="$STARTED $svc"; done
  pid_alive web || die "web 이 떠 있지 않습니다: $0 restart web"
fi

# ---------------------------------------------------------------- BFF 도우미(m4-demo.sh와 같은 방식)
LAST="$RUN_DIR/last"; JAR="$RUN_DIR/admin.cookies"
req() { # 메서드 경로 [curl 인자…]
  local method="$1" path="$2"; shift 2
  curl -s -o "$LAST.body" -D "$LAST.headers" -w '%{http_code}' -b "$JAR" -c "$JAR" -X "$method" "$WEB$path" "$@" > "$LAST.status"
}
status() { cat "$LAST.status"; }
location() { grep -i '^location:' "$LAST.headers" | tail -1 | tr -d '\r' | cut -d' ' -f2-; }
jq_() {
  python3 - "$LAST.body" "$1" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1])); r = d.get("response") if isinstance(d, dict) else None; rs = d.get("responses") if isinstance(d, dict) else None
    print(eval(sys.argv[2]))
except Exception:
    print("")
PY
}
csrf_page() { req GET "$1"; python3 -c "import re; m=re.search(r'name=\"csrf-token\" content=\"([^\"]+)\"', open('$LAST.body').read()); print(m.group(1) if m else '')"; }
form() { # 경로 csrf key=value…
  local path="$1" token="$2"; shift 2
  local args=(-H "Origin: $ORIGIN" --data-urlencode "_csrf=$token") kv
  for kv in "$@"; do args+=(--data-urlencode "$kv"); done
  req POST "$path" "${args[@]}"
}
api() { # 메서드 경로 [JSON]
  local method="$1" path="$2" body="${3:-}"
  local args=(-H "Origin: $ORIGIN" -H "X-CSRF-TOKEN: $T" -H "Accept: application/json")
  [ -n "$body" ] && args+=(-H "Content-Type: application/json" --data "$body")
  [ "$method" = POST ] && args+=(-H "Idempotency-Key: $(python3 -c 'import uuid; print(uuid.uuid4())')")
  req "$method" "/bff/api$path" "${args[@]}"
}
iso() { python3 -c "import datetime as d; print((d.datetime.now(d.timezone.utc)+d.timedelta(seconds=${1:-0})).replace(second=0, microsecond=0).strftime('%Y-%m-%dT%H:%M:%SZ'))"; }

# ---------------------------------------------------------------- 로그인(초기 비밀번호면 바꾼다)
say "관리자 로그인(BFF)"
# 지난 실행의 쿠키 파일을 버린다. keys.env의 세션 키가 같아 예전 세션 쿠키가 그대로 열리면 /login 이 302(이미 로그인)로 답한다
rm -f "$JAR"
T=$(csrf_page /login)
[ "$(status)" = 200 ] || die "로그인 화면 응답 $(status)"
note "로그인 화면 $WEB/login → 200"
login_as() { # 비밀번호 → 302면 성공. 막 뜬 서비스의 첫 호출이 느려 503(의존 서비스 시간 초과)이면 잠시 뒤 다시
  local i
  for i in 1 2 3 4 5 6; do
    rm -f "$JAR"; T=$(csrf_page /login)
    form /login "$T" intent=credentials loginId=$ADMIN_LOGIN "password=$1" next=/
    [ "$(status)" = 503 ] || [ "$(status)" = 504 ] || break
    sleep 5
  done
  [ "$(status)" = 302 ] && ! location | grep -q '^/login'
}
if [ $FRESH = 1 ] || ! login_as "$ADMIN_PASSWORD"; then
  login_as "$ADMIN_INITIAL_PASSWORD" || die "관리자 로그인 실패(응답 $(status)). 키와 DB가 어긋났으면: $0 reset"
  # 막 뜬 core의 첫 비밀번호 해시가 느려 503/504가 나면 잠시 뒤 다시. 시간 초과였지만 실제로 바뀌었으면 새 비밀번호로 로그인된다
  changed=0
  for i in 1 2 3; do
    T=$(csrf_page "/me/security?required=password")
    form /me/security "$T" intent=password "currentPassword=$ADMIN_INITIAL_PASSWORD" "newPassword=$ADMIN_PASSWORD" "confirmPassword=$ADMIN_PASSWORD"
    [ "$(status)" = 302 ] && { changed=1; break; }
    case "$(status)" in 503|504) ;; *) break;; esac
    sleep 10
    if login_as "$ADMIN_PASSWORD"; then changed=1; break; fi
    login_as "$ADMIN_INITIAL_PASSWORD" || break
  done
  [ $changed = 1 ] || die "초기 비밀번호 변경 실패(응답 $(status)). 서비스는 그대로 두고 다시: $0 seed"
  note "초기 비밀번호를 미리보기 비밀번호로 바꿈"
fi
T=$(csrf_page /devices)
[ "$(status)" = 200 ] || die "로그인 뒤 /devices 응답 $(status)"
note "로그인 성공(세션 쿠키), /devices → 200"

# ---------------------------------------------------------------- 견본 데이터
scenario_body() { # 이름 시작 길이(초) 시드 공간
  python3 - "$1" "$2" "$3" "$4" "$5" <<'PY'
import json, sys, datetime as d
name, start, dur, seed, space = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
t0 = d.datetime.fromisoformat(start.replace("Z", "+00:00")); t1 = t0 + d.timedelta(seconds=dur)
iso = lambda x: x.strftime("%Y-%m-%dT%H:%M:%SZ")
events = []
# 무더운 날씨(바깥 30~36℃)라 실내가 27℃를 넘어 "고온이면 냉방"이 에어컨을 켠다. 매일 09:00~18:00(KST) 수업 25명
day = t0.replace(hour=0, minute=0, second=0, microsecond=0) - d.timedelta(days=1)
while day < t1:
    a, b = max(day, t0), min(day + d.timedelta(hours=9), t1)
    if b - a >= d.timedelta(minutes=10):
        events.append({"id": "class-%s" % day.strftime("%m%d"), "track": "OCCUPANCY", "at": iso(a), "until": iso(b),
                       "target": {"spaceId": space}, "params": {"count": 25, "activity": 1.5}})
    day += d.timedelta(days=1)
# 시작이 수업 시간 밖이면 처음 2시간은 특강(30명)으로 열기를 더해 플로우가 곧 동작하는 모습을 볼 수 있게 한다
if not events or events[0]["at"] != iso(t0):
    end = min(t0 + d.timedelta(hours=2), t1)
    if events: end = min(end, d.datetime.fromisoformat(events[0]["at"].replace("Z", "+00:00")))
    if end - t0 >= d.timedelta(minutes=10):
        events.insert(0, {"id": "special", "track": "OCCUPANCY", "at": iso(t0), "until": iso(end),
                          "target": {"spaceId": space}, "params": {"count": 30, "activity": 2.0}})
print(json.dumps({"name": name, "spaceIds": [space], "simStartAt": start, "durationSec": dur, "seed": seed, "useCalendar": False,
                  "outdoor": {"mode": "DIURNAL", "diurnal": {"max": 36, "min": 30, "peakHour": 15, "humidity": 60}},
                  "events": events, "expectations": []}, ensure_ascii=False))
PY
}
start_live_run() { # 실시간(x1, 측정 시각 = 실제 시각) 7일 실행
  api POST /core/sim/scenarios "$(scenario_body "미리보기 실시간(7일)" "$(iso)" 604800 7 "$SPACE")"
  local scn; scn=$(jq_ "r.get('scenarioId') or r.get('id')")
  api POST /core/sim/runs "{\"scenarioId\":\"$scn\",\"acceleration\":1,\"timestampPolicy\":\"WALL_CLOCK\",\"seed\":7}"
  LIVE_RUN=$(jq_ "r.get('runId')")
  [ "$(status)" = 201 ] && note "실시간 시뮬레이터 실행 시작(run $LIVE_RUN, x1, 7일)" || note "실시간 실행 시작 실패(응답 $(status)): $(head -c 300 "$LAST.body")"
}

SPACE=""; FLOW=""; LIVE_RUN=""
SAMPLE_ON=1; { [ "${SAMPLE:-1}" = 0 ] || [ "$CMD" = seed-real ]; } && SAMPLE_ON=0   # seed-real은 가상 견본을 건드리지 않는다
if [ -f "$SAMPLE_ENV" ]; then
  # shellcheck disable=SC1090
  . "$SAMPLE_ENV"
fi
if [ "$SAMPLE_ON" = 1 ] && [ -z "$SPACE" ]; then
  # 견본 기록(sample.env)이 없어도 DB에 이미 있으면 다시 만들지 않는다(KEEP_DATA 재시작·seed 반복)
  SPACE=$(sql "SELECT min(id) FROM data2flow_core.spaces WHERE name = '가상 강의실 301'" || true)
  if [ -n "$SPACE" ]; then
    FLOW=$(sql "SELECT id FROM data2flow_core.flows WHERE name = '301호 고온이면 냉방' LIMIT 1" || true)
    note "견본 데이터가 이미 있음(공간 $SPACE, 플로우 ${FLOW:-없음}): 생성 생략"
    printf 'SPACE=%s\nFLOW=%s\nLIVE_RUN=\n' "$SPACE" "$FLOW" > "$SAMPLE_ENV"
  fi
fi
if [ "$SAMPLE_ON" = 1 ] && [ -z "$SPACE" ]; then
  say "견본 데이터: 가상 강의실 301(표준 키트) → \"고온이면 냉방\" 플로우"
  # 막 뜬 simulator의 첫 호출이 느려 503/504면 잠시 뒤 다시(실패한 배치는 core가 되돌린다. 그래도 공간이 생겼으면 seed로 이어 간다)
  for i in 1 2 3; do
    api POST /core/sim/kits/classroom-standard/place '{"newSpace":{"name":"가상 강의실 301","preset":"CLASSROOM"}}'
    case "$(status)" in 503|504) ;; *) break;; esac
    sleep 10
    [ -z "$(sql "SELECT 1 FROM data2flow_core.spaces WHERE name = '가상 강의실 301' LIMIT 1" || true)" ] \
      || die "키트 배치 응답이 늦었지만 공간은 생겼습니다. 서비스는 그대로 두고 다시: $0 seed"
  done
  [ "$(status)" = 201 ] || die "키트 배치 실패(응답 $(status)): $(head -c 300 "$LAST.body")"
  cp "$LAST.body" "$RUN_DIR/kit.json"
  SPACE=$(jq_ "r['spaceId']")
  note "공간 $SPACE, 기기 $(jq_ "', '.join(d['typeKey'] for d in r['devices'])")"
  BINDINGS=$(jq_ "__import__('json').dumps([f['bindings'] for f in r['suggestedFlows'] if f['templateKey']=='hot-then-cool'][0])")
  api POST /core/flow-templates/hot-then-cool/instantiate "{\"name\":\"301호 고온이면 냉방\",\"params\":$BINDINGS}"
  FLOW=$(jq_ "r.get('flowId')"); DRAFT=$(jq_ "r.get('draftVersion')")
  [ "$(status)" = 201 ] && note "플로우 $FLOW 생성(초안 v$DRAFT)" || note "플로우 생성 실패(응답 $(status))"
  printf 'SPACE=%s\nFLOW=%s\nLIVE_RUN=\n' "$SPACE" "$FLOW" > "$SAMPLE_ENV"

  if [ "${SAMPLE_BACKFILL:-1}" != 0 ]; then
    say "견본 데이터: 지난 3시간을 x60으로 채움(약 3분, 차트가 비지 않게)"
    api POST /core/sim/scenarios "$(scenario_body "미리보기 지난 3시간" "$(iso -10920)" 10800 11 "$SPACE")"
    SCN=$(jq_ "r.get('scenarioId') or r.get('id')")
    api POST /core/sim/runs "{\"scenarioId\":\"$SCN\",\"acceleration\":60,\"timestampPolicy\":\"SIMULATED\",\"seed\":11}"
    RUN=$(jq_ "r.get('runId')")
    if [ "$(status)" = 201 ]; then
      RS=""
      for i in $(seq 1 300); do
        api GET "/core/sim/runs/$RUN"; RS=$(jq_ "r.get('status')")
        case "$RS" in COMPLETED|FAILED|CANCELLED|STOPPED) break;; esac; sleep 1
      done
      note "지난 3시간 실행: $RS"
    else
      note "지난 3시간 실행 시작 실패(응답 $(status)): $(head -c 300 "$LAST.body")"
    fi
  fi

  if [ -n "$FLOW" ]; then
    api POST "/core/flows/$FLOW/validate" '{}'
    api POST "/core/flows/$FLOW/apply" "{\"version\":$DRAFT,\"baseVersion\":0,\"acknowledgedRisks\":true,\"memo\":\"로컬 미리보기 견본\"}"
    [ "$(status)" = 200 ] && note "플로우 적용(운영) → flow-engine" || note "플로우 적용 실패(응답 $(status)): $(head -c 300 "$LAST.body")"
  fi
fi
if [ "$SAMPLE_ON" = 1 ] && [ -n "$SPACE" ]; then
  RS=""
  if [ -n "$LIVE_RUN" ]; then api GET "/core/sim/runs/$LIVE_RUN"; RS=$(jq_ "r.get('status')"); fi
  if [ "$RS" = RUNNING ]; then note "실시간 시뮬레이터 실행 중(run $LIVE_RUN)"; else start_live_run; fi
  printf 'SPACE=%s\nFLOW=%s\nLIVE_RUN=%s\n' "$SPACE" "$FLOW" "$LIVE_RUN" > "$SAMPLE_ENV"
fi

# ---------------------------------------------------------------- 실제 센서(seed-real · REAL_SOURCE=1, ADR-057 보완)
ingress_real_mode() { # 떠 있는 ingress가 iot-data를 막지 않는(실제 센서) 모드인지
  pid_alive ingress && ps eww -p "$(cat "$PIDS/ingress.pid")" 2>/dev/null | tr ' ' '\n' \
    | grep -qx 'DATA2FLOW_INGRESS_DENIED_HOSTS=s3.java21.net,s4.java21.net'
}
if [ "$REAL" = 1 ]; then
  say "실제 센서 연결: 아카데미 ChirpStack(구독만) → 공간·승인·평면도·대시보드·규칙·분석·플로우·내보내기"
  skipped ingress && die "ingress 빌드가 없어 실제 센서를 받을 수 없습니다($LOGS/build-ingress.log)"
  ENV_FILE="${D2F_ENV_FILE:-$D2F_ROOT/.env}"
  grep -q '^MQTT_BASIC_AUTH=.' "$ENV_FILE" 2>/dev/null || die "$ENV_FILE 에 MQTT_BASIC_AUTH 가 없습니다(값은 출력하지 않습니다)"
  if ! ingress_real_mode; then
    # 미리보기를 실제 센서 없이 띄웠으면 ingress 하나만 실제 센서 모드로 다시 띄운다(다른 서비스는 그대로)
    note "ingress를 실제 센서 모드로 다시 시작(client-id $REAL_CLIENT_ID)"
    skip=0; [ -f "$JARS/data2flow-ingress.jar" ] && skip=1
    REAL_SOURCE=1 REAL_SOURCE_DEV="$REAL_DEV" REAL_SOURCE_ORDINAL="$REAL_ORDINAL" SKIP_BUILD=$( [ $skip = 1 ] && echo 1 || echo 0 ) \
      bash "$0" restart ingress | sed 's/^/   /' || die "ingress 다시 시작 실패: $LOGS/ingress.log"
  fi
  printf '# e2e/local-preview.sh seed-real 기록(비밀값 없음)\nREAL_DEV=%s\nREAL_ORDINAL=%s\nREAL_CLIENT_ID=%s\n' \
    "$REAL_DEV" "$REAL_ORDINAL" "$REAL_CLIENT_ID" > "$REAL_ENV.head"
  if [ -f "$REAL_ENV" ]; then grep -vE '^(#|REAL_DEV=|REAL_ORDINAL=|REAL_CLIENT_ID=)' "$REAL_ENV" >> "$REAL_ENV.head" || true; fi
  mv "$REAL_ENV.head" "$REAL_ENV"
  # 자격증명: 파이썬이 루트 .env에서 MQTT_BASIC_AUTH 한 줄만 읽어 BFF로 보낸다(출력·저장 없음). 관리자 비밀번호는 환경 변수로만 넘긴다
  D2F_WEB="$WEB" D2F_ADMIN_LOGIN="$ADMIN_LOGIN" D2F_ADMIN_PASSWORD="$ADMIN_PASSWORD" D2F_ENV_FILE="$ENV_FILE" D2F_REAL_ENV="$REAL_ENV" \
    D2F_REAL_WAIT="${REAL_SOURCE_WAIT:-240}" python3 "$SCRIPT_DIR/local-preview-real.py" || die "실제 센서 견본 실패(서비스는 그대로, 다시: $0 seed-real)"
  check_public_access
fi

# ---------------------------------------------------------------- 확인
say "확인"
# 견본 기기는 모두 가상 기기라 기본 목록에서 빠진다. 화면에서는 "가상 포함"을 켠다(/devices?virtual=true)
api GET "/core/devices?page=1&size=20&virtual=true"
DEVICES=$(jq_ "d.get('totalCount')")
note "기기 목록 API(/bff/api/core/devices?virtual=true) → $(status), 기기 ${DEVICES:-0}대"
if [ -n "$SPACE" ]; then
  TH=$(python3 -c "import json; r=json.load(open('$RUN_DIR/kit.json'))['response']; print([x['deviceId'] for x in r['devices'] if 'temp' in x['typeKey'] or x['typeKey']=='th-sensor'][0])" 2>/dev/null || echo "")
  if [ -n "$TH" ]; then
    api GET "/core/telemetry/series?deviceId=$TH&metrics=temperature&from=$(iso -14400)&to=$(iso 120)&resolution=raw&virtual=true"
    note "온도 시계열(기기 $TH, 최근 4시간) → $(status), 점 $(jq_ "sum(len(s.get('points') or []) for s in (r.get('series') or []))" ) 개"
  fi
fi
[ -f "$JARS/VERSIONS" ] && { note "빌드한 커밋:"; sed 's/^/     /' "$JARS/VERSIONS"; }

cat <<EOF

================================================================
 data2flow 로컬 미리보기가 떠 있습니다
   웹       $WEB
            견본 기기는 가상 기기입니다. 기기 목록에서 "가상 포함"을 켜세요: $WEB/devices?virtual=true
   로그인   아이디 $ADMIN_LOGIN / 비밀번호 $ADMIN_PASSWORD$( [ "${PREVIEW_AUTOFILL:-1}" != 0 ] && printf '  (로그인 폼에 미리 채워져 있음 — [로그인]만 누르면 됨)' )
   Mailpit  $MAILPIT   (초대·비밀번호 재설정 메일)
   RabbitMQ http://localhost:$RABBIT_UI   (d2f / keys.env의 RABBIT_PASSWORD)
$( [ "$REAL" = 1 ] && [ -f "$REAL_ENV" ] && printf '   실제센서 %s/dashboards/%s   (아카데미 실습실 실시간 · 구독만, client-id %s)\n' "$WEB" "$(sed -n 's/^REAL_DASHBOARD_ID=//p' "$REAL_ENV")" "$REAL_CLIENT_ID" )
   실행 중 :${STARTED# }
   건너뜀  :${FAILED:- 없음}
   로그     $LOGS
   키       $KEYS (이 컴퓨터에만, 커밋 금지)
 상태: $0 status   정지: $0 stop   초기화: $0 reset
================================================================
EOF
