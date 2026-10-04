/**
 * 기기·모델 데이터 관리 화면 모델(DEV-13.03·03.04·13.04·05.02). 필드는 core 컨트롤러 DTO(DeviceSearchDtos·ModelExchangeDtos·GatewayDtos)를 따른다.
 */
import { findSpace, type SpaceNode } from "~/lib/spaces";

/** API-DEV-134 저장된 검색 */
export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  shared: boolean;
  ownerId?: string | null;
  ownerName?: string | null;
  updatedAt?: string | null;
}

/** API-DEV-133 검색식 실행 결과 건수 */
export interface QueryCounts {
  total: number;
  tookMs: number;
}

export type ModelExportFormat = "data2flow" | "dtdl";

/** API-DEV-45 응답(dryRun이면 model은 null, createdMetrics는 만들 예정) */
export interface ImportResult {
  dryRun: boolean;
  format: string;
  model: { id: string; code: string; name: string } | null;
  createdMetrics: string[];
  unmapped: { path: string; type: string; reason: string }[];
  scripts: { id?: string | null; name: string; kind: string; status?: string | null }[];
}

export const STANDARD_FORMATS = ["DTDL", "NGSI_LD", "BRICK_TTL", "BRICK_JSONLD"] as const;
export type StandardFormat = (typeof STANDARD_FORMATS)[number];

/** API-DEV-135 요청 */
export interface StandardExportRequest {
  format: StandardFormat;
  scope: { spaceIds: string[]; deviceIds: string[] };
  includeValues: boolean;
}

/** API-DEV-135 작업 상태. report: {exported, skipped[{deviceId,type,reason}], …형식별 요약} */
export interface ExportJob {
  id: string;
  format: string;
  status: string;
  downloadUrl?: string | null;
  report?: { exported?: number; skipped?: { deviceId?: string; type?: string; reason?: string }[] } & Record<string, unknown>;
}

/** API-DEV-136 NGSI-LD 주기 전송 */
export interface NgsiPush {
  id: string;
  outputConnectionId: string;
  scope: { spaceIds: string[]; deviceIds: string[] };
  intervalSec: number;
  enabled: boolean;
  lastSentAt?: string | null;
  lastError?: string | null;
}

/** 작업이 끝났나(DONE·FAILED). 그 밖이면 다시 조회한다 */
export function jobFinished(status: string | undefined): boolean {
  return status === "DONE" || status === "FAILED" || status === "COMPLETED";
}

/** core 다운로드 주소(`/api/v1/core/...`)를 BFF 중계 주소로 */
export function toBffUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/^(https?:\/\/[^/]+)?\/api\/v1\//, "/bff/api/");
}

/** 모델 내보내기 파일 이름: `{코드}.data2flow.json` · `{코드}.dtdl.json` */
export function modelFileName(code: string, format: ModelExportFormat): string {
  const safe = code.replace(/[^A-Za-z0-9._-]/g, "_") || "model";
  return `${safe}.${format}.json`;
}

/** 검색식 오류 응답(400 DEVICE_QUERY_INVALID)의 `response.column`·`message` */
export interface QueryProblem {
  column: number;
  message?: string;
  code: string;
}

/** 공간 이름(내보내기 범위 표시). 못 찾으면 ID */
export function spaceName(nodes: SpaceNode[] | undefined, id: string): string {
  return findSpace(nodes, id)?.name ?? id;
}
