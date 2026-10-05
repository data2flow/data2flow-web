#!/usr/bin/env python3
"""로컬 미리보기에 실제 아카데미 센서를 연결하고 견본을 만든다(e2e/local-preview.sh seed-real 이 부른다. ADR-057 보완).

하는 일(모두 멱등 — 이름·코드로 찾아 이미 있으면 다시 만들지 않는다. 만든 ID는 real.env에 남긴다):
  1. 데이터 소스 academy-chirpstack(MQTT 구독, ChirpStack v4 디코더) 등록. 자격증명은 루트 .env의 MQTT_BASIC_AUTH 한 줄만 읽어
     BFF로 보낸다(core가 암호화 저장). 출력·파일 저장은 하지 않는다
  2. 첫 수신(승인 대기 기기) 대기
  3. 공간 "아카데미"(SITE) 아래 센서 태그 location(기본 "실습실")별 ROOM을 만들고, 기기 이름 앞부분으로 모델을 맞춰 승인한다.
     이름 뒤에 센서 태그의 위치(spot)를 붙인다
  4. 실습실 평면도(스크립트 없는 SVG)와 센서 마커
  5. 대시보드 "아카데미 실습실 실시간"
  6. 규칙 3개(CO2·고온 → 주의, 소음 → 정보). 알림 정책을 붙이지 않아 화면 알람만 생긴다
  7. 분석 4개(CO2 도달 예측·쾌적도·센서 건강·재실 추정) — 충분성 검사 결과를 남기고 일정 실행으로 걸어 둔다
  8. 플로우 "실습실 CO2 높으면 가상 환기" — 실습실 실제 CO2 센서 → 가상 강의실 301의 **가상** 환기 장치(실제 기기 제어 없음)
  9. 데이터 내보내기 1건(최근 1시간 실습실 온도·CO2 CSV)

안전: 공용 브로커에는 구독만 한다(ingress가 발행하지 않는다). 실제 센서에는 제어 대상(드라이버)을 붙이지 않는다.
환경 변수: D2F_WEB, D2F_ADMIN_LOGIN, D2F_ADMIN_PASSWORD, D2F_ENV_FILE, D2F_REAL_ENV, D2F_REAL_WAIT(초, 기본 240)
"""
import http.cookiejar
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

WEB = os.environ.get("D2F_WEB", "http://localhost:3000")
ENV_FILE = os.environ.get("D2F_ENV_FILE", "")
REAL_ENV = os.environ.get("D2F_REAL_ENV", os.path.expanduser("~/.data2flow-preview/real.env"))
WAIT = int(os.environ.get("D2F_REAL_WAIT", "240"))

SOURCE_CODE = "academy-chirpstack"
SITE_NAME = "아카데미"
DEFAULT_ROOM = "실습실"
DASHBOARD_NAME = "아카데미 실습실 실시간"
FLOW_NAME = "실습실 CO2 높으면 가상 환기"


def note(msg):
    print("   " + msg, flush=True)


# ---------------------------------------------------------------- BFF(세션 쿠키 + CSRF)
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), NoRedirect)
CSRF = {"token": ""}


def _open(req):
    try:
        r = opener.open(req, timeout=60)
        return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def page_csrf(path):
    s, b = _open(urllib.request.Request(WEB + path))
    m = re.search(r'name="csrf-token" content="([^"]+)"', b.decode("utf-8", "replace"))
    return m.group(1) if m else ""


def login():
    password = os.environ.get("D2F_ADMIN_PASSWORD", "")
    if not password:
        sys.exit("D2F_ADMIN_PASSWORD 가 없습니다")
    for _ in range(6):
        token = page_csrf("/login")
        data = urllib.parse.urlencode({"_csrf": token, "intent": "credentials", "loginId": os.environ.get("D2F_ADMIN_LOGIN", "admin01"),
                                       "password": password, "next": "/"}).encode()
        s, _ = _open(urllib.request.Request(WEB + "/login", data=data, headers={"Origin": WEB}))
        if s not in (503, 504):
            break
        time.sleep(5)
    CSRF["token"] = page_csrf("/devices")
    if not CSRF["token"]:
        sys.exit("로그인 실패(BFF 세션을 열지 못했습니다)")


def api(method, path, body=None, idem=None, raw=None, content_type="application/json"):
    headers = {"Origin": WEB, "X-CSRF-TOKEN": CSRF["token"], "Accept": "application/json", "Accept-Language": "ko"}
    data = raw
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode()
    if data is not None:
        headers["Content-Type"] = content_type
    if method == "POST" or idem:
        headers["Idempotency-Key"] = idem or str(uuid.uuid4())
    for attempt in range(3):
        s, b = _open(urllib.request.Request(WEB + "/bff/api/core" + path, data=data, headers=headers, method=method))
        if s not in (503, 504) or method == "POST" and idem is None:
            break
        time.sleep(5)
    try:
        return s, json.loads(b.decode() or "{}")
    except ValueError:
        return s, {"raw": b[:300].decode("utf-8", "replace")}


def ok(s):
    return 200 <= s < 300


def why(r):
    h = (r or {}).get("header") or {}
    errs = (r or {}).get("errors")
    return f"{h.get('resultCode', '')} {h.get('resultMessage', '')}" + (f" {errs}" if errs else "")


def resp(r):
    return (r or {}).get("response") or {}


def items(r):
    return (r or {}).get("responses") or []


def iso(dt):
    return dt.astimezone(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------- real.env(만든 ID 기록, 비밀값 없음)
def load_env():
    out = {}
    try:
        for line in open(REAL_ENV, encoding="utf-8"):
            if "=" in line and not line.startswith("#"):
                k, v = line.rstrip("\n").split("=", 1)
                out[k] = v
    except FileNotFoundError:
        pass
    return out


STATE = load_env()


def save(**kw):
    STATE.update({k: str(v) for k, v in kw.items() if v is not None})
    tmp = REAL_ENV + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("# e2e/local-preview.sh seed-real 기록(비밀값 없음). 지우면 다음 seed-real이 이름으로 다시 찾는다\n")
        for k in sorted(STATE):
            f.write(f"{k}={STATE[k]}\n")
    os.replace(tmp, REAL_ENV)


# ---------------------------------------------------------------- 1. 데이터 소스
def mqtt_basic_auth():
    """루트 .env에서 MQTT_BASIC_AUTH 한 줄만 읽는다(다른 줄은 보지 않는다). 값은 출력하지 않는다"""
    if not ENV_FILE or not os.path.isfile(ENV_FILE):
        sys.exit(f"MQTT_BASIC_AUTH 를 읽을 파일이 없습니다({ENV_FILE or 'D2F_ENV_FILE'})")
    with open(ENV_FILE, encoding="utf-8") as f:
        for line in f:
            if line.startswith("MQTT_BASIC_AUTH="):
                v = line.split("=", 1)[1].strip().strip('"').strip("'")
                if v:
                    return v
    sys.exit(f"{ENV_FILE} 에 MQTT_BASIC_AUTH 가 없습니다")


def ensure_source():
    s, r = api("GET", "/sources?q=academy&size=100")
    found = [i for i in items(r) if i.get("code") == SOURCE_CODE]
    if found:
        src = found[0]
        note(f"데이터 소스 있음: {SOURCE_CODE}(id {src['id']}, {src.get('lifecycle')}/{src.get('state')})")
    else:
        body = {"code": SOURCE_CODE, "name": "아카데미 ChirpStack 센서(구독 전용)", "type": "MQTT_SUBSCRIBE",
                "connection": {"url": "wss://iot-data.java21.net:443/mqtt", "clientIdBase": "data2flow-ingress", "qos": 1,
                               "keepaliveSec": 60, "auth": "HEADER", "headerName": "Authorization"},
                "topics": [{"topic": "application/+/device/+/event/up", "qos": 1}],
                "secret": {"kind": "HEADER_VALUE", "value": mqtt_basic_auth()},
                "decoderKey": "chirpstack-v4", "unknownDevicePolicy": "AUTO_REGISTER", "activate": True}
        s, r = api("POST", "/sources", body)
        del body
        if not ok(s):
            sys.exit(f"데이터 소스 등록 실패({s}): {why(r)}")
        src = resp(r)
        note(f"데이터 소스 등록: {SOURCE_CODE}(id {src.get('id')}) — 구독만, 토픽 application/+/device/+/event/up")
    save(REAL_SOURCE_ID=src["id"])
    return src["id"]


def wait_first_data(source_id):
    t0 = time.time()
    while True:
        s, r = api("GET", f"/sources/{source_id}")
        x = resp(r)
        s2, r2 = api("GET", f"/devices?sourceId={source_id}&size=1")
        if x.get("lastReceivedAt") or (r2.get("totalCount") or 0) > 0:
            note(f"수신 중: 상태 {x.get('state')}, 최근 수신 {x.get('lastReceivedAt')}, client-id {', '.join(x.get('clientIds') or [])}")
            return True
        if time.time() - t0 > WAIT:
            note(f"{WAIT}초 동안 수신이 없습니다(상태 {x.get('state')} {x.get('stateDetail') or ''}). 나중에 다시: seed-real")
            return False
        time.sleep(15)


# ---------------------------------------------------------------- 2. 공간·승인
def space_tree():
    s, r = api("GET", "/spaces")
    return r.get("response") or []


def find_child(nodes, name, parent=None):
    for n in nodes or []:
        if n.get("name") == name and (parent is None or str(n.get("parentId")) == str(parent)):
            return n
        f = find_child(n.get("children"), name, parent)
        if f:
            return f
    return None


def ensure_space(name, type_, parent=None, extra=None):
    n = find_child(space_tree(), name, parent)
    if n:
        return n["id"]
    body = {"type": type_, "name": name, **(extra or {})}
    if parent:
        body["parentId"] = str(parent)
    s, r = api("POST", "/spaces", body)
    if not ok(s):
        sys.exit(f"공간 만들기 실패({name}, {s}): {why(r)}")
    note(f"공간 만듦: {name}({type_}, id {resp(r)['id']})")
    return resp(r)["id"]


def norm(s):
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


def approve_pending(source_id, site_id):
    s, r = api("GET", "/device-models?size=100")
    models = {m["code"]: m for m in items(r) if m.get("code")}
    rooms = {}
    approved = 0
    s, r = api("GET", f"/devices?status=PENDING&sourceId={source_id}&size=100")
    for d in items(r):
        code = None
        for c in models:
            if norm(d["name"]).startswith(norm(c)) and (code is None or len(c) > len(code)):
                code = c
        if not code:
            note(f"모델을 못 찾아 승인 대기로 둡니다: {d['name']}(기기 → 승인 대기에서 직접 고르세요)")
            continue
        s1, r1 = api("GET", f"/devices/{d['id']}")
        tags = ((resp(r1).get("sourceMeta") or {}).get("tags")) or {}
        room_name = (tags.get("location") or DEFAULT_ROOM).strip() or DEFAULT_ROOM
        if room_name not in rooms:
            rooms[room_name] = ensure_space(room_name, "ROOM", site_id, {"usage": "LAB" if room_name == DEFAULT_ROOM else "MEETING"})
        spot = (tags.get("spot") or "").strip()
        name = d["name"] + (f" ({spot})" if spot and spot not in d["name"] else "")
        s2, r2 = api("POST", "/devices/approve", {"items": [{"deviceId": d["id"], "baseVersion": resp(r1).get("version", d.get("version"))}],
                                                   "modelId": models[code]["id"], "spaceId": rooms[room_name], "name": name})
        if ok(s2):
            approved += 1
            note(f"승인: {name} → 모델 {code}, 공간 {SITE_NAME}/{room_name}")
        else:
            note(f"승인 실패: {d['name']}({s2}) {why(r2)}")
    return approved


def lab_devices(room_id):
    s, r = api("GET", f"/devices?spaceId={room_id}&status=ACTIVE&size=100")
    out = []
    for d in items(r):
        s1, r1 = api("GET", f"/devices/{d['id']}")
        x = resp(r1)
        out.append({"id": str(x["id"]), "name": x["name"], "metrics": {m["metricKey"] for m in (x.get("latest") or [])},
                    "spot": ((((x.get("sourceMeta") or {}).get("tags")) or {}).get("spot") or "")})
    return sorted(out, key=lambda d: d["name"])


# ---------------------------------------------------------------- 3. 평면도(SVG, 스크립트 없음)
W, H = 800, 560
SPOTS = [  # 위치 이름(띄어쓰기 무시, 앞에서부터 먼저 맞춘다) → SVG 좌표
    ("사무공간스위치", (235, 340)), ("업무공간", (110, 400)), ("후면오른쪽", (690, 410)), ("후방오른쪽", (600, 420)),
    ("후방우측", (600, 420)), ("중앙우측", (550, 260)), ("중앙좌측", (250, 260)), ("입구오른쪽", (700, 120)),
    ("전방좌측", (130, 130)), ("전방우측", (600, 130)), ("강단", (400, 85)), ("복도", (400, 515)),
]


def floorplan_svg():
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">
<rect width="{W}" height="{H}" fill="#f7f8fa"/>
<rect x="40" y="40" width="720" height="420" fill="#ffffff" stroke="#3a4250" stroke-width="4"/>
<rect x="250" y="55" width="300" height="50" fill="#e8ecf3" stroke="#8a94a6"/>
<text x="400" y="86" font-family="sans-serif" font-size="18" text-anchor="middle" fill="#3a4250">강단 · 스크린</text>
<rect x="40" y="320" width="180" height="140" fill="#eef3ec" stroke="#8a94a6" stroke-dasharray="6 4"/>
<text x="130" y="350" font-family="sans-serif" font-size="16" text-anchor="middle" fill="#3a4250">업무 공간</text>
<g fill="#dfe4ec" stroke="#b5bdcb">
<rect x="120" y="170" width="220" height="40"/><rect x="460" y="170" width="220" height="40"/>
<rect x="120" y="240" width="220" height="40"/><rect x="460" y="240" width="220" height="40"/>
<rect x="260" y="330" width="160" height="40"/><rect x="460" y="330" width="220" height="40"/>
</g>
<text x="400" y="230" font-family="sans-serif" font-size="14" text-anchor="middle" fill="#8a94a6">실습 책상</text>
<rect x="752" y="85" width="16" height="70" fill="#ffffff" stroke="#3a4250"/>
<text x="740" y="80" font-family="sans-serif" font-size="14" text-anchor="end" fill="#3a4250">입구</text>
<rect x="40" y="480" width="720" height="60" fill="#eceff4" stroke="#8a94a6"/>
<text x="60" y="516" font-family="sans-serif" font-size="16" fill="#3a4250">복도</text>
<text x="755" y="30" font-family="sans-serif" font-size="14" text-anchor="end" fill="#8a94a6">아카데미 실습실(개략도)</text>
</svg>
"""


def spot_xy(spot, i):
    key = re.sub(r"\s", "", spot or "")
    for name, (x, y) in SPOTS:
        if name in key:
            return x / W, y / H
    return (300 + 60 * (i % 6)) / W, 300 / H  # 위치 태그가 없으면 가운데 줄에 나란히


def ensure_floorplan(room_id, devices):
    s, r = api("GET", f"/spaces/{room_id}/floorplan")
    fp = resp(r) if ok(s) else {}
    if not fp.get("imageUrl"):
        boundary = "----d2f" + uuid.uuid4().hex
        svg = floorplan_svg().encode("utf-8")
        raw = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"academy-lab.svg\"\r\n"
               f"Content-Type: image/svg+xml\r\n\r\n").encode() + svg + f"\r\n--{boundary}--\r\n".encode()
        s, r = api("PUT", f"/spaces/{room_id}/floorplan?scaleMPerPx=0.02", raw=raw, content_type=f"multipart/form-data; boundary={boundary}")
        # Idempotency-Key를 붙이면 multipart PUT이 500(본문 스트림이 닫힘)이 되어 붙이지 않는다(PUT 교체는 원래 멱등)
        if not ok(s):
            note(f"평면도 올리기 실패({s}): {why(r)}")
            return
        fp = resp(r)
        note("평면도 올림: 실습실 개략도(SVG)")
    have = {str(m["deviceId"]): m for m in (fp.get("markers") or [])}
    markers = [{"deviceId": k, "x": float(m["x"]), "y": float(m["y"]), "rotation": int(m.get("rotation") or 0)} for k, m in have.items()]
    added = 0
    for i, d in enumerate(devices):
        if d["id"] in have:
            continue
        x, y = spot_xy(d["spot"], i)
        markers.append({"deviceId": d["id"], "x": round(x, 4), "y": round(y, 4), "rotation": 0})
        added += 1
    if added:
        s, r = api("PUT", f"/spaces/{room_id}/floorplan/markers", {"markers": markers})
        note(f"평면도 센서 표시 {added}개 추가(전체 {len(markers)}개)" if ok(s) else f"평면도 마커 실패({s}): {why(r)}")
    else:
        note(f"평면도 센서 표시 {len(markers)}개(추가할 것 없음)")


# ---------------------------------------------------------------- 4. 대시보드
def find_by_name(path, name, key="name"):
    s, r = api("GET", path + ("&" if "?" in path else "?") + "keyword=" + urllib.parse.quote(name) + "&size=100")
    for i in items(r):
        if i.get(key) == name:
            return i
    return None


def dashboard_body(room_id, devices):
    room = str(room_id)
    by_metric = lambda m: [d for d in devices if m in d["metrics"]]
    first = lambda m: (by_metric(m) or [None])[0]

    def stat(wid, x, title, metric, thresholds=None, unit=None):
        d = first(metric) if metric in ("tvoc", "illumination", "LAeq", "activity") else None
        target = {"kind": "DEVICE_METRIC", "deviceId": d["id"], "metricKey": metric} if d else \
            {"kind": "SPACE_AGGREGATE", "spaceId": room, "metricKey": metric, "agg": "avg"}
        opts = {"decimals": 0 if metric in ("co2", "tvoc", "illumination") else 1, "sparkline": True, "trend": True}
        if thresholds:
            opts["thresholds"] = thresholds
        return {"id": wid, "type": "stat", "title": title, "x": x, "y": 0, "w": 4, "h": 4, "targets": [target], "options": opts}

    widgets = [
        stat("temp", 0, "실습실 평균 온도", "temperature", [{"value": 18, "tone": "good"}, {"value": 26, "tone": "warn"}, {"value": 28, "tone": "bad"}]),
        stat("humidity", 4, "실습실 평균 습도", "humidity", [{"value": 30, "tone": "good"}, {"value": 60, "tone": "warn"}, {"value": 70, "tone": "bad"}]),
        stat("co2", 8, "실습실 평균 CO2", "co2", [{"value": 0, "tone": "good"}, {"value": 800, "tone": "warn"}, {"value": 1000, "tone": "bad"}]),
        stat("tvoc", 12, "TVOC", "tvoc"),
        stat("illum", 16, "조도", "illumination"),
        stat("noise", 20, "소음(LAeq)", "LAeq", [{"value": 0, "tone": "good"}, {"value": 60, "tone": "warn"}, {"value": 70, "tone": "bad"}]),
    ]
    temps = [{"kind": "DEVICE_METRIC", "deviceId": d["id"], "metricKey": "temperature", "label": d["name"]} for d in by_metric("temperature")][:20]
    co2s = [{"kind": "DEVICE_METRIC", "deviceId": d["id"], "metricKey": "co2", "label": d["name"]} for d in by_metric("co2")][:20]
    if temps:
        widgets.append({"id": "temp-line", "type": "line", "title": "센서별 온도", "x": 0, "y": 4, "w": 12, "h": 8, "targets": temps,
                        "options": {"legend": "bottom", "thresholds": [{"value": 28, "label": "고온 규칙 28℃"}]}})
    if co2s:
        widgets.append({"id": "co2-line", "type": "line", "title": "센서별 CO2", "x": 12, "y": 4, "w": 12, "h": 8, "targets": co2s,
                        "options": {"legend": "bottom", "thresholds": [{"value": 1000, "label": "고CO2 규칙 1000ppm"}]}})
    widgets.append({"id": "floorplan", "type": "floorplan", "title": "실습실 평면도(온도)", "x": 0, "y": 12, "w": 12, "h": 10,
                    "targets": [{"kind": "SPACE", "spaceId": room}], "options": {"metricKey": "temperature", "heat": True}})
    act = first("activity")
    if act:
        widgets.append({"id": "activity", "type": "area", "title": "재실 활동(적외선 감지)", "x": 12, "y": 12, "w": 12, "h": 5,
                        "targets": [{"kind": "DEVICE_METRIC", "deviceId": act["id"], "metricKey": "activity", "label": act["name"]}],
                        "options": {"legend": "hidden"}})
    noise = first("LAeq")
    if noise:
        widgets.append({"id": "noise-line", "type": "line", "title": "소음(LAeq)", "x": 12, "y": 17, "w": 12, "h": 5,
                        "targets": [{"kind": "DEVICE_METRIC", "deviceId": noise["id"], "metricKey": "LAeq", "label": noise["name"]}],
                        "options": {"legend": "hidden", "thresholds": [{"value": 70, "label": "소음 규칙 70dB"}]}})
    temp_rows = [{"kind": "DEVICE_METRIC", "deviceId": d["id"], "metricKey": "temperature"} for d in by_metric("temperature")]
    air_rows = [{"kind": "DEVICE_METRIC", "deviceId": d["id"], "metricKey": m}
                for m in ("co2", "tvoc", "illumination", "LAeq", "activity") for d in by_metric(m)]
    cols = {"columns": ["current", "min", "max", "lastSeen"]}
    widgets.append({"id": "latest-temp", "type": "table", "title": "기기별 최신값 — 온도", "x": 0, "y": 22, "w": 9, "h": 12,
                    "targets": temp_rows[:20], "options": cols})
    if air_rows:
        widgets.append({"id": "latest-air", "type": "table", "title": "기기별 최신값 — 공기질·조도·소음·활동", "x": 9, "y": 22, "w": 9, "h": 12,
                        "targets": air_rows[:20], "options": cols})
    widgets.append({"id": "status", "type": "status-list", "title": "센서 연결 상태", "x": 18, "y": 22, "w": 6, "h": 12,
                    "targets": [{"kind": "SPACE", "spaceId": room}]})
    widgets.append({"id": "alarms", "type": "alarm-list", "title": "실습실 알람", "x": 0, "y": 34, "w": 12, "h": 7,
                    "targets": [{"kind": "SPACE", "spaceId": room}], "options": {"maxRows": 10, "showAck": True}})
    widgets.append({"id": "about", "type": "markdown", "title": "이 대시보드", "x": 12, "y": 34, "w": 12, "h": 7, "options": {"content": (
        "**아카데미 실습실 실제 센서**(구독만, 공용 브로커에 발행하지 않음)\n\n"
        "- 규칙: 고CO2(1000ppm·5분 → 주의), 고온(28℃·10분 → 주의), 소음(LAeq 70dB → 정보). 알림 채널 없이 화면 알람만\n"
        "- 플로우: 실습실 CO2가 높으면 **가상 강의실 301의 가상 환기 장치**를 켬(실제 기기 제어 없음)\n"
        "- 분석: CO2 도달 예측(2시간마다), 쾌적도(매일 07:00), 센서 건강·재실 추정(매주 월 07:00). 데이터가 쌓이기 전에는 '데이터 부족'\n"
        "- 평면도의 센서 위치는 센서 태그(spot)를 개략도에 옮긴 것")}})
    return {"name": DASHBOARD_NAME, "description": "아카데미 실습실 실제 센서(온도·습도·CO2·TVOC·조도·소음·재실 활동) 실시간 견본",
            "visibility": "ORG", "refresh": "LIVE", "resolution": "AUTO", "timeRange": {"relative": "6h"}, "variables": [],
            "layout": {"widgets": widgets}}


def ensure_dashboard(room_id, devices):
    found = find_by_name("/dashboards?tab=all", DASHBOARD_NAME) or find_by_name("/dashboards", DASHBOARD_NAME)
    if found:
        did = found.get("id") or found.get("dashboardId")
        note(f"대시보드 있음: {DASHBOARD_NAME}(id {did})")
    else:
        s, r = api("POST", "/dashboards", dashboard_body(room_id, devices))
        if not ok(s):
            note(f"대시보드 만들기 실패({s}): {why(r)}")
            return None
        did = resp(r).get("id") or resp(r).get("dashboardId")
        note(f"대시보드 만듦: {DASHBOARD_NAME}(id {did}) → {WEB}/dashboards/{did}")
    save(REAL_DASHBOARD_ID=did)
    return did


# ---------------------------------------------------------------- 5. 규칙(화면 알람만)
RULES = [
    ("실습실 고CO2(1000ppm 5분)", "high-co2", {"kind": "threshold", "metric": "co2", "op": ">=", "value": 1000, "for": "PT5M", "clear": 900},
     "WARNING", "{{device.name}} CO2 {{value}}ppm — 환기 필요"),
    ("실습실 고온(28℃ 10분)", "high-temp", {"kind": "threshold", "metric": "temperature", "op": ">=", "value": 28, "for": "PT10M", "clear": 27},
     "WARNING", "{{device.name}} 온도 {{value}}℃"),
    ("실습실 소음(LAeq 70dB)", None, {"kind": "threshold", "metric": "LAeq", "op": ">=", "value": 70, "clear": 65},
     "INFO", "{{device.name}} 소음 {{value}}dB"),
]


def ensure_rules(room_id):
    ids = []
    for name, tpl, cond, sev, title in RULES:
        found = find_by_name("/rules?q=" + urllib.parse.quote(name), name)
        if found:
            rid = found.get("ruleId") or found.get("id")
            note(f"규칙 있음: {name}(id {rid}, {found.get('status')})")
        else:
            body = {"name": name, "scope": {"type": "SPACE", "ids": [str(room_id)], "includeChildren": True}, "condition": cond,
                    "severity": sev, "titleTemplate": title, "autoClear": True}
            if tpl:
                body["templateKey"] = tpl
            s, r = api("POST", "/rules", body)
            if not ok(s):
                note(f"규칙 만들기 실패({name}, {s}): {why(r)}")
                continue
            rid = resp(r).get("ruleId") or resp(r).get("id")
            warn = ", ".join(w.get("message", "") for w in (resp(r).get("warnings") or []))
            note(f"규칙 만듦: {name}(id {rid}, {resp(r).get('status')}{', ' + warn if warn else ''})")
        ids.append(str(rid))
    save(REAL_RULE_IDS=",".join(ids))


# ---------------------------------------------------------------- 6. 분석(충분성 검사 → 일정 실행)
def analyses(room_id, devices):
    room = str(room_id)
    by_metric = lambda m: [d for d in devices if m in d["metrics"]]
    co2_dev = next((d for d in by_metric("co2") if d["name"].startswith("AM107")), (by_metric("co2") or [None])[0])
    out = []
    if co2_dev:
        out.append(("실습실 CO2 1000ppm 도달 예측", "threshold-eta",
                    [{"role": "target", "sources": [{"kind": "DEVICE_METRIC", "deviceId": co2_dev["id"], "metricKey": "co2"}]}],
                    {"type": "RELATIVE", "days": 0.0834}, {"threshold": 1000, "direction": "UP", "windowMinutes": 30, "horizonMinutes": 240},
                    {"cron": "20 */2 * * *"}))
    out.append(("실습실 쾌적도", "comfort-index",
                [{"role": r, "sources": [{"kind": "SPACE_AGGREGATE", "spaceId": room, "metricKey": m, "agg": "avg"}]}
                 for r, m in (("temp", "temperature"), ("humidity", "humidity"), ("co2", "co2"))]
                + ([{"role": "tvoc", "sources": [{"kind": "DEVICE_METRIC", "deviceId": by_metric("tvoc")[0]["id"], "metricKey": "tvoc"}]}]
                   if by_metric("tvoc") else []),
                {"type": "RELATIVE", "days": 1}, {}, {"preset": "DAILY", "at": "07:00"}))
    temps = by_metric("temperature")
    if temps:
        out.append(("실습실 온도 센서 건강", "sensor-health",
                    [{"role": "devices", "sources": [{"kind": "DEVICE_METRIC", "deviceId": d["id"], "metricKey": "temperature"} for d in temps]}],
                    {"type": "RELATIVE", "days": 7}, {"peerCompare": True}, {"preset": "WEEKLY", "at": "07:00", "weekday": "MON"}))
    occ = [{"role": "co2", "sources": [{"kind": "SPACE_AGGREGATE", "spaceId": room, "metricKey": "co2", "agg": "avg"}]}]
    # AM107의 activity는 의미가 occupancy라 "적외선 활동"(activity) 역할에 묶이지 않는다(BR-ANA-02) — 소음·조도만 더한다
    for role, metric in (("noise", "LAeq"), ("illuminance", "illumination")):
        if by_metric(metric):
            occ.append({"role": role, "sources": [{"kind": "DEVICE_METRIC", "deviceId": by_metric(metric)[0]["id"], "metricKey": metric}]})
    out.append(("실습실 재실·활용률 추정", "occupancy-estimate", occ, {"type": "RELATIVE", "days": 7}, {},
                {"preset": "WEEKLY", "at": "07:10", "weekday": "MON"}))

    ids = []
    for name, key, bindings, period, params, schedule in out:
        found = find_by_name("/analytics/analyses?templateKey=" + key, name)
        chk_s, chk = api("POST", f"/analytics/templates/{key}/check", {"bindings": bindings, "period": period, "params": params})
        level = resp(chk).get("level") if ok(chk_s) else f"검사 실패({chk_s} {why(chk)})"
        issues = "; ".join(i.get("message", "") for i in (resp(chk).get("issues") or []) if i.get("severity") == "FAIL")
        if found:
            aid = found.get("analysisId") or found.get("id")
            note(f"분석 있음: {name}(id {aid}) — 충분성 {level}{' · ' + issues if issues else ''}")
        else:
            s, r = api("POST", "/analytics/analyses", {"name": name, "templateKey": key, "bindings": bindings, "period": period,
                                                        "params": params, "schedule": schedule, "resolution": "AUTO"})
            if not ok(s):
                note(f"분석 만들기 실패({name}, {s}): {why(r)}")
                continue
            aid = resp(r).get("analysisId") or resp(r).get("id")
            note(f"분석 만듦: {name}(id {aid}, 일정 {schedule}) — 충분성 {level}{' · ' + issues if issues else ''}")
        if level in ("PASS", "WARN"):
            s, r = api("POST", f"/analytics/analyses/{aid}/runs", {})
            note(f"  지금 실행: {'요청됨 run ' + str(resp(r).get('runId') or resp(r).get('id')) if ok(s) else f'{s} {why(r)}'}")
        else:
            note("  데이터가 모자라 지금은 실행하지 않고 일정 실행으로 둡니다")
        ids.append(str(aid))
    save(REAL_ANALYSIS_IDS=",".join(ids))


# ---------------------------------------------------------------- 7. 플로우(가상 환기 장치만 제어)
def ensure_flow(room_id, devices):
    s, r = api("GET", "/flows?size=100&q=" + urllib.parse.quote(FLOW_NAME))
    found = next((f for f in items(r) if f.get("name") == FLOW_NAME), None)
    if found:
        note(f"플로우 있음: {FLOW_NAME}({found.get('status')}, v{found.get('activeVersion')})")
        save(REAL_FLOW_ID=found["flowId"])
        return
    co2 = [d["id"] for d in devices if "co2" in d["metrics"]]
    s, r = api("GET", "/devices?virtual=true&size=100")
    vent = None
    for d in items(r):
        if not d.get("virtual"):
            continue
        s1, r1 = api("GET", f"/devices/{d['id']}")
        x = resp(r1)
        if ((x.get("model") or {}).get("code")) == "SIM-VENTILATOR":
            vent = x
            break
    if not co2 or not vent:
        note("플로우 건너뜀: " + ("실습실 CO2 센서가 없습니다" if not co2 else "가상 환기 장치가 없습니다(가상 견본: e2e/local-preview.sh seed)"))
        return
    params = {"spaceId": str(room_id), "threshold": 1000, "duration": "PT5M", "level": 2, "co2SensorIds": co2, "ventilatorId": str(vent["id"])}
    s, r = api("POST", "/flow-templates/co2-then-ventilate/instantiate", {"name": FLOW_NAME, "params": params})
    if not ok(s):
        note(f"플로우 만들기 실패({s}): {why(r)}")
        return
    flow, draft = resp(r).get("flowId"), resp(r).get("draftVersion")
    save(REAL_FLOW_ID=flow)
    api("POST", f"/flows/{flow}/validate", {})
    s, r = api("POST", f"/flows/{flow}/apply", {"version": draft, "baseVersion": 0, "acknowledgedRisks": True,
                                                 "memo": "실제 센서 → 가상 환기 장치(미리보기 견본)"})
    space = (vent.get("space") or {}).get("name") or "가상 공간"
    note(f"플로우 만듦·적용: {FLOW_NAME} — CO2 센서 {len(co2)}대 평균 1000ppm 5분 → {space}의 {vent['name']}(가상, id {vent['id']}) 켜기"
         + ("" if ok(s) else f" (적용 실패 {s} {why(r)})"))


# ---------------------------------------------------------------- 8. 내보내기
def ensure_export(devices):
    if STATE.get("REAL_EXPORT_ID"):
        s, r = api("GET", f"/exports/{STATE['REAL_EXPORT_ID']}")
        if ok(s):
            note(f"내보내기 있음: id {STATE['REAL_EXPORT_ID']}({resp(r).get('status')}, {resp(r).get('rows')}행)")
            return
    series = [{"deviceId": int(d["id"]), "metric": m, "label": f"{d['name']} {m}"} for d in devices for m in ("temperature", "co2") if m in d["metrics"]]
    if not series:
        return
    now = datetime.now(timezone.utc)
    body = {"query": {"series": series[:20], "from": iso(now - timedelta(hours=1)), "to": iso(now), "resolution": "RAW"},
            "format": "CSV", "columns": "LONG", "includeQuality": True, "tz": "Asia/Seoul"}
    s, r = api("POST", "/exports", body)
    if not ok(s):
        note(f"내보내기 실패({s}): {why(r)}")
        return
    x = resp(r)
    eid = x.get("jobId")
    if eid:
        save(REAL_EXPORT_ID=eid)
    note(f"내보내기 요청: 최근 1시간 실습실 온도·CO2 CSV({x.get('mode')}, 예상 {x.get('estimatedRows')}행, id {eid}) → {WEB}/exports")


def main():
    login()
    source_id = ensure_source()
    receiving = wait_first_data(source_id)
    site_id = ensure_space(SITE_NAME, "SITE", None, {"timezone": "Asia/Seoul", "address": "아카데미 교육장"})
    room_id = ensure_space(DEFAULT_ROOM, "ROOM", site_id, {"usage": "LAB", "capacity": 30})
    save(REAL_SITE_ID=site_id, REAL_ROOM_ID=room_id)
    if receiving:
        n = approve_pending(source_id, site_id)
        note(f"이번에 승인 {n}대")
    s, r = api("GET", f"/devices?sourceId={source_id}&size=100")
    active = [d for d in items(r) if d.get("status") == "ACTIVE"]
    pending = [d for d in items(r) if d.get("status") == "PENDING"]
    note(f"아카데미 센서: 승인 {len(active)}대, 승인 대기 {len(pending)}대")
    devices = lab_devices(room_id)
    if not devices:
        note("실습실에 승인된 센서가 없어 견본(대시보드·규칙·분석·플로우)은 다음 seed-real 때 만듭니다")
        return
    ensure_floorplan(room_id, devices)
    ensure_dashboard(room_id, devices)
    ensure_rules(room_id)
    analyses(room_id, devices)
    ensure_flow(room_id, devices)
    ensure_export(devices)


if __name__ == "__main__":
    main()
