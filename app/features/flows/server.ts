/**
 * 플로우 편집기 loader 공용(서버 전용 라우트 모듈에서만 부른다): 노드 카탈로그(API-FLW-30), 공간 트리(API-DEV-01),
 * 대상 후보 기기(API-DEV-11, 실제·가상), 기기 모델(API-DEV-46), 측정 항목(API-DEV-50), 지표(API-FLW-14).
 */
import { callApi, callList, listOrThrow } from "~/bff/api.server";
import type { BffRequestContext } from "~/bff/middleware.server";
import type { SpaceNode } from "~/lib/spaces";
import type { TargetDevice } from "./components/target-field";
import type { FlowMetrics, NodeType } from "./model/types";

interface DeviceRow {
  id: string;
  name: string;
  space?: { id: string } | null;
  model?: { id: string } | null;
  tags?: string[];
}

export async function loadEditorContext(ctx: BffRequestContext, request: Request, flowId?: string) {
  const [nodes, spaces, real, virtual, models, metricRows, metrics] = await Promise.all([
    callList<NodeType>(ctx, request, "/api/v1/core/flow-nodes"),
    callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces"),
    callList<DeviceRow>(ctx, request, "/api/v1/core/devices?status=ACTIVE&size=100"),
    callList<DeviceRow>(ctx, request, "/api/v1/core/devices?status=ACTIVE&virtual=true&size=100"),
    callList<{ id: string; name: string }>(ctx, request, "/api/v1/core/device-models?size=100"),
    callList<{ key: string }>(ctx, request, "/api/v1/core/metrics?status=VERIFIED&size=100"),
    flowId ? callApi<FlowMetrics>(ctx, request, `/api/v1/core/flows/${encodeURIComponent(flowId)}/metrics?window=1h&step=1m`) : Promise.resolve(null),
  ]);
  const byId = new Map<string, TargetDevice>();
  for (const result of [real, virtual]) {
    if (!result.ok) continue;
    for (const d of result.list.responses) byId.set(String(d.id), { id: String(d.id), name: d.name, spaceId: d.space?.id ?? null, modelId: d.model?.id ?? null, tags: d.tags ?? [] });
  }
  return {
    nodeTypes: listOrThrow(nodes).responses,
    spaces: spaces.ok ? (spaces.data ?? []) : [],
    devices: [...byId.values()],
    models: models.ok ? models.list.responses.map((m) => ({ id: String(m.id), name: m.name })) : [],
    metricKeys: metricRows.ok ? metricRows.list.responses.map((m) => m.key) : [],
    metrics: metrics?.ok ? metrics.data : null,
  };
}
