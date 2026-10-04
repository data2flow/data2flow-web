/**
 * 건물 3D 모델(IFC) 열람·공간 연결(DSH-12.04, API-DSH-24, BR-DSH-21).
 * 올리기: .ifc, 200MB 이하(넘으면 413 MODEL_FILE_INVALID "200MB 이하"). 연결: IFC 공간 요소(IfcSpace, GlobalId 22자) ↔ 플랫폼 공간.
 * 열람: 매핑된 요소는 그 공간의 현재 상태 색, 매핑 없는 요소는 회색(열람 전용).
 */
import type { SpaceNode } from "~/lib/spaces";

export const IFC_MAX_BYTES = 200 * 1024 * 1024;
const GLOBAL_ID = /^[0-9A-Za-z_$]{22}$/;

export interface ModelSummary {
  id: string;
  name: string;
  sizeBytes: number;
  ifcSchema?: string | null;
  status: string;
  elementCount?: number | null;
  version: number;
  createdAt?: string | null;
}

export interface ModelDetail {
  id: string;
  name: string;
  ifcSchema?: string | null;
  status: string;
  error?: string | null;
  elementCount?: number | null;
  downloadUrl?: string | null;
  mappings: { ifcGlobalId: string; spaceId: string }[];
  spaceElements?: { ifcGlobalId: string; name?: string | null }[];
  version: number;
}

export type IfcFileProblem = "REQUIRED" | "NOT_IFC" | "TOO_LARGE" | null;

export function checkIfcFile(file: { name: string; size: number } | null | undefined): IfcFileProblem {
  if (!file || file.size === 0) return "REQUIRED";
  if (!/\.ifc$/i.test(file.name)) return "NOT_IFC";
  if (file.size > IFC_MAX_BYTES) return "TOO_LARGE";
  return null;
}

export type ElementState = "UNMAPPED" | "ALARM" | "WARNING" | "NORMAL";

export interface ViewerElement {
  ifcGlobalId: string;
  name: string;
  spaceId: string | null;
  spaceName: string | null;
  state: ElementState;
}

function indexTree(nodes: readonly SpaceNode[] | undefined, out = new Map<string, SpaceNode>()) {
  for (const n of nodes ?? []) {
    out.set(String(n.id), n);
    indexTree(n.children, out);
  }
  return out;
}

/** 공간의 현재 상태: 열린 알람이 있으면 ALARM, 쾌적도가 정상이 아니면 WARNING, 그 밖은 NORMAL */
export function spaceState(node: SpaceNode | undefined): ElementState {
  if (!node) return "UNMAPPED";
  if ((node.counts?.alarms ?? 0) > 0) return "ALARM";
  if (node.comfortState && !["NORMAL", "UNKNOWN"].includes(node.comfortState)) return "WARNING";
  return "NORMAL";
}

/** 열람용 요소 목록. 요소 목록이 없으면(변환 전) 매핑만으로 만든다 */
export function viewerElements(detail: ModelDetail, tree: readonly SpaceNode[]): ViewerElement[] {
  const spaces = indexTree(tree);
  const mapped = new Map(detail.mappings.map((m) => [m.ifcGlobalId, String(m.spaceId)]));
  const elements = detail.spaceElements?.length ? detail.spaceElements : detail.mappings.map((m) => ({ ifcGlobalId: m.ifcGlobalId, name: null }));
  return elements.map((e) => {
    const spaceId = mapped.get(e.ifcGlobalId) ?? null;
    const node = spaceId ? spaces.get(spaceId) : undefined;
    return { ifcGlobalId: e.ifcGlobalId, name: e.name || e.ifcGlobalId, spaceId, spaceName: node?.name ?? null, state: spaceId ? (node ? spaceState(node) : "NORMAL") : "UNMAPPED" };
  });
}

export function mappingCounts(elements: readonly ViewerElement[]) {
  const mapped = elements.filter((e) => e.spaceId).length;
  return { mapped, unmapped: elements.length - mapped, total: elements.length };
}

/** 연결 저장 본문: 공간을 고른 요소만, GlobalId 형식이 맞는 것만 */
export function mappingBody(rows: readonly { ifcGlobalId: string; spaceId: string }[]) {
  return { mappings: rows.filter((r) => r.spaceId && GLOBAL_ID.test(r.ifcGlobalId)).map((r) => ({ ifcGlobalId: r.ifcGlobalId, spaceId: String(r.spaceId) })) };
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}
