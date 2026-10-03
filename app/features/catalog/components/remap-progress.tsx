/**
 * 별칭 연결 뒤 과거 데이터 키 변환 진행률(BR-DEV-16, API-DEV-56). 끝날 때까지 2초마다 조회한다.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "~/components/ui";
import { bffJson } from "~/lib/bff-client";

interface Job {
  status: string;
  processed: number;
  total: number;
}

export function RemapProgress({ jobId, fetchJob = (id) => bffJson<Job>(`/bff/api/core/metric-remap-jobs/${encodeURIComponent(id)}`), intervalMs = 2000 }: { jobId: string; fetchJob?: (id: string) => ReturnType<typeof bffJson<Job>>; intervalMs?: number }) {
  const { t } = useTranslation();
  const [job, setJob] = useState<Job | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const poll = async () => {
      const result = await fetchJob(jobId);
      if (stopped) return;
      if (!result.ok) {
        setFailed(true);
        return;
      }
      setJob(result.data);
      if (result.data.status === "RUNNING" || result.data.status === "PENDING") timer = setTimeout(poll, intervalMs);
    };
    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, fetchJob, intervalMs]);
  if (failed) return <Alert tone="warning">{t("catalog.metrics.remapUnknown")}</Alert>;
  if (!job) return <p className="text-[12.5px] text-muted">{t("common.loading")}</p>;
  const percent = job.total ? Math.round((job.processed / job.total) * 100) : 100;
  return (
    <div role="status" className="flex flex-col gap-1">
      <p className="text-[13px]">{job.status === "SUCCEEDED" ? t("catalog.metrics.remapDone", { n: job.total }) : job.status === "FAILED" ? t("catalog.metrics.remapFailed") : t("catalog.metrics.remapRunning", { processed: job.processed, total: job.total })}</p>
      <div className="h-2 w-full rounded bg-bg" aria-hidden>
        <div className="h-2 rounded bg-accent" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
