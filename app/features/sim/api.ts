/**
 * 가상 환경 화면이 브라우저에서 부르는 API(BFF `/bff/api/core/sim/**`, design/api/SIM-api.md).
 * 화면 부품은 이 묶음을 받아 쓰고, 테스트는 가짜 묶음을 넣는다.
 */
import { bffJson, clientIdempotencyKey, type BffJsonResult } from "~/lib/bff-client";
import type { PropertyDef, PropertyRow, Scenario, SimFault, SimProfile, SimRun, VirtualDeviceConfig } from "./model/types";

export interface SimApi {
  preview(body: Record<string, unknown>): Promise<BffJsonResult<{ series: Record<string, { t: string; v: number }[]> }>>;
  saveProfile(id: string, body: { name: string; typeId: string; overrides: Record<string, unknown>; baseVersion?: number }): Promise<BffJsonResult<SimProfile>>;
  profile(id: string): Promise<BffJsonResult<SimProfile>>;
  device(id: string): Promise<BffJsonResult<VirtualDeviceConfig>>;
  patchDevice(id: string, body: Record<string, unknown>): Promise<BffJsonResult<unknown>>;
  createScenario(body: Record<string, unknown>): Promise<BffJsonResult<Scenario>>;
  saveScenario(id: string, body: Record<string, unknown>): Promise<BffJsonResult<Scenario>>;
  startRun(body: Record<string, unknown>): Promise<BffJsonResult<{ runId: string; status: string; seed: number; accelerationEffective: number }>>;
  control(runId: string, action: "pause" | "resume" | "stop" | "reset"): Promise<BffJsonResult<Partial<SimRun>>>;
  accelerate(runId: string, acceleration: number): Promise<BffJsonResult<Partial<SimRun>>>;
  faults(runId: string | null): Promise<BffJsonResult<{ responses: SimFault[] }>>;
  injectFault(body: Record<string, unknown>): Promise<BffJsonResult<{ faultIds: string[] }>>;
  cancelFault(faultId: string): Promise<BffJsonResult<SimFault>>;
  replay(body: Record<string, unknown>, dryRun: boolean): Promise<BffJsonResult<{ runId?: string; total: number; byDevice?: Record<string, number>; clones?: { cloneDeviceId: string; name: string }[] }>>;
}

const base = "/bff/api/core/sim";
const enc = encodeURIComponent;

export const simApi: SimApi = {
  preview: (body) => bffJson(`${base}/preview`, { method: "POST", body }),
  saveProfile: (id, body) => bffJson(`${base}/profiles/${enc(id)}`, { method: "PUT", body }),
  profile: (id) => bffJson(`${base}/profiles/${enc(id)}`),
  device: (id) => bffJson(`${base}/devices/${enc(id)}`),
  patchDevice: (id, body) => bffJson(`${base}/devices/${enc(id)}`, { method: "PATCH", body }),
  createScenario: (body) => bffJson(`${base}/scenarios`, { method: "POST", body }),
  saveScenario: (id, body) => bffJson(`${base}/scenarios/${enc(id)}`, { method: "PUT", body }),
  startRun: (body) => bffJson(`${base}/runs`, { method: "POST", body, idempotencyKey: clientIdempotencyKey() }),
  control: (runId, action) => bffJson(`${base}/runs/${enc(runId)}/${action}`, { method: "POST" }),
  accelerate: (runId, acceleration) => bffJson(`${base}/runs/${enc(runId)}`, { method: "PATCH", body: { acceleration } }),
  faults: (runId) => bffJson(`${base}/faults${runId ? `?runId=${enc(runId)}` : ""}`),
  injectFault: (body) => bffJson(`${base}/faults`, { method: "POST", body }),
  cancelFault: (faultId) => bffJson(`${base}/faults/${enc(faultId)}/cancel`, { method: "POST" }),
  replay: (body, dryRun) => bffJson(`${base}/replays${dryRun ? "?dryRun=true" : ""}`, { method: "POST", body, idempotencyKey: dryRun ? undefined : clientIdempotencyKey() }),
};

/** 특성 행을 이름 순서 그대로(정의 순서) 돌려준다. 정의만 있고 값이 없으면 기본값·카탈로그 */
export function rowsFromDefs(defs: PropertyDef[], overrides: Record<string, unknown> | null | undefined): PropertyRow[] {
  return defs.map((def) => {
    const has = overrides && Object.prototype.hasOwnProperty.call(overrides, def.key) && overrides[def.key] !== null;
    return { key: def.key, value: has ? overrides![def.key] : def.default, origin: has ? "PROFILE" : "CATALOG", def };
  });
}
