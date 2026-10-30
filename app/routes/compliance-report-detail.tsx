/**
 * UI-CMP-08 리포트 미리 보기·발행(`/compliance/reports/{id}?rev=n`, CMP-02.02·02.04·02.06). 조회 CMP_READ, [발행]·[다시 생성]·[삭제]는 CMP_REPORT.
 * 가운데는 PDF(초안은 모든 쪽에 "초안" 워터마크), 오른쪽은 데이터 범위·프로필 버전·해시 메타와 [PDF]·[CSV]·[해시 검증].
 * 생성 중이면 진행률을 3초마다 다시 읽는다.
 * API: 상세 API-CMP-17, 발행 API-CMP-18, 파일 링크 API-CMP-19, 해시 검증 API-CMP-20, 다시 생성 API-CMP-16, 판 삭제 API-CMP-20a.
 */
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect, useRouteLoaderData } from "react-router";
import { callApi, field, newIdempotencyKey, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { getMe } from "~/bff/user.server";
import { Alert, Badge, Button, Card, CsrfField, EmptyState, PageHeader } from "~/components/ui";
import { FileButton, HashVerifyPanel, ProgressBar, RevisionMeta, usePolling } from "~/features/compliance/components/report-views";
import { bffFileUrl, failureCode, needsPolling, statusTone, type FileLink, type Report, type ReportCreated } from "~/features/compliance/model/reports";
import { errorText } from "~/lib/error-text";
import { resolveTimezone } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/compliance-report-detail";

const SECTIONS = ["cover", "summary", "metrics", "devices", "unmeasurable", "actions"] as const;

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const base = `/api/v1/core/compliance/reports/${encodeURIComponent(params.reportId)}`;
  const [result, me] = await Promise.all([callApi<Report>(ctx, request, base), getMe(ctx, request)]);
  const report = orThrow(result);
  const revisions = report.revisions ?? (report.latest ? [report.latest] : []);
  const wanted = Number(url.searchParams.get("rev"));
  const revision = revisions.find((r) => r.revisionNo === wanted) ?? report.latest ?? null;
  // 미리 보기는 서명 링크(10분)를 받아 iframe으로 연다. 링크 발급은 감사에 남는다(API-CMP-19)
  const preview =
    revision && (revision.status === "DRAFT" || revision.status === "PUBLISHED")
      ? await callApi<FileLink>(ctx, request, `${base}/revisions/${revision.revisionNo}/files/preview`)
      : null;
  return {
    report,
    revisions,
    revision,
    previewUrl: preview?.ok ? (bffFileUrl(preview.data.url) ?? null) : null,
    previewFailed: preview && !preview.ok ? { code: preview.code, message: preview.message } : null,
    timezone: resolveTimezone(me.ok ? me.data.timezone : undefined),
  };
}

type ActionResult = { intent: string; error?: { code: string; message?: string } };

export async function action({ request, context, params }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const reportId = encodeURIComponent(params.reportId);
  const base = `/api/v1/core/compliance/reports/${reportId}`;
  const revisionNo = Number(field(form, "revisionNo"));
  const fail = (failure: { code: string; message?: string; status: number }) => data<ActionResult>({ intent, error: { code: failure.code, message: failure.message } }, { status: failure.status });
  switch (intent) {
    case "publish": {
      const result = await callApi(ctx, request, `${base}/revisions/${revisionNo}/publish`, { method: "POST", idempotencyKey: newIdempotencyKey() });
      if (!result.ok) return fail(result);
      throw redirect(`/compliance/reports/${reportId}?rev=${revisionNo}`);
    }
    case "regenerate": {
      // 같은 조건(유형·공간·기간·시설 유형)으로 다시 만들면 같은 리포트에 새 판이 생긴다(BR-CMP-12)
      const current = await callApi<Report>(ctx, request, base);
      if (!current.ok) return fail(current);
      const r = current.data;
      const body = { type: r.type, title: r.title, spaceIds: r.spaceIds, facilityType: r.facilityType ?? null, periodFrom: r.periodFrom, periodTo: r.periodTo, options: r.options ?? null };
      const created = await callApi<ReportCreated>(ctx, request, "/api/v1/core/compliance/reports", { method: "POST", body, idempotencyKey: newIdempotencyKey() });
      if (!created.ok) return fail(created);
      throw redirect(`/compliance/reports/${created.data.reportId}?rev=${created.data.revisionNo}`);
    }
    case "delete": {
      const result = await callApi(ctx, request, `${base}/revisions/${revisionNo}`, { method: "DELETE" });
      if (!result.ok) return fail(result);
      const rest = await callApi<Report>(ctx, request, base);
      throw redirect(rest.ok ? `/compliance/reports/${reportId}` : "/compliance/reports");
    }
    default:
      return data<ActionResult>({ intent: intent || "unknown" }, { status: 400 });
  }
}

export default function ComplianceReportDetail({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const canReport = hasAny(root?.me?.permissions, ["CMP_REPORT"]);
  const { report, revisions, revision, previewUrl, previewFailed } = loaderData;
  const timezone = root?.timezone ?? loaderData.timezone;
  const result = actionData as ActionResult | undefined;
  usePolling(needsPolling([revision]));
  const path = `/compliance/reports/${report.reportId}`;
  const action = (intent: string, label: string, variant: "primary" | "secondary" | "danger" = "secondary") =>
    revision && (
      <Form method="post">
        <CsrfField />
        <input type="hidden" name="intent" value={intent} />
        <input type="hidden" name="revisionNo" value={revision.revisionNo} />
        <Button type="submit" variant={variant}>
          {label}
        </Button>
      </Form>
    );
  const cause = failureCode(revision?.failureReason);
  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {report.title}
            {revision && <Badge tone={statusTone(revision.status)}>{t(`compliance.reports.status.${revision.status}`)}</Badge>}
          </span>
        }
        crumb={t("compliance.reports.title")}
        id={revision ? `r${revision.revisionNo}` : undefined}
        actions={
          canReport && (
            <div className="flex gap-2">
              {revision && (revision.status === "DRAFT" || revision.status === "FAILED") && action("delete", t("compliance.reports.detail.delete"), "danger")}
              {revision?.status !== "GENERATING" && action("regenerate", t("compliance.reports.detail.regenerate"))}
              {revision?.status === "DRAFT" && action("publish", t("compliance.reports.detail.publish"), "primary")}
            </div>
          )
        }
      />
      {result?.error && (
        <div className="mb-3">
          <Alert tone="danger">{errorText(t, result.error)}</Alert>
        </div>
      )}
      {revisions.length > 1 && (
        <nav className="mb-3 flex flex-wrap gap-2 text-[13px]" aria-label={t("compliance.reports.detail.revisions")}>
          {revisions.map((r) => (
            <Link key={r.revisionNo} to={`${path}?rev=${r.revisionNo}`} aria-current={r.revisionNo === revision?.revisionNo ? "page" : undefined} className={r.revisionNo === revision?.revisionNo ? "font-semibold text-accent" : "text-muted hover:underline"}>
              r{r.revisionNo} · {t(`compliance.reports.status.${r.status}`)}
            </Link>
          ))}
        </nav>
      )}
      {!revision ? (
        <EmptyState title={t("compliance.reports.detail.noRevision")} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[160px_1fr_300px]">
          <nav className="hidden flex-col gap-1.5 text-[13px] text-muted lg:flex" aria-label={t("compliance.reports.detail.toc")}>
            {SECTIONS.map((s) => (
              <span key={s}>▸ {t(`compliance.reports.sections.${s}`)}</span>
            ))}
          </nav>
          <Card>
            {revision.status === "GENERATING" ? (
              <div className="flex flex-col items-center gap-3 py-16">
                <p className="text-[14px] font-semibold">{t("compliance.reports.detail.generating")}</p>
                <ProgressBar value={revision.progress} />
              </div>
            ) : revision.status === "FAILED" ? (
              <Alert tone="danger">
                {t("compliance.reports.detail.failed")} {cause ? (errorText(t, { code: cause }) ?? cause) : revision.failureReason}
              </Alert>
            ) : previewUrl ? (
              <div className="flex flex-col gap-2">
                {revision.status === "DRAFT" && <Alert tone="info">{t("compliance.reports.detail.draftNote")}</Alert>}
                <iframe title={t("compliance.reports.detail.preview")} src={previewUrl} className="h-[75vh] w-full rounded border border-line" />
              </div>
            ) : (
              <Alert tone="warning">{previewFailed ? errorText(t, previewFailed) : t("compliance.reports.detail.previewMissing")}</Alert>
            )}
          </Card>
          <div className="flex flex-col gap-4">
            <Card title={t("compliance.reports.detail.meta")}>
              <RevisionMeta report={report} revision={revision} timezone={timezone} lang={i18n.language} />
              {(revision.status === "DRAFT" || revision.status === "PUBLISHED") && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <FileButton reportId={report.reportId} revisionNo={revision.revisionNo} kind="pdf" label={t("compliance.reports.detail.pdf")} />
                  {canReport && report.options?.includeRawCsv === true && <FileButton reportId={report.reportId} revisionNo={revision.revisionNo} kind="csv" label={t("compliance.reports.detail.csv")} />}
                </div>
              )}
            </Card>
            <Card title={t("compliance.reports.verify.title")}>
              <HashVerifyPanel timezone={timezone} lang={i18n.language} />
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
