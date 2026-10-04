/**
 * 플로우 편집기 본문(UI-FLW-02): 상단 바(이름·상태·버전·적용 상태·[저장]·[적용]), 왼쪽 팔레트, 가운데 캔버스, 오른쪽 설정 패널,
 * 아래 탭(검증·버전·오류). 저장은 초안(API-FLW-03, baseVersion), 적용은 검증(API-FLW-06) → 변경 요약 대화상자(UI-FLW-03) → 적용(API-FLW-07).
 * 조회 권한만 있으면 읽기 전용(팔레트·저장·적용 없음). 실시간 라이브 뷰(API-FLW-40)·시험 실행은 M4.
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
import { Palette } from "./components/palette";
import { PropertyPanel } from "./components/property-panel";
import { FlowStatusBadge } from "./components/status-badge";
import type { TargetDevice } from "./components/target-field";
import { VersionsPanel } from "./components/versions-panel";
import { addNode, alignToGrid, catalogOf, connect, hasThroughWires, insertOnWire, referencedSpaceIds, removeNodes, removeWire, setPosition, toDefinition, updateNode, wireUnder } from "./model/flow-graph";
import type { FlowDetail, FlowGraph, FlowMetrics, FlowNode, NodeType, ValidateResponse, VersionDiff, Wire } from "./model/types";
import { issueNodeIds, normalizeIssues } from "./model/validation";
import { applyBlockReason, combinedValidation, editorReducer, graphOf, initialState, isDirty, nodeBadges, redoable, undoable } from "./store/flow-editor-store";

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
}

type Notice = { tone: "success" | "danger" | "info" | "warning"; text: string } | null;
type BottomTab = "validation" | "versions" | "errors";

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
        else setNotice({ tone: "danger", text: errorText(t, created) ?? "" });
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
      setNotice({ tone: "danger", text: errorText(t, saved) ?? "" });
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

  const apply = async (memo: string, acknowledgedRisks: boolean) => {
    if (!state.flowId || state.draftVersion === null) return;
    dispatch({ type: "busy", busy: "applying" });
    // baseVersion은 지금 ACTIVE 번호(없으면 0, API-FLW-07)
    const result = await api.apply(state.flowId, { version: state.draftVersion, baseVersion: state.activeVersion ?? 0, memo: memo || undefined, acknowledgedRisks });
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
      setApplyError(result.code === "PERMISSION_DENIED" ? t("flows.apply.noControlPermission") : errorText(t, result));
      return;
    }
    setApplyCheck(null);
    // 승인 대기: 202 FLOW_APPROVAL_REQUIRED {approvalId, version}. 실행 중인 버전은 그대로다
    if (result.status === 202 || result.data.approvalId) {
      setNotice({ tone: "info", text: t("flows.apply.approvalSent") });
      return;
    }
    setNotice({ tone: "success", text: t("flows.apply.applied", { v: result.data.appliedVersion ?? state.draftVersion }) });
    props.onReload();
  };

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
  const applyStatus = detail?.applyStatus;
  const ctx = { spaces: props.spaces, devices: props.devices, models: props.models, metricKeys: props.metricKeys, api, editorFactory: props.editorFactory };

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
        {(detail?.editors ?? []).length > 0 && <span className="text-[12px] text-muted">{t("flows.editor.editors", { names: detail!.editors!.map((e) => e.name).join(", ") })}</span>}
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
      {targetsVirtual && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-[#7c5cc4]/40 bg-[#7c5cc4]/10 px-3 py-2 text-[13px] text-[#6a4bb5]" /* 고정: 가상 보라 */>
          <span className="rounded border border-current px-1 text-[11px] font-semibold">{t("flows.editor.virtualBadge")}</span>
          <span>{t("flows.editor.virtualTargets")}</span>
          <Link to="/sim" className="font-medium underline">
            {t("flows.editor.runScenario")}
          </Link>
        </div>
      )}
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
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
        />
        <aside aria-label={t("flows.panel.aside")} className="w-80 shrink-0 overflow-y-auto border-l border-line p-3">
          {selectedNode ? (
            <PropertyPanel key={selectedNode.id} node={selectedNode} catalog={catalog} readOnly={readOnly} ctx={ctx} onChange={updateSelected} />
          ) : (
            <p className="text-[12.5px] text-muted">{state.selected.length > 1 ? t("common.selectedCount", { n: state.selected.length }) : t("flows.panel.empty")}</p>
          )}
        </aside>
      </div>
      <section className="rounded-lg border border-line bg-panel">
        <div role="tablist" aria-label={t("flows.bottom.label")} className="flex gap-1 border-b border-line px-2">
          {(["validation", "versions", "errors"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cx("-mb-px border-b-2 px-3 py-2 text-[13px]", tab === key ? "border-accent font-semibold text-accent" : "border-transparent text-muted")}
            >
              {key === "validation" ? t("flows.bottom.validation", { n: validation.errors.length + validation.warnings.length }) : t(`flows.bottom.${key}`)}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="p-3">
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
      <ApplyDialog
        open={applyCheck !== null}
        title={t("flows.apply.title", { name: state.name, from: state.activeVersion ? `v${state.activeVersion}` : "–", to: `v${state.draftVersion ?? ""}` })}
        result={applyCheck}
        busy={state.busy === "applying"}
        error={applyError}
        nameOf={nameOf}
        onCancel={() => setApplyCheck(null)}
        onApply={(memo, ack) => void apply(memo, ack)}
        onFocusNode={focusNode}
      />
    </div>
  );
}
