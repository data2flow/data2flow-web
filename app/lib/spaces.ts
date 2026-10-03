/**
 * 공간 계층 도우미(DEV-01.01, BR-DEV-01·02). API-DEV-01은 중첩 트리(`children[]`)를 준다.
 */
export const SPACE_TYPES = ["SITE", "BUILDING", "FLOOR", "ROOM", "ZONE"] as const;
export type SpaceType = (typeof SPACE_TYPES)[number];
export const MAX_SPACE_DEPTH = 6;

export interface SpaceNode {
  id: string;
  parentId?: string | null;
  type: SpaceType | string;
  name: string;
  code?: string | null;
  depth?: number;
  sortOrder?: number;
  children?: SpaceNode[];
  counts?: { devices?: number; offline?: number; alarms?: number } | null;
  mode?: string | null;
  comfortState?: string | null;
  /** 권한 범위 밖 조상(이름만 보이는 회색 노드, API-DSH-02) */
  accessible?: boolean;
  /** 가상 공간(SIM-01.01, API-SIM-10). 화면에 보라 [가상] 배지 */
  virtual?: boolean;
}

export interface FlatSpace {
  id: string;
  name: string;
  type: string;
  depth: number;
  parentId: string | null;
  path: string[];
  node: SpaceNode;
}

/** 트리를 화면 순서(깊이 우선)로 펼친다 */
export function flattenSpaces(nodes: SpaceNode[] | undefined, parentPath: string[] = [], depth = 1, parentId: string | null = null): FlatSpace[] {
  const out: FlatSpace[] = [];
  const sorted = [...(nodes ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
  for (const node of sorted) {
    const id = String(node.id);
    const path = [...parentPath, node.name];
    out.push({ id, name: node.name, type: node.type, depth: node.depth ?? depth, parentId: node.parentId != null ? String(node.parentId) : parentId, path, node });
    out.push(...flattenSpaces(node.children, path, depth + 1, id));
  }
  return out;
}

export function findSpace(nodes: SpaceNode[] | undefined, id: string | null | undefined): FlatSpace | undefined {
  if (!id) return undefined;
  return flattenSpaces(nodes).find((s) => s.id === String(id));
}

/** 이 공간과 모든 하위 공간 ID */
export function descendantIds(nodes: SpaceNode[] | undefined, id: string): string[] {
  const flat = flattenSpaces(nodes);
  const start = flat.find((s) => s.id === id);
  if (!start) return [];
  const result = [id];
  for (const s of flat) if (s.path.length > start.path.length && result.includes(s.parentId ?? "")) result.push(s.id);
  return result;
}

/** 이 부모 아래 만들 수 있는 타입(상위보다 작은 단위, 중간 생략 허용). 부모가 없으면 SITE만(BR-DEV-02) */
export function allowedChildTypes(parent: { type: string; depth: number } | null | undefined): SpaceType[] {
  if (!parent) return ["SITE"];
  if (parent.depth >= MAX_SPACE_DEPTH) return [];
  const index = SPACE_TYPES.indexOf(parent.type as SpaceType);
  if (index < 0) return [];
  const smaller = SPACE_TYPES.slice(index + 1);
  // ZONE 아래에는 ZONE을 더 둘 수 있다(깊이 한도 안)
  return parent.type === "ZONE" ? ["ZONE"] : smaller;
}

/** 공간 경로 문자열(경로 표시용) */
export function spacePathLabel(path: (string | { name?: string })[] | undefined | null, separator = " › "): string {
  if (!path || path.length === 0) return "–";
  return path.map((p) => (typeof p === "string" ? p : (p.name ?? ""))).join(separator);
}

/** 이동할 수 있는 새 부모 후보: 자기 자신과 하위는 제외(BR-DEV-03), 타입 순서를 지키는 곳만 */
export function moveTargets(nodes: SpaceNode[] | undefined, id: string): FlatSpace[] {
  const flat = flattenSpaces(nodes);
  const self = flat.find((s) => s.id === id);
  if (!self) return [];
  const blocked = new Set(descendantIds(nodes, id));
  return flat.filter((s) => !blocked.has(s.id) && allowedChildTypes(s).includes(self.type as SpaceType));
}

/** 공간 입력 검증(UI-DEV-01 대화상자) */
export function checkSpaceInput(input: { name: string; type: string; timezone?: string; code?: string; latitude?: string; longitude?: string }): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = input.name.trim();
  if (name.length < 1 || name.length > 100) errors.name = "nameRequired";
  if (!SPACE_TYPES.includes(input.type as SpaceType)) errors.type = "typeRequired";
  if (input.type === "SITE" && !input.timezone) errors.timezone = "timezoneRequired";
  if (input.code && !/^[A-Za-z0-9_-]{1,50}$/.test(input.code)) errors.code = "codeInvalid";
  if (input.latitude && !(Number(input.latitude) >= -90 && Number(input.latitude) <= 90)) errors.latitude = "latitudeInvalid";
  if (input.longitude && !(Number(input.longitude) >= -180 && Number(input.longitude) <= 180)) errors.longitude = "longitudeInvalid";
  return errors;
}
