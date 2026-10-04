/**
 * 엣지 게이트웨이(UI-DSC-10, DSC-08.03, API-DSC-62·64·65·67, BR-DSC-31·32). 등록 토큰은 24시간 1회용이고 만든 응답에서만 보인다.
 * 설정 배포는 판(version)으로 관리하고 적용 실패 시 에이전트가 직전 판으로 되돌린다.
 */

export const EDGE_STATUSES = ["REGISTERING", "ONLINE", "OFFLINE", "UPDATING", "ERROR", "REVOKED"] as const;

export interface EdgeGateway {
  id: string;
  name: string;
  site?: { id: string; name: string } | null;
  status: string;
  agentVersion?: string | null;
  arch?: string | null;
  certFingerprint?: string | null;
  appliedConfigVersion?: number | null;
  desiredConfigVersion?: number | null;
  bufferUsedBytes?: number | null;
  bufferItems?: number | null;
  droppedItems?: number;
  throughput?: number | null;
  lastSeenAt?: string | null;
  revokedAt?: string | null;
  latestAgentVersion?: string | null;
  updateAvailable?: boolean;
  version: number;
}

export interface EdgeRegistration {
  id: string;
  name: string;
  status: string;
  registrationToken: string;
  expiresAt: string;
  installCommand?: string | null;
  offlinePackageUrl?: string | null;
}

export interface EdgeConfigVersion {
  version: number;
  targets: unknown;
  decoders: unknown;
  result?: string | null;
  error?: string | null;
  createdAt?: string;
  deployedAt?: string | null;
  desired: boolean;
  applied: boolean;
}

export interface EdgeUpdates {
  currentVersion?: string | null;
  latestVersion?: string | null;
  availableVersions: string[];
  updates: { updateId: string; fromVersion?: string | null; toVersion: string; status: string; createdAt?: string; finishedAt?: string | null }[];
}

/** 버퍼 한도(엣지 기본 1GB 디스크 버퍼, design/reliability-and-ha.md) — 사용률 표시용 */
export const EDGE_BUFFER_BYTES = 1024 * 1024 * 1024;

export function edgeTone(status: string): "success" | "warning" | "danger" | "neutral" | "info" {
  if (status === "ONLINE") return "success";
  if (status === "UPDATING" || status === "REGISTERING") return "info";
  if (status === "OFFLINE") return "warning";
  if (status === "ERROR") return "danger";
  return "neutral";
}

export function bufferPercent(bytes: number | null | undefined, capacity = EDGE_BUFFER_BYTES): number | null {
  if (bytes === null || bytes === undefined) return null;
  return Math.min(100, Math.round((bytes / capacity) * 100));
}

/** 건수 축약(1.2k, 88k) */
export function compactCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return "–";
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`;
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`;
  return String(n);
}

/** 상태에 맞는 동작: 등록 전은 토큰 재발급, 폐기 뒤에는 없음 */
export function edgeActions(edge: Pick<EdgeGateway, "status" | "revokedAt">): ("reissue" | "restart" | "collect-logs" | "revoke")[] {
  if (edge.revokedAt || edge.status === "REVOKED") return [];
  if (edge.status === "REGISTERING") return ["reissue", "revoke"];
  return ["restart", "collect-logs", "revoke"];
}

/** 설정 판 편집 JSON 검사: `{targets: [{connectorKey, config}], decoders?}` */
export function parseConfigVersion(raw: string): { ok: true; body: { targets: unknown[]; decoders: unknown } } | { ok: false; error: "json" | "targets" } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "json" };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, error: "json" };
  const p = parsed as { targets?: unknown; decoders?: unknown };
  if (!Array.isArray(p.targets) || p.targets.some((t) => !t || typeof t !== "object" || typeof (t as { connectorKey?: unknown }).connectorKey !== "string")) return { ok: false, error: "targets" };
  return { ok: true, body: { targets: p.targets, decoders: p.decoders ?? {} } };
}

export const DEFAULT_CONFIG = JSON.stringify({ targets: [{ connectorKey: "modbus-tcp", config: { host: "192.168.0.10", port: 502, unitId: 1, intervalSec: 60 } }], decoders: {} }, null, 2);
