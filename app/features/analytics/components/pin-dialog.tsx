/**
 * [대시보드에 고정] 대화상자(ANA-05.06, DSH-04.04, API-DSH-08 `pin-analysis`). 내 것·공유 대시보드에서 하나를 고르면
 * 빈 격자 자리에 분석 결과 위젯(차트 하나 또는 핵심 수치)을 넣는다. 위젯은 늘 그 분석의 최근 성공 결과를 보여 준다(BR-ANA-15).
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Alert, Button, Dialog, SelectField } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import type { AnalyticsApi, DashboardOption } from "../api";

export interface PinTarget {
  chartId?: string;
  metricKeys?: string[];
  label: string;
}

export function PinDialog({ analysisId, target, api, onClose }: { analysisId: string; target: PinTarget | null; api: AnalyticsApi; onClose: () => void }) {
  const { t } = useTranslation();
  const [dashboards, setDashboards] = useState<DashboardOption[] | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<{ code: string; message?: string } | null>(null);
  const [done, setDone] = useState<{ dashboardId: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const open = target !== null;
  useEffect(() => {
    if (!open) return;
    let live = true;
    setDone(null);
    setError(null);
    void api.listDashboards().then((result) => {
      if (!live) return;
      if (result.ok) {
        setDashboards(result.data);
        setSelected(result.data[0]?.id ?? "");
      } else setError({ code: result.code, message: result.message });
    });
    return () => {
      live = false;
    };
  }, [open, api]);
  const pin = async () => {
    if (!target || !selected) return;
    setBusy(true);
    const result = await api.pin(selected, { analysisId, ...(target.chartId ? { chartId: target.chartId } : {}), ...(target.metricKeys?.length ? { metricKeys: target.metricKeys } : {}) });
    setBusy(false);
    if (result.ok) setDone({ dashboardId: result.data.dashboardId ?? selected, name: dashboards?.find((d) => d.id === selected)?.name ?? "" });
    else setError({ code: result.code, message: result.message });
  };
  return (
    <Dialog
      title={t("analytics.pin.title")}
      open={open}
      onClose={onClose}
      footer={
        done ? (
          <Button onClick={onClose}>{t("common.close")}</Button>
        ) : (
          <>
            <Button onClick={onClose}>{t("common.cancel")}</Button>
            <Button variant="primary" onClick={() => void pin()} disabled={busy || !selected}>
              {t("analytics.pin.submit")}
            </Button>
          </>
        )
      }
    >
      <p className="text-[13px]">{t("analytics.pin.what", { label: target?.label ?? "" })}</p>
      {dashboards && dashboards.length === 0 && (
        <p className="text-[13px] text-muted">
          {t("analytics.pin.noDashboards")}{" "}
          <Link to="/dashboards" className="text-accent underline">
            {t("analytics.pin.goDashboards")}
          </Link>
        </p>
      )}
      {dashboards && dashboards.length > 0 && !done && (
        <SelectField label={t("analytics.pin.dashboard")} value={selected} onChange={(e) => setSelected(e.target.value)}>
          {dashboards.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </SelectField>
      )}
      <p className="text-[12px] text-muted">{t("analytics.pin.latestNote")}</p>
      {error && <Alert tone="danger">{errorText(t, error)}</Alert>}
      {done && (
        <Alert tone="success">
          {t("analytics.pin.done", { name: done.name })}{" "}
          <Link to={`/dashboards/${encodeURIComponent(done.dashboardId)}`} className="underline">
            {t("analytics.pin.open")}
          </Link>
        </Alert>
      )}
    </Dialog>
  );
}
