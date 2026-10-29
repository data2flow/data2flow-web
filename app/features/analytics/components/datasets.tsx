/**
 * UI-ANA-09 데이터셋(`/analytics/datasets`, `/analytics/datasets/{id}`, UC-ANA-11, ANA-10.01, API-ANA-20). 조회 V 이상, 편집 A 이상(ANALYTICS_RUN).
 * 목록(이름·버전·연결 수·사용 중인 분석 수), 상세(바인딩 칩·기간·버전 이력·사용 중인 분석과 [최신 버전으로 올리기]).
 * 새 데이터셋은 기존 분석의 바인딩·기간·품질 필터를 이름 붙여 저장한다(분석 마법사와 같은 바인딩 모양, BR-ANA-21). 바꿀 때마다 버전이 오른다.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { Alert, Badge, Button, Card, Chip, Dialog, EmptyState, SelectField, Table, TextField } from "~/components/ui";
import { bffJson, type BffJsonResult } from "~/lib/bff-client";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import { analyticsAdminApi, type AnalyticsAdminApi, type Dataset, type DatasetSummary, type DatasetVersion } from "../admin-api";
import type { Analysis, Period } from "../model/types";

export function periodText(period: Period | null | undefined, t: (key: string, opts?: Record<string, unknown>) => string, timezone: string, lang: string): string {
  if (!period) return "–";
  if (period.type === "RELATIVE") return t("analytics.datasets.lastDays", { n: period.days });
  return `${formatDateTime(period.from, timezone, lang)} ~ ${formatDateTime(period.to, timezone, lang)}`;
}

export function nameProblem(name: string): boolean {
  const n = name.trim();
  return n.length < 1 || n.length > 100;
}

type LoadAnalysis = (id: string) => Promise<BffJsonResult<Analysis>>;
const defaultLoadAnalysis: LoadAnalysis = (id) => bffJson(`/bff/api/core/analytics/analyses/${encodeURIComponent(id)}`);

export interface DatasetListProps {
  initial: DatasetSummary[];
  failed?: { code: string; message?: string } | null;
  analyses: { id: string; name: string }[];
  canEdit: boolean;
  timezone: string;
  lang: string;
  api?: AnalyticsAdminApi;
  loadAnalysis?: LoadAnalysis;
}

export function DatasetList({ initial, failed, analyses, canEdit, timezone, lang, api = analyticsAdminApi, loadAnalysis = defaultLoadAnalysis }: DatasetListProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [from, setFrom] = useState(analyses[0]?.id ?? "");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setSubmitted(true);
    setError(null);
    if (nameProblem(name) || !from) return;
    const source = await loadAnalysis(from);
    if (!source.ok) return setError(errorText(t, source) ?? "");
    const a = source.data;
    const result = await api.createDataset({ name: name.trim(), bindings: a.bindings ?? [], period: a.period ?? { type: "RELATIVE", days: 7 }, qualityFilter: a.qualityFilter ?? "NORMAL_ONLY", includeVirtual: a.includeVirtual ?? false });
    if (!result.ok) return setError(errorText(t, result) ?? "");
    void navigate(`/analytics/datasets/${encodeURIComponent(result.data.datasetId)}`);
  };

  return (
    <Card
      title={t("analytics.datasets.title")}
      actions={
        canEdit && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            {t("analytics.datasets.new")}
          </Button>
        )
      }
    >
      {failed && <Alert tone="danger">{errorText(t, failed)}</Alert>}
      {initial.length === 0 && !failed ? (
        <EmptyState title={t("analytics.datasets.empty")} body={t("analytics.datasets.emptyBody")} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t("analytics.datasets.name")}</th>
              <th>{t("analytics.datasets.version")}</th>
              <th>{t("analytics.datasets.bindings")}</th>
              <th>{t("analytics.datasets.analyses")}</th>
              <th>{t("analytics.datasets.updatedAt")}</th>
            </tr>
          </thead>
          <tbody>
            {initial.map((d) => (
              <tr key={d.datasetId}>
                <td>
                  <Link to={`/analytics/datasets/${encodeURIComponent(d.datasetId)}`} className="text-accent hover:underline">
                    {d.name}
                  </Link>
                </td>
                <td className="font-mono">{`v${d.version}`}</td>
                <td className="font-mono">{d.bindingCount}</td>
                <td className="font-mono">{d.analysisCount}</td>
                <td>{formatDateTime(d.updatedAt, timezone, lang)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title={t("analytics.datasets.new")}
        footer={
          <>
            <Button onClick={() => setCreating(false)}>{t("common.close")}</Button>
            <Button variant="primary" onClick={() => void create()}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        {error && <Alert tone="danger">{error}</Alert>}
        <TextField label={t("analytics.datasets.name")} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} error={submitted && nameProblem(name) ? t("analytics.datasets.nameProblem") : undefined} />
        <SelectField label={t("analytics.datasets.fromAnalysis")} value={from} onChange={(e) => setFrom(e.target.value)} error={submitted && !from ? t("analytics.datasets.fromAnalysisProblem") : undefined}>
          {analyses.length === 0 && <option value="">{t("analytics.datasets.noAnalyses")}</option>}
          {analyses.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </SelectField>
        <p className="text-[12px] text-muted">{t("analytics.datasets.fromAnalysisHint")}</p>
      </Dialog>
    </Card>
  );
}

export interface DatasetUsage {
  analysisId: string;
  name: string;
  datasetVersion?: number | null;
}

export interface DatasetDetailProps {
  dataset: Dataset;
  versions: DatasetVersion[];
  usage: DatasetUsage[];
  canEdit: boolean;
  timezone: string;
  lang: string;
  api?: AnalyticsAdminApi;
}

export function DatasetDetail({ dataset: initial, versions, usage: initialUsage, canEdit, timezone, lang, api = analyticsAdminApi }: DatasetDetailProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [dataset, setDataset] = useState(initial);
  const [history, setHistory] = useState(versions);
  const [usage, setUsage] = useState(initialUsage);
  const [name, setName] = useState(initial.name);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const rename = async () => {
    setNotice(null);
    if (nameProblem(name)) return setNotice({ tone: "danger", text: t("analytics.datasets.nameProblem") });
    const result = await api.renameDataset(dataset, name.trim());
    if (!result.ok) return setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
    setDataset(result.data);
    setHistory((h) => [{ version: result.data.version, bindingCount: result.data.bindings.length, updatedAt: result.data.updatedAt }, ...h]);
    setNotice({ tone: "success", text: t("analytics.datasets.savedVersion", { v: result.data.version }) });
  };

  const remove = async () => {
    if (!window.confirm(t("analytics.datasets.deleteConfirm", { name: dataset.name }))) return;
    const result = await api.deleteDataset(dataset.datasetId);
    if (!result.ok) return setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
    void navigate("/analytics/datasets");
  };

  const upgrade = async (u: DatasetUsage) => {
    setNotice(null);
    const result = await api.upgradeAnalysis(dataset.datasetId, u.analysisId);
    if (!result.ok) return setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
    setUsage((list) => list.map((x) => (x.analysisId === u.analysisId ? { ...x, datasetVersion: result.data.datasetVersion } : x)));
    setNotice({ tone: "success", text: t("analytics.datasets.upgraded", { name: u.name, v: result.data.datasetVersion }) });
  };

  return (
    <div className="flex flex-col gap-4">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <Card title={t("analytics.datasets.definition")} actions={<Badge tone="info">{`v${dataset.version}`}</Badge>}>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-[13px]">
          <dt className="text-muted">{t("analytics.datasets.bindings")}</dt>
          <dd className="flex flex-wrap gap-1.5">
            {dataset.bindings.flatMap((b) =>
              b.sources.map((s, i) => (
                <Chip key={`${b.role}-${i}`}>
                  <span className="text-muted">{b.role}</span> {s.label || `${s.deviceId ?? s.spaceId ?? ""} ${s.metricKey}`}
                </Chip>
              )),
            )}
          </dd>
          <dt className="text-muted">{t("analytics.datasets.period")}</dt>
          <dd>{periodText(dataset.period, t, timezone, lang)}</dd>
          <dt className="text-muted">{t("analytics.datasets.quality")}</dt>
          <dd>{t(`analytics.datasets.qualities.${dataset.qualityFilter}`)}</dd>
          <dt className="text-muted">{t("analytics.datasets.virtual")}</dt>
          <dd>{dataset.includeVirtual ? t("common.yes") : t("common.no")}</dd>
        </dl>
        {canEdit && (
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <TextField label={t("analytics.datasets.name")} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
            <Button onClick={() => void rename()} disabled={name.trim() === dataset.name}>
              {t("analytics.datasets.rename")}
            </Button>
            <Button variant="danger" onClick={() => void remove()} disabled={usage.length > 0}>
              {t("common.delete")}
            </Button>
          </div>
        )}
      </Card>

      <Card title={t("analytics.datasets.usage")}>
        {usage.length === 0 ? (
          <EmptyState title={t("analytics.datasets.noUsage")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("analytics.datasets.analysis")}</th>
                <th>{t("analytics.datasets.usedVersion")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {usage.map((u) => {
                const outdated = u.datasetVersion != null && u.datasetVersion < dataset.version;
                return (
                  <tr key={u.analysisId}>
                    <td>
                      <Link to={`/analytics/${encodeURIComponent(u.analysisId)}`} className="text-accent hover:underline">
                        {u.name}
                      </Link>
                    </td>
                    <td>
                      <span className="font-mono">{`v${u.datasetVersion ?? "–"}`}</span> {outdated && <Badge tone="warning">{t("analytics.datasets.outdated")}</Badge>}
                    </td>
                    <td>
                      {canEdit && outdated && (
                        <Button onClick={() => void upgrade(u)} aria-label={t("analytics.datasets.upgradeOf", { name: u.name })}>
                          {t("analytics.datasets.upgrade")}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title={t("analytics.datasets.history")}>
        <Table>
          <thead>
            <tr>
              <th>{t("analytics.datasets.version")}</th>
              <th>{t("analytics.datasets.bindings")}</th>
              <th>{t("analytics.datasets.updatedAt")}</th>
            </tr>
          </thead>
          <tbody>
            {history.map((v) => (
              <tr key={v.version}>
                <td className="font-mono">{`v${v.version}`}</td>
                <td className="font-mono">{v.bindingCount}</td>
                <td>{formatDateTime(v.updatedAt, timezone, lang)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
