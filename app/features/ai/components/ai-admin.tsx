/**
 * UI-AIA-06 AI 설정·사용량·평가(관리자, AIA-07.04~07.07, API-AIA-07·08·16).
 * - 설정: 켜기, 제공자(NONE·FAKE 포함, 배포에서 못 고르는 제공자는 막고 키가 없는 제공자는 "준비 중"), 모델, 한도, 기록 보관(7~365일),
 *   자동 해설, 평가 기준, 제안 만료(5~120분). 모델을 바꾸면 최근 평가가 기준을 넘어야 저장된다(409 AI_EVAL_BELOW_THRESHOLD)
 * - 사용량: 기간·묶음(일·기능·사용자) 막대, 합계·추정 비용, 오늘 한도 대비 사용률
 * - 평가: 평가 셋 요약(질문 수·종류별), 최근 평가 실행(정확도·수치 일치율·인젝션 방어율·통과), [평가 실행]
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Badge, Button, Card, Checkbox, SelectField, Table, TextField } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { formatDateTime, formatNumber } from "~/lib/format";
import type { AiApi } from "../api";
import type { AiSettings, EvalCase, EvalRun, Usage } from "../model/types";

type Failure = { code: string; message?: string } | null;

const INT_FIELDS = ["dailyRequestLimit", "dailyTokenLimit", "perUserDailyLimit", "logRetentionDays", "suggestionTtlMinutes"] as const;

export function validateSettings(s: Record<string, string | boolean>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const key of INT_FIELDS) {
    const n = Number(s[key]);
    if (String(s[key]).trim() === "" || !Number.isInteger(n) || n < 0) errors[key] = "INT";
  }
  const days = Number(s.logRetentionDays);
  if (!errors.logRetentionDays && (days < 7 || days > 365)) errors.logRetentionDays = "RETENTION";
  const ttl = Number(s.suggestionTtlMinutes);
  if (!errors.suggestionTtlMinutes && (ttl < 5 || ttl > 120)) errors.suggestionTtlMinutes = "TTL";
  const pct = Number(s.evalThreshold);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) errors.evalThreshold = "PERCENT";
  if (!String(s.model).trim()) errors.model = "REQUIRED";
  return errors;
}

/** 제공자 상태 띠: 키가 없어 NONE이면 "AI 사용 불가", FAKE면 시험용 */
export function ProviderBanner({ settings }: { settings: Pick<AiSettings, "enabled" | "provider"> }) {
  const { t } = useTranslation();
  if (!settings.enabled) return <Alert tone="info">{t("ai.admin.bannerOff")}</Alert>;
  if (settings.provider === "NONE") return <Alert tone="warning">{t("ai.admin.bannerNone")}</Alert>;
  if (settings.provider === "FAKE") return <Alert tone="info">{t("ai.admin.bannerFake")}</Alert>;
  return null;
}

export function SettingsTab({ initial, api, timezone }: { initial: AiSettings; api: AiApi; timezone: string }) {
  const { t, i18n } = useTranslation();
  const [saved, setSaved] = useState(initial);
  const toForm = (s: AiSettings) => ({
    enabled: s.enabled,
    provider: s.provider,
    model: s.model,
    embeddingModel: s.embeddingModel ?? "",
    dailyRequestLimit: String(s.dailyRequestLimit),
    dailyTokenLimit: String(s.dailyTokenLimit),
    perUserDailyLimit: String(s.perUserDailyLimit),
    logRetentionDays: String(s.logRetentionDays),
    autoCommentary: s.autoCommentary,
    evalThreshold: String(Math.round(Number(s.evalThreshold) * 1000) / 10),
    suggestionTtlMinutes: String(s.suggestionTtlMinutes),
  });
  const [form, setForm] = useState(toForm(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<Failure>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const set = (key: string, value: string | boolean) => setForm((f) => ({ ...f, [key]: value }));
  const modelChanged = form.model !== saved.model || form.provider !== saved.provider;
  const save = async () => {
    const found = validateSettings(form);
    setErrors(found);
    setNotice(null);
    setFailure(null);
    if (Object.keys(found).length) return;
    const res = await api.saveSettings({
      enabled: form.enabled,
      provider: form.provider,
      model: form.model.trim(),
      embeddingModel: form.embeddingModel.trim() || null,
      dailyRequestLimit: Number(form.dailyRequestLimit),
      dailyTokenLimit: Number(form.dailyTokenLimit),
      perUserDailyLimit: Number(form.perUserDailyLimit),
      logRetentionDays: Number(form.logRetentionDays),
      autoCommentary: form.autoCommentary,
      evalThreshold: Math.round(Number(form.evalThreshold) * 10) / 1000,
      suggestionTtlMinutes: Number(form.suggestionTtlMinutes),
      baseVersion: saved.version,
    });
    if (res.ok) {
      setSaved(res.data);
      setForm(toForm(res.data));
      setNotice(t("common.saved"));
    } else setFailure({ code: res.code, message: res.message });
  };
  const err = (key: string) => (errors[key] ? t(`ai.admin.errors.${errors[key]}`) : undefined);
  return (
    <div className="flex flex-col gap-3">
      <ProviderBanner settings={saved} />
      <Card>
        <div className="grid gap-3 md:grid-cols-2">
          <Checkbox label={t("ai.admin.enabled")} checked={Boolean(form.enabled)} onChange={(e) => set("enabled", e.target.checked)} />
          <Checkbox label={t("ai.admin.autoCommentary")} checked={Boolean(form.autoCommentary)} onChange={(e) => set("autoCommentary", e.target.checked)} />
          <SelectField label={t("ai.admin.provider")} value={form.provider} onChange={(e) => set("provider", e.target.value)}>
            {(saved.providers?.length ? saved.providers : [{ provider: saved.provider, available: true, allowed: true, note: null }]).map((p) => (
              <option key={p.provider} value={p.provider} disabled={!p.allowed}>
                {`${t(`ai.provider.${p.provider}`, { defaultValue: p.provider })}${!p.available ? ` (${t("ai.admin.preparing")})` : ""}${!p.allowed ? ` (${t("ai.admin.notAllowed")})` : ""}`}
              </option>
            ))}
          </SelectField>
          <TextField label={t("ai.admin.model")} value={form.model} onChange={(e) => set("model", e.target.value)} error={err("model")} />
          <TextField label={t("ai.admin.embeddingModel")} value={form.embeddingModel} onChange={(e) => set("embeddingModel", e.target.value)} />
          <TextField label={t("ai.admin.evalThreshold")} type="number" value={form.evalThreshold} onChange={(e) => set("evalThreshold", e.target.value)} error={err("evalThreshold")} />
          <TextField label={t("ai.admin.dailyRequestLimit")} type="number" value={form.dailyRequestLimit} onChange={(e) => set("dailyRequestLimit", e.target.value)} error={err("dailyRequestLimit")} />
          <TextField label={t("ai.admin.dailyTokenLimit")} type="number" value={form.dailyTokenLimit} onChange={(e) => set("dailyTokenLimit", e.target.value)} error={err("dailyTokenLimit")} />
          <TextField label={t("ai.admin.perUserDailyLimit")} type="number" value={form.perUserDailyLimit} onChange={(e) => set("perUserDailyLimit", e.target.value)} error={err("perUserDailyLimit")} />
          <TextField label={t("ai.admin.logRetentionDays")} type="number" value={form.logRetentionDays} onChange={(e) => set("logRetentionDays", e.target.value)} error={err("logRetentionDays")} />
          <TextField label={t("ai.admin.suggestionTtlMinutes")} type="number" value={form.suggestionTtlMinutes} onChange={(e) => set("suggestionTtlMinutes", e.target.value)} error={err("suggestionTtlMinutes")} />
        </div>
        {modelChanged && <p className="mt-2 text-[12.5px] text-muted">{t("ai.admin.evalGate")}</p>}
        <div className="mt-3 flex items-center justify-end gap-2">
          {saved.updatedAt && <span className="mr-auto text-[12px] text-muted">{t("ai.admin.updatedAt", { at: formatDateTime(saved.updatedAt, timezone, i18n.language) })}</span>}
          <Button variant="primary" onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </div>
      </Card>
      {notice && <Alert tone="success">{notice}</Alert>}
      {failure && <Alert tone="danger">{errorText(t, failure)}</Alert>}
    </div>
  );
}

function Meter({ label, used, limit, lang }: { label: string; used: number; limit: number; lang: string }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <p className="text-[12.5px]">{`${label} ${formatNumber(used, lang)} / ${limit > 0 ? formatNumber(limit, lang) : "∞"} (${pct}%)`}</p>
      <div className="h-2 w-full rounded bg-bg" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className={pct >= 100 ? "h-2 rounded bg-bad" : pct >= 80 ? "h-2 rounded bg-fair" : "h-2 rounded bg-accent"} style={{ width: `${Math.max(1, pct)}%` }} />
      </div>
    </div>
  );
}

export function UsageTab({ api, now = Date.now }: { api: AiApi; now?: () => number }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [days, setDays] = useState(30);
  const [groupBy, setGroupBy] = useState<"day" | "feature" | "user">("day");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [failure, setFailure] = useState<Failure>(null);
  useEffect(() => {
    let live = true;
    const to = new Date(now()).toISOString();
    const from = new Date(now() - days * 86_400_000).toISOString();
    void api.usage({ from, to, groupBy }).then((res) => {
      if (!live) return;
      if (res.ok) {
        setUsage(res.data);
        setFailure(null);
      } else setFailure({ code: res.code, message: res.message });
    });
    return () => {
      live = false;
    };
  }, [api, days, groupBy, now]);
  const max = Math.max(1, ...(usage?.series ?? []).map((r) => r.requests));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3">
        <div className="w-40">
          <SelectField label={t("ai.admin.period")} value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
            {[7, 30, 90].map((d) => (
              <option key={d} value={d}>
                {t("ai.admin.lastDays", { n: d })}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="w-40">
          <SelectField label={t("ai.admin.groupBy")} value={groupBy} onChange={(e) => setGroupBy(e.target.value as "day")}>
            {(["day", "feature", "user"] as const).map((g) => (
              <option key={g} value={g}>
                {t(`ai.admin.group.${g}`)}
              </option>
            ))}
          </SelectField>
        </div>
      </div>
      {failure && <Alert tone={failure.code === "AI_DISABLED" ? "info" : "danger"}>{failure.code === "AI_DISABLED" ? t("ai.unavailable.disabled") : errorText(t, failure)}</Alert>}
      {usage && (
        <>
          <Card title={t("ai.admin.today")}>
            <div className="grid gap-3 md:grid-cols-2">
              <Meter label={t("ai.admin.requests")} used={usage.limits.usedRequestsToday} limit={usage.limits.dailyRequestLimit} lang={lang} />
              <Meter label={t("ai.admin.tokens")} used={usage.limits.usedTokensToday} limit={usage.limits.dailyTokenLimit} lang={lang} />
            </div>
          </Card>
          <Card title={t("ai.admin.totals")}>
            <p className="text-[13px]">
              {t("ai.admin.totalsLine", { requests: formatNumber(usage.totals.requests, lang), tokensIn: formatNumber(usage.totals.tokensIn, lang), tokensOut: formatNumber(usage.totals.tokensOut, lang), cost: usage.totals.costEstimate == null ? "–" : `$${formatNumber(usage.totals.costEstimate, lang, { precision: 2 })}` })}
            </p>
          </Card>
          <Card title={t(`ai.admin.group.${groupBy}`)}>
            {usage.series.length === 0 ? (
              <p className="text-[13px] text-muted">{t("ai.admin.noUsage")}</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>{t(`ai.admin.group.${groupBy}`)}</th>
                    <th>{t("ai.admin.requests")}</th>
                    <th>{t("ai.admin.tokens")}</th>
                    <th>{t("ai.admin.cost")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {usage.series.map((row) => (
                    <tr key={row.key}>
                      <td>{groupBy === "feature" ? t(`ai.feature.${row.key}`, { defaultValue: row.key }) : row.key}</td>
                      <td className="w-1/3">
                        <div className="flex items-center gap-2">
                          <span aria-hidden className="inline-block h-2 rounded bg-accent" style={{ width: `${Math.max(2, (row.requests / max) * 100)}%` }} />
                          <span className="tabular-nums">{formatNumber(row.requests, lang)}</span>
                        </div>
                      </td>
                      <td className="tabular-nums">{formatNumber(row.tokensIn + row.tokensOut, lang)}</td>
                      <td className="tabular-nums">{row.costEstimate == null ? "–" : `$${formatNumber(row.costEstimate, lang, { precision: 2 })}`}</td>
                      <td>{row.limited && <Badge tone="warning">{t("ai.admin.limited")}</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

const pct = (v: number | null | undefined, lang: string) => (v == null ? "–" : `${formatNumber(Math.round(v * 1000) / 10, lang)}%`);

export function EvalTab({ api, model, timezone }: { api: AiApi; model: string; timezone: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [cases, setCases] = useState<EvalCase[] | null>(null);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [failure, setFailure] = useState<Failure>(null);
  const [evalModel, setEvalModel] = useState(model);
  const [notice, setNotice] = useState<string | null>(null);
  const load = async () => {
    const [c, r] = await Promise.all([api.evalCases(), api.evalRuns()]);
    if (c.ok) setCases(c.data);
    if (r.ok) setRuns(r.data.responses);
    if (!c.ok) setFailure({ code: c.code, message: c.message });
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const start = async () => {
    const res = await api.startEval({ model: evalModel.trim() || model });
    if (res.ok) {
      setNotice(t("ai.admin.evalStarted"));
      setRuns((list) => [res.data, ...list]);
    } else setFailure({ code: res.code, message: res.message });
  };
  const byKind = new Map<string, number>();
  for (const c of cases ?? []) byKind.set(c.kind ?? (c.injection ? "injection" : "commentary"), (byKind.get(c.kind ?? (c.injection ? "injection" : "commentary")) ?? 0) + 1);
  return (
    <div className="flex flex-col gap-3">
      {failure && <Alert tone={failure.code === "AI_DISABLED" ? "info" : "danger"}>{failure.code === "AI_DISABLED" ? t("ai.unavailable.disabled") : errorText(t, failure)}</Alert>}
      {notice && <Alert tone="info">{notice}</Alert>}
      <Card title={t("ai.admin.evalSet")}>
        <p className="text-[13px]">
          {t("ai.admin.caseCount", { n: cases?.length ?? 0 })}
          {[...byKind.entries()].map(([k, n]) => ` · ${k} ${n}`).join("")}
          {` · ${t("ai.admin.injectionCases", { n: (cases ?? []).filter((c) => c.injection).length })}`}
        </p>
      </Card>
      <Card
        title={t("ai.admin.evalRuns")}
        actions={
          <span className="flex items-end gap-2">
            <TextField label={t("ai.admin.model")} value={evalModel} onChange={(e) => setEvalModel(e.target.value)} />
            <Button variant="primary" onClick={() => void start()}>
              {t("ai.admin.runEval")}
            </Button>
          </span>
        }
      >
        {runs.length === 0 ? (
          <p className="text-[13px] text-muted">{t("ai.admin.noRuns")}</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("ai.admin.model")}</th>
                <th>{t("ai.admin.promptVersion")}</th>
                <th>{t("ai.admin.accuracy")}</th>
                <th>{t("ai.admin.numberMatch")}</th>
                <th>{t("ai.admin.injectionBlock")}</th>
                <th>{t("ai.admin.passed")}</th>
                <th>{t("ai.admin.at")}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.runId}>
                  <td>{r.model}</td>
                  <td>{r.promptVersion ?? "–"}</td>
                  <td>{pct(r.accuracy, lang)}</td>
                  <td>{pct(r.numberMatchRate, lang)}</td>
                  <td>{pct(r.injectionBlockRate, lang)}</td>
                  <td>{r.accuracy == null ? <Badge tone="neutral">{t("ai.admin.running")}</Badge> : <Badge tone={r.passed ? "success" : "danger"}>{r.passed ? t("ai.admin.pass") : t("ai.admin.fail")}</Badge>}</td>
                  <td>{formatDateTime(r.createdAt, timezone, lang)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
