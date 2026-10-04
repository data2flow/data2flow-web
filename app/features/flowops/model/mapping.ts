/**
 * UI-FLW-13 승격 대상 매핑(FLW-09.01, BR-FLW-23): 시험(가상) 대상 → 운영 대상.
 * 참조 목록은 플로우 내보내기(API-FLW-15)의 `references[{kind, id, name}]`에서 얻고, 후보는 종류별 조회 결과에서 고른다.
 * 이름이 같은 후보가 하나면 자동으로 제안한다. 매핑되지 않은 대상이 하나라도 있으면 승격할 수 없다(✗가 있으면 [요청] 비활성).
 */
export const REFERENCE_KINDS = ["SPACE", "DEVICE", "RELATION", "SINK_CONNECTION", "NOTIFICATION_CHANNEL", "SCRIPT"] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

export interface Reference {
  kind: string;
  id: string;
  name: string;
}

export interface Candidate {
  id: string;
  name: string;
}

export interface MappingRow {
  kind: string;
  sourceId: string;
  sourceName: string;
  candidates: Candidate[];
  targetId: string;
  /** 관계(controls/…)는 공간 매핑을 따른다 — 고를 대상이 없다 */
  derived: boolean;
  mapped: boolean;
}

/** 같은 (종류, ID)는 한 번만 */
export function uniqueReferences(references: Reference[]): Reference[] {
  const seen = new Set<string>();
  return references.filter((r) => {
    const key = `${r.kind}:${r.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 이름이 같은 후보가 정확히 하나일 때만 자동 제안 */
export function autoMatch(reference: Reference, candidates: Candidate[]): string {
  const same = candidates.filter((c) => c.name.trim() === reference.name.trim());
  return same.length === 1 ? same[0].id : "";
}

/**
 * 매핑 행. `chosen`은 사용자가 고른 값(`kind:sourceId` → targetId), 없으면 자동 제안을 쓴다.
 * 고른 값이 후보에 없으면(권한 밖·삭제) 매핑되지 않은 것으로 본다.
 */
export function buildMappingRows(references: Reference[], candidatesByKind: Partial<Record<string, Candidate[]>>, chosen: Record<string, string> = {}): MappingRow[] {
  return uniqueReferences(references).map((ref) => {
    const derived = ref.kind === "RELATION";
    const candidates = candidatesByKind[ref.kind] ?? [];
    const key = `${ref.kind}:${ref.id}`;
    const picked = key in chosen ? chosen[key] : autoMatch(ref, candidates);
    const targetId = derived ? "" : candidates.some((c) => c.id === picked) ? picked : "";
    return { kind: ref.kind, sourceId: ref.id, sourceName: ref.name, candidates, targetId, derived, mapped: derived || Boolean(targetId) };
  });
}

export function unmappedCount(rows: MappingRow[]): number {
  return rows.filter((r) => !r.mapped).length;
}

/** API-FLW-19 `mappings[{kind, sourceId, targetId}]`(관계 행은 보내지 않는다) */
export function promoteMappings(rows: MappingRow[]) {
  return rows.filter((r) => !r.derived && r.targetId).map((r) => ({ kind: r.kind, sourceId: r.sourceId, targetId: r.targetId }));
}

/** API-FLW-65 `targetMappings[{from, to}]` */
export function targetMappings(rows: MappingRow[]) {
  return rows.filter((r) => !r.derived && r.targetId).map((r) => ({ from: r.sourceId, to: r.targetId }));
}

/** 폼의 `map.{kind}:{id}` 필드 → 고른 값 */
export function chosenFromForm(form: FormData | URLSearchParams): Record<string, string> {
  const chosen: Record<string, string> = {};
  for (const [name, value] of form.entries()) {
    if (name.startsWith("map.") && typeof value === "string") chosen[name.slice(4)] = value;
  }
  return chosen;
}

interface TreeNode {
  id: string | number;
  name: string;
  virtual?: boolean;
  children?: TreeNode[];
}

/** 공간 트리를 후보 목록으로 펼친다. 가상 공간은 운영 대상이 될 수 없다(BR-FLW-23) */
export function flattenSpaces(nodes: TreeNode[], path: string[] = []): Candidate[] {
  return nodes.flatMap((node) => {
    const here = [...path, node.name];
    const self = node.virtual ? [] : [{ id: String(node.id), name: node.name }];
    return [...self, ...flattenSpaces(node.children ?? [], here)];
  });
}
