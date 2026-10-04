/**
 * 알람 화면이 브라우저에서 부르는 API(BFF `/bff/api/core/**`, design/api/RUL-api.md API-RUL-12·25).
 * 목록 화면의 일괄 확인·무음처럼 화면을 떠나지 않는 작업만 둔다. 상세 화면의 단건 처리는 라우트 action(폼)이 한다.
 */
import { bffJson, clientIdempotencyKey, type BffJsonResult } from "~/lib/bff-client";
import type { BulkResult } from "./model/alarms";

export interface AlarmsApi {
  /** API-RUL-12 일괄 확인(≤200건) */
  bulkAck(alarmIds: string[]): Promise<BffJsonResult<{ results: BulkResult[] }>>;
  /** API-RUL-25 무음 하나 */
  silence(body: Record<string, unknown>): Promise<BffJsonResult<{ silenceId: string }>>;
}

const base = "/bff/api/core";

export const alarmsApi: AlarmsApi = {
  bulkAck: (alarmIds) => bffJson(`${base}/alarms/bulk-ack`, { method: "POST", body: { alarmIds }, idempotencyKey: clientIdempotencyKey() }),
  silence: (body) => bffJson(`${base}/silences`, { method: "POST", body, idempotencyKey: clientIdempotencyKey() }),
};
