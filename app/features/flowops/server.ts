/**
 * 자동화 부가 화면 loader·action 공용(서버 전용 라우트 모듈에서만 부른다).
 * 승격 대상 매핑(UI-FLW-13): 플로우 내보내기(API-FLW-15)의 참조 목록 + 종류별 후보(공간 API-DEV-01, 기기 API-DEV-11,
 * Sink 연결 API-FLW-50, 알림 채널 API-OPS-30, 스크립트 API-SCR-01).
 */
import { callApi, callList } from "~/bff/api.server";
import type { BffRequestContext } from "~/bff/middleware.server";
import { flattenSpaces, type Candidate, type Reference } from "./model/mapping";

interface ExportFile {
  references?: Reference[];
}

/** 플로우마다 내보내기를 읽어 참조를 모은다. 읽을 수 없는 플로우는 건너뛰고 `failed`에 남긴다 */
export async function loadReferences(ctx: BffRequestContext, request: Request, flows: { flowId: string; version?: number | null }[]) {
  const results = await Promise.all(
    flows.map((f) => callApi<ExportFile>(ctx, request, `/api/v1/core/flows/${encodeURIComponent(f.flowId)}/export${f.version ? `?version=${f.version}` : ""}`)),
  );
  const references: Reference[] = [];
  const failed: string[] = [];
  results.forEach((result, i) => {
    if (!result.ok) failed.push(flows[i].flowId);
    else for (const r of result.data?.references ?? []) references.push({ kind: String(r.kind), id: String(r.id), name: String(r.name ?? r.id) });
  });
  return { references, failed };
}

/** 참조에 나온 종류만 후보를 읽는다(운영 대상: 가상 아님) */
export async function loadCandidates(ctx: BffRequestContext, request: Request, kinds: Set<string>): Promise<Record<string, Candidate[]>> {
  const out: Record<string, Candidate[]> = {};
  const jobs: Promise<void>[] = [];
  const named = (rows: { id?: unknown; name?: unknown }[], idKey = "id") => rows.map((r) => ({ id: String((r as Record<string, unknown>)[idKey]), name: String(r.name ?? "") }));
  if (kinds.has("SPACE")) {
    jobs.push(
      callApi<Parameters<typeof flattenSpaces>[0]>(ctx, request, "/api/v1/core/spaces").then((r) => {
        out.SPACE = r.ok ? flattenSpaces(r.data ?? []) : [];
      }),
    );
  }
  if (kinds.has("DEVICE")) {
    jobs.push(
      callList<{ id: string; name: string; virtual?: boolean }>(ctx, request, "/api/v1/core/devices?status=ACTIVE&virtual=false&size=100").then((r) => {
        out.DEVICE = r.ok ? named(r.list.responses.filter((d) => !d.virtual)) : [];
      }),
    );
  }
  if (kinds.has("SINK_CONNECTION")) {
    jobs.push(
      callList<{ sinkConnectionId: string; name: string }>(ctx, request, "/api/v1/core/sink-connections?size=100").then((r) => {
        out.SINK_CONNECTION = r.ok ? named(r.list.responses, "sinkConnectionId") : [];
      }),
    );
  }
  if (kinds.has("NOTIFICATION_CHANNEL")) {
    jobs.push(
      callList<{ id: string; name: string }>(ctx, request, "/api/v1/core/notification-channels?size=100").then((r) => {
        out.NOTIFICATION_CHANNEL = r.ok ? named(r.list.responses) : [];
      }),
    );
  }
  if (kinds.has("SCRIPT")) {
    jobs.push(
      callList<{ id: string; name: string }>(ctx, request, "/api/v1/core/scripts?size=100").then((r) => {
        out.SCRIPT = r.ok ? named(r.list.responses) : [];
      }),
    );
  }
  await Promise.all(jobs);
  return out;
}

export interface ScenarioOption {
  scenarioId: string;
  name: string;
  lastRun?: { status: string; passed?: number; total?: number; finishedAt?: string | null } | null;
}

/** 승격 조건 시나리오(FLW-09.03, API-SIM-12 목록 + 마지막 결과). 가상 환경 권한이 없으면 빈 목록 */
export async function loadScenarios(ctx: BffRequestContext, request: Request): Promise<ScenarioOption[]> {
  const result = await callList<ScenarioOption>(ctx, request, "/api/v1/core/sim/scenarios?size=100");
  return result.ok ? result.list.responses.map((s) => ({ scenarioId: String(s.scenarioId), name: s.name, lastRun: s.lastRun ?? null })) : [];
}
