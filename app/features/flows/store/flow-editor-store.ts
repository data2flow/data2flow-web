/**
 * 플로우 편집기 상태(UI-FLW-02): 그래프 + 실행 취소 이력, 저장 기준(dirty), 편집 기준 버전(baseVersion, 낙관적 잠금),
 * 서버 검증 결과(API-FLW-03·06·07) → 노드별 배지, 적용 버튼을 막는 이유. 순수 리듀서라 node 환경에서 시험한다.
 */
import { copySelection, fromDefinition, paste, toDefinition, type Catalog, type Clipboard } from "../model/flow-graph";
import { canRedo, canUndo, history, record, redo, undo, type History } from "../model/flow-graph-history";
import { issueNodeIds, validateGraph } from "../model/validation";
import type { FlowDetail, FlowGraph, ValidationIssue, ValidationResult, VersionDiff } from "../model/types";

export type Busy = null | "saving" | "validating" | "applying";

export interface EditorState {
  flowId: string | null;
  name: string;
  history: History<FlowGraph>;
  /** 마지막으로 저장(또는 불러온) 내용. 지금 내용과 다르면 저장 안 된 변경 */
  savedKey: string;
  /** 편집을 시작한 버전(API-FLW-03 baseVersion) */
  baseVersion: number | null;
  draftVersion: number | null;
  activeVersion: number | null;
  /** 서버가 준 검증 결과(초안 저장·적용 전 검증·적용 거부) */
  server: ValidationResult | null;
  selected: string[];
  clipboard: Clipboard | null;
  diff: VersionDiff | null;
  busy: Busy;
}

export type EditorAction =
  | { type: "load"; detail: FlowDetail | null; name?: string }
  | { type: "rename"; name: string }
  | { type: "change"; graph: FlowGraph; select?: string[] }
  /** 끄는 중 위치처럼 이력에 남기지 않는 변경 */
  | { type: "replace"; graph: FlowGraph }
  /** 끌기를 마칠 때: 끌기 전 그래프를 이력에 남기고 결과를 현재로 */
  | { type: "commit"; before: FlowGraph; graph: FlowGraph }
  | { type: "select"; ids: string[] }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "copy" }
  | { type: "paste"; random?: () => number }
  | { type: "saved"; flowId: string; draftVersion: number; validation?: ValidationResult | null }
  | { type: "server"; result: ValidationResult | null }
  | { type: "diff"; diff: VersionDiff | null }
  | { type: "busy"; busy: Busy };

const keyOf = (name: string, graph: FlowGraph) => JSON.stringify([name, toDefinition(graph)]);

export function initialState(detail: FlowDetail | null, name = ""): EditorState {
  const graph = fromDefinition(detail?.version.definition);
  const flowName = detail?.flow.name ?? name;
  const draft = detail?.flow.draftVersion ?? null;
  const active = detail?.flow.activeVersion ?? null;
  return {
    flowId: detail?.flow.flowId ?? null,
    name: flowName,
    history: history(graph),
    savedKey: keyOf(flowName, graph),
    baseVersion: draft ?? active ?? detail?.version.version ?? null,
    draftVersion: draft,
    activeVersion: active,
    server: detail?.version.validation ?? null,
    selected: [],
    clipboard: null,
    diff: null,
    busy: null,
  };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "load":
      return initialState(action.detail, action.name);
    case "rename":
      return { ...state, name: action.name };
    case "change":
      return { ...state, history: record(state.history, action.graph), selected: action.select ?? state.selected.filter((id) => action.graph.nodes.some((n) => n.id === id)) };
    case "replace":
      return { ...state, history: { ...state.history, present: action.graph } };
    case "commit":
      return { ...state, history: record({ ...state.history, present: action.before }, action.graph) };
    case "select":
      return { ...state, selected: action.ids };
    case "undo":
      return { ...state, history: undo(state.history) };
    case "redo":
      return { ...state, history: redo(state.history) };
    case "copy":
      return state.selected.length === 0 ? state : { ...state, clipboard: copySelection(state.history.present, state.selected) };
    case "paste": {
      if (!state.clipboard || state.clipboard.nodes.length === 0) return state;
      const result = paste(state.history.present, state.clipboard, { random: action.random });
      return { ...state, history: record(state.history, result.graph), selected: result.ids, clipboard: copySelection(result.graph, result.ids) };
    }
    case "saved":
      return {
        ...state,
        flowId: action.flowId,
        draftVersion: action.draftVersion,
        baseVersion: action.draftVersion,
        savedKey: keyOf(state.name, state.history.present),
        server: action.validation ?? null,
        busy: null,
      };
    case "server":
      return { ...state, server: action.result };
    case "diff":
      return { ...state, diff: action.diff };
    case "busy":
      return { ...state, busy: action.busy };
  }
}

export const graphOf = (state: EditorState) => state.history.present;
export const isDirty = (state: EditorState) => keyOf(state.name, state.history.present) !== state.savedKey;
export const undoable = (state: EditorState) => canUndo(state.history);
export const redoable = (state: EditorState) => canRedo(state.history);

/** 화면 검증 + 서버 검증을 합친 결과(같은 코드·노드는 하나로) */
export function combinedValidation(state: EditorState, catalog: Catalog): ValidationResult {
  const local = validateGraph(state.history.present, catalog);
  const server = state.server ?? { errors: [], warnings: [] };
  const seen = new Set<string>();
  const unique = (issues: ValidationIssue[]) =>
    issues.filter((i) => {
      const key = `${i.code}|${issueNodeIds(i).join(",")}|${i.path ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  // 서버 오류는 저장 뒤 화면에서 고쳤을 수 있다: 이미 없는 노드를 가리키면 버린다
  const ids = new Set(state.history.present.nodes.map((n) => n.id));
  const stillThere = (i: ValidationIssue) => issueNodeIds(i).every((id) => ids.has(id));
  return { errors: unique([...local.errors, ...(server.errors ?? []).filter(stillThere)]), warnings: unique((server.warnings ?? []).filter(stillThere)) };
}

export interface NodeBadge {
  errors: string[];
  warnings: string[];
}

/** 노드별 오류·경고 배지(TC-FLW-007, TC-FLW-021) */
export function nodeBadges(result: ValidationResult): Map<string, NodeBadge> {
  const badges = new Map<string, NodeBadge>();
  const add = (issue: ValidationIssue, kind: keyof NodeBadge) => {
    for (const id of issueNodeIds(issue)) {
      const badge = badges.get(id) ?? { errors: [], warnings: [] };
      if (!badge[kind].includes(issue.code)) badge[kind].push(issue.code);
      badges.set(id, badge);
    }
  };
  result.errors.forEach((i) => add(i, "errors"));
  result.warnings.forEach((i) => add(i, "warnings"));
  return badges;
}

export type ApplyBlock = "readOnly" | "busy" | "empty" | "unsaved" | "noChanges" | "errors" | null;

/** 적용 버튼을 막는 이유(UI-FLW-02 "적용 버튼 비활성 사유"). 경고는 막지 않는다(TC-FLW-021) */
export function applyBlockReason(state: EditorState, validation: ValidationResult, canWrite: boolean): ApplyBlock {
  if (!canWrite) return "readOnly";
  if (state.busy) return "busy";
  if (state.history.present.nodes.length === 0) return "empty";
  if (!state.flowId || isDirty(state)) return "unsaved";
  if (state.draftVersion === null) return "noChanges";
  if (validation.errors.length > 0) return "errors";
  return null;
}
