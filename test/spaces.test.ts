/**
 * 공간 화면 SSR + BFF 통합 테스트(UI-DEV-01·02·03, UI-DSH-02, UI-DEV-15): DEV-01.01~01.04, DEV-10.01, DEV-11.01, DSH-07.05.
 */
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
const integrator = () => as("lee.int", "Integrator-Pass1");
const operator = () => as("kim.op", "Correct-Horse-9");
const viewer = () => as("view.er", "Viewer-Pass-123");
const sent = (method: string, path: string) => app.gateway.received.filter((r) => r.method === method && r.path.split("?")[0] === path);

describe("DEV-01.01 공간 트리(UI-DEV-01)", () => {
  it("TC-DEV-006 /spaces는 첫 공간으로, 트리에 타입·기기 수, INTEGRATOR에게만 편집 도구", async () => {
    const browser = await integrator();
    const index = await browser.get("/spaces");
    expect(index.response.headers.get("Location")).toBe("/spaces/1");
    const page = await browser.get("/spaces/31");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("광주캠퍼스 › 본관 › 3층 › 실습실");
    expect(page.body).toContain("사이트 추가");
    expect(page.body).toContain("하위 추가");
    const vpage = await (await viewer()).get("/spaces/31");
    expect(vpage.response.status).toBe(200);
    expect(vpage.body).not.toContain("사이트 추가");
  });

  it("TC-DEV-006 [하위 추가] 저장 → 트리에 추가하고 선택, 같은 이름·입력 오류 안내", async () => {
    const browser = await integrator();
    await browser.get("/spaces/3");
    const created = await browser.post("/spaces/3", { intent: "create", parentId: "3", name: "회의실", type: "ROOM", code: "meet" });
    expect(created.response.status).toBe(302);
    const location = created.response.headers.get("Location")!;
    expect(sent("POST", "/api/v1/core/spaces")[0].body).toMatchObject({ parentId: "3", type: "ROOM", name: "회의실", code: "meet" });
    expect(sent("POST", "/api/v1/core/spaces")[0].headers["idempotency-key"]).toBeTruthy();
    const page = await browser.get(location);
    expect(page.body).toContain("회의실");
    const dup = await browser.post("/spaces/3", { intent: "create", parentId: "3", name: "회의실", type: "ROOM" });
    expect(dup.response.status).toBe(409);
    expect(dup.body).toContain("같은 이름의 공간이 이미 있습니다");
    const bad = await browser.post("/spaces/3", { intent: "create", name: "", type: "SITE", timezone: "", code: "a b", latitude: "95" });
    expect(bad.response.status).toBe(400);
    for (const text of ["이름을 입력하세요", "시간대를 선택하세요", "코드 형식이 올바르지 않습니다", "위도는 -90~90 사이여야 합니다"]) expect(bad.body).toContain(text);
  });

  it("TC-DEV-266 사이트 추가는 시간대·좌표와 함께, OPERATOR는 서버가 403", async () => {
    const browser = await integrator();
    await browser.get("/spaces/1");
    const site = await browser.post("/spaces/1", { intent: "create", name: "순천캠퍼스", type: "SITE", timezone: "Asia/Seoul", latitude: "34.95", longitude: "127.48", address: "순천시" });
    expect(site.response.status).toBe(302);
    expect(sent("POST", "/api/v1/core/spaces")[0].body).toMatchObject({ type: "SITE", timezone: "Asia/Seoul", latitude: 34.95, longitude: 127.48 });
    const op = await operator();
    await op.get("/spaces/1");
    const denied = await op.post("/spaces/1", { intent: "create", name: "x", type: "SITE", timezone: "UTC" });
    expect(denied.response.status).toBe(403);
    expect(denied.body).toContain("이 작업을 할 권한이 없습니다");
  });

  it("이름 바꾸기(baseVersion), 이동(순환 금지), 삭제(하위가 있으면 막힘 + 기기 보기)", async () => {
    const browser = await integrator();
    await browser.get("/spaces/32");
    expect((await browser.post("/spaces/32", { intent: "rename", id: "32", name: "교무실" })).response.status).toBe(302);
    expect(sent("PATCH", "/api/v1/core/spaces/32")[0].body).toEqual({ name: "교무실", baseVersion: 1 });
    expect((await browser.post("/spaces/32", { intent: "move", id: "32", newParentId: "2" })).response.status).toBe(302);
    const cycle = await browser.post("/spaces/2", { intent: "move", id: "2", newParentId: "31" });
    expect(cycle.response.status).toBe(409);
    expect(cycle.body).toContain("자기 하위 공간으로는 옮길 수 없습니다");
    const blocked = await browser.post("/spaces/3", { intent: "delete", id: "3" });
    expect(blocked.response.status).toBe(409);
    expect(blocked.body).toContain("하위 공간 1개, 기기 0대, 마커 0개, 작업 지시 0건이 있어 삭제할 수 없습니다.");
    expect(blocked.body).toContain('href="/devices?spaceId=3"');
    const removed = await browser.post("/spaces/32", { intent: "delete", id: "32" });
    expect(removed.response.headers.get("Location")).toBe("/spaces");
  });

  it("DSH-08.02 빈 조직은 시작 안내와 [사이트 추가], VIEWER는 관리자 요청 안내", async () => {
    app.gateway.m2.spaces = [];
    const browser = await integrator();
    const page = await browser.get("/spaces");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("첫 사이트를 만들어 시작하세요");
    expect(page.body).toContain("사이트 추가");
    const first = await browser.post("/spaces", { intent: "create", name: "광주캠퍼스", type: "SITE", timezone: "Asia/Seoul" });
    expect(first.response.status).toBe(302);
    app.gateway.m2.spaces = [];
    const v = await (await viewer()).get("/spaces");
    expect(v.body).toContain("관리자에게 요청하세요");
  });

  it("권한 밖·없는 공간은 404 화면", async () => {
    const page = await (await viewer()).get("/spaces/999");
    expect(page.response.status).toBe(404);
  });
});

describe("UI-DSH-02 공간 보기(DSH-01.02, DSH-07.05)", () => {
  it("개요: 쾌적도 배지·원인, 기기 카드 현재값, 하위 공간; 최근 본 항목 기록", async () => {
    app.gateway.m2.devices[0].latest[2].value = 1150;
    const browser = await viewer();
    const page = await browser.get("/spaces/31");
    expect(page.body).toContain("경고");
    expect(page.body).toContain("co2 1150ppm");
    expect(page.body).toContain('href="/devices/1042"');
    expect(page.body).toContain("AM107-067999");
    expect(sent("POST", "/api/v1/core/accounts/me/recent")[0].body).toEqual({ type: "SPACE", id: "31" });
    const floor = await browser.get("/spaces/3");
    expect(floor.body).toContain('href="/spaces/31"');
    expect(floor.body).toContain("이 공간에 기기가 없습니다");
  });

  it("TC-DSH-079 즐겨찾기 켜고 끄기(API-DSH-12 favorites, baseVersion)", async () => {
    const browser = await viewer();
    await browser.get("/spaces/31");
    expect((await browser.post("/spaces/31", { intent: "favorite" })).response.status).toBe(200);
    expect(sent("PUT", "/api/v1/core/accounts/me/preferences")[0].body).toEqual({ favorites: [{ type: "SPACE", id: "31" }], baseVersion: 1 });
    const page = await browser.get("/spaces/31");
    expect(page.body).toContain("즐겨찾기 해제");
    await browser.post("/spaces/31", { intent: "favorite" });
    expect(sent("PUT", "/api/v1/core/accounts/me/preferences")[1].body).toEqual({ favorites: [], baseVersion: 2 });
  });

  it("기기 탭은 하위 포함 기기 목록(API-DEV-11 spaceId)", async () => {
    const page = await (await viewer()).get("/spaces/3?tab=devices");
    expect(page.response.status).toBe(200);
    expect(sent("GET", "/api/v1/core/devices").at(-1)?.path).toContain("spaceId=3&includeDescendants=true");
  });
});

describe("DEV-01.02·01.04·11.01 관리 탭(UI-DEV-02)", () => {
  it("TC-DEV-014 속성 저장(PATCH baseVersion), VIEWER는 읽기 전용(저장 버튼 없음)", async () => {
    const browser = await integrator();
    const page = await browser.get("/spaces/31?tab=props");
    expect(page.body).toContain('value="66"');
    const saved = await browser.post("/spaces/31?tab=props", { intent: "props", baseVersion: "2", name: "실습실", code: "lab", usage: "LAB", areaM2: "70", capacity: "32" });
    expect(saved.response.status).toBe(200);
    expect(saved.body).toContain("저장했습니다");
    expect(sent("PATCH", "/api/v1/core/spaces/31")[0].body).toMatchObject({ usage: "LAB", areaM2: 70, capacity: 32, baseVersion: 2 });
    const conflict = await browser.post("/spaces/31?tab=props", { intent: "props", baseVersion: "2", name: "실습실", areaM2: "1" });
    expect(conflict.response.status).toBe(409);
    expect(conflict.body).toContain("다른 사용자가 먼저 수정했습니다");
    const bad = await browser.post("/spaces/31?tab=props", { intent: "props", baseVersion: "3", name: "실습실", areaM2: "-1" });
    expect(bad.response.status).toBe(400);
    const site = await browser.get("/spaces/1?tab=props");
    expect(site.body).toContain("기상청 격자 nx 59, ny 74");
    const v = await (await viewer()).get("/spaces/31?tab=props");
    expect(v.body).not.toMatch(/<button[^>]*type="submit"[^>]*>저장/);
  });

  it("TC-DEV-025 목표 환경: 상속 표시(상위 공간 이름), 직접 지정 저장, 최소>최대는 거부", async () => {
    const browser = await integrator();
    const page = await browser.get("/spaces/31?tab=targets");
    expect(page.body).toContain("상속: 광주캠퍼스");
    const saved = await browser.post("/spaces/31?tab=targets", { intent: "targets", items: JSON.stringify([{ metricKey: "co2", max: 900 }]) });
    expect(saved.response.status).toBe(200);
    expect(sent("PUT", "/api/v1/core/spaces/31/targets")[0].body).toEqual({ inherit: false, items: [{ metricKey: "co2", max: 900 }] });
    const bad = await browser.post("/spaces/31?tab=targets", { intent: "targets", items: JSON.stringify([{ metricKey: "co2", min: 9, max: 1 }]) });
    expect(bad.response.status).toBe(400);
    const unknown = await browser.post("/spaces/31?tab=targets", { intent: "targets", items: JSON.stringify([{ metricKey: "nope", max: 1 }]) });
    expect(unknown.body).toContain("측정 항목을 찾을 수 없습니다");
    await browser.post("/spaces/31?tab=targets", { intent: "targets", inherit: "true", items: "[]" });
    expect(sent("PUT", "/api/v1/core/spaces/31/targets").at(-1)?.body).toEqual({ inherit: true, items: [] });
  });

  it("TC-DEV-285 운영 시간: 상위 시간표 상속 안내, 저장, 같은 요일 겹침 거부, 모드 수동 지정(OPERATOR)", async () => {
    const browser = await integrator();
    const page = await browser.get("/spaces/31?tab=schedule");
    expect(page.body).toContain("상위 공간(광주캠퍼스)의 시간표를 따릅니다.");
    expect(page.body).toContain("운영 중");
    const slots = [{ dayOfWeek: 1, start: "09:00", end: "12:00" }];
    expect((await browser.post("/spaces/31?tab=schedule", { intent: "schedule", slots: JSON.stringify(slots) })).response.status).toBe(200);
    expect(sent("PUT", "/api/v1/core/spaces/31/schedule")[0].body).toEqual({ inherit: false, slots });
    const overlap = await browser.post("/spaces/31?tab=schedule", { intent: "schedule", slots: JSON.stringify([...slots, { dayOfWeek: 1, start: "11:00", end: "13:00" }]) });
    expect(overlap.response.status).toBe(400);
    expect(overlap.body).toContain("같은 요일의 시간 구간이 겹칩니다");
    // 운영 모드 수동 지정(override-mode)은 core M2에 없어 조회만(OPERATOR에게도 폼 없음, 서버로 보내지 않음)
    const op = await operator();
    const opPage = await op.get("/spaces/31?tab=schedule");
    expect(opPage.body).toContain("운영 중");
    expect(opPage.body).not.toContain("수동 지정 해제");
    const override = await op.post("/spaces/31?tab=schedule", { intent: "override", mode: "MAINTENANCE", until: new Date(Date.now() + 3600_000).toISOString() });
    expect(override.response.status).toBe(400);
    expect(sent("POST", "/api/v1/core/spaces/31/override-mode")).toHaveLength(0);
    const v = await (await viewer()).get("/spaces/31?tab=schedule");
    expect(v.body).not.toContain("수동 지정 해제");
  });
});

describe("DEV-01.03 평면도(UI-DEV-03)", () => {
  it("TC-DEV-019 평면도 없음 안내 + [업로드](INTEGRATOR), 업로드·마커 저장, 형식 오류", async () => {
    const browser = await integrator();
    const empty = await browser.get("/spaces/31?tab=floorplan");
    expect(empty.body).toContain("평면도 이미지를 올려 기기를 배치하세요");
    expect(empty.body).toContain("업로드");
    const form = new FormData();
    form.set("_csrf", browser.csrf);
    form.set("intent", "floorplan");
    form.set("file", new File([new Uint8Array(2048)], "3f.png", { type: "image/png" }));
    const uploaded = await browser.request("/spaces/31?tab=floorplan", { method: "POST", body: form });
    expect(uploaded.response.status).toBe(200);
    expect(app.gateway.m2.extra.lastFloorplanUpload).toBe(true);
    const badForm = new FormData();
    badForm.set("_csrf", browser.csrf);
    badForm.set("intent", "floorplan");
    badForm.set("file", new File(["x"], "plan.gif", { type: "image/gif" }));
    const bad = await browser.request("/spaces/31?tab=floorplan", { method: "POST", body: badForm });
    expect(bad.response.status).toBe(400);
    expect(bad.body).toContain("이미지 형식이나 크기가 올바르지 않습니다");
    const markers = await browser.post("/spaces/31?tab=floorplan", { intent: "markers", markers: JSON.stringify([{ deviceId: "1042", x: 0.25, y: 0.5 }, { deviceId: "x", x: 2, y: 0 }]) });
    expect(markers.response.status).toBe(200);
    expect(sent("PUT", "/api/v1/core/spaces/31/floorplan/markers")[0].body).toEqual({ markers: [{ deviceId: "1042", x: 0.25, y: 0.5 }] });
    const view = await (await viewer()).get("/spaces/31?tab=floorplan");
    // API-DEV-142: imageUrl(API 경로)은 브라우저가 BFF 중계로 읽는다
    expect(view.body).toContain('src="/bff/api/core/spaces/31/floorplan/image?v=1"');
    const image = await (await viewer()).get("/bff/api/core/spaces/31/floorplan/image?v=1");
    expect(image.response.status).toBe(200);
    expect(image.response.headers.get("Content-Type")).toBe("image/png");
    expect(view.body).toContain("AM107-067999");
    expect(view.body).not.toContain("편집 모드");
  });

  it("VIEWER는 평면도가 없으면 업로드 대신 안내", async () => {
    const page = await (await viewer()).get("/spaces/31?tab=floorplan");
    expect(page.body).toContain("평면도는 관리자가 올릴 수 있습니다.");
  });
});

describe("DEV-10.01 사이트(UI-DEV-15)", () => {
  it("TC-DEV-268 사이트 카드: 기기·오프라인·알람·쾌적, 좌표, 공간 링크", async () => {
    const page = await (await viewer()).get("/sites");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain('href="/spaces/1"');
    expect(page.body).toContain("기기 1 · 오프라인 0 · 알람 0");
    expect(page.body).toContain("35.15, 126.85");
    app.gateway.m2.spaces = [];
    expect((await (await viewer()).get("/sites")).body).toContain("아직 사이트가 없습니다");
  });
});
