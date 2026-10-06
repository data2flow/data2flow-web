#!/usr/bin/env python3
"""M5·M6 시연 확인기(e2e/m56-demo.sh 가 부른다). 브라우저처럼 BFF(세션 쿠키 + CSRF)로만 플랫폼을 부르고,
MCP는 외부 MCP 클라이언트처럼 gateway의 /mcp(MCP 호스트)에 장기 토큰으로 붙는다.

환경 변수(m56-demo.sh가 넣는다)
  D2F_MODE(fresh|preview) D2F_WEB D2F_GATEWAY D2F_MCP_HOST D2F_ADMIN_LOGIN D2F_ADMIN_PASSWORD [D2F_ADMIN_INITIAL_PASSWORD]
  D2F_MQTT_HOST D2F_MQTT_PORT D2F_MQTT_CONTAINER D2F_PG_CONTAINER D2F_WORK_DIR D2F_EXPORT_DAYS D2F_REPO_ROOT

안전: 새 벤더 메시지 발행은 로컬 버리는 Mosquitto 컨테이너 안에서 mosquitto_pub(127.0.0.1)로만 한다. 공용 브로커 주소는 쓰지 않는다.
비밀값(관리자 비밀번호·MCP 토큰)은 출력하지 않는다.
"""
import base64
import http.cookiejar
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

MODE = os.environ.get("D2F_MODE", "preview")
WEB = os.environ.get("D2F_WEB", "http://localhost:3000")
GATEWAY = os.environ.get("D2F_GATEWAY", "http://127.0.0.1:45780")
MCP_HOST = os.environ.get("D2F_MCP_HOST", "mcp.localhost")
LOGIN_ID = os.environ.get("D2F_ADMIN_LOGIN", "admin01")
MQTT_HOST = os.environ.get("D2F_MQTT_HOST", "127.0.0.1")
MQTT_PORT = int(os.environ.get("D2F_MQTT_PORT", "45718"))
MQTT_CONTAINER = os.environ.get("D2F_MQTT_CONTAINER", "d2f-preview-mqtt")
PG_CONTAINER = os.environ.get("D2F_PG_CONTAINER", "d2f-preview-pg")
WORK = os.environ.get("D2F_WORK_DIR") or "."
EXPORT_DAYS = int(os.environ.get("D2F_EXPORT_DAYS", "365"))
REPO_ROOT = os.environ.get("D2F_REPO_ROOT", "")
TAG = "[시연]"

if MQTT_HOST not in ("127.0.0.1", "localhost"):
    sys.exit("안전: 새 벤더 메시지는 로컬(127.0.0.1) 버리는 Mosquitto에만 발행합니다")

# ---------------------------------------------------------------- 결과 기록
PASS, FAIL = [], []
RESULTS = os.path.join(WORK, "results.txt")
open(RESULTS, "w").close()


def out(line):
    print(line, flush=True)
    with open(RESULTS, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def section(title):
    out(f"\n== {title}")


def info(msg):
    out(f"        {msg}")


def check(name, cond, detail=None):
    if cond:
        PASS.append(name)
        out(f"  PASS  {name}")
    else:
        FAIL.append(name)
        out(f"  FAIL  {name}")
        if detail:
            out(f"        {str(detail)[:400]}")
    return bool(cond)


# ---------------------------------------------------------------- BFF(세션 쿠키 + CSRF)
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), NoRedirect)
plain = urllib.request.build_opener(NoRedirect)
CSRF = {"token": ""}


def _open(req, op=None, timeout=90):
    try:
        r = (op or opener).open(req, timeout=timeout)
        return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)


def page(path):
    s, b, h = _open(urllib.request.Request(WEB + path))
    m = re.search(r'name="csrf-token" content="([^"]+)"', b.decode("utf-8", "replace"))
    return s, (m.group(1) if m else ""), h


def form(path, token, fields):
    data = urllib.parse.urlencode({"_csrf": token, **fields}).encode()
    return _open(urllib.request.Request(WEB + path, data=data, headers={"Origin": WEB}))


def login():
    pw = os.environ.get("D2F_ADMIN_PASSWORD", "")
    initial = os.environ.get("D2F_ADMIN_INITIAL_PASSWORD", "")
    if not pw:
        sys.exit("D2F_ADMIN_PASSWORD 가 없습니다")

    def attempt(password):
        for _ in range(6):
            jar.clear()
            _, token, _ = page("/login")
            s, _, h = form("/login", token, {"intent": "credentials", "loginId": LOGIN_ID, "password": password, "next": "/"})
            if s not in (503, 504):
                break
            time.sleep(5)
        loc = h.get("Location") or h.get("location") or ""
        return s == 302 and not loc.startswith("/login"), loc

    good, loc = attempt(pw)
    if not good and initial:
        good, loc = attempt(initial)
        if good:  # 최초 로그인: 초기 비밀번호를 바꾼다(기본 방식)
            _, token, _ = page("/me/security?required=password")
            s, _, _ = form("/me/security", token, {"intent": "password", "currentPassword": initial,
                                                   "newPassword": pw, "confirmPassword": pw})
            good = s == 302
    s, token, _ = page("/devices")
    CSRF["token"] = token
    return good and s == 200 and bool(token)


def api(method, path, body=None, raw=None, content_type="application/json", accept="application/json", timeout=90):
    """/bff/api{path} — path는 /core/... 또는 /ai/... 로 시작"""
    headers = {"Origin": WEB, "X-CSRF-TOKEN": CSRF["token"], "Accept": accept, "Accept-Language": "ko"}
    data = raw
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode()
    if data is not None:
        headers["Content-Type"] = content_type
    if method in ("POST", "PUT", "PATCH"):
        headers["Idempotency-Key"] = str(uuid.uuid4())
    s, b, h = _open(urllib.request.Request(WEB + "/bff/api" + path, data=data, headers=headers, method=method), timeout=timeout)
    if accept != "application/json":
        return s, b, h
    try:
        return s, json.loads(b.decode() or "{}"), h
    except ValueError:
        return s, {"raw": b[:300].decode("utf-8", "replace")}, h


def ok(s):
    return 200 <= s < 300


def why(r):
    if not isinstance(r, dict):
        return str(r)[:300]
    h = r.get("header") or {}
    errs = r.get("errors")
    return (f"{h.get('resultCode', '')} {h.get('resultMessage', '')}" + (f" {errs}" if errs else "") or str(r.get("raw", r)))[:400]


def resp(r):
    return (r or {}).get("response") or {}


def items(r):
    return (r or {}).get("responses") or []


def iso(dt):
    return dt.astimezone(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def now():
    return datetime.now(timezone.utc)


def poll(fn, secs, every=2.0):
    """fn()이 참 같은 값을 돌려줄 때까지(최대 secs초). 마지막 값을 돌려준다"""
    t0 = time.time()
    v = None
    while time.time() - t0 < secs:
        v = fn()
        if v:
            return v
        time.sleep(every)
    return v


def sql(q):
    r = subprocess.run(["docker", "exec", PG_CONTAINER, "psql", "-U", "data2flow", "-d", "data2flow", "-tAc", q],
                       capture_output=True, text=True)
    return r.stdout.strip()


def mqtt_pub(topic, payload):
    """로컬 버리는 Mosquitto 컨테이너 안에서 127.0.0.1로만 발행한다(공용 브로커 금지, CLAUDE.md §5)"""
    r = subprocess.run(["docker", "exec", MQTT_CONTAINER, "mosquitto_pub", "-h", "127.0.0.1", "-p", "1883", "-q", "1",
                        "-i", f"d2f-m56-vendor-{uuid.uuid4().hex[:8]}", "-t", topic, "-m", payload], capture_output=True, text=True)
    return r.returncode == 0


# ================================================================ 본문(아래에서 채운다)
def contract_summary():
    """커넥터별 계약 시험은 ingress 저장소 IT(Testcontainers)로 이미 통과했다 — 마지막 실행 기록(failsafe 보고서)만 요약한다"""
    section("5-0. 커넥터 계약 시험 요약(ingress 저장소 IT 기록, 다시 돌리지 않음)")
    import glob
    import xml.etree.ElementTree as ET
    base = os.path.join(REPO_ROOT, "data2flow-ingress")
    reports = sorted(glob.glob(os.path.join(base, "target/failsafe-reports/TEST-*ContractIT.xml")))
    sources = sorted(glob.glob(os.path.join(base, "src/test/java/**/*ContractIT.java"), recursive=True))
    if not reports:
        info(f"ingress IT 보고서가 없습니다(./mvnw verify를 돌린 적 없음). 계약 시험 소스 {len(sources)}개만 확인")
        check(f"커넥터 계약 시험 소스 {len(sources)}종 존재(M5 기록: 22종 통과)", len(sources) >= 15)
        return
    tests = failures = 0
    names = []
    for p in reports:
        r = ET.parse(p).getroot()
        tests += int(r.get("tests", 0))
        failures += int(r.get("failures", 0)) + int(r.get("errors", 0))
        names.append(os.path.basename(p)[5:-4].rsplit(".", 1)[-1].replace("ConnectorContractIT", "").replace("ContractIT", ""))
    info(f"보고서 {len(reports)}개(소스 {len(sources)}개): {', '.join(names)}")
    check(f"커넥터 계약 시험 {len(reports)}종·{tests}건 실패 0 (M5 완료 확인 기준 15종 이상)", len(reports) >= 15 and failures == 0 and tests > 0,
          f"실패·오류 {failures}건")


def year_export(device_id, metric):
    """1년치 가상 데이터를 채우고(5분 간격) 원본 CSV로 내보내 행 수를 맞춘다.
    채우기는 core-api 시험(TelemetryExportJobIT)과 같은 방식으로 로컬 DB에 직접 넣는다 — 시뮬레이터는 x60·7일 상한이라 1년(약 6일 걸림)에 맞지 않고,
    데이터 가져오기 실행(API-TSD-52)은 아직 pipeline에 없다(M5 남은 일). 기존 값과 겹치면 넣지 않는다(ON CONFLICT DO NOTHING)."""
    section(f"5-6. 1년치 데이터 CSV 내보내기(기기 {device_id}, {metric}, {EXPORT_DAYS}일 × 5분)")
    t_to = now().replace(second=0, microsecond=0) - timedelta(hours=3)          # 시연 중 들어온 값과 겹치지 않게 3시간 전까지
    t_from = now().replace(second=0, microsecond=0) - timedelta(days=EXPORT_DAYS) + timedelta(minutes=30)  # 원본 보관 365일 안쪽
    t_from = t_from - timedelta(minutes=t_from.minute % 5)
    count = int((t_to - t_from).total_seconds() // 300)
    org = sql(f"SELECT organization_id FROM data2flow_core.devices WHERE id = {int(device_id)}")
    t0 = time.time()
    # 온도: 계절(연) + 하루 주기 + 개입(30일 전 냉방 설정 변경) 뒤 1.5℃ 낮아짐 — 6단계 개입 효과 검증에 쓴다
    # CO2: 평일 09~18시(KST) 수업으로 높아지고 주말·밤에는 바깥 수준 — 6단계 "언제 붐비나"에 쓴다
    at = CTX.setdefault("interventionAt", iso(now().replace(minute=0, second=0, microsecond=0) - timedelta(days=30)))
    series = {
        "temperature": f"""round((23 + 3 * sin(2 * pi() * extract(doy FROM ts) / 365.0) + 1.5 * sin(2 * pi() * (extract(epoch FROM ts) - 21600) / 86400.0)
                          - CASE WHEN ts >= TIMESTAMPTZ '{at}' THEN 1.5 ELSE 0 END + 0.2 * sin(i * 1.7))::numeric, 2)""",
        "co2": """round((430 + CASE WHEN extract(isodow FROM ts AT TIME ZONE 'Asia/Seoul') <= 5
                                    AND extract(hour FROM ts AT TIME ZONE 'Asia/Seoul') BETWEEN 9 AND 17
                               THEN 520 + 150 * sin(pi() * (extract(hour FROM ts AT TIME ZONE 'Asia/Seoul') - 9) / 9.0) ELSE 0 END
                          + 15 * sin(i * 0.37))::numeric, 0)""",
    }
    for key, expr in series.items():
        sql(f"""INSERT INTO data2flow_pipeline.telemetry (device_id, metric_key, time, organization_id, value, quality, received_at)
                SELECT {int(device_id)}, '{key}', ts, {int(org)}, {expr}, 0, ts
                  FROM generate_series(0, {count - 1}) i,
                       LATERAL (SELECT TIMESTAMPTZ '{iso(t_from)}' + i * INTERVAL '5 minutes' AS ts) x
                ON CONFLICT DO NOTHING""")
        # 집계(1m·1h·1d)도 다시 계산하게 표시한다(pipeline이 늦은 데이터와 같은 길로 처리). 1m은 보관 90일이라 최근 60일만
        sql(f"""INSERT INTO data2flow_pipeline.agg_dirty_ranges (organization_id, level, device_id, metric_key, from_ts, to_ts, reason)
                VALUES ({int(org)}, '1m', {int(device_id)}, '{key}', '{iso(t_to - timedelta(days=60))}', '{iso(t_to)}', 'LATE'),
                       ({int(org)}, '1h', {int(device_id)}, '{key}', '{iso(t_from.replace(minute=0))}', '{iso(t_to)}', 'LATE')""")
    db_rows = int(sql(f"SELECT count(*) FROM data2flow_pipeline.telemetry WHERE device_id = {int(device_id)} AND metric_key = '{metric}' "
                      f"AND time >= '{iso(t_from)}' AND time < '{iso(t_to)}'") or 0)
    info(f"채움: {iso(t_from)} ~ {iso(t_to)} 5분 간격 {count:,}점 → 구간 안 행 {db_rows:,}개({time.time() - t0:.1f}초)")
    check(f"1년치 가상 데이터 {db_rows:,}행 준비(온도, 기대 {count:,}; CO2도 같은 수)", db_rows >= count)
    CTX.update(yearFrom=t_from, yearTo=t_to)

    body = {"query": {"series": [{"deviceId": int(device_id), "metric": metric, "label": f"{TAG} 새 벤더 센서 {metric}"}],
                      "from": iso(t_from), "to": iso(t_to), "resolution": "raw"},
            "format": "CSV", "columns": "LONG", "includeQuality": True, "tz": "Asia/Seoul"}
    s, r, _ = api("POST", "/core/exports", body)
    x = resp(r)
    job = x.get("jobId")
    check(f"내보내기 요청 {s} {x.get('mode')}(예상 {x.get('estimatedRows')}행, 작업 {job})", s in (200, 202) and job, why(r))
    if not job:
        return
    final = poll(lambda: (lambda st, rr: resp(rr) if resp(rr).get("status") in ("SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED") else None)(
        *api("GET", f"/core/exports/{job}")[:2]), 300, 3) or {}
    check(f"내보내기 작업 SUCCEEDED (rows {final.get('rows')}, {final.get('bytes')}바이트)", final.get("status") == "SUCCEEDED", final)
    url = final.get("downloadUrl") or ""
    if not url:
        return
    path = url.replace("/api/v1/", "/", 1) if url.startswith("/api/v1/") else url
    s, b, h = api("GET", path, accept="text/csv, */*", timeout=300)
    csv_path = os.path.join(WORK, f"export-{job}.csv")
    with open(csv_path, "wb") as f:
        f.write(b if isinstance(b, bytes) else b"")
    lines = b.decode("utf-8-sig", "replace").splitlines() if isinstance(b, bytes) else []
    header = lines[0] if lines else ""
    info(f"내려받음: {csv_path}({len(b) if isinstance(b, bytes) else 0:,}바이트), 머리글 {header[:120]}")
    check(f"CSV 내려받기 {s}, 데이터 행 {max(len(lines) - 1, 0):,}개 = DB 구간 행 {db_rows:,}개 = 작업 rows {final.get('rows')}",
          s == 200 and len(lines) - 1 == db_rows == int(final.get("rows") or -1))


# ================================================================ 5단계: 시나리오 4(새 벤더 MQTT 센서, 코드 배포 없이)
RUN = datetime.now().strftime("%m%d%H%M%S")
CTX = {}

# 새 벤더(VendorX) 센서 형식: 온도·습도는 10배 정수, 측정 시각은 초 단위 epoch, 배터리는 mV(우리 카탈로그에 없는 항목)
SERIAL = f"VX{RUN}-01"
TOPIC = f"vendorx/{RUN}/{SERIAL}/up"


def vendor_payload(at, t10, h10, co2, bat=3612):
    p = {"sn": SERIAL, "ts": int(at.timestamp()), "env": {"t": t10, "h": h10, "c": co2}, "fw": "1.4.2"}
    if bat is not None:
        p["bat"] = bat
    return p


DECODE_OK = """// [시연] VendorX 환경 센서 디코더 — 온도·습도는 10배 정수, ts는 초 단위 epoch
function decode(input, ctx) {
  const p = input.payload;                 // JSON이면 객체로 들어온다
  const env = p.env || {};
  const metrics = [];
  if (typeof env.t === 'number') metrics.push({ key: 'temperature', value: env.t / 10, unit: '℃' });
  if (typeof env.h === 'number') metrics.push({ key: 'humidity', value: env.h / 10, unit: '%' });
  if (typeof env.c === 'number') metrics.push({ key: 'co2', value: env.c, unit: 'ppm' });
  if (typeof p.bat === 'number') metrics.push({ key: 'vxBatteryMv', value: p.bat, unit: 'mV' });
  return { externalId: String(p.sn), measuredAt: p.ts * 1000, metrics: metrics };
}
"""
# 처음 쓴 초안: 배율을 잘못 읽었다(10이 아니라 100으로 나눔) — 시험 케이스가 배포를 막는 모습을 보인다
DECODE_BUGGY = DECODE_OK.replace("env.t / 10", "env.t / 100")


def expected_output(p):
    m = [{"key": "temperature", "value": p["env"]["t"] / 10, "unit": "℃"},
         {"key": "humidity", "value": p["env"]["h"] / 10, "unit": "%"},
         {"key": "co2", "value": p["env"]["c"], "unit": "ppm"}]
    if "bat" in p:
        m.append({"key": "vxBatteryMv", "value": p["bat"], "unit": "mV"})
    return {"externalId": p["sn"], "measuredAt": p["ts"] * 1000, "metrics": m}


def raw_messages(source_id, since):
    s, r, _ = api("GET", f"/core/ingest/raw-messages?sourceId={source_id}&from={urllib.parse.quote(iso(since))}"
                         f"&to={urllib.parse.quote(iso(now() + timedelta(minutes=5)))}&size=200")
    return items(r) if ok(s) else []


def live_tap(source_id, secs, sink):
    """실시간 메시지 보기(DSC-02.06, BFF SSE)를 secs초 동안 읽어 message 이벤트를 sink에 모은다"""
    import threading

    def run():
        req = urllib.request.Request(f"{WEB}/bff/stream/sources/{source_id}/live", headers={"Accept": "text/event-stream"})
        try:
            r = opener.open(req, timeout=secs + 5)
            t0, event = time.time(), ""
            while time.time() - t0 < secs:
                line = r.readline()
                if not line:
                    break
                line = line.decode("utf-8", "replace").rstrip("\n")
                if line.startswith("event:"):
                    event = line[6:].strip()
                elif line.startswith("data:") and event == "message":
                    try:
                        sink.append(json.loads(line[5:].strip()))
                    except ValueError:
                        pass
        except Exception as e:  # 시간 초과·연결 끊김은 정상 종료로 본다
            sink.append({"_error": str(e)}) if not sink else None
    th = threading.Thread(target=run, daemon=True)
    th.start()
    return th


def ensure_space(name, type_, parent=None, extra=None):
    def find(nodes):
        for n in nodes or []:
            if n.get("name") == name and (parent is None or str(n.get("parentId")) == str(parent)):
                return n
            f = find(n.get("children"))
            if f:
                return f
    s, r, _ = api("GET", "/core/spaces")
    n = find(r.get("response") or [])
    if n:
        return str(n["id"])
    body = {"type": type_, "name": name, **(extra or {})}
    if parent:
        body["parentId"] = str(parent)
    s, r, _ = api("POST", "/core/spaces", body)
    return str(resp(r).get("id")) if ok(s) else None


def scenario4():
    section(f"5-1. 새 소스 등록(MQTT 구독, 로컬 버리는 Mosquitto {MQTT_HOST}:{MQTT_PORT}) → 실시간 메시지 보기로 형식 확인")
    # 디코더 자리: 아직 비어 있는 DECODE 스크립트(배포 전). 메시지는 원본으로 남고 DECODE_ERROR가 된다
    s, r, _ = api("POST", "/core/scripts", {"name": f"{TAG} VendorX 디코더 {RUN}", "kind": "DECODE",
                                            "description": "시연(M5 시나리오 4): 새 벤더 MQTT 센서 형식을 코드 배포 없이 해석"})
    script = resp(r)
    sid = script.get("id")
    check(f"DECODE 스크립트 만들기 201 (id {sid}, v1 초안)", s == 201 and sid, why(r))
    if not sid:
        return
    CTX["scriptId"] = sid
    src_body = {"code": f"vendorx-{RUN}", "name": f"{TAG} VendorX MQTT {RUN}", "type": "MQTT_SUBSCRIBE",
                "connection": {"url": f"tcp://{MQTT_HOST}:{MQTT_PORT}", "auth": "NONE", "qos": 1, "keepaliveSec": 60,
                               "clientIdBase": f"d2f-vendorx-{RUN}"},  # 로컬 브로커 전용, 실행마다 고유
                "topics": [{"topic": f"vendorx/{RUN}/+/up", "qos": 1}],
                "decoderKey": "script", "decodeScriptId": str(sid), "unknownDevicePolicy": "AUTO_REGISTER", "activate": True}
    s, r, _ = api("POST", "/core/sources", src_body)
    src = resp(r)
    source_id = src.get("id")
    check(f"소스 등록 201 (id {source_id}, 디코더 script → {sid}, 토픽 vendorx/{RUN}/+/up, 코드 배포 없음)", s == 201 and source_id, why(r))
    if not source_id:
        return
    CTX["sourceId"] = source_id

    # 구독이 붙을 때까지 한 건씩 발행(QoS1이라도 구독자가 없으면 버려진다) → 원본 1건이 보이면 나머지를 보낸다
    since = now() - timedelta(minutes=1)
    tap = []
    th = live_tap(source_id, 90, tap)
    first = poll(lambda: (mqtt_pub(TOPIC, json.dumps(vendor_payload(now() - timedelta(minutes=65), 231, 455, 612)))
                          and raw_messages(source_id, since)), 120, 4)
    s, r, _ = api("GET", f"/core/sources/{source_id}")
    info(f"소스 상태 {resp(r).get('lifecycle')}/{resp(r).get('state')}, client-id {', '.join(resp(r).get('clientIds') or [])}")
    check("ingress가 새 소스를 구독해 원본을 받음(코드 배포·재시작 없이)", bool(first))
    if not first:
        return
    # 과거 1시간의 측정(5분 간격 12건): 스크립트가 아직 없어 원본만 남는다 → 나중에 재처리로 값이 채워질 대상
    past = []
    for i in range(12):
        at = now().replace(second=0, microsecond=0) - timedelta(minutes=60 - 5 * i)
        p = vendor_payload(at, 228 + i, 450 + i, 600 + 10 * i)
        past.append(p)
        mqtt_pub(TOPIC, json.dumps(p))
    rows = poll(lambda: (lambda x: x if len(x) >= 13 else None)(raw_messages(source_id, since)), 60, 2) or raw_messages(source_id, since)
    th.join(timeout=1)
    statuses = sorted({x.get("status") for x in rows})
    info(f"원본 {len(rows)}건, 상태 {statuses}")
    check(f"원본 13건 저장, 디코더 미배포라 DECODE_ERROR(원본은 보관)", len(rows) >= 13 and statuses == ["DECODE_ERROR"], statuses)
    seen = [m for m in tap if m.get("topic", "").startswith(f"vendorx/{RUN}/")]
    sample = (seen[0].get("payload") if seen else "") or ""
    info(f"실시간 보기 메시지 {len(seen)}건, 예: {str(sample)[:120]}")
    check("실시간 메시지 보기(SSE)로 새 형식 확인(sn·ts·env.t/h/c·bat)", seen and '"env"' in str(sample).replace("'", '"'), tap[:1])
    CTX.update(rawIds=[x["id"] for x in rows], past=past, since=since)

    section("5-2. DECODE 스크립트 직접 작성 → 시험 실행 → 시험 케이스")
    s, r, _ = api("PUT", f"/core/scripts/{sid}/draft", {"code": DECODE_BUGGY, "baseVersionNo": 1})
    d = resp(r)
    check(f"초안 저장(잘못된 배율) {s} v{d.get('versionNo')}, 정적 검사 ok={d.get('staticCheck', {}).get('ok')}", ok(s) and d.get("versionNo"), why(r))
    vno = d.get("versionNo") or 1
    p0 = past[0]
    case_input = {"topic": TOPIC, "payload": p0, "receivedAt": iso(now())}
    s, r, _ = api("POST", "/core/scripts/test-run", {"kind": "DECODE", "code": DECODE_OK, "input": case_input})
    t = resp(r)
    check(f"시험 실행(저장 안 함) ok={t.get('ok')} {t.get('durationMs')}ms → 출력이 기대값과 같음", ok(s) and t.get("ok") and t.get("output") == expected_output(p0),
          json.dumps(t.get("output") or t.get("error"), ensure_ascii=False))
    s, r, _ = api("POST", "/core/scripts/test-run", {"kind": "DECODE", "code": DECODE_OK, "rawMessageId": str(CTX["rawIds"][-1])})
    t = resp(r)
    check(f"실제 원본(rawMessageId {CTX['rawIds'][-1]})으로 시험 실행 ok={t.get('ok')}, externalId {(t.get('output') or {}).get('externalId')}",
          ok(s) and t.get("ok") and (t.get("output") or {}).get("externalId") == SERIAL, why(r) if not ok(s) else t.get("error"))
    p_nobat = vendor_payload(now(), 250, 400, 700, bat=None)
    cases = [("정상 메시지(배터리 포함)", case_input, expected_output(p0)),
             ("배터리 값이 없는 메시지", {"topic": TOPIC, "payload": p_nobat, "receivedAt": iso(now())}, expected_output(p_nobat))]
    made = 0
    for name, inp, exp in cases:
        s, r, _ = api("POST", f"/core/scripts/{sid}/test-cases", {"name": name, "input": inp, "expected": exp, "compareMode": "EXACT"})
        made += 1 if s == 201 else 0
    check(f"시험 케이스 {made}/2 저장(EXACT 비교)", made == 2)
    s, r, _ = api("POST", f"/core/scripts/{sid}/test-cases/run", {})
    x = resp(r)
    check(f"잘못된 초안으로 일괄 실행 → 통과 {x.get('passed')} · 실패 {x.get('failed')}(온도 배율 차이 발견)", ok(s) and x.get("failed") == 2, why(r))
    s, r, _ = api("POST", f"/core/scripts/{sid}/deploy", {"versionId": str(d.get("versionId")), "memo": f"{TAG} 잘못된 초안 배포 시도"})
    check(f"시험 실패 초안 배포 거절 {s} {(r.get('header') or {}).get('resultCode')}", s == 400 and (r.get("header") or {}).get("resultCode") == "SCRIPT_TEST_FAILED", why(r))
    s, r, _ = api("PUT", f"/core/scripts/{sid}/draft", {"code": DECODE_OK, "baseVersionNo": vno})
    d = resp(r)
    check(f"초안 고쳐 저장 {s} v{d.get('versionNo')}, 정적 검사 ok={d.get('staticCheck', {}).get('ok')}", ok(s) and (d.get("staticCheck") or {}).get("ok"), why(r))
    s, r, _ = api("POST", f"/core/scripts/{sid}/test-cases/run", {})
    x = resp(r)
    check(f"고친 초안 일괄 실행 → 통과 {x.get('passed')} · 실패 {x.get('failed')}", ok(s) and x.get("passed") == 2 and x.get("failed") == 0, why(r))

    section("5-3. 배포(코드 배포 없이 스크립트만) → 새 메시지 해석 → 미검증 측정 항목 승인 → 기기 승인")
    s, r, _ = api("PUT", f"/core/scripts/{sid}/bindings",
                  {"bindings": [{"targetType": "SOURCE", "targetId": str(source_id), "failurePolicy": "FAIL_OPEN", "enabled": True}]})
    check(f"스크립트 ↔ 소스 연결 {s}", ok(s), why(r))
    s, r, _ = api("POST", f"/core/scripts/{sid}/deploy", {"versionId": str(d.get("versionId")), "memo": f"{TAG} VendorX 디코더 첫 배포"})
    dep = resp(r)
    applied = dep.get("applied") or {}
    sug = ((dep.get("reprocessSuggestion") or {}).get("requests") or [])
    check(f"배포 {s}: 운영 v{dep.get('versionNo')}, 시험 {((dep.get('testResult') or {}).get('passed'))}건 통과, 적용 보고 {applied.get('reported')}/{applied.get('total')}, 재처리 제안 {len(sug)}건",
          ok(s) and dep.get("activeVersionId"), why(r))
    CTX["reprocess"] = sug[0] if sug else None
    # 배포가 pipeline에 반영(EVT-SCR-01 / 30초 주기)되면 새 메시지가 해석된다
    t_new = now()
    since_new = now() - timedelta(seconds=5)

    def decoded_new():
        # 같은 내용을 다시 보내면 중복(DUPLICATE)으로 걸러지므로 매번 측정 시각이 다른 새 메시지를 보낸다
        mqtt_pub(TOPIC, json.dumps(vendor_payload(now().replace(microsecond=0), 241, 470, 655)))
        return [x for x in raw_messages(source_id, since_new) if x.get("status") == "OK"]
    oks = poll(decoded_new, 90, 5)
    dev_id = (oks or [{}])[0].get("deviceId")
    check(f"배포 뒤 새 메시지 → 해석 OK(측정 {((oks or [{}])[0]).get('metricCount')}개), 기기 자동 등록(id {dev_id})", bool(oks) and dev_id)
    if not dev_id:
        return
    CTX["deviceId"] = str(dev_id)
    s, r, _ = api("GET", "/core/metrics?key=vxBatteryMv&size=10")
    known = next((m for m in items(r) if m.get("key") == "vxBatteryMv"), {})
    unv = [known] if known.get("status") == "UNVERIFIED" else []
    if known.get("status") == "VERIFIED":   # 같은 조직에서 다시 돌린 경우(측정 항목 카탈로그는 조직 단위)
        check("측정 항목 vxBatteryMv는 이전 시연에서 이미 승인됨(VERIFIED)", True)
    else:
        check(f"미검증 측정 항목 발견: vxBatteryMv(상태 {known.get('status')}, 첫 발견 {known.get('firstSeen')})", bool(unv), items(r)[:3])
    if unv:
        s, r, _ = api("POST", f"/core/metrics/{unv[0]['id']}/verify", {"displayName": "VendorX 배터리 전압", "unit": "mV", "valueType": "NUMBER",
                                                                        "aggDefault": "LAST", "precision": 0})
        check(f"미검증 항목 승인(표준으로 등록) {s} → {resp(r).get('status')}", ok(s) and resp(r).get("status") == "VERIFIED", why(r))
    site = ensure_space(f"{TAG} 시연 건물", "SITE", None, {"timezone": "Asia/Seoul"})
    room = ensure_space(f"{TAG} 새 벤더 시험실", "ROOM", site, {"usage": "LAB"})
    s, r, _ = api("GET", "/core/device-models?size=100")
    model = next((m for m in items(r) if m.get("code") == "AM103"), (items(r) or [{}])[0])
    s, r, _ = api("GET", f"/core/devices/{dev_id}")
    s2, r2, _ = api("POST", "/core/devices/approve", {"items": [{"deviceId": str(dev_id), "baseVersion": resp(r).get("version", 0)}],
                                                      "modelId": str(model.get("id")), "spaceId": room, "name": f"{TAG} VendorX 환경 센서 {SERIAL}"})
    res = (resp(r2).get("results") or [{}])[0]
    check(f"기기 승인 {s2}: 모델 {model.get('code')}, 공간 {TAG} 새 벤더 시험실(id {room})", ok(s2) and res.get("ok"), why(r2) if not ok(s2) else res)
    CTX["roomId"] = room

    section("5-4. 과거 원본 재처리(새 스크립트로) → 값이 채워짐")
    t_from = since - timedelta(minutes=1)
    body = dict(CTX["reprocess"] or {}) or {"sourceId": str(source_id), "from": iso(t_from), "to": iso(now())}
    body.update({"sourceId": str(source_id), "from": iso(t_from), "to": iso(now() + timedelta(minutes=1)),
                 "memo": f"{TAG} VendorX 디코더 배포 전 원본 재처리"})
    body.pop("deviceIds", None)  # 배포 전 원본은 기기 식별 전이라 기기로 거르지 않는다
    s, r, _ = api("POST", "/core/ingest/reprocess-jobs", body)
    job = resp(r).get("jobId")
    check(f"재처리 요청 {s} (작업 {job}, 대상 {resp(r).get('total')}건)", s == 202 and job, why(r))
    final = {}
    if job:
        final = poll(lambda: (lambda x: x if x.get("status") in ("COMPLETED", "FAILED", "CANCELLED") else None)(
            resp(api("GET", f"/core/ingest/reprocess-jobs/{job}")[1])), 180, 3) or {}
    check(f"재처리 COMPLETED (처리 {final.get('processed')} · 실패 {final.get('failed')} · 건너뜀 {final.get('skipped')})",
          final.get("status") == "COMPLETED" and not final.get("failed"), final)
    q = (f"/core/telemetry/raw-points?deviceId={dev_id}&metric=temperature&from={urllib.parse.quote(iso(now() - timedelta(hours=2)))}"
         f"&to={urllib.parse.quote(iso(now() + timedelta(minutes=1)))}&quality=all&size=200")
    s, r, _ = api("GET", q)
    pts = items(r) or (resp(r).get("points") if isinstance(resp(r), dict) else []) or []
    want = {round(p["env"]["t"] / 10, 1) for p in past}
    got = {round(float(x.get("value")), 1) for x in pts if x.get("value") is not None}
    info(f"온도 점 {len(pts)}개(과거 12건 기대값 {sorted(want)[:3]}…{sorted(want)[-1]})")
    check(f"과거 원본 12건의 온도가 새 스크립트 값으로 채워짐({len(want & got)}/12)", want <= got, f"얻은 값 {sorted(got)[:15]}")
    rows = raw_messages(source_id, since)
    statuses = {}
    for x in rows:
        statuses[x.get("status")] = statuses.get(x.get("status"), 0) + 1
    check(f"원본 상태가 OK로 바뀜 {statuses}", statuses.get("OK", 0) >= 13 and not statuses.get("DECODE_ERROR"), statuses)
    s, r, _ = api("GET", f"/core/telemetry/latest?deviceIds={dev_id}")
    lat = {m.get("key"): m.get("value") for d in (items(r) or resp(r) or []) if isinstance(d, dict) for m in (d.get("metrics") or [])}
    info(f"현재값: {lat}")
    check("현재값에 temperature·humidity·co2·vxBatteryMv", {"temperature", "humidity", "co2", "vxBatteryMv"} <= set(lat), lat)


# ================================================================ 6단계: 시나리오 5의 1·2·4단계, 시나리오 4의 AI 초안, MCP
AI_ORIG = {}


def ai_fake_on():
    section("6-0. AI 제공자: 실제 LLM 키 없음 → 가짜 제공자 FAKE(결정적, 데이터 구획의 숫자만 인용)로 켠다(ADR-040)")
    s, r, _ = api("GET", "/ai/settings")
    cur = resp(r)
    provs = {p.get("provider"): p for p in (cur.get("providers") or [])}
    info(f"현재 제공자 {cur.get('provider')}/{cur.get('model')}, ANTHROPIC 사용 가능={provs.get('ANTHROPIC', {}).get('available')} (키 없음)")
    check(f"AI 설정 조회 {s}, FAKE 허용={provs.get('FAKE', {}).get('allowed')}·사용 가능={provs.get('FAKE', {}).get('available')}",
          ok(s) and provs.get("FAKE", {}).get("allowed") and provs.get("FAKE", {}).get("available"), cur)
    if cur.get("provider") == "FAKE":
        info("이미 FAKE입니다")
        return True
    AI_ORIG.update(cur)
    # BR-AIA-10: 모델을 바꾸려면 그 모델의 평가(해설 50 + 인젝션 84)가 기준 이상이어야 한다 → FAKE로 평가부터
    s, r, _ = api("POST", "/ai/evals/runs", {"model": "fake-demo", "provider": "FAKE"})
    run_id = resp(r).get("runId")
    check(f"FAKE 평가 실행 요청 {s} (run {run_id})", ok(s) and run_id, why(r))
    ev = poll(lambda: next((x for x in items(api("GET", "/ai/evals/runs?size=20")[1])
                            if x.get("runId") == run_id and x.get("accuracy") is not None), None), 180, 3) or {}
    check(f"FAKE 평가 끝: 정확도 {ev.get('accuracy')}, 숫자 일치 {ev.get('numberMatchRate')}, 인젝션 차단 {ev.get('injectionBlockRate')}, 통과={ev.get('passed')}",
          ev.get("passed"), ev)
    body = {k: cur.get(k) for k in ("enabled", "embeddingModel", "dailyRequestLimit", "dailyTokenLimit", "perUserDailyLimit",
                                    "logRetentionDays", "autoCommentary", "evalThreshold", "suggestionTtlMinutes")}
    body.update(enabled=True, provider="FAKE", model="fake-demo", baseVersion=cur.get("version", 0))
    s, r, _ = api("PUT", "/ai/settings", body)
    check(f"조직 AI 제공자 FAKE로 전환 {s} → {resp(r).get('provider')}/{resp(r).get('model')}", ok(s) and resp(r).get("provider") == "FAKE", why(r))
    return ok(s)


def ai_restore():
    if not AI_ORIG:
        return
    s, r, _ = api("GET", "/ai/settings")
    cur = resp(r)
    body = {k: AI_ORIG.get(k) for k in ("enabled", "provider", "model", "embeddingModel", "dailyRequestLimit", "dailyTokenLimit",
                                        "perUserDailyLimit", "logRetentionDays", "autoCommentary", "evalThreshold", "suggestionTtlMinutes")}
    body["baseVersion"] = cur.get("version")
    s, r, _ = api("PUT", "/ai/settings", body)
    info(f"AI 제공자 되돌림: {resp(r).get('provider') if ok(s) else f'실패 {s} {why(r)}'}")
    if ok(s) and resp(r).get("provider") == "NONE" and CTX.get("heatRid"):
        s, b, h = api("POST", "/ai/commentaries", {"subjectType": "ANALYSIS_RUN", "subjectId": str(CTX["heatRid"]), "regenerate": True},
                      accept="text/event-stream")
        try:
            code = json.loads(b.decode()).get("header", {}).get("resultCode")
        except ValueError:
            code = None
        check(f"키 없는 제공자(NONE)에서 해설 다시 만들기 → {s} {code}(JSON, 화면이 \"AI 사용 불가\"로 표시)",
              s == 503 and code == "AI_PROVIDER_UNAVAILABLE", b[:200])


# 해상도 RAW: 시연이 방금 넣은 1년치 값은 집계(1m·1h)가 pipeline에서 다시 계산되는 중일 수 있어 원본으로 읽는다
def run_analysis(name, key, bindings, period, params, label):
    s, r, _ = api("POST", f"/core/analytics/templates/{key}/check",
                  {"bindings": bindings, "period": period, "params": params, "resolution": "RAW"})
    c = resp(r)
    st = c.get("stats") or {}
    check(f"{label} 충분성 {c.get('level')} (점 {st.get('points')}, 결측 {st.get('missingRate')}, 해상도 {st.get('effectiveResolution')})",
          ok(s) and c.get("level") in ("OK", "WARN"), why(r) if not ok(s) else c.get("issues"))
    s, r, _ = api("POST", "/core/analytics/analyses", {"name": name, "templateKey": key, "bindings": bindings, "period": period,
                                                       "params": params, "resolution": "RAW"})
    aid = resp(r).get("analysisId")
    check(f"{label} 분석 만들기 {s} (id {aid})", s == 201 and aid, why(r))
    if not aid:
        return None, None, {}
    s, r, _ = api("POST", f"/core/analytics/analyses/{aid}/runs", {"acknowledgeWarnings": True})
    rid = resp(r).get("runId")
    check(f"{label} 실행 요청 {s} (run {rid}, {resp(r).get('status')})", s == 202 and rid, why(r))
    if not rid:
        return aid, None, {}
    done = poll(lambda: (lambda x: x if (x.get("run") or {}).get("status") in ("SUCCEEDED", "FAILED", "TIMEOUT", "CANCELLED") else None)(
        resp(api("GET", f"/core/analytics/analyses/{aid}/runs/{rid}")[1])), 300, 3) or {}
    run = done.get("run") or {}
    check(f"{label} 실행 {run.get('status')}", run.get("status") == "SUCCEEDED", f"{run.get('errorCode')} {run.get('errorMessage')}")
    return aid, rid, done.get("result") or {}


def find_matrices(o, out=None):
    """결과 차트에서 7×24 행렬(값·표본 수·표준편차)을 모두 찾는다"""
    out = [] if out is None else out
    if isinstance(o, list) and len(o) == 7 and all(isinstance(r, list) and len(r) == 24 for r in o):
        out.append(o)
        return out
    for v in (o.values() if isinstance(o, dict) else o if isinstance(o, list) else []):
        find_matrices(v, out)
    return out


def find_matrix(o):
    """평균 값 행렬 = 7×24 행렬 중 최댓값이 가장 큰 것(표본 수·표준편차 행렬보다 CO2 평균이 훨씬 크다)"""
    ms = find_matrices(o)
    num = lambda m: max((v for row in m for v in row if isinstance(v, (int, float))), default=float("-inf"))
    return max(ms, key=num) if ms else None


def commentary(rid, aid):
    """AI 해설(AIA-01.01): SSE(delta → verification → done)를 끝까지 읽는다"""
    s, b, h = api("POST", "/ai/commentaries", {"subjectType": "ANALYSIS_RUN", "subjectId": str(rid), "analysisId": str(aid), "regenerate": False},
                  accept="text/event-stream", timeout=120)
    text, ver, done, event = [], {}, {}, ""
    for line in (b.decode("utf-8", "replace") if isinstance(b, bytes) else "").splitlines():
        if line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            try:
                d = json.loads(line[5:].strip())
            except ValueError:
                continue
            if event == "delta":
                text.append(d.get("text", ""))
            elif event == "verification":
                ver = d
            elif event == "done":
                done = d
    return s, "".join(text), ver, done, b


def scenario5():
    dev = CTX.get("deviceId")
    if not dev:
        check("6단계 준비: 5단계의 새 벤더 기기가 필요합니다", False)
        return
    fake = ai_fake_on()

    section("6-1. 질문으로 템플릿 찾기(\"언제 붐비나\") → 역할에 데이터 연결")
    s, r, _ = api("GET", "/core/analytics/templates?keyword=" + urllib.parse.quote("언제 붐비나") + "&size=10")
    found = items(r)
    top = found[0] if found else {}
    info("검색 결과: " + ", ".join(f"{x.get('key')}({x.get('score')})" for x in found[:5]))
    check(f"질문 검색 1위 = {top.get('key')} (일치 질문 \"{top.get('matchedQuestion')}\")", ok(s) and top.get("key") == "pattern-heatmap", why(r))
    s, r, _ = api("GET", "/core/analytics/templates/pattern-heatmap")
    g = resp(r).get("guide") or {}
    check(f"템플릿 설명서 {s}: {resp(r).get('name')} — 언제 쓰나 {len(g.get('whenToUse') or [])}개", ok(s) and resp(r).get("name"), why(r))
    s, r, _ = api("GET", f"/core/analytics/templates/pattern-heatmap/roles/target/candidates?spaceId={CTX.get('roomId')}&kind=DEVICE_METRIC&keyword=co2")
    cand = [x for x in items(r) if str(x.get("deviceId")) == str(dev) and x.get("metricKey") == "co2"]
    check(f"역할 'target' 후보에 {TAG} VendorX 센서 co2 ({len(items(r))}개 중)", bool(cand), why(r) if not ok(s) else items(r)[:3])

    section("6-2. 실행(1년치 가상 데이터 중 최근 4주) → 결과 → AI 해설 → 현황판 고정")
    bind = [{"role": "target", "sources": [{"kind": "DEVICE_METRIC", "deviceId": str(dev), "metricKey": "co2"}]}]
    yt = CTX.get("yearTo") or now()
    period = {"type": "FIXED", "from": iso(yt - timedelta(days=28)), "to": iso(yt)}
    aid, rid, res = run_analysis(f"{TAG} 언제 붐비나 — VendorX CO2 {RUN}", "pattern-heatmap", bind, period, {"aggregation": "MEAN"}, "시간 패턴")
    if res:
        info(f"요약: {(res.get('summary') or {}).get('headline')}")
        m = find_matrix(res.get("charts"))
        if m:
            best = max(((d, h, v) for d, row in enumerate(m) for h, v in enumerate(row) if isinstance(v, (int, float))), key=lambda x: x[2])
            info(f"가장 붐비는 칸: 요일 {'월화수목금토일'[best[0]]} {best[1]}시(KST) 평균 {best[2]:.0f}ppm")
            check("붐비는 시간 = 평일 09~17시(넣은 수업 패턴과 같음)", best[0] < 5 and 9 <= best[1] <= 17, best)
        else:
            check("결과에 요일×시간 히트맵", False, list((res.get("charts") or [{}])[0].keys()) if res.get("charts") else res.keys())
    CTX.update(heatAid=aid, heatRid=rid)
    if rid and fake:
        s, text, ver, done, raw = commentary(rid, aid)
        info(f"해설({len(text)}자): {text[:160].replace(chr(10), ' ')}…")
        check(f"AI 해설 {s} 모델 {done.get('model')}, 숫자 검증 {ver.get('status')}(\"숫자 확인됨\"), 불일치 {len(ver.get('mismatches') or [])}건",
              s == 200 and ver.get("status") == "VERIFIED" and done.get("model") == "fake-demo", raw[:300] if isinstance(raw, bytes) else raw)
        s, r, _ = api("GET", f"/ai/commentaries?subjectType=ANALYSIS_RUN&subjectId={rid}")
        st = (items(r) or [{}])[0].get("status")
        check(f"해설 다시 불러오기 {s}: 상태 {st}", ok(s) and st == "VERIFIED", why(r))
    s, r, _ = api("POST", "/core/dashboards", {"name": f"{TAG} 분석 현황판 {RUN}", "visibility": "PRIVATE", "refresh": "OFF"})
    board = resp(r).get("id")
    check(f"현황판 만들기 {s} (id {board})", s == 201 and board, why(r))
    if board and aid:
        s, r, _ = api("POST", f"/core/dashboards/{board}/widgets/pin-analysis", {"analysisId": str(aid)})
        check(f"분석 결과를 현황판에 고정 {s} (위젯 {resp(r).get('widgetId')})", ok(s) and resp(r).get("widgetId"), why(r))
        s, r, _ = api("GET", f"/core/dashboards/{board}")
        ws = json.dumps(resp(r), ensure_ascii=False)
        check(f"현황판 조회 {s}: 분석 위젯 포함", ok(s) and f"analysis-{aid}" in ws, ws[:300])
        st, _, _ = page(f"/dashboards/{board}")
        check(f"현황판 화면 /dashboards/{board} → {st}", st == 200)
        CTX["boardId"] = board

    section("6-3. 개입 효과 검증(ANA-09.01): 30일 전 냉방 설정 변경 전후 온도")
    at = CTX.get("interventionAt")
    bind = [{"role": "target", "sources": [{"kind": "DEVICE_METRIC", "deviceId": str(dev), "metricKey": "temperature"}]}]
    period = {"type": "FIXED", "from": iso(yt - timedelta(days=58)), "to": iso(yt)}
    aid2, rid2, res2 = run_analysis(f"{TAG} 냉방 설정 변경 효과 — VendorX 온도 {RUN}", "intervention-impact", bind, period,
                                    {"interventionAt": at, "minDaysEachSide": 7, "bootstrap": 500}, "개입 효과")
    if res2:
        ms = {m.get("key"): m.get("value") for m in ((res2.get("summary") or {}).get("metrics") or [])}
        info(f"요약: {(res2.get('summary') or {}).get('headline')} / 지표 {ms}")
        eff = ms.get("effect")
        # 템플릿의 효과는 상대 변화(비율). 넣은 -1.5℃에 계절 추세가 조금 섞이므로, DB의 개입 전후 평균 변화율과 견준다(±2%p)
        q = (f"SELECT avg(value) FILTER (WHERE time < '{at}'), avg(value) FILTER (WHERE time >= '{at}') FROM data2flow_pipeline.telemetry "
             f"WHERE device_id = {int(dev)} AND metric_key = 'temperature' AND time >= '{period['from']}' AND time < '{period['to']}'")
        b4, af = (float(x) for x in (sql(q) or "nan|nan").split("|"))
        want = (af - b4) / b4
        info(f"DB 평균: 개입 전 {b4:.2f}℃ → 후 {af:.2f}℃ ({want:+.1%}, 넣은 변화 -1.5℃ = {-1.5 / b4:+.1%})")
        ok_eff = isinstance(eff, (int, float)) and abs(eff - want) <= 0.02 and ms.get("verdict") == "DECREASE"
        check(f"효과 {eff:+.1%} (95% 구간 {ms.get('ciLow'):+.1%}~{ms.get('ciHigh'):+.1%}), 판정 {ms.get('verdict')} — DB 전후 변화 {want:+.1%} ±2%p"
              if isinstance(eff, (int, float)) else f"효과 {eff}", ok_eff, ms)
        CTX.update(effAid=aid2, effRid=rid2)

    section("6-4. 시나리오 4의 AI 스크립트 초안(가짜 제공자 FAKE, 저장·배포 안 함)")
    if fake:
        raw_id = (CTX.get("rawIds") or [None])[-1]
        s, r, _ = api("POST", "/core/scripts/ai-draft", {"kind": "DECODE", "requirement": "VendorX 센서: env.t·env.h는 10배 정수, sn이 기기 ID",
                                                          "sampleRawMessageIds": [str(raw_id)] if raw_id else []})
        code = resp(r).get("code") or ""
        check(f"AI 초안 {s}: decode 함수 {len(code)}자, 설명 \"{(resp(r).get('explanation') or '')[:40]}\"", ok(s) and "function decode" in code, why(r))
        sc, tr = resp(r).get("staticCheck") or {}, resp(r).get("testRun") or {}
        check(f"초안에 정적 검사(ok={sc.get('ok')})와 샘플 원본 시험 실행(ok={tr.get('ok')}, externalId {(tr.get('output') or {}).get('externalId')})이 붙음",
              ok(s) and "ok" in sc and "ok" in tr, {"staticCheck": sc, "testRun": str(tr)[:200]})
        if code:
            s, r, _ = api("POST", "/core/scripts/test-run", {"kind": "DECODE", "code": code,
                                                             "input": {"topic": TOPIC, "payload": CTX["past"][0], "receivedAt": iso(now())}})
            t = resp(r)
            info(f"초안 시험 실행 출력: {json.dumps(t.get('output'), ensure_ascii=False)[:200]}")
            check(f"AI 초안을 그대로 시험 실행 ok={t.get('ok')}(사람이 검토·수정 후 배포 — 초안은 저장되지 않음)", ok(s) and t.get("ok") is not None, why(r))
    else:
        check("AI 초안: FAKE 제공자를 켜지 못해 건너뜀", False)


# ---------------------------------------------------------------- MCP(외부 MCP 클라이언트처럼)
def mcp_call(token, method, params=None, rid=1):
    body = {"jsonrpc": "2.0", "method": method}
    if rid is not None:          # 알림(notifications/*)에는 id가 없다
        body["id"] = rid
    if params is not None:
        body["params"] = params
    req = urllib.request.Request(GATEWAY + "/mcp", data=json.dumps(body).encode(), method="POST",
                                 headers={"Host": MCP_HOST, "Authorization": "Bearer " + token, "Content-Type": "application/json",
                                          "Accept": "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18"})
    s, b, h = _open(req, op=plain, timeout=60)
    text = b.decode("utf-8", "replace")
    ctype = (h.get("Content-Type") or h.get("content-type") or "")
    if "event-stream" in ctype:  # SSE로 답하면 마지막 data 줄
        data = [l[5:].strip() for l in text.splitlines() if l.startswith("data:")]
        text = data[-1] if data else "{}"
    try:
        return s, json.loads(text or "{}"), ctype
    except ValueError:
        return s, {"raw": text[:300]}, ctype


def mcp():
    section("6-5. MCP: 장기 열쇠(MCP 토큰) 발급 → /mcp 읽기 도구 호출 → 범위 밖 도구는 목록에 없음")
    exp = iso(now() + timedelta(days=1))
    tokens = {}
    for label, scopes in (("기기만", ["read:devices"]), ("읽기 전체", ["read:devices", "read:telemetry", "read:analytics"])):
        s, r, h = api("POST", "/core/api-tokens", {"kind": "MCP", "name": f"{TAG} MCP {label} {RUN}", "scopes": scopes, "expiresAt": exp})
        x = resp(r)
        tok = x.get("token") or ""
        check(f"MCP 토큰 발급({label}: {', '.join(scopes)}) {s} {x.get('status')}, 접두사 {x.get('prefix')}(비밀값은 한 번만 보이고 출력하지 않음)",
              s == 201 and tok.startswith("data2flow_") and x.get("status") == "ACTIVE", why(r))
        tokens[label] = (x.get("id"), tok)
    tid, tok = tokens.get("기기만", (None, ""))
    if tok:
        s, r, ct = mcp_call(tok, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                                "clientInfo": {"name": "d2f-m56-demo", "version": "1.0"}})
        si = (r.get("result") or {}).get("serverInfo") or {}
        check(f"initialize {s}: 서버 {si.get('name')} {si.get('version')}, 프로토콜 {(r.get('result') or {}).get('protocolVersion')}", s == 200 and r.get("result"), r)
        mcp_call(tok, "notifications/initialized", None, None)
        s, r, ct = mcp_call(tok, "tools/list", {}, 2)
        names = sorted(t.get("name") for t in ((r.get("result") or {}).get("tools") or []))
        info(f"도구 목록({ct.split(';')[0]}): {names}")
        want = {"list_spaces", "get_space", "list_devices", "get_device", "list_flows", "get_flow_status"}
        check(f"read:devices 토큰의 도구 {len(names)}개 = 기기·공간·플로우 6개", set(names) == want, names)
        check("범위 밖 도구(query_telemetry·list_alarms·get_analysis_result 등)는 목록에 없음",
              not ({"query_telemetry", "aggregate_telemetry", "list_alarms", "list_analysis_templates", "get_analysis_result"} & set(names)))
        s, r, _ = mcp_call(tok, "tools/call", {"name": "list_devices", "arguments": {"q": SERIAL, "size": 10}}, 3)
        res = r.get("result") or {}
        body = "".join(c.get("text", "") for c in (res.get("content") or []) if c.get("type") == "text")
        check(f"tools/call list_devices(q={SERIAL}) {s}: isError={res.get('isError')}, {TAG} VendorX 센서 포함",
              s == 200 and not res.get("isError") and SERIAL.lower() in body.lower() and '"totalCount":0' not in body.replace(" ", ""), body[:300] or r)
        s, r, _ = mcp_call(tok, "tools/call", {"name": "query_telemetry", "arguments": {"deviceId": str(CTX.get("deviceId", 1)), "metric": "co2",
                                                                                          "from": iso(now() - timedelta(hours=2)), "to": iso(now())}}, 4)
        res = r.get("result") or {}
        txt = "".join(c.get("text", "") for c in (res.get("content") or []) if c.get("type") == "text")
        check(f"범위 밖 도구를 이름으로 불러도 거절(isError={res.get('isError')}: {txt[:40]})", res.get("isError") is True or "error" in r, r)
        s, r, _ = mcp_call("data2flow_invalid0000000000000000", "tools/list", {}, 5)
        check(f"틀린 토큰 → {s}", s in (401, 403), r)
    tid2, tok2 = tokens.get("읽기 전체", (None, ""))
    if tok2:
        s, r, _ = mcp_call(tok2, "tools/list", {}, 6)
        names = sorted(t.get("name") for t in ((r.get("result") or {}).get("tools") or []))
        check(f"읽기 전체 토큰의 도구 {len(names)}개(읽기 도구 11개)", len(names) == 11, names)
        dev = CTX.get("deviceId")
        if dev:
            s, r, _ = mcp_call(tok2, "tools/call", {"name": "query_telemetry", "arguments": {
                "deviceId": str(dev), "metric": "temperature", "from": iso(now() - timedelta(hours=2)), "to": iso(now())}}, 7)
            res = r.get("result") or {}
            txt = "".join(c.get("text", "") for c in (res.get("content") or []) if c.get("type") == "text")
            check(f"query_telemetry(VendorX 온도, 최근 2시간) isError={res.get('isError')}, 재처리로 채운 값 포함", s == 200 and not res.get("isError")
                  and str(CTX["past"][0]["env"]["t"] / 10) in txt, txt[:300] or r)
        if CTX.get("effAid") and CTX.get("effRid"):
            s, r, _ = mcp_call(tok2, "tools/call", {"name": "get_analysis_result", "arguments": {
                "analysisId": str(CTX["effAid"]), "runId": str(CTX["effRid"])}}, 8)
            res = r.get("result") or {}
            txt = "".join(c.get("text", "") for c in (res.get("content") or []) if c.get("type") == "text")
            check(f"get_analysis_result(개입 효과) isError={res.get('isError')}", s == 200 and not res.get("isError") and "effect" in txt, txt[:300] or r)
    # 시연이 끝나면 장기 열쇠는 폐기한다
    for label, (tid_, _) in tokens.items():
        if tid_:
            s, r, _ = api("DELETE", f"/core/api-tokens/{tid_}")
            info(f"토큰 폐기({label}) {s}")


# ================================================================ 실행
def main():
    out(f"M5·M6 시연 확인 — 방식 {MODE}, 웹 {WEB}, 실행 표시 {RUN}, 기록 {RESULTS}")
    out("※ LLM 실제 키 없음: AI 해설·스크립트 초안은 가짜 제공자 FAKE로 확인합니다(ADR-040)")
    section("0. 관리자 로그인(BFF 세션 쿠키 + CSRF)")
    if not check(f"{LOGIN_ID} 로그인 → /devices 200", login()):
        return finish()
    try:
        contract_summary()
        scenario4()
        if CTX.get("deviceId"):
            year_export(CTX["deviceId"], "temperature")
        scenario5()
        mcp()
    finally:
        ai_restore()
    return finish()


def finish():
    out(f"\n== 결과: 통과 {len(PASS)} · 실패 {len(FAIL)}")
    for f in FAIL:
        out(f"  실패: {f}")
    if CTX:
        keep = {k: (v if not isinstance(v, datetime) else iso(v)) for k, v in CTX.items() if k not in ("past", "rawIds")}
        out(f"   만든 것({TAG}): {json.dumps(keep, ensure_ascii=False)}")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
