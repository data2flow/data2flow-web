/**
 * 홈 SSR 통합 테스트(UI-DSH-01 뼈대): DSH-01.02 공간 쾌적도, DSH-08.02 빈 화면 안내.
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
  await browser.login(loginId, password);
  return browser;
}

describe("DSH-01.02 홈 공간 쾌적도", () => {
  it("TC-DSH-007 쾌적도 표(상태 배지 글자+기호, 원인 값), 요약 카드, 권한별 카드", async () => {
    app.gateway.m2.devices[0].latest[2].value = 1150;
    const op = await as("kim.op", "Correct-Horse-9");
    const page = await op.get("/");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("김운영님, 안녕하세요");
    expect(page.body).toContain("공간 쾌적도");
    expect(page.body).toContain("co2 1150ppm");
    expect(page.body).toContain("경고");
    expect(page.body).toContain('href="/devices/pending"');
    expect(page.body).toContain('href="/sources"');
    expect(page.body).toContain("실습실 고CO2");
    const viewer = await (await as("view.er", "Viewer-Pass-123")).get("/");
    expect(viewer.body).not.toContain('href="/devices/pending"');
    expect(viewer.body).not.toContain('href="/sources"');
  });

  it("요약 API가 실패해도 화면은 열리고 안내만 보인다", async () => {
    app.gateway.m2.extra.homeFails = true;
    const page = await (await as("kim.op", "Correct-Horse-9")).get("/");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("요약을 불러오지 못했습니다");
  });

  it("TC-DSH-084 빈 조직: 이유와 다음 행동(권한자는 소스 연결·공간 만들기, 그 외는 관리자 요청)", async () => {
    app.gateway.m2.spaces = [];
    app.gateway.m2.sources = [];
    const integrator = await (await as("lee.int", "Integrator-Pass1")).get("/");
    expect(integrator.body).toContain("아직 데이터가 없습니다");
    expect(integrator.body).toContain('href="/sources/new"');
    expect(integrator.body).toContain('href="/spaces"');
    const viewer = await (await as("view.er", "Viewer-Pass-123")).get("/");
    expect(viewer.body).toContain("관리자에게 요청하세요");
    expect(viewer.body).not.toContain('href="/sources/new"');
  });
});

describe("[DSH-01.01][DSH-01.03] 홈 요약 카드·타임라인(M4)", () => {
  it("TC-DSH-004 AT-DSH-01.1 열린 알람 카드(심각도 기호+글자, /alarms?state=ACTIVE), 타임라인 알람·자동 제어 링크", async () => {
    const page = await (await as("kim.op", "Correct-Horse-9")).get("/");
    expect(page.body).toContain('href="/alarms?state=ACTIVE"');
    expect(page.body).toContain('data-severity="critical"');
    expect(page.body).toContain('href="/alarms/1"');
    expect(page.body).toContain('href="/control/commands"');
    expect(page.body).toContain("자동, 플로우");
    expect(page.body).toContain("grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5");
  });
});
