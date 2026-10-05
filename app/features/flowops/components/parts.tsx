/**
 * 자동화 부가 화면 공용 부품: 하위 메뉴, 승격 대상 매핑 표(UI-FLW-13), 자동 검사 결과(UI-FLW-19), 스냅샷 비교(UI-FLW-18), 연결 테스트 결과(UI-FLW-08).
 */
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useRouteLoaderData } from "react-router";
import { Alert, Badge, Table, Tabs } from "~/components/ui";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import { unmappedCount, type MappingRow } from "../model/mapping";
import { compareTotals, type SnapshotCompare } from "../model/snapshot";
import { testFailureKind, type SinkTestResult } from "../model/sink";

const AREAS = [
  { key: "flows", to: "/automation/flows", anyOf: ["FLOW_READ"] },
  { key: "snapshots", to: "/automation/snapshots", anyOf: ["FLOW_WRITE"] },
  { key: "pipelines", to: "/automation/pipelines", anyOf: ["FLOW_DEPLOY_CONTROL", "FLOW_APPROVE"] },
  { key: "packages", to: "/automation/packages", anyOf: ["FLOW_DEPLOY_CONTROL", "NODE_PACKAGE_MANAGE"] },
  { key: "sinks", to: "/automation/sink-connections", anyOf: ["SINK_CONNECTION_MANAGE"] },
] as const;

export type FlowOpsArea = (typeof AREAS)[number]["key"];

/** 자동화 하위 메뉴(00-navigation.md §2 자동화). 권한 없는 항목은 숨긴다(보조 수단) */
export function FlowOpsTabs({ current }: { current: FlowOpsArea }) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const items = AREAS.filter((a) => hasAny(root?.me?.permissions, a.anyOf)).map((a) => ({ key: a.key, label: t(`flowops.areas.${a.key}`), to: a.to }));
  return <Tabs section items={items} current={current} />;
}

/**
 * UI-FLW-13 대상 매핑 표: 종류·원본·대상 선택·상태(✓/✗). 선택은 `map.{kind}:{id}` 필드로 폼에 실린다.
 * 고를 때마다 상태와 "매핑되지 않은 대상 N개"를 바로 다시 계산하고, ✗가 하나라도 있으면 `submit(true)`로 버튼을 막는다.
 */
export function MappingTable({ rows, readOnly = false, submit }: { rows: MappingRow[]; readOnly?: boolean; submit?: (blocked: boolean) => ReactNode }) {
  const { t } = useTranslation();
  const [targets, setTargets] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [`${r.kind}:${r.sourceId}`, r.targetId])));
  const live = rows.map((r) => {
    const targetId = targets[`${r.kind}:${r.sourceId}`] ?? "";
    return { ...r, targetId, mapped: r.derived || Boolean(targetId) };
  });
  const missing = unmappedCount(live);
  return (
    <div className="flex flex-col gap-2">
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-muted">{t("flowops.mapping.none")}</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t("flowops.mapping.kind")}</th>
              <th>{t("flowops.mapping.source")}</th>
              <th>{t("flowops.mapping.target")}</th>
              <th>{t("flowops.mapping.status")}</th>
            </tr>
          </thead>
          <tbody>
            {live.map((row) => {
              const key = `${row.kind}:${row.sourceId}`;
              return (
                <tr key={key}>
                  <td>{t(`flowops.mapping.kinds.${row.kind}`, { defaultValue: row.kind })}</td>
                  <td>{row.sourceName}</td>
                  <td>
                    {row.derived ? (
                      <span className="text-muted">{t("flowops.mapping.derived")}</span>
                    ) : readOnly ? (
                      (row.candidates.find((c) => c.id === row.targetId)?.name ?? "–")
                    ) : (
                      <select
                        name={`map.${key}`}
                        value={row.targetId}
                        onChange={(e) => setTargets((prev) => ({ ...prev, [key]: e.target.value }))}
                        aria-label={t("flowops.mapping.targetOf", { name: row.sourceName })}
                        className="rounded-md border border-line bg-panel px-2 py-1 text-[13px]"
                      >
                        <option value="">{t("flowops.mapping.choose")}</option>
                        {row.candidates.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td>{row.mapped ? <Badge tone="success">{t("flowops.mapping.ok")}</Badge> : <Badge tone="danger">{t("flowops.mapping.missing")}</Badge>}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {missing > 0 && <Alert tone="warning">{t("flowops.mapping.unmapped", { count: missing })}</Alert>}
      {submit?.(missing > 0)}
    </div>
  );
}

/** 자동 검사 결과(시험 실행 통과, 재생 제어·알림 횟수 상한) */
export function ChecksList({ checks }: { checks: { name: string; passed: boolean; detail?: string | null }[] | undefined }) {
  const { t } = useTranslation();
  if (!checks?.length) return <span className="text-muted">–</span>;
  return (
    <ul className="flex flex-col gap-0.5 text-[12.5px]">
      {checks.map((c) => (
        <li key={c.name} className={c.passed ? "text-good-ink" : "text-bad-ink"}>
          {`${c.passed ? t("flowops.checks.passed") : t("flowops.checks.failed")} · ${t(`flowops.checks.names.${c.name}`, { defaultValue: c.name })}`}
          {c.detail ? ` — ${c.detail}` : ""}
        </li>
      ))}
    </ul>
  );
}

const show = (value: unknown) => (value === undefined || value === null ? "–" : typeof value === "object" ? JSON.stringify(value) : String(value));

/** UI-FLW-18 스냅샷 비교: 플로우별 노드 추가·삭제·변경, 스크립트·서브플로우 버전 */
export function SnapshotCompareView({ compare, names }: { compare: SnapshotCompare; names: [string, string] }) {
  const { t } = useTranslation();
  const totals = compareTotals(compare);
  const versionRows = [...compare.scripts.map((s) => ({ ...s, kind: "script" })), ...compare.subflows.map((s) => ({ ...s, kind: "subflow" }))].filter((s) => s.from !== s.to);
  return (
    <div className="flex flex-col gap-3" aria-label={t("flowops.snapshots.compareTitle", { a: names[0], b: names[1] })}>
      <p className="text-[13px]">{t("flowops.snapshots.compareSummary", totals)}</p>
      {compare.flows.length === 0 && versionRows.length === 0 && <p className="text-[12.5px] text-muted">{t("flowops.snapshots.noDiff")}</p>}
      {compare.flows.map((flow) => (
        <section key={flow.flowId} className="rounded-md border border-line p-3">
          <h3 className="mb-1 text-[13px] font-semibold">{flow.flowName ?? flow.flowId}</h3>
          <ul className="flex flex-col gap-0.5 text-[12.5px]">
            {flow.added.map((n) => (
              <li key={`a-${n}`} className="text-good-ink">{t("flowops.snapshots.nodeAdded", { node: n })}</li>
            ))}
            {flow.removed.map((n) => (
              <li key={`r-${n}`} className="text-bad-ink">{t("flowops.snapshots.nodeRemoved", { node: n })}</li>
            ))}
            {flow.changed.map((c) => (
              <li key={`c-${c.nodeId}-${c.field}`}>{t("flowops.snapshots.nodeChanged", { node: c.nodeId, field: c.field, from: show(c.from), to: show(c.to) })}</li>
            ))}
          </ul>
        </section>
      ))}
      {versionRows.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-[12.5px]">
          {versionRows.map((v) => (
            <li key={`${v.kind}-${v.id}`}>{t(`flowops.snapshots.${v.kind}Version`, { id: v.id, from: v.from === null ? "–" : `v${v.from}`, to: v.to === null ? "–" : `v${v.to}` })}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** UI-FLW-08 연결 테스트 결과: 성공(지연 ms) 또는 원인(AUTH·DNS·TLS·TIMEOUT·OTHER) */
export function SinkTestResultView({ result, failureMessage }: { result: SinkTestResult | null; failureMessage?: string }) {
  const { t } = useTranslation();
  if (result?.ok) return <Alert tone="success">{t("flowops.sinks.testOk", { ms: result.latencyMs ?? 0 })}</Alert>;
  const kind = testFailureKind(result, failureMessage);
  const detail = result?.error?.message ?? failureMessage;
  return (
    <Alert tone="danger">
      {t("flowops.sinks.testFailed", { reason: t(`flowops.sinks.kinds.${kind}`) })}
      {detail ? ` (${detail})` : ""}
    </Alert>
  );
}
