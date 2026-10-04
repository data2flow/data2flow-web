/**
 * 캔버스 노드 카드(UI-FLW-02): 분류 표시, 이름, 설정 요약, 입력·출력 포트(true/false·error 라벨), 검증 배지, 오류 카운터,
 * 버전 비교 색(추가·변경·삭제, UI-FLW-05).
 * M4: 라이브 카운터(입력·출력·오류)와 상태 배지(정상·경고·오류 + 최근 오류, FLW-03.01·03.03), 바이패스 점선(FLW-06.04)·디버그 표시,
 * 과거 재생 분기 건수(FLW-03.06), 다른 편집자가 고른 노드의 색 테두리와 이름표(UI-FLW-17).
 */
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import { cx } from "~/components/ui";
import type { NodeHealth, NodeStats } from "../model/live";
import type { NodeBadge } from "../store/flow-editor-store";
import type { FlowNode, PortSpec } from "../model/types";

/** 오류 툴팁 최대 길이(TC-FLW-069: 최근 오류 메시지 500자 절단) */
export const LAST_ERROR_MAX = 500;

const HEALTH_CLASS: Record<NodeHealth, string> = { OK: "bg-good-soft text-good", WARN: "bg-warn-soft text-warn", ERROR: "bg-bad-soft text-bad" };

/** 노드 상태 배지(FLW-03.03, TC-FLW-070): 색 + 접근 가능한 이름, 오류면 최근 오류를 툴팁으로 */
export function NodeStatusBadge({ stats }: { stats: NodeStats }) {
  const { t } = useTranslation();
  const label = t(`flows.live.health.${stats.status}`);
  const lastError = stats.lastError ? stats.lastError.slice(0, LAST_ERROR_MAX) : undefined;
  const title = stats.status !== "OK" && lastError ? t("flows.live.lastError", { message: lastError }) : label;
  return (
    <span role="status" aria-label={t("flows.live.healthLabel", { status: label })} title={title} className={cx("rounded px-1 text-[10.5px] font-semibold", HEALTH_CLASS[stats.status] ?? HEALTH_CLASS.OK)}>
      ● {label}
    </span>
  );
}

export interface FlowNodeData extends Record<string, unknown> {
  node: FlowNode;
  category: string;
  summary: string;
  inputs: PortSpec[];
  outputs: PortSpec[];
  badge?: NodeBadge;
  errorCount?: number;
  diff?: "added" | "changed" | "removed";
  live?: NodeStats;
  bypassed?: boolean;
  debug?: boolean;
  /** 과거 재생 결과의 포트별 건수(API-FLW-13 branchCounts) */
  replay?: Record<string, number>;
  /** 다른 편집자가 고른 노드(UI-FLW-17) */
  presence?: { name: string; color: string };
}

export type FlowNodeView = Node<FlowNodeData, "flowNode">;

const DIFF_CLASS = { added: "border-good", changed: "border-warn", removed: "border-bad border-dashed" } as const;

export function FlowNodeCard({ data, selected }: NodeProps<FlowNodeView>) {
  const { t } = useTranslation();
  const { node, badge, errorCount, diff, live, presence } = data;
  const hasError = Boolean(badge?.errors.length);
  const hasWarning = Boolean(badge?.warnings.length);
  return (
    <div
      data-node-id={node.id}
      className={cx(
        "relative w-[180px] rounded-lg border-2 bg-panel px-2.5 py-2 text-[12px] shadow-sm",
        diff ? DIFF_CLASS[diff] : hasError ? "border-bad" : selected ? "border-accent" : "border-line",
        data.bypassed && "border-dashed opacity-70",
      )}
      data-bypassed={data.bypassed ? "true" : undefined}
      style={presence && !diff && !selected ? { borderColor: presence.color } : undefined}
    >
      {presence && (
        <span className="absolute -top-4 right-0 rounded px-1 text-[10px] text-white" style={{ backgroundColor: presence.color }}>
          {t("flows.presence.editing", { name: presence.name })}
        </span>
      )}
      {data.inputs.length > 0 && <Handle type="target" position={Position.Left} id={data.inputs[0].name} />}
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10.5px] font-semibold uppercase text-muted">{t(`flows.category.${data.category}`, { defaultValue: data.category })}</span>
        <span className="flex gap-1">
          {hasError && (
            <span className="rounded bg-bad-soft px-1 text-[10.5px] text-bad" title={badge!.errors.map((c) => t(`flows.issue.${c}`, { defaultValue: c })).join(", ")}>
              {t("flows.node.errorBadge", { n: badge!.errors.length })}
            </span>
          )}
          {hasWarning && (
            <span className="rounded bg-warn-soft px-1 text-[10.5px] text-warn" title={badge!.warnings.map((c) => t(`flows.issue.${c}`, { defaultValue: c })).join(", ")}>
              {badge!.warnings.map((c) => t(`flows.issue.${c}`, { defaultValue: c })).join(", ")}
            </span>
          )}
        </span>
      </div>
      <p className="truncate font-semibold">{node.name}</p>
      <p className="truncate font-mono text-[11px] text-muted">{data.summary || node.type}</p>
      {errorCount ? <p className="text-[11px] text-bad">{t("flows.node.errors1h", { n: errorCount })}</p> : null}
      {(data.bypassed || data.debug) && (
        <p className="flex gap-1 text-[10.5px]">
          {data.bypassed && <span className="rounded bg-warn-soft px-1 text-warn">{t("flows.overlay.bypassed")}</span>}
          {data.debug && <span className="rounded bg-accent-soft px-1 text-accent">{t("flows.overlay.debugOn")}</span>}
        </p>
      )}
      {live && (
        <div className="mt-1 flex items-center justify-between gap-1 text-[10.5px]">
          <span className="font-mono" title={live.lastAt ? t("flows.live.lastAt", { at: live.lastAt }) : undefined}>
            {t("flows.live.counter", { in: live.in, errors: live.errors })}
          </span>
          <NodeStatusBadge stats={live} />
        </div>
      )}
      {diff && <p className="text-[10.5px] text-muted">{t(`flows.diff.${diff}`)}</p>}
      <div className="mt-1 flex flex-col items-end gap-0.5">
        {data.outputs.map((port) => (
          <div key={port.name} className="relative flex items-center gap-1 pr-1 text-[10.5px] text-muted">
            <span className={port.name === "error" ? "text-bad" : undefined}>{port.name}</span>
            {live?.out?.[port.name] !== undefined && <span className="font-mono text-text">{live.out[port.name]}</span>}
            {data.replay?.[port.name] !== undefined && (
              <span className="rounded bg-accent-soft px-1 font-mono text-accent" title={t("flows.replay.portCount")}>
                {data.replay[port.name]}
              </span>
            )}
            <Handle type="source" position={Position.Right} id={port.name} style={{ top: "auto", right: -12 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
