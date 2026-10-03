/**
 * M2 공용 도우미 단위 테스트: 실시간 연결(DSH-05.01, IAM-07.06), 차트 모델(DSH-05.02·05.03, UI-TSD-07),
 * 공간 계층(DEV-01.01, BR-DEV-01~03), 표시 형식(DSH-07.03·07.04, TSD-01.05).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { bffJson, clientIdempotencyKey } from "../bff-client";
import { appendPoint, axisIndexByUnit, axisLabel, buildChartOption, hasData, qualityPoints, roundTo, toTable, tooltipTime, withGaps, type ChartSeries } from "../chart-model";
import { LiveConnection, MessageBuffer, RateLimiter, backoffDelay, liveUrl, type EventSourceLike } from "../event-stream";
import { formatDate, formatNumber, formatRelative, rangeOf } from "../format";
import { scopeFromForm } from "../roles";
import { isDarkNow, nextTheme, normalizeTheme, themeAttribute, themeFromCookie } from "../theme";
import { allowedChildTypes, checkSpaceInput, descendantIds, findSpace, flattenSpaces, moveTargets, spacePathLabel, type SpaceNode } from "../spaces";

class FakeSource implements EventSourceLike {
  static all: FakeSource[] = [];
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  closed = false;
  constructor(readonly url: string) {
    FakeSource.all.push(this);
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: string, lastEventId = "") {
    for (const l of this.listeners.get(type) ?? []) l({ data, lastEventId } as MessageEvent);
  }
}

afterEach(() => {
  FakeSource.all = [];
  vi.useRealTimers();
});

describe("DSH-05.01 실시간 연결(API-DSH-20 규칙)", () => {
  it("다시 연결 대기 시간은 1→2→4…30초 상한, 토픽은 200개까지 한 주소로", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(backoffDelay)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    expect(liveUrl([])).toBeNull();
    expect(liveUrl(["space:31", "space:31", "telemetry:1042.co2"])).toBe(`/bff/stream/live?topics=${encodeURIComponent("space:31,telemetry:1042.co2")}`);
    const many = Array.from({ length: 250 }, (_, i) => `t${i}`);
    expect(decodeURIComponent(liveUrl(many)!.split("=")[1]).split(",")).toHaveLength(200);
  });

  it("TC-DSH-052 끊기면 세션을 확인하고 백오프로 다시 연결, 연결되면 대기 시간을 처음으로", async () => {
    vi.useFakeTimers();
    const statuses: string[] = [];
    const events: unknown[] = [];
    const connection = new LiveConnection({
      url: "/bff/stream/live?topics=home",
      events: ["point"],
      onEvent: (e) => events.push(e),
      onStatus: (s) => statuses.push(s),
      createSource: (url) => new FakeSource(url),
      checkSession: async () => true,
    });
    connection.start();
    const first = FakeSource.all[0];
    first.onopen?.(new Event("open"));
    first.emit("point", '{"v":1}', "e-1");
    first.emit("point", "not-json");
    expect(events).toEqual([{ type: "point", data: { v: 1 }, id: "e-1" }, { type: "point", data: "not-json", id: undefined }]);
    first.onerror?.(new Event("error"));
    expect(first.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeSource.all).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSource.all).toHaveLength(2);
    FakeSource.all[1].onerror?.(new Event("error"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(FakeSource.all).toHaveLength(3);
    FakeSource.all[2].onopen?.(new Event("open"));
    expect(connection.status).toBe("open");
    expect(statuses).toEqual(["connecting", "open", "retrying", "retrying", "retrying", "retrying", "open"]);
    connection.stop();
    expect(FakeSource.all[2].closed).toBe(true);
  });

  it("AT-IAM-22.2 세션이 끝났으면 다시 연결하지 않는다, session-revoked 이벤트는 로그아웃 알림", async () => {
    const post = vi.fn();
    vi.stubGlobal("BroadcastChannel", class { postMessage = post; close() {} onmessage = null; });
    const dead = new LiveConnection({ url: "/x", events: [], onEvent: () => {}, createSource: (u) => new FakeSource(u), checkSession: async () => false });
    dead.start();
    FakeSource.all[0].onerror?.(new Event("error"));
    await Promise.resolve();
    await Promise.resolve();
    expect(dead.status).toBe("closed");
    const live = new LiveConnection({ url: "/y", events: [], onEvent: () => {}, createSource: (u) => new FakeSource(u), checkSession: async () => true });
    live.start();
    FakeSource.all[1].emit("session-revoked", "{}");
    expect(live.status).toBe("closed");
    expect(post).toHaveBeenCalledWith({ type: "logout", reason: "revoked" });
    vi.unstubAllGlobals();
  });

  it("TC-DSH-026 일시정지 중에는 목록을 고정하고 대기 건수만 센다, 재개하면 반영, 500건 넘으면 오래된 것부터 버림", () => {
    const buffer = new MessageBuffer<number>(500);
    for (let i = 0; i < 10; i++) buffer.push(i);
    buffer.pause();
    for (let i = 10; i < 40; i++) buffer.push(i);
    expect(buffer.items).toHaveLength(10);
    expect(buffer.waiting).toBe(30);
    buffer.resume();
    expect(buffer.items[0]).toBe(39);
    expect(buffer.items).toHaveLength(40);
    for (let i = 0; i < 600; i++) buffer.push(1000 + i);
    expect(buffer.items).toHaveLength(500);
    expect(buffer.items[499]).toBe(1100);
    buffer.pause();
    for (let i = 0; i < 600; i++) buffer.push(i);
    expect(buffer.waiting).toBe(500);
    buffer.clear();
    expect(buffer.items).toHaveLength(0);
  });

  it("TC-DSC-100 초당 10건을 넘는 메시지는 버리고 n건 생략으로 센다", () => {
    let now = 0;
    const limiter = new RateLimiter(10, () => now);
    const allowed = Array.from({ length: 15 }, () => limiter.allow()).filter(Boolean).length;
    expect(allowed).toBe(10);
    expect(limiter.dropped).toBe(5);
    now = 1000;
    expect(limiter.allow()).toBe(true);
  });
});

const raw: ChartSeries = {
  key: "1042.temperature",
  label: "AM107 온도",
  unit: "℃",
  raw: true,
  expectedIntervalSec: 60,
  points: [
    ["2026-10-03T00:00:00Z", 22, 0],
    ["2026-10-03T00:01:00Z", 61, 1],
    ["2026-10-03T00:02:00Z", 22.4, 3],
    // 1시간 공백(주기 60초 × 3 초과)
    ["2026-10-03T01:02:00Z", 22.6, 0],
  ],
};

describe("DSH-05.02·05.03 품질·공백 표시(TC-DSH-055, TC-DSH-057)", () => {
  it("TC-DSH-057 보고 주기 3배를 넘는 공백에 null을 넣고 값은 보간하지 않는다", () => {
    const data = withGaps(raw);
    expect(data).toHaveLength(5);
    expect(data[3]).toEqual([Date.parse("2026-10-03T00:02:00Z") + 1, null]);
    expect(data.filter((p) => p[1] !== null).map((p) => p[1])).toEqual([22, 61, 22.4, 22.6]);
    const declared = withGaps({ points: [["2026-10-03T00:00:00Z", 1, 10], ["2026-10-03T03:00:00Z", 2, 10]], gaps: [{ from: "2026-10-03T00:30:00Z", to: "2026-10-03T02:00:00Z" }] });
    expect(declared[1][1]).toBeNull();
    expect(withGaps({ points: [["bad", 1, 0]] })).toEqual([]);
  });

  it("TC-DSH-055 품질 1·3은 삼각형·다이아몬드 별도 계열과 범례, 가상은 점선과 \"가상\" 범례, 공백 선 끊김(connectNulls false)", () => {
    const option = buildChartOption([raw, { key: "sim", label: "가상 온도", unit: "℃", virtual: true, points: [["2026-10-03T00:00:00Z", 21, 30]] }], {
      timezone: "Asia/Seoul",
      labels: { outOfRange: "범위 초과", suspect: "의심", virtual: "가상", noData: "", gap: "수신 없음" },
      annotations: [
        { timeFrom: "2026-10-03T00:30:00Z", type: "OFFLINE", title: "오프라인" },
        { timeFrom: "2026-10-03T00:10:00Z", timeTo: "2026-10-03T00:20:00Z", type: "USER", title: "점검" },
      ],
      target: { min: 20, max: 26 },
      dark: true,
    });
    const series = option.series as { id: string; name: string; type: string; symbol?: string; connectNulls?: boolean; lineStyle?: { type: string }; markLine?: unknown; markArea?: { data: unknown[] } }[];
    expect(series.find((s) => s.id === "1042.temperature:q1")).toMatchObject({ type: "scatter", symbol: "triangle", name: "범위 초과" });
    expect(series.find((s) => s.id === "1042.temperature:q3")).toMatchObject({ type: "scatter", symbol: "diamond", name: "의심" });
    expect(series[0].connectNulls).toBe(false);
    expect(series.find((s) => s.id === "sim")?.lineStyle?.type).toBe("dashed");
    expect((option.legend as { data: string[] }).data).toEqual(["AM107 온도 (℃)", "범위 초과", "의심", "가상 온도 (℃)", "가상"]);
    expect(series[0].markLine).toBeDefined();
    expect(series[0].markArea?.data).toHaveLength(2);
    expect((option.yAxis as unknown[]).length).toBe(1);
    // 집계 계열(raw 아님)은 세 번째 값이 표본 수라 품질 점을 만들지 않는다
    expect(qualityPoints({ ...raw, raw: false }, 1)).toEqual([]);
  });

  it("단위가 둘이면 y축 둘, 셋째 단위부터 첫 축", () => {
    const s = (unit: string): ChartSeries => ({ key: unit, label: unit, unit, points: [] });
    expect([...axisIndexByUnit([s("℃"), s("ppm"), s("%")]).values()]).toEqual([0, 1, 1]);
    const option = buildChartOption([s("℃"), s("ppm")], { timezone: "UTC", labels: { outOfRange: "", suspect: "", virtual: "", noData: "", gap: "" } });
    expect((option.yAxis as unknown[]).length).toBe(2);
    expect(buildChartOption([], { timezone: "UTC", labels: { outOfRange: "", suspect: "", virtual: "", noData: "", gap: "" } }).yAxis).toHaveLength(1);
  });

  it("실시간 점 덧붙이기(오래된 점·같은 시각은 무시, 최대 개수 유지), 표로 보기, 데이터 유무", () => {
    const appended = appendPoint(raw, { t: "2026-10-03T01:03:00Z", v: 22.7 });
    expect(appended.points).toHaveLength(5);
    expect(appendPoint(appended, { t: "2026-10-03T01:03:00Z", v: 1 })).toBe(appended);
    expect(appendPoint(appended, { t: "2026-10-03T01:04:00Z", v: 1 }, 3).points).toHaveLength(3);
    const table = toTable([raw, { key: "b", label: "b", points: [["2026-10-03T00:00:00Z", 5, 0]] }]);
    expect(table[0]).toEqual({ time: "2026-10-03T00:00:00Z", values: [22, 5] });
    expect(table[1].values).toEqual([61, null]);
    expect(hasData([{ key: "x", label: "x", points: [["2026-10-03T00:00:00Z", null, null]] }])).toBe(false);
    expect(hasData([raw])).toBe(true);
  });

  it("TC-DSH-077 시각은 표시 시간대(UTC 01:00 → 서울 10:00), 소수 자릿수는 측정 항목 precision", () => {
    expect(axisLabel(Date.parse("2026-10-03T01:00:00Z"), "Asia/Seoul")).toBe("10-03 10:00");
    expect(tooltipTime("UTC", "en")(Date.parse("2026-10-03T01:00:00Z"))).toContain("01:00:00");
    expect(roundTo(22.345, 1)).toBe("22.3");
    expect(roundTo(22.345, undefined)).toBe("22.345");
    expect(roundTo(null, 1)).toBe("–");
  });
});

const tree: SpaceNode[] = [
  {
    id: "1",
    type: "SITE",
    name: "광주캠퍼스",
    children: [
      {
        id: "2",
        type: "BUILDING",
        name: "본관",
        children: [
          {
            id: "3",
            type: "FLOOR",
            name: "3층",
            children: [
              { id: "32", type: "ROOM", name: "사무실", sortOrder: 1 },
              { id: "31", type: "ROOM", name: "실습실", sortOrder: 0 },
            ],
          },
        ],
      },
    ],
  },
];

describe("DEV-01.01 공간 계층(BR-DEV-01·02·03)", () => {
  it("깊이 우선으로 펼치고 경로·하위 ID를 구한다", () => {
    const flat = flattenSpaces(tree);
    expect(flat.map((s) => s.name)).toEqual(["광주캠퍼스", "본관", "3층", "실습실", "사무실"]);
    expect(findSpace(tree, "31")?.path).toEqual(["광주캠퍼스", "본관", "3층", "실습실"]);
    expect(findSpace(tree, null)).toBeUndefined();
    expect(descendantIds(tree, "2").sort()).toEqual(["2", "3", "31", "32"]);
    expect(descendantIds(tree, "999")).toEqual([]);
    expect(spacePathLabel(["본관", { name: "3층" }])).toBe("본관 › 3층");
    expect(spacePathLabel([])).toBe("–");
  });

  it("최상위는 SITE만, 하위는 상위보다 작은 단위만(중간 생략 허용), 깊이 6이면 더 못 만든다", () => {
    expect(allowedChildTypes(null)).toEqual(["SITE"]);
    expect(allowedChildTypes({ type: "BUILDING", depth: 2 })).toEqual(["FLOOR", "ROOM", "ZONE"]);
    expect(allowedChildTypes({ type: "ZONE", depth: 5 })).toEqual(["ZONE"]);
    expect(allowedChildTypes({ type: "ROOM", depth: 6 })).toEqual([]);
    expect(allowedChildTypes({ type: "WEIRD", depth: 1 })).toEqual([]);
  });

  it("이동 대상에서 자기 자신과 하위는 빠진다(순환 금지)", () => {
    expect(moveTargets(tree, "3").map((s) => s.id)).toEqual(["1", "2"]);
    expect(moveTargets(tree, "31").map((s) => s.id)).toEqual(["1", "2", "3"]);
    expect(moveTargets(tree, "nope")).toEqual([]);
  });

  it("입력 검증: 이름 1~100, 사이트 시간대 필수, 코드 형식, 위·경도 범위", () => {
    expect(checkSpaceInput({ name: "", type: "SITE" })).toEqual({ name: "nameRequired", timezone: "timezoneRequired" });
    expect(checkSpaceInput({ name: "본관", type: "BUILDING", code: "a b", latitude: "91", longitude: "200" })).toEqual({ code: "codeInvalid", latitude: "latitudeInvalid", longitude: "longitudeInvalid" });
    expect(checkSpaceInput({ name: "본관", type: "X" })).toEqual({ type: "typeRequired" });
    expect(checkSpaceInput({ name: "광주", type: "SITE", timezone: "Asia/Seoul", latitude: "35.1", longitude: "126.8" })).toEqual({});
  });
});

describe("DSH-07.03 TC-DSH-076 언어별 숫자·날짜 형식, DSH-07.04 시간대", () => {
  it("숫자와 단위(영어만 띄어 씀), 날짜", () => {
    expect(formatNumber(1240.5, "en", { unit: "ppm" })).toBe("1,240.5 ppm");
    expect(formatNumber(1240.5, "ko", { unit: "ppm" })).toBe("1,240.5ppm");
    expect(formatNumber(22.345, "ja", { precision: 1 })).toBe("22.3");
    expect(formatNumber(null)).toBe("–");
    expect(formatDate("2026-10-03T01:00:00Z", "Asia/Seoul", "en")).toBe("Oct 3, 2026");
    expect(formatDate("2026-10-03T01:00:00Z", "Asia/Seoul", "ko")).toBe("2026. 10. 3.");
    expect(formatDate("2026-10-03T01:00:00Z", "Asia/Seoul", "ja")).toBe("2026/10/3");
    expect(formatDate("2026-10-03T01:00:00Z", "Asia/Seoul", "zh")).toBe("2026/10/3");
    expect(formatDate(null, "UTC")).toBe("–");
    expect(formatDate("x", "UTC")).toBe("–");
  });

  it("상대 시각과 기간 키", () => {
    const now = Date.parse("2026-10-04T00:00:00Z");
    expect(formatRelative("2026-10-03T23:59:48Z", now, "ko")).toBe("12초 전");
    expect(formatRelative("2026-10-03T23:50:00Z", now, "en")).toBe("10 minutes ago");
    expect(formatRelative("2026-10-03T22:00:00Z", now, "ko")).toBe("2시간 전");
    expect(formatRelative("2026-10-01T00:00:00Z", now, "ko")).toBe("3일 전");
    expect(formatRelative(null, now)).toBe("–");
    expect(formatRelative("x", now)).toBe("–");
    expect(rangeOf("1h", now)).toEqual({ from: "2026-10-03T23:00:00Z", to: "2026-10-04T00:00:00Z" });
    expect(rangeOf("unknown", now).from).toBe("2026-10-03T00:00:00Z");
  });
});

describe("브라우저 JSON 호출(bffJson)", () => {
  it("성공 응답·목록 봉투·204·실패·네트워크 오류", async () => {
    const reply = (status: number, body?: unknown) => async () => new Response(body === undefined ? null : JSON.stringify(body), { status });
    expect(await bffJson("/bff/api/core/x", {}, { fetchImpl: reply(200, { header: { resultCode: "SUCCESS" }, response: { a: 1 } }) })).toEqual({ ok: true, status: 200, data: { a: 1 } });
    const listed = await bffJson<{ responses: unknown[] }>("/x", {}, { fetchImpl: reply(200, { header: {}, responses: [1], totalCount: 1 }) });
    expect(listed.ok && listed.data.responses).toEqual([1]);
    expect(await bffJson("/x", { method: "DELETE" }, { fetchImpl: reply(204), csrfToken: "t" })).toEqual({ ok: true, status: 204, data: undefined });
    const failed = await bffJson("/x", { method: "POST", body: { a: 1 }, idempotencyKey: "k" }, { csrfToken: "t", fetchImpl: reply(409, { header: { resultCode: "VERSION_CONFLICT", resultMessage: "m" } }) });
    expect(failed).toMatchObject({ ok: false, status: 409, code: "VERSION_CONFLICT", message: "m" });
    expect(await bffJson("/x", {}, { fetchImpl: async () => Promise.reject(new Error("net")) })).toMatchObject({ ok: false, code: "SERVICE_UNAVAILABLE" });
    expect(clientIdempotencyKey()).toMatch(/[0-9a-f-]{8,}/);
  });
});

describe("IAM-01.07 공간 범위 폼 값", () => {
  it("트리 선택(여러 값)과 쉼표 입력을 모두 받고 중복은 하나로", () => {
    const form = new FormData();
    form.append("spaceScope", "3");
    form.append("spaceScope", "31, 3");
    form.append("spaceScope", "");
    expect(scopeFromForm(form)).toEqual(["3", "31"]);
    expect(scopeFromForm(new FormData())).toEqual([]);
  });
});

describe("DSH-07.02 테마 값", () => {
  it("쿠키·속성·다음 테마·현재 어두운지", () => {
    expect(themeFromCookie("a=1; data2flow_theme=DARK; b=2")).toBe("DARK");
    expect(themeFromCookie(undefined)).toBe("SYSTEM");
    expect(normalizeTheme("light")).toBe("LIGHT");
    expect(normalizeTheme("purple")).toBe("SYSTEM");
    expect([themeAttribute("SYSTEM"), themeAttribute("DARK"), themeAttribute("LIGHT")]).toEqual([undefined, "dark", "light"]);
    expect([nextTheme("SYSTEM"), nextTheme("LIGHT"), nextTheme("DARK")]).toEqual(["LIGHT", "DARK", "SYSTEM"]);
    expect(isDarkNow(undefined)).toBe(false);
    expect(isDarkNow({ documentElement: { dataset: { theme: "dark" } } } as unknown as Document)).toBe(true);
    expect(isDarkNow({ documentElement: { dataset: { theme: "light" } } } as unknown as Document)).toBe(false);
  });
});
