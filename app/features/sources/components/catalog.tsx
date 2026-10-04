/**
 * 커넥터 카탈로그(UI-DSC-07, DSC-09.01, DSC-01.02). 분류 탭·검색(브라우저에서 거름), 템플릿 줄, 커넥터 카드.
 * 카드: 이름, 표준·버전, 전송 방식, 지원 인증 수, 확장 방식, "유실 가능". 사용 불가는 사유와 함께 고를 수 없다(TC-DSC-017·233).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Alert, Badge, EmptyState, TextField, cx } from "~/components/ui";
import { CATEGORIES, TYPE_CARD_CONNECTORS, filterConnectors, isLossy, type Connector, type ConnectorTemplate } from "../model/catalog";
import { TYPE_CARDS } from "../model/source";

export function ConnectorCatalog({ connectors, templates, catalogError }: { connectors: Connector[]; templates: ConnectorTemplate[]; catalogError?: boolean }) {
  const { t } = useTranslation();
  const [category, setCategory] = useState("ALL");
  const [query, setQuery] = useState("");
  const shown = filterConnectors(connectors, category, query);
  return (
    <div className="flex flex-col gap-4">
      {catalogError && <Alert tone="warning">{t("sources.catalog.fallback")}</Alert>}
      <TypeCards />
      <TextField label={t("sources.catalog.search")} value={query} onChange={(e) => setQuery(e.target.value)} type="search" />
      <div role="tablist" aria-label={t("sources.catalog.categories")} className="flex flex-wrap gap-1">
        {["ALL", ...CATEGORIES].map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={category === c}
            onClick={() => setCategory(c)}
            className={cx("rounded-md border px-2.5 py-1 text-[12.5px]", category === c ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-text")}
          >
            {t(`sources.catalog.category.${c}`)}
          </button>
        ))}
      </div>
      {templates.length > 0 && (
        <div>
          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted">{t("sources.catalog.templates")}</p>
          <div className="flex flex-wrap gap-2">
            {templates.map((tpl) => (
              <Link key={tpl.key} to={`/sources/new/${encodeURIComponent(tpl.connectorKey)}?template=${encodeURIComponent(tpl.key)}`} className="rounded-md border border-line bg-panel px-3 py-1.5 text-[13px] hover:border-accent" title={tpl.description}>
                {tpl.name}
              </Link>
            ))}
          </div>
        </div>
      )}
      {shown.length === 0 ? (
        <EmptyState title={t("sources.catalog.noMatch")} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((c) => (
            <li key={c.connectorKey}>
              <ConnectorCard connector={c} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ConnectorCard({ connector: c }: { connector: Connector }) {
  const { t } = useTranslation();
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{c.name}</span>
        {!c.enabled && <Badge tone="neutral">{t("sources.catalog.unavailable", { reason: c.disabledReason ? t(`sources.catalog.reason.${c.disabledReason}`, { defaultValue: c.disabledReason }) : "–" })}</Badge>}
      </div>
      <p className="text-[12.5px] text-muted">
        {c.standard ?? c.connectorKey}
        {c.version ? ` · v${c.version}` : ""}
      </p>
      <p className="font-mono text-[12px]">{c.transports.join(" · ")}</p>
      <p className="text-[12.5px]">
        {t("sources.catalog.authCount", { n: c.authMethods.length })}
        {c.scaling ? ` · ${c.scaling}` : ""}
      </p>
      {isLossy(c) && <Badge tone="warning">{t("sources.form.lossPossible")}</Badge>}
    </>
  );
  if (!c.enabled) {
    return (
      <div aria-disabled="true" className="flex h-full flex-col gap-1 rounded-lg border border-line bg-bg p-3 opacity-70">
        {body}
      </div>
    );
  }
  return (
    <Link to={`/sources/new/${encodeURIComponent(c.connectorKey)}`} className="flex h-full flex-col gap-1 rounded-lg border border-line bg-panel p-3 hover:border-accent">
      {body}
    </Link>
  );
}

/** UI-DSC-02 1단계 유형 카드 7종(TC-DSC-015). M5부터 모두 만들 수 있다(기본 유형 3개는 전용 폼, 나머지는 커넥터 스키마 폼) */
function TypeCards() {
  const { t } = useTranslation();
  return (
    <div>
      <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted">{t("sources.catalog.types")}</p>
      <ul className="flex flex-wrap gap-2">
        {TYPE_CARDS.map((type) => (
          <li key={type}>
            <Link to={`/sources/new/${TYPE_CARD_CONNECTORS[type]}`} className="inline-block rounded-md border border-line bg-panel px-3 py-1.5 text-[13px] hover:border-accent">
              {t(`sources.type.${type}`)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
