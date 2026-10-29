/**
 * 준수 리포트 화면 부품(UI-CMP-07·08): 상태 배지·진행률, 판 메타, 파일 받기, 해시 검증.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useRevalidator } from "react-router";
import { Alert, Badge, Button } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { formatDate, formatDateTime } from "~/lib/format";
import { defaultReportsApi, type ReportsApi } from "../api";
import { bffFileUrl, POLL_MS, shortHash, statusTone, type FileKind, type Report, type ReportRevision, type VerifyResult } from "../model/reports";

export function ReportStatusBadge({ revision }: { revision: ReportRevision | null | undefined }) {
  const { t } = useTranslation();
  if (!revision) return <span className="text-muted">–</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <Badge tone={statusTone(revision.status)}>{t(`compliance.reports.status.${revision.status}`)}</Badge>
      {revision.status === "GENERATING" && <ProgressBar value={revision.progress} />}
    </span>
  );
}

export function ProgressBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-muted" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <span className="h-1.5 w-16 overflow-hidden rounded bg-line2">
        <span className="block h-full bg-accent" style={{ width: `${v}%` }} />
      </span>
      {v}%
    </span>
  );
}

/** 생성 중인 판이 있으면 POLL_MS마다 loader를 다시 부른다 */
export function usePolling(active: boolean) {
  const revalidator = useRevalidator();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") void revalidator.revalidate();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, revalidator]);
}

/** UI-CMP-08 오른쪽 메타: 데이터 범위·결측률·프로필 버전·생성·발행·해시·판 */
export function RevisionMeta({ report, revision, timezone, lang }: { report: Report; revision: ReportRevision; timezone: string; lang: string }) {
  const { t } = useTranslation();
  const range = revision.dataRange;
  const rows: [string, ReactNode][] = [
    [t("compliance.reports.meta.period"), `${report.periodFrom} ~ ${report.periodTo}`],
    [t("compliance.reports.meta.revision"), `r${revision.revisionNo}`],
    [t("compliance.reports.meta.facility"), report.facilityType ? t(`compliance.facility.${report.facilityType}`, { defaultValue: report.facilityType }) : t("compliance.reports.meta.noFacility")],
    [t("compliance.reports.meta.profiles"), t("compliance.reports.meta.profileCount", { n: revision.profileVersions.length })],
  ];
  if (range) {
    rows.push([t("compliance.reports.meta.rows"), range.rows.toLocaleString(lang)]);
    rows.push([t("compliance.reports.meta.missing"), range.missingRatio == null ? "–" : `${range.missingRatio}%`]);
    if (range.excludedVirtualDevices > 0) rows.push([t("compliance.reports.meta.virtual"), t("compliance.reports.meta.virtualCount", { n: range.excludedVirtualDevices })]);
    if (range.lateRowsSincePrevious > 0) rows.push([t("compliance.reports.meta.late"), t("compliance.reports.meta.lateCount", { n: range.lateRowsSincePrevious })]);
  }
  rows.push([t("compliance.reports.meta.generated"), `${formatDateTime(revision.updatedAt, timezone, lang)}${revision.generatedBy?.name ? ` · ${revision.generatedBy.name}` : ""}`]);
  if (revision.publishedAt) rows.push([t("compliance.reports.meta.published"), `${formatDateTime(revision.publishedAt, timezone, lang)}${revision.publishedBy?.name ? ` · ${revision.publishedBy.name}` : ""}`]);
  if (revision.sha256)
    rows.push([
      t("compliance.reports.meta.hash"),
      <code key="hash" title={revision.sha256} className="font-mono text-[12px]">
        {shortHash(revision.sha256)}
      </code>,
    ]);
  const warn = range?.missingRatio != null && range.missingRatio > 10;
  return (
    <div className="flex flex-col gap-3">
      {warn && <Alert tone="warning">{t("compliance.reports.meta.qualityWarning", { ratio: range?.missingRatio })}</Alert>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export type Opener = (href: string) => void;
const openHref: Opener = (href) => window.location.assign(href);

/** [PDF 다운로드]·[원시 데이터 CSV]: 서명 링크(10분)를 받아 바로 연다. 링크 발급은 감사에 남는다 */
export function FileButton({ reportId, revisionNo, kind, label, api = defaultReportsApi, open = openHref }: { reportId: string; revisionNo: number; kind: FileKind; label: string; api?: ReportsApi; open?: Opener }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const click = async () => {
    setBusy(true);
    setError(null);
    const result = await api.fileLink(reportId, revisionNo, kind);
    setBusy(false);
    const href = result.ok ? bffFileUrl(result.data.url) : undefined;
    if (href) open(href);
    else setError(result.ok ? (t("errors.UNKNOWN") ?? "") : (errorText(t, result) ?? ""));
  };
  return (
    <span className="inline-flex flex-col">
      <Button type="button" onClick={click} disabled={busy}>
        {label}
      </Button>
      {error && <span className="text-[12px] text-bad-ink">{error}</span>}
    </span>
  );
}

/** [해시 검증](API-CMP-20): PDF를 올려 이 조직이 만든 리포트와 같은지 본다 */
export function HashVerifyPanel({ api = defaultReportsApi, timezone, lang }: { api?: ReportsApi; timezone: string; lang: string }) {
  const { t } = useTranslation();
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const change = async (file: File | undefined) => {
    setResult(null);
    setError(null);
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      setError(t("compliance.reports.verify.tooLarge"));
      return;
    }
    setBusy(true);
    const r = await api.verifyHash(file);
    setBusy(false);
    if (r.ok) setResult(r.data);
    else setError(r.status === 400 ? t("compliance.reports.verify.notPdf") : (errorText(t, r) ?? ""));
  };
  return (
    <div className="flex flex-col gap-2">
      <label className="text-[12.5px] font-medium">
        {t("compliance.reports.verify.label")}
        <input type="file" accept="application/pdf,.pdf" className="mt-1 block text-[12.5px]" disabled={busy} onChange={(e) => void change(e.target.files?.[0])} />
      </label>
      <p className="text-[12px] text-muted">{t("compliance.reports.verify.hint")}</p>
      {busy && <p className="text-[12.5px] text-muted">{t("compliance.reports.verify.checking")}</p>}
      {error && <Alert tone="danger">{error}</Alert>}
      {result &&
        (result.matched ? (
          <Alert tone="success">
            {t("compliance.reports.verify.matched", { n: result.revisionNo })}{" "}
            {result.publishedAt ? t("compliance.reports.verify.publishedAt", { at: formatDate(result.publishedAt, timezone, lang) }) : t("compliance.reports.verify.draft")}{" "}
            <Link className="text-accent hover:underline" to={`/compliance/reports/${result.reportId}?rev=${result.revisionNo}`}>
              {t("compliance.reports.verify.open")}
            </Link>
          </Alert>
        ) : (
          <Alert tone="danger">{t("compliance.reports.verify.mismatch")}</Alert>
        ))}
    </div>
  );
}
