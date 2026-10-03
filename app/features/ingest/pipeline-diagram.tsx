/**
 * 수집 흐름 다이어그램(DSH-03.01, DSH-03.04): 소스 → 디코딩 → 스크립트 → 검증 → 저장 → 이벤트.
 * 단계마다 처리/분·실패/분·지연 p95, 실패가 있는 단계는 빨간 테두리, 누르면 실패 메시지 목록으로 이동한다.
 */
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { cx } from "~/components/ui";
import { formatNumber } from "~/lib/format";
import { failureLinkOf, orderedStages, stageFailing, type StageSnapshot } from "./model/ingest";

export function PipelineDiagram({ stages }: { stages: StageSnapshot[] }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  return (
    <ol aria-label={t("ingest.monitor.diagram")} className="flex flex-wrap items-stretch gap-2">
      {orderedStages(stages).map((stage, index) => {
        const failing = stageFailing(stage);
        const link = failureLinkOf(stage);
        const body = (
          <>
            <span className="text-[12px] font-semibold">{t(`ingest.stage.${stage.key}`)}</span>
            <span className="font-mono text-[13px]">{t("ingest.monitor.inPerMin", { n: formatNumber(stage.inPerMin ?? 0, lang) })}</span>
            {failing ? (
              <span className="font-mono text-[12px] text-bad">{t("ingest.monitor.failPerMin", { n: formatNumber(stage.failPerMin ?? 0, lang) })}</span>
            ) : (
              <span className="text-[12px] text-muted">{t("ingest.monitor.noFailure")}</span>
            )}
            {stage.latencyP95Ms != null && <span className="text-[11.5px] text-muted">p95 {formatNumber(stage.latencyP95Ms, lang)}ms</span>}
          </>
        );
        const className = cx("flex min-w-[120px] flex-col gap-0.5 rounded-lg border bg-panel px-3 py-2", failing ? "border-bad border-2" : "border-line");
        return (
          <li key={stage.key} className="flex items-center gap-2" data-stage={stage.key} data-failing={failing || undefined}>
            {index > 0 && <span aria-hidden className="text-muted">→</span>}
            {link ? (
              <Link to={link} className={cx(className, "hover:border-accent")} aria-label={t("ingest.monitor.stageLink", { stage: t(`ingest.stage.${stage.key}`) })}>
                {body}
              </Link>
            ) : (
              <div className={className}>{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
