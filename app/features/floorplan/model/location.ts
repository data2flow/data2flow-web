/**
 * 탐색 경로(DSH-09.02)와 층 전환(DSH-12.04) 도우미.
 * - 경로: 사이트 › 건물 › 층 › 실. 층을 누르면 그 층의 평면도와 하위 공간 요약(`/spaces/{층}?tab=floorplan`)으로 간다(AT-DSH-02.2).
 *   포트폴리오에서 내려오면(`?from=portfolio`) 앞에 "포트폴리오"를 붙인다(AT-DSH-12.4).
 * - 층 전환: 건물의 층 목록(GET /core/buildings/{id}/floors, sortOrder 순)에서 위·아래 층을 고른다.
 */
import type { SpaceNode } from "~/lib/spaces";

export interface Crumb {
  id: string;
  name: string;
  type: string;
  to: string;
}

/** 트리에서 id까지의 조상 경로(자기 포함). 없으면 빈 배열 */
export function ancestorsOf(tree: readonly SpaceNode[], id: string): SpaceNode[] {
  for (const node of tree) {
    if (String(node.id) === id) return [node];
    const below = ancestorsOf(node.children ?? [], id);
    if (below.length) return [node, ...below];
  }
  return [];
}

/** 단계별 이동 주소: 층은 평면도 탭, 나머지는 공간 개요 */
export function crumbTarget(node: Pick<SpaceNode, "id" | "type">, from?: string | null): string {
  const query = new URLSearchParams();
  if (node.type === "FLOOR") query.set("tab", "floorplan");
  if (from) query.set("from", from);
  const qs = query.toString();
  return `/spaces/${encodeURIComponent(String(node.id))}${qs ? `?${qs}` : ""}`;
}

export function locationPath(tree: readonly SpaceNode[], id: string, from?: string | null): Crumb[] {
  return ancestorsOf(tree, id).map((n) => ({ id: String(n.id), name: n.name, type: String(n.type), to: crumbTarget(n, from) }));
}

export interface FloorItem {
  spaceId: string;
  name: string;
  code?: string | null;
  sortOrder?: number;
  hasFloorplan?: boolean;
  imageUrl?: string | null;
  width?: number | null;
  height?: number | null;
}

/** 층은 아래(sortOrder 작은 쪽)부터 위로 쌓는다. "위" 버튼은 다음 층 */
export function sortFloors(floors: readonly FloorItem[]): FloorItem[] {
  return [...floors].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export interface FloorNav {
  current: FloorItem | null;
  index: number;
  up: FloorItem | null;
  down: FloorItem | null;
}

/** 요청한 층(없거나 모르면 평면도가 있는 첫 층, 그것도 없으면 첫 층) */
export function floorNav(floors: readonly FloorItem[], requested?: string | null): FloorNav {
  const sorted = sortFloors(floors);
  if (sorted.length === 0) return { current: null, index: -1, up: null, down: null };
  let index = requested ? sorted.findIndex((f) => f.spaceId === requested) : -1;
  if (index < 0) index = Math.max(0, sorted.findIndex((f) => f.hasFloorplan));
  return { current: sorted[index], index, up: sorted[index + 1] ?? null, down: sorted[index - 1] ?? null };
}

/** 트리에서 공간의 건물(자기 또는 조상)과 그 아래 층들(트리만으로 층 전환 후보를 만들 때) */
export function buildingOf(tree: readonly SpaceNode[], id: string): SpaceNode | null {
  return [...ancestorsOf(tree, id)].reverse().find((n) => n.type === "BUILDING") ?? null;
}
