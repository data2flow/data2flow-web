/**
 * UI-ANA-02 템플릿 설명서(ANA-01.06, ANA-08.01). 설명서 9항목을 순서대로 글자 그대로 보여 준다(HTML을 해석하지 않으므로 스크립트가 실행되지 않는다).
 * 버전을 바꾸면 그 버전 설명서(API-ANA-02 `?version=`). 필요한 데이터 표는 역할·종류·개수·의미 조건·최소 기간.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Badge, ButtonLink, Card, SelectField, Table } from "~/components/ui";
import type { TemplateDetail } from "../model/types";

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    return String(o.text ?? o.title ?? o.question ?? o.description ?? JSON.stringify(o));
  }
  return String(value);
}

function List({ items }: { items: unknown[] | undefined }) {
  if (!items?.length) return <p className="text-[13px] text-muted">–</p>;
  return (
    <ul className="list-disc pl-5 text-[13px]">
      {items.map((item, i) => (
        <li key={i}>{text(item)}</li>
      ))}
    </ul>
  );
}

export function TemplateGuideView({ template, canRun }: { template: TemplateDetail; canRun: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const guide = template.guide ?? {};
  const req = template.requirements ?? {};
  const params = guide.params?.length
    ? guide.params.map((p) => ({ key: p.key ?? p.name ?? "", label: p.label ?? p.name ?? p.key ?? "", description: p.description ?? "", range: p.range ?? "", def: p.default }))
    : Object.entries(template.paramsSchema?.properties ?? {}).map(([key, p]) => ({
        key,
        label: p.title ?? key,
        description: p.description ?? "",
        range: p.enum ? p.enum.join(" / ") : p.minimum !== undefined || p.maximum !== undefined ? `${p.minimum ?? ""}~${p.maximum ?? ""}` : "",
        def: p.default,
      }));
  const sections: { key: string; body: ReactNode }[] = [
    { key: "summary", body: <p className="text-[13px]">{guide.summary || template.summary || "–"}</p> },
    { key: "whenToUse", body: <List items={guide.whenToUse} /> },
    { key: "whenNotToUse", body: <List items={guide.whenNotToUse} /> },
    {
      key: "dataRequirements",
      body: (
        <>
          <Table>
            <thead>
              <tr>
                <th>{t("analytics.guide.role")}</th>
                <th>{t("analytics.guide.dataType")}</th>
                <th>{t("analytics.guide.count")}</th>
                <th>{t("analytics.guide.semantic")}</th>
                <th>{t("analytics.guide.minPeriod")}</th>
                <th>{t("analytics.guide.missing")}</th>
              </tr>
            </thead>
            <tbody>
              {(template.roles ?? []).map((r) => (
                <tr key={r.name}>
                  <td className="font-mono">{r.name}</td>
                  <td>{r.type ?? "series"}</td>
                  <td>{`${r.min ?? (r.required ? 1 : 0)}~${r.max ?? "–"}`}</td>
                  <td>{r.semantic ?? "–"}</td>
                  <td>{req.minPeriodDays !== undefined ? t("analytics.guide.days", { n: req.minPeriodDays }) : "–"}</td>
                  <td>{req.missingWarn !== undefined ? `${Math.round(req.missingWarn * 100)}% / ${Math.round((req.missingFail ?? 0) * 100)}%` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          {guide.dataRequirements?.length ? <List items={guide.dataRequirements} /> : null}
        </>
      ),
    },
    {
      key: "params",
      body: params.length ? (
        <Table>
          <thead>
            <tr>
              <th>{t("analytics.guide.param")}</th>
              <th>{t("analytics.guide.range")}</th>
              <th>{t("analytics.guide.default")}</th>
              <th>{t("analytics.guide.description")}</th>
            </tr>
          </thead>
          <tbody>
            {params.map((p) => (
              <tr key={p.key}>
                <td>{p.label}</td>
                <td>{p.range || "–"}</td>
                <td>{p.def === undefined ? "–" : String(p.def)}</td>
                <td>{p.description || "–"}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <p className="text-[13px] text-muted">–</p>
      ),
    },
    { key: "howToRead", body: <p className="whitespace-pre-wrap text-[13px]">{guide.howToRead || "–"}</p> },
    { key: "caveats", body: <List items={guide.caveats} /> },
    { key: "examples", body: <List items={guide.examples} /> },
    {
      key: "algorithm",
      body: (
        <>
          <p className="whitespace-pre-wrap text-[13px]">{guide.algorithm || "–"}</p>
          {guide.references?.length ? <List items={guide.references} /> : null}
        </>
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Badge tone="neutral">{t(`analytics.category.${template.category}`, { defaultValue: template.category })}</Badge>
        <Badge tone={template.kind === "DOMAIN" ? "info" : "neutral"}>{t(`analytics.kind.${template.kind}`)}</Badge>
        {template.enabled === false && <Badge tone="warning">{t("analytics.guide.disabled")}</Badge>}
        {(template.versions?.length ?? 0) > 1 && (
          <div className="w-40">
            <SelectField label={t("analytics.guide.version")} value={template.version} onChange={(e) => navigate(`?version=${encodeURIComponent(e.target.value)}`)}>
              {template.versions!.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </SelectField>
          </div>
        )}
        {canRun && template.enabled !== false && (
          <span className="ml-auto">
            <ButtonLink variant="primary" to={`/analytics/new?template=${encodeURIComponent(template.key)}`}>
              {t("analytics.gallery.analyze")}
            </ButtonLink>
          </span>
        )}
      </div>
      {sections.map((s, i) => (
        <Card key={s.key} title={`${i + 1}. ${t(`analytics.guide.sections.${s.key}`)}`}>
          <div data-guide-section={s.key}>{s.body}</div>
        </Card>
      ))}
    </div>
  );
}
