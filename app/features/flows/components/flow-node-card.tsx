/**
 * 캔버스 노드 카드(UI-FLW-02): 분류 표시, 이름, 설정 요약, 입력·출력 포트(true/false·error 라벨), 검증 배지, 오류 카운터,
 * 버전 비교 색(추가·변경·삭제, UI-FLW-05).
 */
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import { cx } from "~/components/ui";
import type { NodeBadge } from "../store/flow-editor-store";
import type { FlowNode, PortSpec } from "../model/types";

export interface FlowNodeData extends Record<string, unknown> {
  node: FlowNode;
  category: string;
  summary: string;
  inputs: PortSpec[];
  outputs: PortSpec[];
  badge?: NodeBadge;
  errorCount?: number;
  diff?: "added" | "changed" | "removed";
}

export type FlowNodeView = Node<FlowNodeData, "flowNode">;

const DIFF_CLASS = { added: "border-good", changed: "border-warn", removed: "border-bad border-dashed" } as const;

export function FlowNodeCard({ data, selected }: NodeProps<FlowNodeView>) {
  const { t } = useTranslation();
  const { node, badge, errorCount, diff } = data;
  const hasError = Boolean(badge?.errors.length);
  const hasWarning = Boolean(badge?.warnings.length);
  return (
    <div
      data-node-id={node.id}
      className={cx(
        "w-[180px] rounded-lg border-2 bg-panel px-2.5 py-2 text-[12px] shadow-sm",
        diff ? DIFF_CLASS[diff] : hasError ? "border-bad" : selected ? "border-accent" : "border-line",
      )}
    >
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
      {diff && <p className="text-[10.5px] text-muted">{t(`flows.diff.${diff}`)}</p>}
      <div className="mt-1 flex flex-col items-end gap-0.5">
        {data.outputs.map((port) => (
          <div key={port.name} className="relative flex items-center gap-1 pr-1 text-[10.5px] text-muted">
            <span className={port.name === "error" ? "text-bad" : undefined}>{port.name}</span>
            <Handle type="source" position={Position.Right} id={port.name} style={{ top: "auto", right: -12 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
