/** 화면 부품 테스트용 가짜 SimApi(기본은 성공 응답). 필요한 메서드만 덮어쓴다 */
import { vi } from "vitest";
import type { SimApi } from "../api";

export function fakeSimApi(overrides: Partial<SimApi> = {}): SimApi & Record<keyof SimApi, ReturnType<typeof vi.fn>> {
  const ok = <T>(data: T) => Promise.resolve({ ok: true as const, status: 200, data });
  const api = {
    preview: vi.fn(() => ok({ series: { temperature: [{ t: "2026-08-12T00:00:00Z", v: 24 }], co2: [{ t: "2026-08-12T00:00:00Z", v: 450 }] } })),
    saveProfile: vi.fn(() => ok({ id: "301", name: "p", typeId: "21" })),
    profile: vi.fn(() => ok({ id: "301", name: "p", typeId: "21" })),
    device: vi.fn(),
    patchDevice: vi.fn(() => ok({})),
    createScenario: vi.fn(() => ok({ scenarioId: "700", version: 1 })),
    saveScenario: vi.fn(() => ok({ scenarioId: "601", version: 4 })),
    startRun: vi.fn(() => ok({ runId: "42", status: "RUNNING", seed: 1, accelerationEffective: 60 })),
    control: vi.fn((_id: string, action: string) => ok({ status: action === "pause" ? "PAUSED" : action === "resume" ? "RUNNING" : action === "stop" ? "STOPPED" : "CREATED" })),
    accelerate: vi.fn((_id: string, n: number) => ok({ accelerationRequested: n, accelerationEffective: n, throttled: false })),
    faults: vi.fn(() => ok({ responses: [] })),
    injectFault: vi.fn(() => ok({ faultIds: ["f1"] })),
    cancelFault: vi.fn(() => ok({})),
    replay: vi.fn(() => ok({ total: 20000, runId: "77" })),
    ...overrides,
  };
  return api as never;
}

export const failure = (status: number, code: string, errors?: { field: string; code: string; message: string }[]) => Promise.resolve({ ok: false as const, status, code, message: "", errors });
