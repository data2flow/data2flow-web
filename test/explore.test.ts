/**
 * 데이터 탐색기 SSR + BFF 통합(UI-TSD-01): TSD-03.01·03.04·03.05, TSD-01.04·01.05, DSH-07.04.
 */
import { http, HttpResponse } from "msw";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TestBrowser, startApp, type AppContext } from "./app-harness";

let app: AppContext;
beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => app.reset());

async function as(loginId: string, password: string) {
  const browser = new TestBrowser(app);
  const result = await browser.login(loginId, password);
  expect(result.response.status).toBe(302);
  return browser;
}
const viewer = () => as("view.er", "Viewer-Pass-123");
const operator = () => as("kim.op", "Correct-Horse-9");

const q = (state: Record<string, unknown>) => `/explore?${new URLSearchParams({ q: JSON.stringify(state) })}`;
const device = (metric: string) => ({ kind: "device", id: "1042", metric, label: `AM107-067999 ${metric}` });
const received = (prefix: string) => app.gateway.received.filter((r) => r.path.startsWith(prefix));

describe("TSD-03.01 TC-TSD-056 기기·측정 항목·기간·집계 단위 조회", () => {
  it("TC-TSD-021 시계열이 없으면 안내만 보이고 시계열 API를 부르지 않는다", async () => {
    const browser = await viewer();
    const page = await browser.get("/explore");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("왼쪽에서 기기나 공간을 추가하세요");
    expect(received("/api/v1/core/telemetry")).toHaveLength(0);
  });

  it("단일 기기면 API-TSD-02 GET(측정 항목 묶음, UTC 기간, 표시 시간대 tz)", async () => {
    const browser = await viewer();
    const page = await browser.get(q({ series: [device("temperature"), device("co2")], range: "24h" }));
    expect(page.response.status).toBe(200);
    const [call] = received("/api/v1/core/telemetry/series");
    const url = new URL(`http://x${call.path}`);
    expect(url.searchParams.get("deviceId")).toBe("1042");
    expect(url.searchParams.get("metrics")).toBe("temperature,co2");
    expect(url.searchParams.get("from")).toBe("2026-10-03T00:00:00Z");
    expect(url.searchParams.get("to")).toBe("2026-10-04T00:00:00Z");
    expect(url.searchParams.get("tz")).toBe("Asia/Seoul");
    expect(url.searchParams.get("quality")).toBe("normal");
    expect(url.searchParams.get("virtual")).toBe("false");
    expect(page.body).toContain("자동 단위: 1분로 표시합니다");
  });

  it("두 기기·공간이 섞이면 API-TSD-04 POST(계열 목록·집계 함수·라벨)", async () => {
    const browser = await viewer();
    await browser.get(q({ series: [device("co2"), { kind: "device", id: "1050", metric: "temperature", label: "EM300 temperature" }, { kind: "space", id: "31", metric: "co2", agg: "max", label: "실습실 CO2" }] }));
    const [call] = received("/api/v1/core/telemetry/query");
    expect(call.method).toBe("POST");
    expect(call.body).toMatchObject({
      series: [
        { deviceId: "1042", metric: "co2", label: "AM107-067999 co2" },
        { deviceId: "1050", metric: "temperature" },
        { spaceId: "31", metric: "co2", agg: "max", label: "실습실 CO2" },
      ],
      resolution: "auto",
      quality: "normal",
      tz: "Asia/Seoul",
    });
    expect(received("/api/v1/core/telemetry/series")).toHaveLength(0);
  });

  it("다른 화면에서 여는 짧은 주소(?deviceId=&metrics=)도 같은 조회", async () => {
    const browser = await viewer();
    await browser.get("/explore?deviceId=1042&metrics=co2&label=AM107-067999");
    expect(received("/api/v1/core/telemetry/series")[0].path).toContain("metrics=co2");
  });

  it("입력 검증: 시작이 종료보다 늦으면 조회하지 않고 안내, 원본 31일 초과는 [1시간 집계로 보기]", async () => {
    const browser = await viewer();
    const bad = await browser.get(q({ series: [device("co2")], range: "custom", from: "2026-10-03T10:00:00Z", to: "2026-10-03T09:00:00Z" }));
    expect(bad.body).toContain("시작이 종료보다 늦습니다");
    const long = await browser.get(q({ series: [device("co2")], range: "90d", resolution: "raw" }));
    expect(long.body).toContain("원본은 31일까지 조회할 수 있습니다");
    expect(long.body).toContain("1시간 집계로 보기");
    expect(received("/api/v1/core/telemetry")).toHaveLength(0);
  });

  it("조회 실패(429 TSD_RATE_LIMITED)는 현지화 문구로", async () => {
    app.server.use(http.get("http://gateway.test/api/v1/core/telemetry/series", () => HttpResponse.json({ header: { isSuccessful: false, resultCode: "TSD_RATE_LIMITED", resultMessage: "" } }, { status: 429, headers: { "Retry-After": "12" } })));
    const browser = await viewer();
    const page = await browser.get(q({ series: [device("co2")] }));
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("조회가 너무 많습니다. 12초 후 다시 시도해 주세요.");
  });
});

describe("TSD-03.04·03.05 TC-TSD-082·090 품질·가상 데이터 필터", () => {
  it("AT-TSD-01.3 quality=normal은 범위 초과 점을 빼고, quality=all이면 포함한다(가상 포함 여부도 요청에 실림)", async () => {
    const browser = await viewer();
    await browser.get(q({ series: [device("temperature")], range: "1h", quality: "all", includeVirtual: true }));
    const call = received("/api/v1/core/telemetry/series")[0];
    expect(call.path).toContain("quality=all");
    expect(call.path).toContain("virtual=true");
  });
});

describe("TSD-01.04 TC-TSD-021 주석", () => {
  it("AT-TSD-11.2 같은 공간의 공간 범위 주석이 기기 차트에 보인다, VIEWER에게는 [주석 추가]가 없다", async () => {
    const browser = await viewer();
    const page = await browser.get(q({ series: [device("co2")] }));
    expect(received("/api/v1/core/annotations")[0].path).toContain("deviceId=1042");
    expect(page.body).toContain("창문 공사");
    expect(page.body).toContain("(공간 범위)");
    expect(page.body).not.toContain("주석 추가");
  });

  it("주석 종류를 끄면 그 종류는 숨긴다", async () => {
    const browser = await viewer();
    const page = await browser.get(q({ series: [device("co2")], annotations: ["OFFLINE"] }));
    expect(page.body).not.toContain("창문 공사");
  });

  it("TC-TSD-027 OPERATOR가 주석을 추가하면 사용자 시간대 입력을 UTC로 보내고(10:00 KST → 01:00Z), 본인 주석은 지울 수 있다", async () => {
    const browser = await operator();
    const path = q({ series: [device("co2")] });
    const page = await browser.get(path);
    expect(page.body).toContain("주석 추가");
    const saved = await browser.post(path, { intent: "annotate", title: "필터 교체", timeFrom: "2026-10-03T10:00", timeTo: "2026-10-03T11:30", timezone: "Asia/Seoul", target: "device:1042" });
    expect(saved.response.status).toBe(200);
    const post = received("/api/v1/core/annotations").find((r) => r.method === "POST");
    expect(post?.body).toEqual({ timeFrom: "2026-10-03T01:00:00Z", timeTo: "2026-10-03T02:30:00Z", deviceId: "1042", title: "필터 교체" });
    const after = await browser.get(path);
    expect(after.body).toContain("필터 교체");
    const id = (app.gateway.m2.extra.annotations as { id: string; title: string }[]).find((a) => a.title === "필터 교체")!.id;
    const removed = await browser.post(path, { intent: "delete-annotation", id });
    expect(removed.response.status).toBe(200);
    expect((app.gateway.m2.extra.annotations as { title: string }[]).some((a) => a.title === "필터 교체")).toBe(false);
  });

  it("주석 입력 검증(제목·시각)과 VIEWER가 직접 보내면 서버가 403 ANNOTATION_FORBIDDEN", async () => {
    const browser = await operator();
    const path = q({ series: [device("co2")] });
    await browser.get(path);
    const noTitle = await browser.post(path, { intent: "annotate", title: " ", timeFrom: "2026-10-03T10:00", timezone: "Asia/Seoul", target: "device:1042" });
    expect(noTitle.response.status).toBe(400);
    expect(noTitle.body).toContain("제목을 1~200자로 입력하세요");
    const badTime = await browser.post(path, { intent: "annotate", title: "x", timeFrom: "2026-10-03T10:00", timeTo: "2026-10-03T09:00", timezone: "Asia/Seoul", target: "space:31" });
    expect(badTime.response.status).toBe(400);
    const unknown = await browser.post(path, { intent: "nope" });
    expect(unknown.response.status).toBe(400);
    const v = await viewer();
    await v.get(path);
    const denied = await v.post(path, { intent: "annotate", title: "x", timeFrom: "2026-10-03T10:00", timezone: "Asia/Seoul", target: "space:31" });
    expect(denied.response.status).toBe(403);
    expect(denied.body).toContain("주석을 추가하거나 지울 권한이 없습니다.");
    const deniedDelete = await v.post(path, { intent: "delete-annotation", id: "a2" });
    expect(deniedDelete.response.status).toBe(403);
  });
});
