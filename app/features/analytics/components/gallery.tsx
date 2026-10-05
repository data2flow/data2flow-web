/**
 * UI-ANA-01 템플릿 갤러리(ANA-01.01·01.04·01.07). 질문으로 찾기(입력 400ms 뒤 API-ANA-03), 카테고리 탭·범용/도메인 칩(URL 쿼리에 남김),
 * [실행 가능한 템플릿만](API-ANA-04: 고른 공간 기준. 실행할 수 없는 카드는 숨기지 않고 "데이터 없음" 배지를 붙여 끝으로 보낸다).
 * [이 템플릿으로 분석]은 ANALYTICS_RUN(ANALYST 이상)일 때만 그린다.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { SpaceSelect } from "~/components/space-picker";
import { Alert, Badge, Button, ButtonLink, Checkbox, EmptyState, cx } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import type { SpaceNode } from "~/lib/spaces";
import type { AnalyticsApi } from "../api";
import { filterTemplates, highlightParts, mergeRunnable, requirementSummary, sortByRunnable } from "../model/gallery";
import { CATEGORIES, type Template, type TemplateCategory, type TemplateKind } from "../model/types";

export const SEARCH_DEBOUNCE_MS = 400;

function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((part, i) =>
        part.hit ? (
          <mark key={i} className="rounded bg-fair-soft px-0.5 text-text">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

function TemplateCard({ template, query, canRun }: { template: Template; query: string; canRun: boolean }) {
  const { t } = useTranslation();
  const req = requirementSummary(template);
  const questions = (template.questions ?? []).slice(0, 3);
  const matched = template.matchedQuestion;
  return (
    <article data-template={template.key} aria-label={template.name} className={cx("flex flex-col gap-2 rounded-lg border border-line bg-panel p-4", template.runnable === false && "opacity-80")}>
      <header className="flex flex-wrap items-center gap-1.5">
        <h3 className="mr-auto text-[14px] font-semibold">{query ? <Highlighted text={template.name} query={query} /> : template.name}</h3>
        <Badge tone="neutral">{t(`analytics.category.${template.category}`, { defaultValue: template.category })}</Badge>
        <Badge tone={template.kind === "DOMAIN" ? "info" : "neutral"}>{t(`analytics.kind.${template.kind}`)}</Badge>
        {template.runnable === false && (
          <span title={t("analytics.gallery.missingRoles", { roles: (template.missingRoles ?? []).map((m) => m.semantic || m.role).join(", ") })}>
            <Badge tone="warning">{t("analytics.gallery.noData")}</Badge>
          </span>
        )}
      </header>
      {template.summary && <p className="text-[13px] text-muted">{query ? <Highlighted text={template.summary} query={query} /> : template.summary}</p>}
      {questions.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-[12.5px]" aria-label={t("analytics.gallery.questions")}>
          {questions.map((q) => (
            <li key={q} className={q === matched ? "font-medium" : undefined}>
              {"“"}
              {query ? <Highlighted text={q} query={query} /> : q}
              {"”"}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[12px] text-muted">
        {t("analytics.gallery.needs", { roles: req.roles.join(", ") || "–", days: req.minDays ?? "–" })}
      </p>
      {template.sampleImageUrl && <img src={template.sampleImageUrl} alt={t("analytics.gallery.sample", { name: template.name })} className="h-24 w-full rounded border border-line object-cover" loading="lazy" />}
      <footer className="mt-auto flex flex-wrap gap-2 pt-1">
        <ButtonLink to={`/analytics/templates/${encodeURIComponent(template.key)}`}>{t("analytics.gallery.guide")}</ButtonLink>
        {canRun && (
          <ButtonLink variant="primary" to={`/analytics/new?template=${encodeURIComponent(template.key)}`}>
            {t("analytics.gallery.analyze")}
          </ButtonLink>
        )}
      </footer>
    </article>
  );
}

export interface GalleryProps {
  initial: Template[];
  failed?: { code: string; message?: string } | null;
  canRun: boolean;
  spaces: SpaceNode[];
  api: AnalyticsApi;
  debounceMs?: number;
}

export function Gallery({ initial, failed, canRun, spaces, api, debounceMs = SEARCH_DEBOUNCE_MS }: GalleryProps) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const category = (CATEGORIES as string[]).includes(params.get("category") ?? "") ? (params.get("category") as TemplateCategory) : "ALL";
  const kinds = (params.get("kind") ?? "").split(",").filter((k): k is TemplateKind => k === "GENERAL" || k === "DOMAIN");
  const [all, setAll] = useState<Template[]>(initial);
  const [error, setError] = useState(failed ?? null);
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState<{ query: string; items: Template[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [runnableOn, setRunnableOn] = useState(false);
  const [spaceId, setSpaceId] = useState("");
  const [runnable, setRunnable] = useState<Template[] | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSearched(null);
      return;
    }
    const id = ++seq.current;
    const timer = setTimeout(() => {
      setLoading(true);
      void api.listTemplates({ keyword: q }).then((result) => {
        if (id !== seq.current) return;
        setLoading(false);
        if (result.ok) setSearched({ query: q, items: result.data.responses });
        else setError({ code: result.code, message: result.message });
      });
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [query, api, debounceMs]);

  useEffect(() => {
    if (!runnableOn || !spaceId) {
      setRunnable(null);
      return;
    }
    let live = true;
    void api.listTemplates({ view: "runnable", spaceId }).then((result) => {
      if (!live) return;
      if (result.ok) setRunnable(result.data.responses);
      else setError({ code: result.code, message: result.message });
    });
    return () => {
      live = false;
    };
  }, [runnableOn, spaceId, api]);

  const retry = async () => {
    setLoading(true);
    const result = await api.listTemplates();
    setLoading(false);
    if (result.ok) {
      setAll(result.data.responses);
      setError(null);
    } else setError({ code: result.code, message: result.message });
  };

  const items = useMemo(() => {
    const base = searched ? searched.items : all;
    const filtered = filterTemplates(base, { category, kinds });
    return runnable ? sortByRunnable(mergeRunnable(filtered, runnable)) : filtered;
  }, [searched, all, category, kinds, runnable]);

  const setFilter = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true, preventScrollReset: true });
  };
  const toggleKind = (kind: TemplateKind) => {
    const set = new Set(kinds);
    if (set.has(kind)) set.delete(kind);
    else set.add(kind);
    setFilter("kind", [...set].join(",") || null);
  };

  if (error && all.length === 0) {
    return (
      <EmptyState title={t("analytics.gallery.errorTitle")} body={errorText(t, error)} action={<Button onClick={() => void retry()}>{t("common.retry")}</Button>} />
    );
  }

  const keywordMode = searched && searched.items.some((i) => i.mode === "KEYWORD");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-72 flex-1 flex-col gap-1">
          <span className="text-[12.5px] font-medium text-muted">{t("analytics.gallery.searchLabel")}</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("analytics.gallery.searchPlaceholder")}
            className="w-full rounded-md border border-line bg-panel px-2.5 py-1.5 text-[13.5px] outline-none focus:border-accent"
          />
        </label>
        <Checkbox label={t("analytics.gallery.runnableOnly")} checked={runnableOn} onChange={(e) => setRunnableOn(e.target.checked)} />
        {runnableOn && (
          <div className="w-56">
            <SpaceSelect spaces={spaces} label={t("analytics.gallery.space")} value={spaceId} onChange={(e) => setSpaceId(e.target.value)} />
          </div>
        )}
      </div>
      {runnableOn && !spaceId && <p className="text-[12px] text-muted">{t("analytics.gallery.pickSpace")}</p>}
      {keywordMode && <Alert tone="info">{t("analytics.gallery.keywordFallback")}</Alert>}
      {error && all.length > 0 && <Alert tone="danger">{errorText(t, error)}</Alert>}
      <nav className="flex flex-wrap items-center gap-1 border-b border-line" aria-label={t("analytics.gallery.categories")}>
        {(["ALL", ...CATEGORIES] as const).map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={category === c}
            onClick={() => setFilter("category", c === "ALL" ? null : c)}
            className={cx("-mb-px border-b-2 px-3 py-2 text-[13px]", category === c ? "border-accent font-semibold text-accent" : "border-transparent text-muted hover:text-text")}
          >
            {c === "ALL" ? t("analytics.gallery.all") : t(`analytics.category.${c}`)}
          </button>
        ))}
        <span className="ml-auto flex gap-1 pb-1">
          {(["GENERAL", "DOMAIN"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={kinds.includes(k)} onClick={() => toggleKind(k)} className={cx("rounded-full border px-2.5 py-0.5 text-[12px]", kinds.includes(k) ? "border-accent bg-accent-soft text-accent" : "border-line text-muted")}>
              {t(`analytics.kind.${k}`)}
            </button>
          ))}
        </span>
      </nav>
      {loading && <p className="text-[12px] text-muted" role="status">{t("common.loading")}</p>}
      {items.length === 0 ? (
        <EmptyState
          title={t("analytics.gallery.empty")}
          action={
            <Button
              onClick={() => {
                setQuery("");
                setParams(new URLSearchParams(), { replace: true });
              }}
            >
              {t("analytics.gallery.showAll")}
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((template) => (
            <TemplateCard key={template.key} template={template} query={searched?.query ?? ""} canRun={canRun} />
          ))}
        </div>
      )}
      <p className="text-[12px] text-muted">
        <Link to="/analytics" className="text-accent hover:underline">
          {t("analytics.gallery.myAnalyses")}
        </Link>
      </p>
    </div>
  );
}
