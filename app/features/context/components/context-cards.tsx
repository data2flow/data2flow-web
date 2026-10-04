/**
 * UI-DSC-04 외부 맥락 카드(DSC-06.01·06.02·06.04·06.05): 기상청 날씨·대기질·공휴일·학사일정(iCal) 켜기·설정, 마지막 수집, 호출량 막대(90일).
 * 조회 SRC_READ(OPERATOR+), 설정·지금 갱신 SRC_ADMIN(INTEGRATOR+). 비밀값(API 키)은 다시 보이지 않고 "설정됨"만 표시한다.
 */
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link } from "react-router";
import { Badge, Button, Card, Checkbox, CsrfField, SelectField, StatusDot, TextField, cx } from "~/components/ui";
import { formatDateTime, formatNumber } from "~/lib/format";
import {
  AIR_ITEMS,
  CALENDAR_TYPES,
  WEATHER_ITEMS,
  checkContextInput,
  checkIcsFile,
  contextTone,
  costTotals,
  selectedItems,
  syncDelta,
  typeMappingRows,
  usageLevel,
  type ContextSourceView,
  type IcsProblem,
  type SiteContext,
  type Station,
  type UsageDay,
} from "../model/context";

export interface ContextResult {
  intent?: string;
  type?: string;
  ok?: boolean;
  error?: { code: string; message?: string };
  fieldErrors?: Record<string, string>;
  refresh?: { status: string; added: number; updated: number; removed: number; error?: string | null };
}

interface CardProps {
  site: SiteContext;
  view: ContextSourceView;
  canAdmin: boolean;
  result?: ContextResult;
  timezone: string;
  lang: string;
}

const DEFAULT_WEATHER = ["T1H", "REH", "RN1", "WSD"];
const DEFAULT_AIR = ["PM10", "PM25", "O3"];

export function ContextCards({ site, stations, canAdmin, result, timezone, lang }: { site: SiteContext; stations: Station[]; canAdmin: boolean; result?: ContextResult; timezone: string; lang: string }) {
  const { t } = useTranslation();
  const byType = new Map(site.sources.map((s) => [s.type, s]));
  const view = (type: string): ContextSourceView => byType.get(type) ?? { type, enabled: false, apiKeyConfigured: false };
  const common = { site, canAdmin, result, timezone, lang };
  return (
    <div className="flex flex-col gap-4">
      {site.locationRequired && (
        <p role="note" className="rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-[13px] text-warn">
          {t("context.locationRequired")}{" "}
          <Link to={`/spaces/${site.siteId}?tab=props`} className="underline">
            {t("context.openSpace")}
          </Link>
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <WeatherCard {...common} view={view("KMA_WEATHER")} />
        <AirCard {...common} view={view("AIRKOREA")} stations={stations} />
        <HolidayCard {...common} view={view("HOLIDAY")} />
        <IcalCard {...common} view={view("ICAL")} />
      </div>
    </div>
  );
}

function CardShell({ view, children, actions }: { view: ContextSourceView; children: ReactNode; actions?: ReactNode }) {
  const { t } = useTranslation();
  const tone = contextTone(view);
  return (
    <Card
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          {t(`context.type.${view.type}`)}
          <StatusDot tone={tone} label={view.enabled ? t(`context.tone.${tone}`) : t("context.off")} />
          {view.provider?.simulated && <Badge tone="warning">{t("context.simulated")}</Badge>}
          {view.provider && !view.provider.available && <Badge tone="neutral">{t("context.unavailable")}</Badge>}
        </span>
      }
      actions={actions}
    >
      {children}
    </Card>
  );
}

function LastLine({ view, timezone, lang }: { view: ContextSourceView; timezone: string; lang: string }) {
  const { t } = useTranslation();
  const sync = view.lastSync;
  const usage = view.usageToday;
  return (
    <div className="mt-2 flex flex-col gap-1 text-[12.5px] text-muted">
      <span>
        {sync?.at ? t("context.lastSync", { at: formatDateTime(sync.at, timezone, lang) }) : t("context.never")}
        {sync?.status && ` · ${t(`context.syncStatus.${sync.status}`, { defaultValue: sync.status })}`}
        {sync && (sync.added || sync.updated || sync.removed) ? ` · ${syncDelta(sync)}` : ""}
        {sync?.error ? ` · ${sync.error}` : ""}
      </span>
      {usage && (
        <span className={cx(usage.exhausted ? "text-bad" : usage.warning ? "text-warn" : undefined)}>
          {usage.quota ? t("context.callsQuota", { calls: usage.calls, quota: usage.quota }) : t("context.calls", { calls: usage.calls })}
          {usage.failures ? ` · ${t("context.failures", { n: usage.failures })}` : ""}
          {usage.exhausted ? ` · ${t("context.exhausted")}` : usage.warning ? ` · ${t("context.warn80")}` : ""}
        </span>
      )}
    </div>
  );
}

function SaveForm({ type, children, disabled, result }: { type: string; children: ReactNode; disabled?: boolean; result?: ContextResult }) {
  const { t } = useTranslation();
  const mine = result?.type === type && result.intent === "save";
  return (
    <Form method="post" encType="multipart/form-data" className="flex flex-col gap-2">
      <CsrfField />
      <input type="hidden" name="intent" value="save" />
      <input type="hidden" name="type" value={type} />
      {children}
      {mine && result.ok && (
        <p role="status" className="text-[12.5px] text-good">
          {t("common.saved")}
        </p>
      )}
      {mine && result.error && (
        <p role="alert" className="text-[12.5px] text-bad">
          {t(`errors.${result.error.code}`, { defaultValue: result.error.message || t("errors.UNKNOWN") })}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={disabled}>
          {t("common.save")}
        </Button>
      </div>
    </Form>
  );
}

function useFieldErrors(type: string, result: ContextResult | undefined, local: Record<string, string>) {
  const { t } = useTranslation();
  const server = result?.type === type ? (result.fieldErrors ?? {}) : {};
  const merged = { ...server, ...local };
  return (key: string) => (merged[key] ? t(`context.validation.${merged[key]}`, { defaultValue: merged[key] }) : undefined);
}

function EnabledAndKey({ view, enabled, setEnabled, apiKey, setApiKey, keyError, needsKey }: { view: ContextSourceView; enabled: boolean; setEnabled: (v: boolean) => void; apiKey: string; setApiKey: (v: string) => void; keyError?: string; needsKey: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <Checkbox label={t("context.enabled")} name="enabled" value="true" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
      {needsKey && (
        <TextField
          label={t("context.apiKey")}
          name="apiKey"
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          hint={view.apiKeyConfigured ? t("context.apiKeySet") : undefined}
          error={keyError}
        />
      )}
    </>
  );
}

function ItemChecks({ name, all, selected, labelKey }: { name: string; all: readonly string[]; selected: string[]; labelKey: string }) {
  const { t } = useTranslation();
  return (
    <fieldset className="flex flex-wrap gap-x-3 gap-y-1">
      <legend className="text-[12.5px] text-muted">{t("context.items")}</legend>
      {all.map((item) => (
        <Checkbox key={item} label={t(`${labelKey}.${item}`)} name={name} value={item} defaultChecked={selected.includes(item)} />
      ))}
    </fieldset>
  );
}

function QuotaFields({ view, error }: { view: ContextSourceView; error: (k: string) => string | undefined }) {
  const { t } = useTranslation();
  const config = view.config ?? {};
  return (
    <div className="grid grid-cols-2 gap-2">
      <TextField label={t("context.dailyQuota")} name="dailyQuota" inputMode="numeric" defaultValue={config.dailyQuota === undefined || config.dailyQuota === null ? "" : String(config.dailyQuota)} error={error("dailyQuota")} />
      <TextField label={t("context.unitCost")} name="unitCost" inputMode="decimal" defaultValue={config.unitCost === undefined || config.unitCost === null ? "" : String(config.unitCost)} error={error("unitCost")} />
    </div>
  );
}

function WeatherCard({ site, view, canAdmin, result, timezone, lang }: CardProps) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(view.enabled);
  const [apiKey, setApiKey] = useState("");
  const [nx, setNx] = useState(String(view.config?.nx ?? site.kmaNx ?? ""));
  const [ny, setNy] = useState(String(view.config?.ny ?? site.kmaNy ?? ""));
  const local = checkContextInput("KMA_WEATHER", { enabled, apiKey, apiKeyConfigured: view.apiKeyConfigured, nx, ny });
  const error = useFieldErrors("KMA_WEATHER", result, local);
  const auto = site.kmaNx !== null && site.kmaNx !== undefined && String(site.kmaNx) === nx && String(site.kmaNy) === ny;
  return (
    <CardShell view={view} actions={canAdmin && view.sourceId && view.enabled ? <RefreshNow view={view} result={result} /> : undefined}>
      <p className="text-[12.5px] text-muted">{t("context.weatherNote")}</p>
      {canAdmin ? (
        <SaveForm type="KMA_WEATHER" result={result} disabled={Object.keys(local).length > 0 || (enabled && site.locationRequired)}>
          <EnabledAndKey view={view} enabled={enabled} setEnabled={setEnabled} apiKey={apiKey} setApiKey={setApiKey} keyError={error("apiKey")} needsKey />
          <div className="grid grid-cols-2 gap-2">
            <TextField label="nx" name="nx" inputMode="numeric" value={nx} onChange={(e) => setNx(e.target.value)} error={error("nx")} hint={auto ? t("context.gridAuto") : undefined} />
            <TextField label="ny" name="ny" inputMode="numeric" value={ny} onChange={(e) => setNy(e.target.value)} error={error("ny")} />
          </div>
          <ItemChecks name="items" all={WEATHER_ITEMS} selected={selectedItems(view.config, DEFAULT_WEATHER)} labelKey="context.weatherItem" />
          <Checkbox label={t("context.forecast")} name="forecast" value="true" defaultChecked={view.config?.forecast !== false} />
          <QuotaFields view={view} error={error} />
        </SaveForm>
      ) : (
        <p className="text-[13px]">{t("context.gridValue", { nx: nx || "–", ny: ny || "–" })}</p>
      )}
      <LastLine view={view} timezone={timezone} lang={lang} />
    </CardShell>
  );
}

function AirCard({ site, view, canAdmin, result, timezone, lang, stations }: CardProps & { stations: Station[] }) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(view.enabled);
  const [apiKey, setApiKey] = useState("");
  const local = checkContextInput("AIRKOREA", { enabled, apiKey, apiKeyConfigured: view.apiKeyConfigured });
  const error = useFieldErrors("AIRKOREA", result, local);
  const current = String(view.config?.stationName ?? "");
  const sorted = [...stations].sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 5);
  return (
    <CardShell view={view} actions={canAdmin && view.sourceId && view.enabled ? <RefreshNow view={view} result={result} /> : undefined}>
      {canAdmin ? (
        <SaveForm type="AIRKOREA" result={result} disabled={Object.keys(local).length > 0 || (enabled && site.locationRequired)}>
          <EnabledAndKey view={view} enabled={enabled} setEnabled={setEnabled} apiKey={apiKey} setApiKey={setApiKey} keyError={error("apiKey")} needsKey />
          <SelectField label={t("context.station")} name="stationName" defaultValue={current}>
            <option value="">{t("context.stationAuto")}</option>
            {current && !sorted.some((s) => s.stationName === current) && <option value={current}>{current}</option>}
            {sorted.map((s) => (
              <option key={s.stationName} value={s.stationName}>
                {t("context.stationOption", { name: s.stationName, km: formatNumber(s.distanceKm, lang, { precision: 1 }) })}
              </option>
            ))}
          </SelectField>
          <ItemChecks name="items" all={AIR_ITEMS} selected={selectedItems(view.config, DEFAULT_AIR)} labelKey="context.airItem" />
          <QuotaFields view={view} error={error} />
        </SaveForm>
      ) : (
        <p className="text-[13px]">{t("context.stationValue", { name: current || "–" })}</p>
      )}
      <LastLine view={view} timezone={timezone} lang={lang} />
    </CardShell>
  );
}

function HolidayCard({ view, canAdmin, result, timezone, lang }: CardProps) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(view.enabled);
  return (
    <CardShell view={view} actions={canAdmin && view.sourceId && view.enabled ? <RefreshNow view={view} result={result} /> : undefined}>
      {canAdmin ? (
        <SaveForm type="HOLIDAY" result={result}>
          <EnabledAndKey view={view} enabled={enabled} setEnabled={setEnabled} apiKey="" setApiKey={() => undefined} needsKey={false} />
          <SelectField label={t("context.country")} name="countryCode" defaultValue="KR">
            <option value="KR">{t("context.countryKR")}</option>
          </SelectField>
        </SaveForm>
      ) : (
        <p className="text-[13px]">{t("context.countryKR")}</p>
      )}
      <LastLine view={view} timezone={timezone} lang={lang} />
    </CardShell>
  );
}

function IcalCard({ view, canAdmin, result, timezone, lang }: CardProps) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(view.enabled);
  const [url, setUrl] = useState(String(view.config?.url ?? ""));
  const [fileProblem, setFileProblem] = useState<IcsProblem>(null);
  const [hasFile, setHasFile] = useState(false);
  const [refreshHours, setRefreshHours] = useState(String(view.config?.refreshHours ?? 6));
  const [rows, setRows] = useState(() => typeMappingRows(view.config));
  const fileKey = String(view.config?.fileObjectKey ?? "");
  const local = checkContextInput("ICAL", { enabled, url, fileObjectKey: fileKey, hasFile, refreshHours });
  const error = useFieldErrors("ICAL", result, local);
  return (
    <CardShell view={view} actions={canAdmin && view.sourceId && view.enabled ? <RefreshNow view={view} result={result} /> : undefined}>
      {canAdmin ? (
        <SaveForm type="ICAL" result={result} disabled={Object.keys(local).length > 0 || Boolean(fileProblem)}>
          <EnabledAndKey view={view} enabled={enabled} setEnabled={setEnabled} apiKey="" setApiKey={() => undefined} needsKey={false} />
          <TextField label={t("context.icalUrl")} name="url" type="url" placeholder="https://… / webcal://…" value={url} onChange={(e) => setUrl(e.target.value)} error={error("url")} />
          <label className="flex flex-col gap-1 text-[12.5px] text-muted">
            {t("context.icalFile")}
            <input
              type="file"
              name="file"
              accept=".ics,text/calendar"
              onChange={(e) => {
                const f = e.target.files?.[0];
                setHasFile(Boolean(f));
                setFileProblem(f ? checkIcsFile({ name: f.name, size: f.size }) : null);
              }}
            />
            {fileKey && <span>{t("context.icalFileStored")}</span>}
            {fileProblem && (
              <span role="alert" className="text-bad">
                {t(`context.validation.${fileProblem}`)}
              </span>
            )}
          </label>
          <TextField label={t("context.refreshHours")} name="refreshHours" inputMode="numeric" value={refreshHours} onChange={(e) => setRefreshHours(e.target.value)} error={error("refreshHours")} />
          <input type="hidden" name="typeMapping" value={JSON.stringify(rows)} />
          <fieldset className="flex flex-col gap-1">
            <legend className="text-[12.5px] text-muted">{t("context.typeMapping")}</legend>
            {rows.length === 0 && <p className="text-[12px] text-muted">{t("context.typeMappingEmpty")}</p>}
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <TextField label={t("context.category")} value={r.category} onChange={(e) => setRows((cur) => cur.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))} />
                <SelectField label={t("context.eventType")} value={r.type} onChange={(e) => setRows((cur) => cur.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}>
                  {CALENDAR_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`calendar.type.${type}`)}
                    </option>
                  ))}
                </SelectField>
                <Button aria-label={t("context.removeMapping", { category: r.category || "–" })} onClick={() => setRows((cur) => cur.filter((_, j) => j !== i))}>
                  ×
                </Button>
              </div>
            ))}
            <div>
              <Button onClick={() => setRows((cur) => [...cur, { category: "", type: "EVENT" }])}>{t("context.addMapping")}</Button>
            </div>
          </fieldset>
        </SaveForm>
      ) : (
        <p className="text-[13px]">{url || (fileKey ? t("context.icalFileStored") : "–")}</p>
      )}
      <LastLine view={view} timezone={timezone} lang={lang} />
    </CardShell>
  );
}

function RefreshNow({ view, result }: { view: ContextSourceView; result?: ContextResult }) {
  const { t } = useTranslation();
  const mine = result?.intent === "refresh" && result.type === view.type;
  return (
    <Form method="post" className="flex items-center gap-2">
      <CsrfField />
      <input type="hidden" name="intent" value="refresh" />
      <input type="hidden" name="type" value={view.type} />
      <input type="hidden" name="sourceId" value={view.sourceId ?? ""} />
      {mine && result.refresh && <span role="status" className="text-[12px] text-muted">{t("context.refreshed", { status: t(`context.syncStatus.${result.refresh.status}`, { defaultValue: result.refresh.status }), delta: syncDelta(result.refresh) })}</span>}
      {mine && result.error && <span role="alert" className="text-[12px] text-bad">{t(`errors.${result.error.code}`, { defaultValue: t("errors.UNKNOWN") })}</span>}
      <Button type="submit">{t("context.refreshNow")}</Button>
    </Form>
  );
}

/** 소스별 일일 호출·실패·한도 막대(최근 90일, DSC-06.05) */
export function UsageBars({ title, days, today, lang }: { title: string; days: UsageDay[]; today: string; lang: string }) {
  const { t } = useTranslation();
  const max = Math.max(1, ...days.map((d) => Math.max(d.calls, d.quota ?? 0)));
  const cost = costTotals(days, today);
  const latest = days.find((d) => d.day === today) ?? days[days.length - 1];
  const latestLevel = latest ? usageLevel(latest) : null;
  return (
    <section aria-label={t("context.usageOf", { name: title })} className="flex flex-col gap-1">
      <h3 className="text-[13px] font-semibold">{title}</h3>
      {days.length === 0 ? (
        <p className="text-[12px] text-muted">{t("context.noUsage")}</p>
      ) : (
        <>
          <div className="flex h-16 items-end gap-px" role="img" aria-label={t("context.usageChart", { days: days.length })}>
            {days.map((d) => {
              const { level } = usageLevel(d);
              return (
                <span
                  key={d.day}
                  data-day={d.day}
                  data-level={level}
                  title={`${d.day} ${d.calls}${d.quota ? `/${d.quota}` : ""}`}
                  className={cx("w-1 min-w-[2px] flex-1", level === "exhausted" ? "bg-bad" : level === "warn" ? "bg-warn" : "bg-accent")}
                  style={{ height: `${Math.max(2, (d.calls / max) * 100)}%` }}
                />
              );
            })}
          </div>
          {latest && latestLevel && (
            <p className={cx("text-[12px]", latestLevel.level === "exhausted" ? "text-bad" : latestLevel.level === "warn" ? "text-warn" : "text-muted")}>
              {latest.quota ? t("context.callsQuota", { calls: latest.calls, quota: latest.quota }) : t("context.calls", { calls: latest.calls })}
              {latest.failures ? ` · ${t("context.failures", { n: latest.failures })}` : ""}
              {latestLevel.pct !== null ? ` · ${latestLevel.pct}%` : ""}
              {latestLevel.level === "warn" ? ` · ${t("context.warn80")}` : latestLevel.level === "exhausted" ? ` · ${t("context.exhausted")}` : ""}
            </p>
          )}
          {cost && <p className="text-[12px] text-muted">{t("context.cost", { today: formatNumber(cost.today, lang), month: formatNumber(cost.month, lang) })}</p>}
        </>
      )}
    </section>
  );
}
