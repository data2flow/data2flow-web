/**
 * M4 제어·기기 화면 SSR + BFF 통합: UI-ACT-07 비상 정지·전역 띠(ACT-06.03, 00-navigation §1.3), UI-ACT-04 장면, UI-ACT-05 예약, UI-ACT-06 인터락,
 * UI-ACT-09 드라이버, UI-ACT-10 기능 카탈로그, UI-ACT-03 일괄 제어(BFF 중계), UI-ACT-11 가동, UI-DEV-06 기기 상세 M4 탭(DEV-02.07), UI-DEV-12 일괄 작업(DEV-02.09).
 * 가짜 gateway: test/msw/handlers/control-m4.ts. 규칙·알람·유지보수 응답은 이 파일에서 server.use로 덮어쓴다.
 */
import { HttpResponse, http } from "msw";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TestBrowser, startApp, type AppContext } from "./app-harness";
import { GATEWAY, envelope } from "./msw/fake-gateway";
import { AIRCON_ID } from "./msw/handlers/control";
import { controlM4State } from "./msw/handlers/control-m4";

let app: AppContext;
const GW = `${GATEWAY}/api/v1/core`;

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
  await browser.get("/");
  return browser;
}
const operator = () => as("kim.op", "Correct-Horse-9");
const integrator = () => as("lee.int", "Integrator-Pass1");
const analyst = () => as("ana.lyst", "Analyst-Pass-123");
const viewer = () => as("view.er", "Viewer-Pass-123");

function json(browser: TestBrowser, path: string, method: string, body: unknown, headers: Record<string, string> = {}) {
  return browser.request(path, { method, headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": browser.csrf, ...headers }, body: JSON.stringify(body) });
}
const parse = (body: string) => JSON.parse(body) as { header: { resultCode: string }; response: Record<string, unknown> };
const state = () => controlM4State(app.gateway.m2);

describe("ACT-06.03 UI-ACT-07 자동화 비상 정지와 전역 띠", () => {
  it("TC-ACT-105 TC-ACT-107 AT-ACT-09.3 AT-ACT-09.4: OPERATOR 실행 → 다른 사용자 화면에 붉은 띠, 해제는 ADMIN·INTEGRATOR만(OPERATOR 403)", async () => {
    const op = await operator();
    const home = await op.get("/");
    expect(home.body).toContain('aria-label="자동화 비상 정지"');
    expect((await (await viewer()).get("/")).body).not.toContain('aria-label="자동화 비상 정지"');

    const started = await json(op, "/bff/api/core/emergency-stops", "POST", { scope: { type: "ORG" }, reason: "냉방 오작동 점검" });
    expect(started.response.status).toBe(201);
    const id = String(parse(started.body).response.id);
    const again = await json(op, "/bff/api/core/emergency-stops", "POST", { scope: { type: "ORG" }, reason: "다시" });
    expect(again.response.status).toBe(409);
    expect(parse(again.body).header.resultCode).toBe("EMERGENCY_STOP_ACTIVE");

    const view = await (await viewer()).get("/devices");
    expect(view.body).toContain("자동화 비상 정지 중 — 조직 전체 · 김운영");
    expect(view.body).toContain("냉방 오작동 점검");
    expect(view.body).not.toMatch(/>해제</);

    const opView = await op.get("/");
    expect(opView.body).not.toMatch(/>해제</);
    const denied = await json(op, `/bff/api/core/emergency-stops/${id}/release`, "POST", {});
    expect(denied.response.status).toBe(403);

    const int = await integrator();
    expect((await int.get("/")).body).toMatch(/>해제</);
    const released = await json(int, `/bff/api/core/emergency-stops/${id}/release`, "POST", { note: "점검 끝" });
    expect(released.response.status).toBe(200);
    expect((await int.get("/")).body).not.toContain("자동화 비상 정지 중");
  });

  it("공간 범위 비상 정지는 공간 이름으로, 진행 중 유지보수는 주황 띠(API-OPS-23)", async () => {
    state().stops.push({
      emergencyStopId: "9",
      scope: { type: "SPACE", spaceId: "31", includeChildren: true },
      reason: "점검",
      startedBy: { userId: "8", name: "이통합" },
      startedAt: "2026-10-04T00:00:00Z",
      releasedBy: null,
      releasedAt: null,
      releaseNote: null,
      active: true,
    });
    app.server.use(
      http.get(`${GW}/maintenance-windows`, () =>
        HttpResponse.json({
          ...envelope(),
          page: 1,
          size: 20,
          totalPages: 1,
          totalCount: 1,
          responses: [
            {
              id: "77",
              targetType: "SPACE",
              targetId: "31",
              targetName: "본관 › 3층 › 실습실",
              startsAt: "2026-10-03T23:00:00Z",
              endsAt: null,
              pauseAutomation: true,
              reason: "필터 교체",
              status: "ACTIVE",
              version: 1,
            },
          ],
        }),
      ),
    );
    const page = await (await viewer()).get("/");
    expect(page.body).toContain("실습실 전체");
    expect(page.body).toContain("유지보수 중 — 본관 › 3층 › 실습실");
    expect(page.body).toContain("필터 교체");
    expect(page.body).not.toMatch(/>종료</);
    expect((await (await operator()).get("/")).body).toMatch(/>종료</);
  });

  it("비상 정지·유지보수를 못 읽어도 화면은 열린다", async () => {
    app.server.use(http.get(`${GW}/emergency-stops`, () => HttpResponse.json(envelope(undefined, "SERVICE_UNAVAILABLE"), { status: 503 })));
    const page = await (await viewer()).get("/devices");
    expect(page.response.status).toBe(200);
    expect(page.body).not.toContain("자동화 비상 정지 중");
  });
});

describe("ACT-05 UI-ACT-04 장면", () => {
  it("OPERATOR(SCENE_RUN): 목록과 실행 링크, 새 장면 없음 · INTEGRATOR(SCENE_MANAGE): 새 장면·편집 · VIEWER 403", async () => {
    const op = await operator();
    const list = await op.get("/control/scenes");
    expect(list.response.status).toBe(200);
    expect(list.body).toContain("수업 모드");
    expect(list.body).toContain('href="/control/scenes/501"');
    expect(list.body).not.toContain("새 장면");
    expect(list.body).toContain('href="/control/commands"');
    const detail = await op.get("/control/scenes/501");
    expect(detail.body).toContain("관리 권한이 없어 보기만 할 수 있습니다");
    expect(detail.body).toContain("mode=cool, targetTemperature=24");
    expect(detail.body).toMatch(/>실행</);

    const int = await integrator();
    expect((await int.get("/control/scenes")).body).toContain("새 장면");
    expect((await int.get("/control/scenes/new")).response.status).toBe(200);
    expect((await (await viewer()).get("/control/scenes")).response.status).toBe(403);
  });

  it("TC-ACT-094 AT-ACT-05.1 미리보기·실행 BFF 중계, TC-ACT-090 항목 101개는 SCENE_ITEM_LIMIT_EXCEEDED", async () => {
    const int = await integrator();
    await int.get("/control/scenes/501");
    const preview = await json(int, "/bff/api/core/scenes/501/preview", "POST", {});
    expect((parse(preview.body).response.items as { willChange: boolean }[]).filter((i) => !i.willChange)).toHaveLength(1);
    const run = await json(int, "/bff/api/core/scenes/501/run", "POST", {}, { "Idempotency-Key": "scene-1" });
    expect(run.response.status).toBe(202);
    const items = Array.from({ length: 101 }, () => ({ target: { deviceId: AIRCON_ID }, capability: "Switch", desired: { on: true } }));
    const tooMany = await json(int, "/bff/api/core/scenes", "POST", { name: "큰 장면", items });
    expect(tooMany.response.status).toBe(400);
    expect(parse(tooMany.body).header.resultCode).toBe("SCENE_ITEM_LIMIT_EXCEEDED");
  });
});

describe("ACT-02.07 UI-ACT-05 예약 제어", () => {
  it("INTEGRATOR: 목록(대상·다음 실행·마지막 결과), OPERATOR는 403(SCHEDULE_MANAGE 없음), cron 오류 SCHEDULE_INVALID", async () => {
    const int = await integrator();
    const page = await int.get("/control/schedules");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("아침 준비");
    expect(page.body).toContain("장면 수업 모드");
    expect(page.body).toContain("다음 실행: ");
    expect(page.body).toContain("성공");
    const bad = await json(int, "/bff/api/core/control-schedules", "POST", { name: "잘못", target: { sceneId: "501" }, kind: "RECURRING", cron: "매일", skipHolidays: true });
    expect(parse(bad.body).header.resultCode).toBe("SCHEDULE_INVALID");
    expect((await (await operator()).get("/control/schedules")).response.status).toBe(403);
  });
});

describe("ACT-06.02 UI-ACT-06 인터락", () => {
  it("INTEGRATOR: 이름·공간(하위 포함)·금지 대상·7일 차단 수, OPERATOR 403", async () => {
    const page = await (await integrator()).get("/control/interlocks");
    expect(page.body).toContain("창문 열림 시 냉난방 금지");
    expect(page.body).toContain("실습실");
    expect(page.body).toContain("Thermostat.set · mode ∈ {cool, heat}");
    expect(page.body).toContain(">4<");
    expect((await (await operator()).get("/control/interlocks")).response.status).toBe(403);
  });
});

describe("ACT-03.05·03.06 UI-ACT-09 드라이버", () => {
  it("TC-ACT-077 TC-ACT-082: 서킷 열림 경고·오류율·열린 시각, 비밀값은 화면에 없음, OPERATOR 403", async () => {
    const page = await (await integrator()).get("/control/drivers");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("LG ThinQ 본관");
    expect(page.body).toContain("서킷 열림");
    expect(page.body).toContain("62%");
    expect(page.body).toContain("12ms");
    expect(page.body).not.toContain("d2f-secret");
    expect((await (await operator()).get("/control/drivers")).response.status).toBe(403);
  });

  it("TC-ACT-079 연결 확인 실패는 502 DRIVER_HEALTHCHECK_FAILED, 저장 응답은 hasSecret만", async () => {
    const int = await integrator();
    await int.get("/control/drivers");
    const failed = await json(int, "/bff/api/core/drivers/test", "POST", { name: "x", type: "LORAWAN", config: { chirpstackUrl: "http://unreachable" } });
    expect(failed.response.status).toBe(502);
    const created = await json(int, "/bff/api/core/drivers", "POST", {
      name: "본관 LoRaWAN",
      type: "LORAWAN",
      config: { chirpstackUrl: "http://cs.test", applicationId: "1", fPortDefault: 10 },
      secret: { apiToken: "d2f-secret" },
    });
    expect(created.response.status).toBe(201);
    expect(created.body).not.toContain("d2f-secret");
    expect(parse(created.body).response.hasSecret).toBe(true);
  });
});

describe("ACT-01.04 UI-ACT-10 기능 카탈로그", () => {
  it("TC-ACT-009 TC-ACT-011 AT-ACT-13.1·13.2: OPERATOR 조회만, INTEGRATOR 추가 버튼, 표준 이름은 409 CAPABILITY_NAME_RESERVED", async () => {
    const op = await operator();
    const page = await op.get("/control/capabilities");
    expect(page.body).toContain("Thermostat");
    expect(page.body).not.toContain("사용자 정의 기능 추가");
    const int = await integrator();
    expect((await int.get("/control/capabilities")).body).toContain("사용자 정의 기능 추가");
    const reserved = await json(int, "/bff/api/core/capabilities", "POST", { name: "Switch", attributes: [{ name: "on", type: "boolean" }], commands: [] });
    expect(reserved.response.status).toBe(409);
    expect(parse(reserved.body).header.resultCode).toBe("CAPABILITY_NAME_RESERVED");
    const custom = await json(int, "/bff/api/core/capabilities", "POST", {
      name: "custom.Humidifier",
      attributes: [{ name: "targetHumidity", type: "integer", min: 30, max: 70 }],
      commands: [{ name: "set", sets: ["targetHumidity"] }],
    });
    expect(custom.response.status).toBe(201);
    expect((await (await viewer()).get("/control/capabilities")).response.status).toBe(403);
  });
});

describe("ACT-02.06 UI-ACT-03 일괄 제어(BFF 중계)", () => {
  it("TC-ACT-056 미리보기·실행·진행, 500대 초과는 COMMAND_BULK_LIMIT_EXCEEDED, ANALYST 403", async () => {
    const op = await operator();
    const list = await op.get("/devices");
    expect(list.response.status).toBe(200);
    const preview = await json(
      op,
      "/bff/api/core/commands/bulk",
      "POST",
      { target: { deviceIds: [AIRCON_ID] }, capability: "Switch", command: "set", args: { on: true }, preview: true },
      { "Idempotency-Key": "b-1" },
    );
    expect((parse(preview.body).response.devices as unknown[]).length).toBe(1);
    const run = await json(
      op,
      "/bff/api/core/commands/bulk",
      "POST",
      { target: { deviceIds: [AIRCON_ID, "1042"] }, capability: "Switch", command: "set", args: { on: true }, preview: false },
      { "Idempotency-Key": "b-2" },
    );
    expect(run.response.status).toBe(202);
    const job = await op.get(`/bff/api/core/command-bulk-jobs/${parse(run.body).response.bulkJobId}`);
    expect(parse(job.body).response.queued).toBe(1);
    const tooMany = await json(
      op,
      "/bff/api/core/commands/bulk",
      "POST",
      { target: { deviceIds: Array.from({ length: 501 }, (_, i) => String(i)) }, capability: "Switch", command: "set", args: { on: true } },
      { "Idempotency-Key": "b-3" },
    );
    expect(parse(tooMany.body).header.resultCode).toBe("COMMAND_BULK_LIMIT_EXCEEDED");
    const denied = await json(
      await analyst(),
      "/bff/api/core/commands/bulk",
      "POST",
      { target: { deviceIds: [AIRCON_ID] }, capability: "Switch", command: "set", args: { on: true } },
      { "Idempotency-Key": "b-4" },
    );
    expect(denied.response.status).toBe(403);
  });
});

describe("DEV-02.07 UI-DEV-06 기기 상세 M4 탭", () => {
  it("TC-DEV-069 AT-DEV-05.4: 액추에이터 [제어] 버튼은 제어 권한자만, VIEWER에게는 편집·삭제·제어 버튼이 없다", async () => {
    const op = await (await operator()).get(`/devices/${AIRCON_ID}`);
    const controlButton = `border-accent hover:opacity-90" href="/devices/${AIRCON_ID}?tab=control"`;
    expect(op.body).toContain(controlButton);
    expect(op.body).toContain(">가동<");
    const view = await (await viewer()).get(`/devices/${AIRCON_ID}`);
    expect(view.body).not.toContain(controlButton);
    expect(view.body).not.toContain("?edit=1");
    expect(view.body).not.toMatch(/>삭제</);
    const sensor = await (await operator()).get("/devices/1042");
    expect(sensor.body).not.toContain(">가동<");
  });

  it("TC-DEV-067 변경 이력 탭(API-DEV-27): 누가·언제·무엇", async () => {
    const page = await (await viewer()).get("/devices/1042?tab=history");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("이통합");
    expect(page.body).toContain("name: AM107 → 실습실 AM107");
    expect(page.body).toContain("승인");
    expect(app.gateway.received.some((r) => r.path.startsWith("/api/v1/core/devices/1042/history"))).toBe(true);
  });

  it("규칙·알람 탭: 적용 규칙(직접·공간 경유)과 이 기기의 열린 알람, VIEWER는 알람만", async () => {
    app.server.use(
      http.get(`${GW}/rules`, ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        void auth;
        return HttpResponse.json({
          ...envelope(),
          page: 1,
          size: 100,
          totalPages: 1,
          totalCount: 3,
          responses: [
            {
              ruleId: "r1",
              name: "실습실 고CO2",
              status: "ACTIVE",
              conditionSummary: "co2 > 1000 · 5분",
              scope: { type: "SPACE", ids: ["3"], includeChildren: true },
              severity: "MAJOR",
              openAlarms: 1,
            },
            { ruleId: "r2", name: "AM107 저배터리", status: "ACTIVE", conditionSummary: "battery < 20", scope: { type: "DEVICE", ids: ["1042"] }, severity: "WARNING", openAlarms: 0 },
            { ruleId: "r3", name: "사무실 온도", status: "ACTIVE", conditionSummary: "temperature > 28", scope: { type: "SPACE", ids: ["32"] }, severity: "MINOR", openAlarms: 0 },
          ],
        });
      }),
      http.get(`${GW}/alarms`, () =>
        HttpResponse.json({
          ...envelope(),
          page: 1,
          size: 100,
          totalPages: 1,
          totalCount: 2,
          responses: [
            { id: "a1", severity: "MAJOR", status: "ACTIVE", title: "실습실 CO2 1,240ppm", device: { id: "1042", name: "AM107" }, raisedAt: "2026-10-03T23:40:00Z" },
            { id: "a2", severity: "MINOR", status: "ACTIVE", title: "다른 기기 알람", device: { id: "9999", name: "x" }, raisedAt: "2026-10-03T23:41:00Z" },
          ],
        }),
      ),
    );
    const op = await (await operator()).get("/devices/1042?tab=rules");
    expect(op.body).toContain("실습실 고CO2");
    expect(op.body).toContain("공간 경유");
    expect(op.body).toContain("AM107 저배터리");
    expect(op.body).toContain("직접");
    expect(op.body).not.toContain("사무실 온도");
    expect(op.body).toContain("실습실 CO2 1,240ppm");
    expect(op.body).not.toContain("다른 기기 알람");
    expect(op.body).toContain("규칙 템플릿 적용");
    const view = await (await viewer()).get("/devices/1042?tab=rules");
    expect(view.body).toContain("실습실 CO2 1,240ppm");
    expect(view.body).not.toContain("이 기기에 적용되는 규칙");
  });

  it("DEV-09.01 온보딩 체크리스트: 미완료 '규칙'은 규칙 템플릿 바로가기", async () => {
    const page = await (await operator()).get("/devices/1042");
    expect(page.body).toContain('href="/rules/new?deviceId=1042&amp;spaceId=31"');
  });

  it("UI-ACT-11 가동 탭은 화면에서 API-ACT-35를 부른다(BFF 중계)", async () => {
    const op = await operator();
    const page = await op.get(`/devices/${AIRCON_ID}?tab=operation`);
    expect(page.response.status).toBe(200);
    const runtime = await op.get(`/bff/api/core/devices/${AIRCON_ID}/runtime?from=2026-09-27T00:00:00Z&to=2026-10-04T00:00:00Z&step=day`);
    expect((parse(runtime.body).response.items as unknown[]).length).toBe(2);
  });
});

describe("DEV-02.09 UI-DEV-12 일괄 작업", () => {
  it("TC-DEV-079: VIEWER 목록만(새 작업 없음), INTEGRATOR 마법사(선택 기기), 상세의 실패만·실패분 다시 실행(AT-DEV-14.1·14.2)", async () => {
    const view = await (await viewer()).get("/device-jobs");
    expect(view.response.status).toBe(200);
    expect(view.body).toContain("#42 공간 이동");
    expect(view.body).toContain("일부 실패");
    expect(view.body).not.toContain("새 일괄 작업");
    const detailView = await (await viewer()).get("/device-jobs/42");
    expect(detailView.body).toContain("EM300-TH-151777");
    expect(detailView.body).not.toContain("실패분 다시 실행");

    const int = await integrator();
    const wizard = await int.get("/device-jobs?new=1&deviceIds=1042,2001");
    expect(wizard.body).toContain("선택한 기기 2대");
    expect(wizard.body).toContain("일괄 작업 마법사");
    const detail = await int.get("/device-jobs/42");
    expect(detail.body).toContain("48 성공 · 2 실패 / 50");
    expect(detail.body).toContain("실패분 다시 실행");
    const retried = await json(int, "/bff/api/core/device-jobs/42/retry-failed", "POST", {}, { "Idempotency-Key": "j-1" });
    expect(retried.response.status).toBe(201);
    expect(parse(retried.body).response.total).toBe(2);
    expect(parse(retried.body).response.retryOfJobId).toBe("42");

    const op = await operator();
    const denied = await json(op, "/bff/api/core/device-jobs", "POST", { type: "SET_SPACE", target: { deviceIds: ["1042"] }, params: { spaceId: "31" } }, { "Idempotency-Key": "j-2" });
    expect(denied.response.status).toBe(403);
  });

  it("동시 작업 3개면 429 JOB_LIMIT_EXCEEDED", async () => {
    for (let i = 0; i < 3; i += 1) state().jobs.push({ id: `r${i}`, type: "SET_SPACE", status: "RUNNING", total: 1, succeeded: 0, failed: 0 });
    const int = await integrator();
    await int.get("/device-jobs");
    const limited = await json(int, "/bff/api/core/device-jobs", "POST", { type: "SET_SPACE", target: { deviceIds: ["1042"] }, params: { spaceId: "31" } }, { "Idempotency-Key": "j-3" });
    expect(limited.response.status).toBe(429);
    expect(parse(limited.body).header.resultCode).toBe("JOB_LIMIT_EXCEEDED");
  });
});
