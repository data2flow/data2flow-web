/**
 * UI-ANA-04 내 분석 목록(ANA-04.01·04.02, API-ANA-07·08·22). 이름·템플릿(버전)·대상 요약·마지막 실행 상태·다음 일정·실시간·소유자.
 * [다시 실행]은 ANALYTICS_RUN, [삭제]는 소유자 또는 ADMIN(서버가 다시 판정). 일정이 연속 실패로 멈췄으면 빨간 배지.
 * 분석 하나에 실행이 아직 없으면 AnalysisEmpty가 [실행]을 보여 준다.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { Alert, Badge, Button, ButtonLink, Dialog, EmptyState, StatusDot, Table } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import type { AnalyticsApi } from "../api";
import { statusTone } from "../model/result";
import type { Analysis, AnalysisSummary } from "../model/types";

export function AnalysesList({ initial, canRun, isAdmin, meId, api, timezone }: { initial: AnalysisSummary[]; canRun: boolean; isAdmin: boolean; meId?: string; api: AnalyticsApi; timezone: string }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [items, setItems] = useState(initial);
  const [deleting, setDeleting] = useState<AnalysisSummary | null>(null);
  const [error, setError] = useState<{ code: string; message?: string } | null>(null);
  const idOf = (a: AnalysisSummary) => a.analysisId ?? a.id;

  const rerun = async (a: AnalysisSummary, ack = false) => {
    setError(null);
    const res = await api.runAnalysis(idOf(a), ack);
    if (res.ok) {
      const runId = res.data.runId ?? res.data.run?.runId;
      navigate(runId ? `/analytics/${encodeURIComponent(idOf(a))}/runs/${encodeURIComponent(runId)}` : `/analytics/${encodeURIComponent(idOf(a))}`);
    } else if (res.code === "ANALYSIS_WARNING_NOT_ACKNOWLEDGED" && !ack && window.confirm(t("analytics.result.warnBody"))) void rerun(a, true);
    else setError({ code: res.code, message: res.message });
  };
  const remove = async () => {
    if (!deleting) return;
    const res = await api.deleteAnalysis(idOf(deleting));
    if (res.ok) setItems((list) => list.filter((x) => idOf(x) !== idOf(deleting)));
    else setError({ code: res.code, message: res.message });
    setDeleting(null);
  };

  if (items.length === 0)
    return <EmptyState title={t("analytics.list.empty")} body={t("analytics.list.emptyBody")} action={<ButtonLink variant="primary" to="/analytics/templates">{t("analytics.list.toGallery")}</ButtonLink>} />;
  return (
    <>
      {error && <Alert tone="danger">{errorText(t, error)}</Alert>}
      <Table>
        <thead>
          <tr>
            <th>{t("analytics.list.name")}</th>
            <th>{t("analytics.list.template")}</th>
            <th>{t("analytics.list.target")}</th>
            <th>{t("analytics.list.lastRun")}</th>
            <th>{t("analytics.list.next")}</th>
            <th>{t("analytics.list.owner")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((a) => {
            const id = idOf(a);
            const ownerId = a.owner?.userId ?? a.owner?.id;
            const lastRunId = a.lastRun?.runId ?? a.lastRun?.id;
            return (
              <tr key={id}>
                <td>
                  <Link to={`/analytics/${encodeURIComponent(id)}`} className="font-medium text-accent hover:underline">
                    {a.name}
                  </Link>
                  {a.realtime && (
                    <span className="ml-1">
                      <Badge tone="info">{t("analytics.list.realtime")}</Badge>
                    </span>
                  )}
                </td>
                <td className="font-mono text-[12px]">{`${a.templateKey}${a.templateVersion ? ` ${a.templateVersion}` : ""}`}</td>
                <td>{a.targetSummary ?? "–"}</td>
                <td>
                  {a.lastRun ? (
                    <Link to={`/analytics/${encodeURIComponent(id)}/runs/${encodeURIComponent(lastRunId ?? "")}`}>
                      <StatusDot tone={statusTone(a.lastRun.status)} label={`${t(`analytics.status.${a.lastRun.status}`)}${a.lastRun.finishedAt ? ` ${formatDateTime(a.lastRun.finishedAt, timezone, i18n.language)}` : ""}`} />
                    </Link>
                  ) : (
                    "–"
                  )}
                </td>
                <td>
                  {a.scheduleState === "STOPPED_BY_FAILURE" ? <Badge tone="danger">{t("analytics.list.stopped")}</Badge> : a.scheduleState === "PAUSED" ? <Badge tone="neutral">{t("analytics.list.paused")}</Badge> : formatDateTime(a.nextScheduledAt, timezone, i18n.language)}
                </td>
                <td>{a.owner?.name ?? "–"}</td>
                <td className="whitespace-nowrap">
                  {canRun && <Button onClick={() => void rerun(a)}>{t("analytics.result.rerun")}</Button>}{" "}
                  {(isAdmin || (meId && ownerId === meId)) && (
                    <Button variant="danger" onClick={() => setDeleting(a)}>
                      {t("common.delete")}
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <Dialog
        title={t("analytics.list.deleteTitle")}
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>{t("common.cancel")}</Button>
            <Button variant="danger" onClick={() => void remove()}>
              {t("common.delete")}
            </Button>
          </>
        }
      >
        <p className="text-[13px]">{t("analytics.list.deleteBody", { name: deleting?.name ?? "" })}</p>
      </Dialog>
    </>
  );
}

/** 실행이 아직 없는 분석(저장만 한 직후 등) */
export function AnalysisEmpty({ analysis, canRun, saved, api }: { analysis: Analysis; canRun: boolean; saved: boolean; api: AnalyticsApi }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [error, setError] = useState<{ code: string; message?: string } | null>(null);
  const run = async (ack: boolean) => {
    const res = await api.runAnalysis(analysis.analysisId, ack);
    if (res.ok) {
      const runId = res.data.runId ?? res.data.run?.runId;
      if (runId) navigate(`/analytics/${encodeURIComponent(analysis.analysisId)}/runs/${encodeURIComponent(runId)}`);
    } else if (res.code === "ANALYSIS_WARNING_NOT_ACKNOWLEDGED" && !ack && window.confirm(t("analytics.result.warnBody"))) void run(true);
    else setError({ code: res.code, message: res.message });
  };
  return (
    <div className="flex flex-col gap-3">
      {saved && <Alert tone="success">{t("analytics.list.saved")}</Alert>}
      {error && <Alert tone="danger">{errorText(t, error)}</Alert>}
      <EmptyState title={t("analytics.list.noRuns")} body={analysis.schedule ? t("analytics.list.scheduled") : undefined} action={canRun ? <Button variant="primary" onClick={() => void run(false)}>{t("analytics.list.runNow")}</Button> : undefined} />
    </div>
  );
}
