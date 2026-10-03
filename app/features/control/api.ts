/**
 * 제어 화면이 브라우저에서 부르는 API(BFF `/bff/api/core/**`, design/api/ACT-api.md). 화면 부품은 이 묶음을 받아 쓰고, 테스트는 가짜 묶음을 넣는다.
 */
import { bffJson, clientIdempotencyKey, type BffJsonResult } from "~/lib/bff-client";
import type { Command, ControlInfo, Shadow } from "./model/control";

export interface CommandRequest {
  capability: string;
  command: string;
  args: Record<string, unknown>;
  validitySeconds?: number;
  wait?: "none" | "ack" | "applied";
}

export interface ControlApi {
  /** API-ACT-03 */
  control(deviceId: string): Promise<BffJsonResult<ControlInfo>>;
  /** API-ACT-04 */
  shadow(deviceId: string): Promise<BffJsonResult<Shadow>>;
  /** API-ACT-01(Idempotency-Key 필수). 실패 응답의 commandId는 거부된 명령 ID */
  command(deviceId: string, body: CommandRequest, idempotencyKey?: string): Promise<BffJsonResult<Command>>;
  /** API-ACT-02 */
  commandDetail(commandId: string): Promise<BffJsonResult<Command>>;
  cancel(commandId: string): Promise<BffJsonResult<Command>>;
  /** API-ACT-06 */
  releaseOverride(deviceId: string, capability: string): Promise<BffJsonResult<void>>;
}

const base = "/bff/api/core";
const enc = encodeURIComponent;

export const controlApi: ControlApi = {
  control: (deviceId) => bffJson(`${base}/devices/${enc(deviceId)}/control`),
  shadow: (deviceId) => bffJson(`${base}/devices/${enc(deviceId)}/shadow`),
  command: (deviceId, body, idempotencyKey) => bffJson(`${base}/devices/${enc(deviceId)}/commands`, { method: "POST", body: { wait: "none", ...body }, idempotencyKey: idempotencyKey ?? clientIdempotencyKey() }),
  commandDetail: (commandId) => bffJson(`${base}/commands/${enc(commandId)}`),
  cancel: (commandId) => bffJson(`${base}/commands/${enc(commandId)}/cancel`, { method: "POST", body: {} }),
  releaseOverride: (deviceId, capability) => bffJson(`${base}/devices/${enc(deviceId)}/manual-override?capability=${enc(capability)}`, { method: "DELETE" }),
};
