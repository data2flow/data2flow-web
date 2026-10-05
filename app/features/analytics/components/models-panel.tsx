/**
 * UI-ANA-06 모델 관리(ANA-07.01~07.04, API-ANA-14·23·24). 분석별로 버전·상태·학습 기간·지표(MAE·MAPE·정밀도)·드리프트를 보여 주고,
 * INTEGRATOR 이상은 [재학습]·후보 [적용]을 쓴다. 후보가 지금보다 나쁘면 서버가 409 MODEL_WORSE_THAN_ACTIVE → 확인 뒤 force로 다시 보낸다.
 * 라벨이 없어 정밀도를 낼 수 없는 칸은 "–"(TC-ANA-148).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Alert, Badge, Button, Card, Dialog, EmptyState, Table } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { formatDate, formatDateTime, formatNumber } from "~/lib/format";
import type { AnalyticsApi } from "../api";
import type { ModelItem } from "../model/types";

const METRIC_KEYS = ["mae", "mape", "precision", "recall"] as const;

function metricOf(m: ModelItem, key: string): number | null {
  const entries = Object.entries(m.metrics ?? {});
  const found = entries.find(([k]) => k.toLowerCase() === key);
  return found && typeof found[1] === "number" ? found[1] : null;
}

export function ModelsPanel({ initial, canManage, api, timezone }: { initial: ModelItem[]; canManage: boolean; api: AnalyticsApi; timezone: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [items, setItems] = useState(initial);
  const [notice, setNotice] = useState<{ tone: "success" | "danger" | "info"; text: string } | null>(null);
  const [worse, setWorse] = useState<ModelItem | null>(null);
  const groups = new Map<string, ModelItem[]>();
  for (const m of items) groups.set(m.analysisId, [...(groups.get(m.analysisId) ?? []), m]);

  const reload = async () => {
    const res = await api.listModels();
    if (res.ok) setItems(res.data.responses);
  };
  const activate = async (m: ModelItem, force: boolean) => {
    setWorse(null);
    const res = await api.activateModel(m.modelId, force);
    if (res.ok) {
      setNotice({ tone: "success", text: t("analytics.models.activated", { v: m.version }) });
      await reload();
    } else if (res.code === "MODEL_WORSE_THAN_ACTIVE" && !force) setWorse(m);
    else setNotice({ tone: "danger", text: errorText(t, res) ?? "" });
  };
  const train = async (analysisId: string) => {
    const res = await api.trainModel(analysisId);
    if (res.ok) {
      setNotice({ tone: "info", text: t("analytics.models.trainQueued", { v: res.data.version }) });
      await reload();
    } else setNotice({ tone: "danger", text: errorText(t, res) ?? "" });
  };

  if (items.length === 0) return <EmptyState title={t("analytics.models.empty")} body={t("analytics.models.emptyBody")} />;
  return (
    <div className="flex flex-col gap-3">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {[...groups.entries()].map(([analysisId, versions]) => {
        const sorted = [...versions].sort((a, b) => b.version - a.version);
        const head = sorted[0];
        const drift = sorted.some((m) => m.drift);
        return (
          <Card
            key={analysisId}
            title={
              <span className="flex items-center gap-2">
                <Link to={`/analytics/${encodeURIComponent(analysisId)}`} className="text-accent hover:underline">
                  {head.analysisName ?? analysisId}
                </Link>
                <span className="font-mono text-[12px] font-normal text-muted">{head.templateKey}</span>
                {drift && <Badge tone="warning">{t("analytics.models.drift")}</Badge>}
              </span>
            }
            actions={canManage ? <Button onClick={() => void train(analysisId)}>{t("analytics.models.retrain")}</Button> : undefined}
          >
            <Table>
              <thead>
                <tr>
                  <th>{t("analytics.models.version")}</th>
                  <th>{t("analytics.models.status")}</th>
                  <th>{t("analytics.models.trainPeriod")}</th>
                  {METRIC_KEYS.map((k) => (
                    <th key={k}>{k.toUpperCase()}</th>
                  ))}
                  <th>{t("analytics.models.trainedAt")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sorted.map((m) => (
                  <tr key={m.modelId}>
                    <td>{`v${m.version}`}</td>
                    <td>
                      <Badge tone={m.status === "ACTIVE" ? "success" : m.status === "FAILED" ? "danger" : m.status === "CANDIDATE" ? "info" : "neutral"}>{t(`analytics.modelStatus.${m.status}`)}</Badge>
                    </td>
                    <td>{m.trainFrom ? `${formatDate(m.trainFrom, timezone, lang)} – ${formatDate(m.trainTo, timezone, lang)}` : "–"}</td>
                    {METRIC_KEYS.map((k) => (
                      <td key={k} className="tabular-nums">
                        {formatNumber(metricOf(m, k), lang)}
                      </td>
                    ))}
                    <td>{formatDateTime(m.trainedAt, timezone, lang)}</td>
                    <td>{canManage && m.status === "CANDIDATE" && <Button onClick={() => void activate(m, false)}>{t("analytics.models.activate")}</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        );
      })}
      <Dialog
        title={t("analytics.models.worseTitle")}
        open={worse !== null}
        onClose={() => setWorse(null)}
        footer={
          <>
            <Button onClick={() => setWorse(null)}>{t("common.cancel")}</Button>
            <Button variant="danger" onClick={() => worse && void activate(worse, true)}>
              {t("analytics.models.activateAnyway")}
            </Button>
          </>
        }
      >
        <p className="text-[13px]">{t("analytics.models.worseBody")}</p>
      </Dialog>
    </div>
  );
}
