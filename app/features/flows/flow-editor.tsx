/**
 * 플로우 편집기 본문(UI-FLW-02): 상단 바(이름·상태·버전·적용 상태·[저장]·[적용]), 왼쪽 팔레트, 가운데 캔버스, 오른쪽 설정 패널,
 * 아래 탭(검증·버전·오류). 저장은 초안(API-FLW-03, baseVersion), 적용은 검증(API-FLW-06) → 변경 요약 대화상자(UI-FLW-03) → 적용(API-FLW-07).
 * 조회 권한만 있으면 읽기 전용(팔레트·저장·적용 없음).
 * M4: 라이브 뷰(API-FLW-40 WebSocket — 노드 카운터·상태 배지·와이어 움직임·최근 메시지, FLW-03.01~03.03), 실행 추적(UI-FLW-07),
 * 시험 실행·과거 재생(UI-FLW-06), JS 노드 시험 실행, 바이패스·디버그(overlay, FLW-06.04), 섀도우 적용(UI-FLW-12), 지표(UI-FLW-10),
 * 설정·설명서(UI-FLW-09·22), 동시 편집 표시·잠금(UI-FLW-17, API-FLW-42), 적용 충돌 차이 보기(FLW-06.09), 노드 200개 한도(FLW-10.01).
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { EditorFactory } from "~/components/code-editor";
import { Alert, Badge, Button, Dialog, cx } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { flattenSpaces, type SpaceNode } from "~/lib/spaces";
import type { FlowApi } from "./api";
import { ApplyDialog, issueText } from "./components/apply-dialog";
import { ErrorsPanel } from "./components/errors-panel";
import { FlowCanvas } from "./components/flow-canvas";
import { LiveBanner, LiveIndicator, NodeInspector, TracePanel } from "./components/live-panels";
import { MetricsPanel } from "./components/metrics-panel";
import { SettingsPanel } from "./components/settings-panel";
import { ShadowPanel } from "./components/shadow-panel";
import { SubflowDialog } from "./components/subflow-dialog";
import { TestRunPanel } from "./components/test-run-panel";
import { defaultSocketFactory, type SocketFactory } from "./live/flow-socket";
import { useFlowLive } from "./live/use-flow-live";
import { useFlowPresence } from "./live/use-flow-presence";
import { PRESENCE_HEARTBEAT_MS, avatars, othersSelection, updatedByName } from "./model/presence";
import { subflowDraft, subflowRefs, subflowRequest, type SubflowDraft } from "./model/subflow";
import { Palette } from "./components/palette";
import { PropertyPanel } from "./components/property-panel";
import { FlowStatusBadge } from "./components/status-badge";
import type { TargetDevice } from "./components/target-field";
import { VersionsPanel } from "./components/versions-panel";
import { addNode, alignToGrid, catalogOf, connect, hasThroughWires, insertOnWire, referencedSpaceIds, removeNodes, removeWire, setPosition, toDefinition, updateNode, wireUnder } from "./model/flow-graph";
import type { FlowDetail, FlowGraph, FlowMetrics, FlowNode, NodeType, ShadowStatus, ValidateResponse, VersionDiff, Wire } from "./model/types";
import { FLOW_NODE_LIMIT, issueNodeIds, normalizeIssues } from "./model/validation";
import { applyBlockReason, combinedValidation, editorReducer, graphOf, initialState, isDirty, nodeBadges, redoable, toggleOverlay, undoable, type Overlay } from "./store/flow-editor-store";

export const FLOW_NAME_MAX = 100;

export interface FlowEditorProps {
  detail: FlowDetail | null;
  nodeTypes: NodeType[];
  spaces: SpaceNode[];
  devices: TargetDevice[];
  models: { id: string; name: string }[];
  metricKeys: string[];
  metrics: FlowMetrics | null;
  canWrite: boolean;
  canDeployControl: boolean;
  timezone: string;
  api: FlowApi;
  /** 새 플로우를 처음 저장했을 때(편집기 주소로 이동) */
  onCreated: (flowId: string) => void;
  /** 적용·롤백 뒤 상세를 다시 불러온다 */
  onReload: () => void;
  editorFactory?: EditorFactory;
  random?: () => number;
  /** 라이브 뷰·편집 참여 WebSocket(테스트는 가짜). 없으면 브라우저 WebSocket */
  socketFactory?: SocketFactory;
  /** 로그인한 사용자(편집 참여에서 나를 빼고 보여 준다, 책임자 "나로 지정") */
  me?: { userId: string; name: string };
  now?: () => number;
}

type Notice = { tone: "success" | "danger" | "info" | "warning"; text: string; action?: { label: string; run: () => void } } | null;
type BottomTab = "debug" | "traces" | "test" | "validation" | "versions" | "errors" | "metrics" | "shadow" | "settings";

const CONTROL_NODE_TYPES = new Set(["action.control", "action.scene"]);

const isEditableTarget = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable || Boolean(el.closest?.(".monaco-editor"));
};

export function FlowEditor(props: FlowEditorProps) {
  const { t } = useTranslation();
  const { detail, nodeTypes, canWrite, canDeployControl, api } = props;
  const readOnly = !canWrite;
  const catalog = useMemo(() => catalogOf(nodeTypes), [nodeTypes]);
  const [state, dispatch] = useReducer(editorReducer, undefined, () => initialState(detail, ""));
  const graph = graphOf(state);
  const dirty = isDirty(state);
  const [notice, setNotice] = useState<Notice>(null);
  const [nameError, setNameError] = useState<string | undefined>();
  const [tab, setTab] = useState<BottomTab>("validation");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [applyCheck, setApplyCheck] = useState<ValidateResponse | null>(null);
  const [applyError, setApplyError] = useState<string | undefined>();
  const [diffLabel, setDiffLabel] = useState<string | undefined>();
  const savedName = useRef(detail?.flow.name ?? "");
  const dragOrigin = useRef<FlowGraph | null>(null);
  const now = props.now ?? Date.now;
  const createSocket = props.socketFactory ?? defaultSocketFactory;
  const [overlay, setOverlay] = useState<Overlay>(() => ({ bypass: detail?.overlay?.bypass ?? [], debug: detail?.overlay?.debug ?? [], revision: detail?.overlay?.revision ?? 0 }));
  const [overlayBusy, setOverlayBusy] = useState(false);
  const [traceFor, setTraceFor] = useState<string | undefined>();
  const [replayCounts, setReplayCounts] = useState<Record<string, Record<string, number>> | null>(null);
  const [shadow, setShadow] = useState<ShadowStatus | null>(null);
  const [shadowBusy, setShadowBusy] = useState(false);
  const [subflow, setSubflow] = useState<{ draft: SubflowDraft; busy?: boolean; error?: string } | null>(null);
  /** 서브플로우 최신 버전(노드 "새 버전 있음", BR-FLW-17) */
  const [subflowLatest, setSubflowLatest] = useState<Record<string, number>>({});
  const live = useFlowLive({ flowId: state.flowId, enabled: Boolean(detail?.flow.activeVersion), create: createSocket, debugNodes: overlay.debug, now });
  const presence = useFlowPresence({ flowId: state.flowId, enabled: Boolean(state.flowId), create: createSocket, me: props.me?.userId });
  const presenceMap = useMemo(() => othersSelection(presence.state, props.me?.userId), [presence.state, props.me?.userId]);
  const people = avatars(presence.state, props.me?.userId);

  const validation = useMemo(() => combinedValidation(state, catalog), [state, catalog]);
  const badges = useMemo(() => nodeBadges(validation), [validation]);
  const errorCounts = useMemo(() => new Map((props.metrics?.nodes ?? []).filter((n) => n.errors > 0).map((n) => [n.nodeId, n.errors])), [props.metrics]);
  const block = applyBlockReason(state, validation, canWrite);
  const nameOf = useCallback((id: string) => graph.nodes.find((n) => n.id === id)?.name ?? id, [graph.nodes]);
  const selectedNode = state.selected.length === 1 ? graph.nodes.find((n) => n.id === state.selected[0]) : undefined;
  const virtualIds = useMemo(() => new Set(flattenSpaces(props.spaces).filter((s) => (s.node as SpaceNode & { virtual?: boolean }).virtual).map((s) => s.id)), [props.spaces]);
  const targetsVirtual = referencedSpaceIds(graph).some((id) => virtualIds.has(id)) || (detail?.flow.relatedSpaceIds ?? []).some((id) => virtualIds.has(String(id)));

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = t("flows.editor.leaveWarning");
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, t]);

  const change = (next: FlowGraph, select?: string[]) => dispatch({ type: "change", graph: next, select });

  const add = (type: string, position?: { x: number; y: number }) => {
    if (readOnly) return;
    if (graph.nodes.length >= FLOW_NODE_LIMIT) {
      setNotice({ tone: "danger", text: t("flows.limit.nodes", { n: graph.nodes.length, max: FLOW_NODE_LIMIT }) });
      return;
    }
    const result = addNode(graph, type, catalog, { position, random: props.random });
    change(result.graph, [result.node.id]);
    setNotice({ tone: "info", text: t("flows.editor.added", { name: result.node.name }) });
  };

  const onConnect = (wire: Wire) => {
    if (readOnly) return;
    const result = connect(graph, wire, catalog);
    if (result.ok) change(result.graph);
    else setNotice({ tone: "danger", text: t(`flows.connect.${result.reason}`) });
  };

  const onDrag = (id: string, position: { x: number; y: number }) => {
    dragOrigin.current ??= graph;
    dispatch({ type: "replace", graph: setPosition(graph, id, position) });
  };

  const onDragEnd = (id: string, position: { x: number; y: number }) => {
    const before = dragOrigin.current ?? graph;
    dragOrigin.current = null;
    let next = setPosition(graph, id, position);
    const wire = wireUnder(next, id);
    if (wire) {
      const inserted = insertOnWire(next, wire, id, catalog);
      if (inserted.ok) {
        next = inserted.graph;
        setNotice({ tone: "info", text: t("flows.editor.inserted", { name: nameOf(id) }) });
      }
    }
    dispatch({ type: "commit", before, graph: next });
  };

  const requestDelete = () => {
    if (readOnly || state.selected.length === 0) return;
    if (state.selected.length === 1 && hasThroughWires(graph, state.selected[0])) {
      setConfirmDelete(state.selected[0]);
      return;
    }
    change(removeNodes(graph, state.selected, { catalog }), []);
  };

  const doDelete = (reconnect: boolean) => {
    if (!confirmDelete) return;
    change(removeNodes(graph, [confirmDelete], { reconnect, catalog }), []);
    setConfirmDelete(null);
  };

  const updateSelected = (patch: Partial<FlowNode>) => {
    if (!selectedNode || readOnly) return;
    change(updateNode(graph, selectedNode.id, patch));
  };

  const saveErrorText = (result: { code: string; status: number; message: string }) =>
    result.code === "FLOW_NODE_LIMIT_EXCEEDED" ? t("flows.limit.nodes", { n: graph.nodes.length, max: FLOW_NODE_LIMIT }) : (errorText(t, result) ?? "");

  /** 적용 충돌(FLW-06.09, AT-FLW-07.1): 지금 실행 버전과 내 초안의 차이를 캔버스에 보여 준다. 어떤 버전도 덮어쓰지 않는다 */
  const showConflictDiff = async () => {
    if (!state.flowId || state.draftVersion === null) return;
    const versions = await api.versions(state.flowId);
    const active = versions.ok ? versions.data.responses?.find((v) => v.state === "ACTIVE") : undefined;
    if (!active) return;
    const diff = await api.diff(state.flowId, active.version, state.draftVersion);
    if (diff.ok) onDiff(diff.data, t("flows.conflict.diffLabel", { active: active.version, draft: state.draftVersion }));
  };

  const save = async () => {
    if (readOnly || state.busy) return;
    const name = state.name.trim();
    if (!name || name.length > FLOW_NAME_MAX) {
      setNameError(t("flows.editor.nameRule", { max: FLOW_NAME_MAX }));
      return;
    }
    setNameError(undefined);
    dispatch({ type: "busy", busy: "saving" });
    const definition = toDefinition(graph);
    if (!state.flowId) {
      const created = await api.create({ name, definition });
      if (!created.ok) {
        dispatch({ type: "busy", busy: null });
        if (created.code === "FLOW_NAME_DUPLICATED") setNameError(errorText(t, created));
        else setNotice({ tone: "danger", text: saveErrorText(created) });
        return;
      }
      savedName.current = name;
      dispatch({ type: "saved", flowId: created.data.flowId, draftVersion: created.data.draftVersion, validation: created.data.validation });
      setNotice({ tone: "success", text: t("flows.editor.saved", { v: created.data.draftVersion }) });
      props.onCreated(created.data.flowId);
      return;
    }
    if (name !== savedName.current) {
      const renamed = await api.rename(state.flowId, name);
      if (!renamed.ok) {
        dispatch({ type: "busy", busy: null });
        if (renamed.code === "FLOW_NAME_DUPLICATED") setNameError(errorText(t, renamed));
        else setNotice({ tone: "danger", text: errorText(t, renamed) ?? "" });
        return;
      }
      savedName.current = name;
    }
    // 초안을 저장할 때마다 새 번호를 받는다: 직전 응답의 draftVersion이 다음 baseVersion(다르면 409 FLOW_VERSION_CONFLICT)
    const saved = await api.saveDraft(state.flowId, { baseVersion: state.baseVersion ?? 0, definition });
    if (!saved.ok) {
      dispatch({ type: "busy", busy: null });
      setNotice({ tone: "danger", text: saveErrorText(saved) });
      return;
    }
    dispatch({ type: "saved", flowId: saved.data.flowId ?? state.flowId, draftVersion: saved.data.draftVersion, validation: saved.data.validation });
    setNotice({ tone: "success", text: t("flows.editor.saved", { v: saved.data.draftVersion }) });
  };

  const startApply = async () => {
    if (block || !state.flowId || state.draftVersion === null) return;
    dispatch({ type: "busy", busy: "validating" });
    const result = await api.validate(state.flowId, state.draftVersion);
    dispatch({ type: "busy", busy: null });
    if (!result.ok) {
      setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
      return;
    }
    const issues = normalizeIssues(result.data, graph) ?? { errors: [], warnings: [] };
    dispatch({ type: "server", result: issues });
    setApplyError(undefined);
    setApplyCheck({ ...result.data, ...issues });
  };

  const apply = async (memo: string, acknowledgedRisks: boolean, shadowMinutes?: number) => {
    if (!state.flowId || state.draftVersion === null) return;
    dispatch({ type: "busy", busy: "applying" });
    // baseVersion은 지금 ACTIVE 번호(없으면 0, API-FLW-07). 섀도우를 고르면 실제 행동 없이 나란히 돌린다(API-FLW-07 shadow, FLW-06.08)
    const result = await api.apply(state.flowId, { version: state.draftVersion, baseVersion: state.activeVersion ?? 0, memo: memo || undefined, acknowledgedRisks, ...(shadowMinutes ? { shadow: { durationMinutes: shadowMinutes } } : {}) });
    dispatch({ type: "busy", busy: null });
    if (!result.ok) {
      if (result.code === "FLOW_VALIDATION_FAILED" && Array.isArray(result.errors)) {
        dispatch({ type: "server", result: { errors: result.errors, warnings: [] } });
        setApplyCheck(null);
        setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
        return;
      }
      // 위험 변경(제어 노드·실행 모드)인데 확인이 없으면 400 INVALID_REQUEST errors[{field: acknowledgedRisks}]: 위험을 보여 주고 확인을 받는다
      if (result.status === 400 && (result.errors ?? []).some((e) => e.field === "acknowledgedRisks")) {
        setApplyCheck((check) => (!check || check.risky?.controlNodesChanged || check.risky?.executionModeChanged ? check : { ...check, risky: { controlNodesChanged: true, executionModeChanged: false } }));
        setApplyError(t("flows.apply.ackRequired"));
        return;
      }
      if (result.code === "FLOW_VERSION_CONFLICT") {
        setApplyCheck(null);
        setNotice({ tone: "danger", text: t("flows.conflict.applied"), action: { label: t("flows.conflict.showDiff"), run: () => void showConflictDiff() } });
        return;
      }
      setApplyError(result.code === "PERMISSION_DENIED" ? t("flows.apply.noControlPermission") : result.code === "FLOW_SHADOW_IN_PROGRESS" ? t("flows.shadow.inProgress") : errorText(t, result));
      return;
    }
    setApplyCheck(null);
    if (shadowMinutes) {
      setNotice({ tone: "info", text: t("flows.shadow.started", { v: state.draftVersion, minutes: shadowMinutes }) });
      void loadShadow();
      setTab("shadow");
      return;
    }
    // 승인 대기: 202 FLOW_APPROVAL_REQUIRED {approvalId, version}. 실행 중인 버전은 그대로다
    if (result.status === 202 || result.data.approvalId) {
      setNotice({ tone: "info", text: t("flows.apply.approvalSent") });
      return;
    }
    setNotice({ tone: "success", text: t("flows.apply.applied", { v: result.data.appliedVersion ?? state.draftVersion }) });
    props.onReload();
  };

  const subflowKey = subflowRefs(graph)
    .map((r) => r.subflowId)
    .sort()
    .join(",");
  useEffect(() => {
    if (!subflowKey) return;
    let cancelled = false;
    void Promise.all(subflowKey.split(",").map((id) => api.subflow(id))).then((results) => {
      if (cancelled) return;
      const latest: Record<string, number> = {};
      for (const r of results) if (r.ok) latest[r.data.subflowId] = r.data.version;
      setSubflowLatest(latest);
    });
    return () => {
      cancelled = true;
    };
  }, [subflowKey, api]);
  const newerSubflows = useMemo(() => new Map(subflowRefs(graph).filter((r) => (subflowLatest[r.subflowId] ?? 0) > r.version).map((r) => [r.nodeId, subflowLatest[r.subflowId]])), [graph, subflowLatest]);

  const startSubflow = () => {
    const check = subflowDraft(graph, state.selected, catalog);
    if (!check.ok) {
      setNotice({ tone: "danger", text: t(`flows.subflow.reason.${check.reason}`, { max: check.reason === "tooManyInputs" ? 5 : 10 }) });
      return;
    }
    setSubflow({ draft: check.draft });
  };

  const createSubflow = async (form: Parameters<typeof subflowRequest>[1]) => {
    if (!subflow || !state.flowId) return;
    setSubflow({ ...subflow, busy: true, error: undefined });
    const result = await api.createSubflow(subflowRequest(subflow.draft, form, state.flowId));
    if (!result.ok) {
      setSubflow({ ...subflow, busy: false, error: errorText(t, result) });
      return;
    }
    setSubflow(null);
    setNotice({ tone: "success", text: t("flows.subflow.created", { name: form.name.trim(), v: result.data.version }) });
    props.onReload();
  };

  const flowIdForShadow = state.flowId;
  const loadShadow = useCallback(async () => {
    if (!flowIdForShadow) return;
    const result = await api.shadow(flowIdForShadow);
    setShadow(result.ok && result.data?.status ? result.data : null);
  }, [api, flowIdForShadow]);
  const hasActive = Boolean(detail?.flow.activeVersion);
  useEffect(() => {
    if (hasActive) void loadShadow();
  }, [hasActive, loadShadow]);

  const endShadow = async (action: "promote" | "cancel") => {
    if (!state.flowId) return;
    setShadowBusy(true);
    const result = await api.endShadow(state.flowId, action);
    setShadowBusy(false);
    if (!result.ok) {
      setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
      return;
    }
    setShadow(null);
    setNotice({ tone: "success", text: action === "promote" ? t("flows.shadow.promoted", { v: shadow?.version ?? "" }) : t("flows.shadow.cancelled") });
    props.onReload();
  };

  /** 바이패스·디버그 즉시 변경(API-FLW-11): 버전은 그대로, revision으로 충돌 감지 */
  const changeOverlay = async (nodeId: string, kind: "bypass" | "debug", on: boolean) => {
    if (!state.flowId) return;
    const next = toggleOverlay(overlay, kind, nodeId, on);
    setOverlayBusy(true);
    const result = await api.overlay(state.flowId, { bypass: next.bypass, debug: next.debug, revision: overlay.revision });
    setOverlayBusy(false);
    if (!result.ok) {
      if (result.code === "FLOW_VERSION_CONFLICT") {
        setNotice({ tone: "danger", text: t("flows.overlay.conflict") });
        props.onReload();
      } else setNotice({ tone: "danger", text: result.code === "PERMISSION_DENIED" ? t("flows.overlay.noControlPermission") : (errorText(t, result) ?? "") });
      return;
    }
    if (result.status === 202) {
      setNotice({ tone: "info", text: t("flows.apply.approvalSent") });
      return;
    }
    setOverlay({ ...next, revision: result.data.revision ?? overlay.revision + 1 });
    setNotice({ tone: "success", text: t(`flows.overlay.${kind}${on ? "On" : "Off"}Done`, { name: nameOf(nodeId) }) });
  };

  // 편집 참여: 고른 노드를 알리고(디바운스), 설정 패널을 연 노드는 잠근다(UI-FLW-17)
  const selectedKey = state.selected.join(",");
  const { select: presenceSelect, acquire, release } = presence;
  useEffect(() => {
    presenceSelect(selectedKey ? selectedKey.split(",") : []);
  }, [selectedKey, presenceSelect]);
  const lockTarget = canWrite && selectedNode ? selectedNode.id : null;
  useEffect(() => {
    if (!lockTarget) return;
    acquire(lockTarget);
    return () => release(lockTarget);
  }, [lockTarget, acquire, release]);
  // 다른 사람이 잡고 있으면 잠금이 풀렸는지 20초마다 다시 묻는다(서버 잠금 TTL 60초, 창을 닫은 사람의 잠금은 저절로 풀린다 — AT-FLW-25.3)
  const heldByOther = lockTarget ? Boolean(presence.state.heldBy[lockTarget]) : false;
  useEffect(() => {
    if (!lockTarget || !heldByOther) return;
    const timer = setInterval(() => acquire(lockTarget), PRESENCE_HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [lockTarget, heldByOther, acquire]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (mod && key === "s") {
      event.preventDefault();
      void save();
      return;
    }
    if (readOnly || isEditableTarget(event.target)) return;
    if (mod && key === "z") {
      event.preventDefault();
      dispatch({ type: event.shiftKey ? "redo" : "undo" });
    } else if (mod && key === "y") {
      event.preventDefault();
      dispatch({ type: "redo" });
    } else if (mod && key === "c") dispatch({ type: "copy" });
    else if (mod && key === "v") dispatch({ type: "paste", random: props.random });
    else if (mod && key === "a") {
      event.preventDefault();
      dispatch({ type: "select", ids: graph.nodes.map((n) => n.id) });
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      requestDelete();
    }
  };

  const focusNode = (id: string) => {
    dispatch({ type: "select", ids: [id] });
    setApplyCheck(null);
  };

  const onDiff = (diff: VersionDiff | null, label?: string) => {
    dispatch({ type: "diff", diff });
    setDiffLabel(diff ? label : undefined);
  };

  const flow = detail?.flow;
  const applyStatus = live.applyStatus ?? detail?.applyStatus;
  const testFlowId = state.flowId;
  const testNode = testFlowId ? (nodeId: string, message: Record<string, unknown>) => api.testRun(testFlowId, { definition: toDefinition(graph), input: { message }, startNodeId: nodeId }) : undefined;
  const ctx = { spaces: props.spaces, devices: props.devices, models: props.models, metricKeys: props.metricKeys, api, editorFactory: props.editorFactory, testNode };
  const isControlNode = (node: FlowNode) => CONTROL_NODE_TYPES.has(node.type) || (catalog.get(node.type)?.permissions ?? []).includes("FLOW_DEPLOY_CONTROL");
  const overlayToggles = selectedNode && hasActive
    ? {
        bypassed: overlay.bypass.includes(selectedNode.id),
        debug: overlay.debug.includes(selectedNode.id),
        canToggle: canWrite && (!isControlNode(selectedNode) || canDeployControl),
        reason: !canWrite ? undefined : isControlNode(selectedNode) && !canDeployControl ? t("flows.overlay.noControlPermission") : undefined,
        busy: overlayBusy,
        onToggle: (kind: "bypass" | "debug", on: boolean) => void changeOverlay(selectedNode.id, kind, on),
      }
    : undefined;
  const lockedBy = selectedNode ? presence.state.heldBy[selectedNode.id]?.name : undefined;
  const openTrace = (messageId: string) => {
    setTraceFor(messageId);
    setTab("traces");
  };
  const tabs: BottomTab[] = ["debug", "traces", ...(canWrite && state.flowId ? (["test"] as const) : []), "validation", "versions", "errors", ...(state.flowId ? (["metrics"] as const) : []), ...(shadow ? (["shadow"] as const) : []), ...(state.flowId ? (["settings"] as const) : [])];
  const tabLabel = (key: BottomTab) => (key === "validation" ? t("flows.bottom.validation", { n: validation.errors.length + validation.warnings.length }) : t(`flows.bottom.${key}`));

  return (
    <div className="flex flex-col gap-3" onKeyDown={onKeyDown}>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2">
        <div className="flex flex-col">
          <input
            aria-label={t("flows.editor.name")}
            value={state.name}
            placeholder={t("flows.editor.namePlaceholder")}
            readOnly={readOnly}
            maxLength={FLOW_NAME_MAX + 1}
            aria-invalid={nameError ? true : undefined}
            onChange={(e) => dispatch({ type: "rename", name: e.target.value })}
            className="min-w-56 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[16px] font-bold hover:border-line focus:border-accent aria-[invalid=true]:border-bad"
          />
          {nameError && (
            <span role="alert" className="text-[12px] text-bad">
              {nameError}
            </span>
          )}
        </div>
        {flow ? <FlowStatusBadge status={flow.status} /> : <Badge tone="info">{t("flows.status.NEW")}</Badge>}
        <span className="text-[12.5px] text-muted">
          {t("flows.editor.versions", { active: state.activeVersion ? `v${state.activeVersion}` : "–", base: state.baseVersion ? `v${state.baseVersion}` : "–" })}
        </span>
        {applyStatus && <span className="text-[12.5px] text-muted">{applyStatus.converged ? t("flows.editor.converged", { v: applyStatus.targetVersion }) : t("flows.editor.converging", { v: applyStatus.targetVersion })}</span>}
        {hasActive && <LiveIndicator live={live} />}
        {people.shown.length > 0 ? (
          <span aria-label={t("flows.presence.label")} className="flex items-center gap-1">
            {people.shown.map((p) => (
              <span key={p.userId} title={p.readOnly ? t("flows.presence.viewer", { name: p.name }) : p.name} className="inline-flex h-6 items-center rounded-full px-2 text-[11px] text-white" style={{ backgroundColor: p.color ?? "#2f6fde" }}>
                {p.name}
                {p.readOnly ? ` (${t("flows.presence.readOnly")})` : ""}
              </span>
            ))}
            {people.more > 0 && <span className="text-[11px] text-muted">+{people.more}</span>}
          </span>
        ) : (
          (detail?.editors ?? []).length > 0 && <span className="text-[12px] text-muted">{t("flows.editor.editors", { names: detail!.editors!.map((e) => e.name).join(", ") })}</span>
        )}
        {dirty && (
          <span className="text-accent" title={t("flows.editor.unsaved")}>
            ● <span className="sr-only">{t("flows.editor.unsaved")}</span>
          </span>
        )}
        {readOnly && <Badge tone="neutral">{t("flows.editor.readOnly")}</Badge>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canWrite && (
            <>
              <Button onClick={() => void save()} disabled={Boolean(state.busy)}>
                {state.busy === "saving" ? t("common.processing") : t("common.save")}
              </Button>
              {state.flowId && <Button onClick={() => setTab("test")}>{t("flows.editor.testRun")}</Button>}
              <Button variant="primary" onClick={() => void startApply()} disabled={Boolean(block)} aria-describedby={block ? "flow-apply-block" : undefined}>
                {state.busy === "validating" || state.busy === "applying" ? t("common.processing") : t("flows.editor.apply")}
              </Button>
            </>
          )}
        </div>
      </div>
      {canWrite && block && block !== "busy" && (
        <p id="flow-apply-block" className="text-[12px] text-muted">
          {t(`flows.applyBlock.${block}`)}
        </p>
      )}
      {detail?.emergencyStop?.active && <Alert tone="danger">{t("flows.editor.emergencyStop")}</Alert>}
      {hasActive && <LiveBanner live={live} />}
      {presence.state.connection === "reconnecting" && (
        <div role="status" className="rounded-md border border-line bg-bg px-3 py-1.5 text-[12.5px] text-muted">
          {t("flows.presence.reconnecting")}
        </div>
      )}
      {presence.state.updated && (
        <Alert tone="info">
          {t("flows.presence.updated", { name: updatedByName(presence.state.updated), v: presence.state.updated.version })}{" "}
          <button type="button" className="font-medium underline" onClick={() => { presence.dismissUpdate(); props.onReload(); }}>
            {t("flows.presence.reload")}
          </button>
        </Alert>
      )}
      {shadow?.status === "RUNNING" && (
        <Alert tone="info">
          {t("flows.shadow.banner", { v: shadow.version ?? "" })}{" "}
          <button type="button" className="font-medium underline" onClick={() => setTab("shadow")}>
            {t("flows.shadow.view")}
          </button>
        </Alert>
      )}
      {live.flowStatus && live.flowStatus.status !== flow?.status && <Alert tone={live.flowStatus.status === "DEGRADED" ? "warning" : "info"}>{t("flows.live.statusChanged", { status: t(`flows.status.${live.flowStatus.status}`, { defaultValue: live.flowStatus.status }) })}</Alert>}
      {targetsVirtual && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-[#7c5cc4]/40 bg-[#7c5cc4]/10 px-3 py-2 text-[13px] text-[#6a4bb5]" /* 고정: 가상 보라 */>
          <span className="rounded border border-current px-1 text-[11px] font-semibold">{t("flows.editor.virtualBadge")}</span>
          <span>{t("flows.editor.virtualTargets")}</span>
          <Link to="/sim" className="font-medium underline">
            {t("flows.editor.runScenario")}
          </Link>
        </div>
      )}
      {notice && (
        <Alert tone={notice.tone}>
          {notice.text}
          {notice.action && (
            <>
              {" "}
              <button type="button" className="font-medium underline" onClick={notice.action.run}>
                {notice.action.label}
              </button>
            </>
          )}
        </Alert>
      )}
      {replayCounts && (
        <p className="text-[12.5px] text-muted">
          {t("flows.replay.overlayShown")}{" "}
          <button type="button" className="text-accent underline" onClick={() => setReplayCounts(null)}>
            {t("flows.replay.overlayClear")}
          </button>
        </p>
      )}
      {diffLabel && (
        <p className="text-[12.5px] text-muted">
          {t("flows.diff.showing", { label: diffLabel })}{" "}
          <button type="button" className="text-accent underline" onClick={() => onDiff(null)}>
            {t("flows.diff.clear")}
          </button>
        </p>
      )}
      {!readOnly && (
        <div role="toolbar" aria-label={t("flows.toolbar.label")} className="flex flex-wrap gap-1">
          <Button onClick={() => dispatch({ type: "undo" })} disabled={!undoable(state)}>
            {t("flows.toolbar.undo")}
          </Button>
          <Button onClick={() => dispatch({ type: "redo" })} disabled={!redoable(state)}>
            {t("flows.toolbar.redo")}
          </Button>
          <Button onClick={() => dispatch({ type: "select", ids: graph.nodes.map((n) => n.id) })} disabled={graph.nodes.length === 0}>
            {t("flows.toolbar.selectAll")}
          </Button>
          <Button onClick={() => dispatch({ type: "copy" })} disabled={state.selected.length === 0}>
            {t("flows.toolbar.copy")}
          </Button>
          <Button onClick={() => dispatch({ type: "paste", random: props.random })} disabled={!state.clipboard}>
            {t("flows.toolbar.paste")}
          </Button>
          <Button onClick={() => change(alignToGrid(graph, state.selected))} disabled={graph.nodes.length === 0}>
            {t("flows.toolbar.align")}
          </Button>
          {state.flowId && (
            <Button onClick={startSubflow} disabled={state.selected.length === 0 || dirty} title={dirty ? t("flows.subflow.saveFirst") : undefined}>
              {t("flows.subflow.make")}
            </Button>
          )}
          <Button variant="danger" onClick={requestDelete} disabled={state.selected.length === 0}>
            {t("flows.toolbar.delete")}
          </Button>
        </div>
      )}
      <div className="flex min-h-[480px] overflow-hidden rounded-lg border border-line bg-panel">
        {!readOnly && <Palette types={nodeTypes} catalog={catalog} canDeployControl={canDeployControl} onAdd={(type) => add(type)} />}
        <FlowCanvas
          graph={graph}
          catalog={catalog}
          selected={state.selected}
          badges={badges}
          errorCounts={errorCounts}
          diff={state.diff}
          readOnly={readOnly}
          onConnect={onConnect}
          onDrag={onDrag}
          onDragEnd={onDragEnd}
          onSelect={(ids) => dispatch({ type: "select", ids })}
          onRemoveWire={(wire) => !readOnly && change(removeWire(graph, wire))}
          onDropType={(type, position) => add(type, position)}
          live={hasActive ? live : null}
          now={now()}
          overlay={overlay}
          replay={replayCounts}
          presence={presenceMap}
          newerSubflows={newerSubflows}
        />
        <aside aria-label={t("flows.panel.aside")} className="w-80 shrink-0 overflow-y-auto border-l border-line p-3">
          {selectedNode ? (
            <PropertyPanel
              key={selectedNode.id}
              node={selectedNode}
              catalog={catalog}
              readOnly={readOnly}
              ctx={ctx}
              onChange={updateSelected}
              overlay={overlayToggles}
              lockedBy={lockedBy}
              newerSubflowVersion={newerSubflows.get(selectedNode.id)}
            />
          ) : (
            <p className="text-[12.5px] text-muted">{state.selected.length > 1 ? t("common.selectedCount", { n: state.selected.length }) : t("flows.panel.empty")}</p>
          )}
        </aside>
      </div>
      <section className="rounded-lg border border-line bg-panel">
        <div role="tablist" aria-label={t("flows.bottom.label")} className="flex gap-1 border-b border-line px-2">
          {tabs.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cx("-mb-px border-b-2 px-3 py-2 text-[13px]", tab === key ? "border-accent font-semibold text-accent" : "border-transparent text-muted")}
            >
              {tabLabel(key)}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="p-3">
          {tab === "debug" &&
            (!hasActive ? (
              <p className="text-[12.5px] text-muted">{t("flows.live.notApplied")}</p>
            ) : selectedNode ? (
              <NodeInspector nodeName={selectedNode.name} samples={live.samples[selectedNode.id] ?? []} skipped={live.skipped[selectedNode.id]} droppedPerSec={live.sampling[selectedNode.id]} timezone={props.timezone} onTrace={openTrace} />
            ) : (
              <p className="text-[12.5px] text-muted">{t("flows.inspector.pickNode")}</p>
            ))}
          {tab === "traces" &&
            (state.flowId ? (
              <TracePanel key={traceFor ?? ""} flowId={state.flowId} api={api} initialMessageId={traceFor} nameOf={nameOf} timezone={props.timezone} onSelectNode={(id) => dispatch({ type: "select", ids: [id] })} />
            ) : (
              <p className="text-[12.5px] text-muted">{t("flows.versions.notSaved")}</p>
            ))}
          {tab === "test" && state.flowId && (
            <TestRunPanel
              flowId={state.flowId}
              version={state.draftVersion ?? state.activeVersion}
              dirty={dirty}
              definition={() => toDefinition(graph)}
              api={api}
              devices={props.devices}
              timezone={props.timezone}
              now={now}
              nameOf={nameOf}
              onSelectNode={(id) => dispatch({ type: "select", ids: [id] })}
              onReplayCounts={setReplayCounts}
            />
          )}
          {tab === "metrics" && state.flowId && <MetricsPanel flowId={state.flowId} api={api} initial={props.metrics} nameOf={nameOf} />}
          {tab === "shadow" && shadow && <ShadowPanel shadow={shadow} activeVersion={state.activeVersion} now={now()} timezone={props.timezone} canWrite={canWrite} busy={shadowBusy} nameOf={nameOf} onPromote={() => void endShadow("promote")} onCancel={() => void endShadow("cancel")} />}
          {tab === "settings" && state.flowId && (
            <SettingsPanel
              flowId={state.flowId}
              flow={flow}
              extra={graph.extra as { mode?: Record<string, unknown>; variables?: unknown[] }}
              spaces={props.spaces}
              me={props.me}
              canWrite={canWrite}
              api={api}
              onExtraChange={(extra) => change({ ...graph, extra: { ...graph.extra, ...extra } })}
              onSaved={props.onReload}
            />
          )}
          {tab === "validation" &&
            (validation.errors.length + validation.warnings.length === 0 ? (
              <p className="text-[12.5px] text-good">{t("flows.validation.ok")}</p>
            ) : (
              <ul className="flex flex-col gap-1 text-[12.5px]">
                {validation.errors.map((issue, i) => (
                  <li key={`e${i}`} className="text-bad">
                    <button type="button" className="text-left hover:underline" onClick={() => issueNodeIds(issue)[0] && dispatch({ type: "select", ids: issueNodeIds(issue) })}>
                      {t("flows.validation.error")}: {issueText(t, issue, nameOf)}
                    </button>
                  </li>
                ))}
                {validation.warnings.map((issue, i) => (
                  <li key={`w${i}`} className="text-warn">
                    {t("flows.validation.warning")}: {issueText(t, issue, nameOf)}
                  </li>
                ))}
              </ul>
            ))}
          {tab === "versions" &&
            (state.flowId ? (
              <VersionsPanel flowId={state.flowId} api={api} canWrite={canWrite} timezone={props.timezone} onDiff={onDiff} onRolledBack={(v, approvalId) => {
                if (approvalId) {
                  setNotice({ tone: "info", text: t("flows.apply.approvalSent") });
                  return;
                }
                setNotice({ tone: "success", text: t("flows.versions.rolledBack", { v: v ?? "" }) });
                props.onReload();
              }} />
            ) : (
              <p className="text-[12.5px] text-muted">{t("flows.versions.notSaved")}</p>
            ))}
          {tab === "errors" && <ErrorsPanel metrics={props.metrics} nameOf={nameOf} />}
        </div>
      </section>
      <Dialog
        open={confirmDelete !== null}
        title={t("flows.delete.title")}
        onClose={() => setConfirmDelete(null)}
        footer={
          <>
            <Button onClick={() => setConfirmDelete(null)}>{t("common.cancel")}</Button>
            <Button onClick={() => doDelete(false)}>{t("flows.delete.only")}</Button>
            <Button variant="primary" onClick={() => doDelete(true)}>
              {t("flows.delete.reconnect")}
            </Button>
          </>
        }
      >
        <p className="text-[13px]">{t("flows.delete.question", { name: confirmDelete ? nameOf(confirmDelete) : "" })}</p>
      </Dialog>
      {subflow && <SubflowDialog draft={subflow.draft} busy={subflow.busy} error={subflow.error} onCancel={() => setSubflow(null)} onCreate={(form) => void createSubflow(form)} />}
      <ApplyDialog
        open={applyCheck !== null}
        title={t("flows.apply.title", { name: state.name, from: state.activeVersion ? `v${state.activeVersion}` : "–", to: `v${state.draftVersion ?? ""}` })}
        result={applyCheck}
        busy={state.busy === "applying"}
        error={applyError}
        nameOf={nameOf}
        onCancel={() => setApplyCheck(null)}
        onApply={(memo, ack, shadowMinutes) => void apply(memo, ack, shadowMinutes)}
        onFocusNode={focusNode}
        canShadow={hasActive && !shadow}
      />
    </div>
  );
}
