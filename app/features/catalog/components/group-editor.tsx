/**
 * 그룹 편집(UI-DEV-11): 정적 그룹은 기기 검색·선택, 동적 그룹은 조건 작성기(모델·공간+하위 포함·태그 any/all·상태)와
 * 실시간 미리 보기(API-DEV-33, 입력 멈춤 300ms 뒤). 폼에는 숨은 필드 `criteria`(JSON)·`deviceIds`로 보낸다.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, SelectField, TextField } from "~/components/ui";
import { bffJson, type BffJsonResult } from "~/lib/bff-client";
import { flattenSpaces, type SpaceNode } from "~/lib/spaces";
import { DEVICE_STATUSES, GROUP_LIMIT, buildCriteria, criteriaSize, parseList, type GroupCriteriaInput } from "../model/catalog";
import type { DeviceLite, ModelSummary } from "../model/types";

export interface Preview {
  count: number;
  sample: { id: string; name: string }[];
}

type PreviewFn = (criteria: Record<string, unknown>) => Promise<BffJsonResult<Preview>>;
type SearchFn = (q: string) => Promise<BffJsonResult<{ responses: DeviceLite[] }>>;

const defaultPreview: PreviewFn = (criteria) => bffJson<Preview>("/bff/api/core/device-groups/preview", { method: "POST", body: { criteria } });
const defaultSearch: SearchFn = (q) => bffJson<{ responses: DeviceLite[] }>(`/bff/api/core/devices?size=20&q=${encodeURIComponent(q)}`);

export function CriteriaBuilder({
  models,
  spaces,
  initial,
  preview = defaultPreview,
  debounceMs = 300,
  onCount,
}: {
  models: ModelSummary[];
  spaces: SpaceNode[];
  initial: GroupCriteriaInput;
  preview?: PreviewFn;
  debounceMs?: number;
  onCount?: (count: number | null) => void;
}) {
  const { t } = useTranslation();
  const [input, setInput] = useState(initial);
  const [tagText, setTagText] = useState(initial.tags.join(", "));
  const [result, setResult] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const criteria = useMemo(() => buildCriteria({ ...input, tags: parseList(tagText) }), [input, tagText]);
  const key = JSON.stringify(criteria);
  useEffect(() => {
    if (criteriaSize(criteria) === 0) {
      setResult(null);
      onCount?.(null);
      return;
    }
    const timer = setTimeout(async () => {
      const answer = await preview(JSON.parse(key) as Record<string, unknown>);
      if (answer.ok) {
        setResult(answer.data);
        setError(null);
        onCount?.(answer.data.count);
      } else {
        setResult(null);
        setError(answer.code);
        onCount?.(answer.code === "GROUP_SIZE_EXCEEDED" ? GROUP_LIMIT + 1 : null);
      }
    }, debounceMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 조건 문자열이 바뀔 때만 다시 조회한다
  }, [key, debounceMs, preview]);
  const toggle = (field: "modelIds" | "spaceIds" | "statuses", value: string) =>
    setInput((current) => ({ ...current, [field]: current[field].includes(value) ? current[field].filter((v) => v !== value) : [...current[field], value] }));
  const flat = flattenSpaces(spaces);
  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="criteria" value={key} />
      <fieldset>
        <legend className="text-[12.5px] font-medium text-muted">{t("catalog.groups.models")}</legend>
        <div className="flex flex-wrap gap-3">
          {models.map((m) => (
            <label key={m.id} className="flex items-center gap-1 text-[13px]">
              <input type="checkbox" checked={input.modelIds.includes(m.id)} onChange={() => toggle("modelIds", m.id)} />
              {m.code}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-[12.5px] font-medium text-muted">{t("catalog.groups.spaces")}</legend>
        <div className="max-h-36 overflow-y-auto rounded-md border border-line p-2">
          {flat.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-[13px]" style={{ paddingLeft: (s.depth - 1) * 14 }}>
              <input type="checkbox" checked={input.spaceIds.includes(s.id)} onChange={() => toggle("spaceIds", s.id)} aria-label={s.path.join(" › ")} />
              {s.name}
            </label>
          ))}
        </div>
        <label className="mt-1 flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={input.includeDescendants} onChange={(e) => setInput((c) => ({ ...c, includeDescendants: e.target.checked }))} />
          {t("catalog.groups.includeDescendants")}
        </label>
      </fieldset>
      <div className="flex flex-wrap items-end gap-3">
        <SelectField label={t("catalog.groups.tagMatch")} value={input.tagMatch} onChange={(e) => setInput((c) => ({ ...c, tagMatch: e.target.value as "any" | "all" }))}>
          <option value="any">any</option>
          <option value="all">all</option>
        </SelectField>
        <TextField label={t("catalog.groups.tags")} value={tagText} onChange={(e) => setTagText(e.target.value)} hint={t("catalog.listHint")} />
      </div>
      <fieldset>
        <legend className="text-[12.5px] font-medium text-muted">{t("catalog.groups.statuses")}</legend>
        <div className="flex gap-3">
          {DEVICE_STATUSES.map((s) => (
            <label key={s} className="flex items-center gap-1 text-[13px]">
              <input type="checkbox" checked={input.statuses.includes(s)} onChange={() => toggle("statuses", s)} />
              {t(`status.device.${s}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <div role="status" className="rounded-md border border-line bg-bg px-3 py-2 text-[13px]">
        {criteriaSize(criteria) === 0 ? (
          t("catalog.groups.criteriaRequired")
        ) : error === "GROUP_SIZE_EXCEEDED" || (result && result.count > GROUP_LIMIT) ? (
          <span className="text-bad-ink">{t("catalog.validation.groupLimit")}</span>
        ) : error ? (
          <span className="text-bad-ink">{t(`errors.${error}`, { defaultValue: t("errors.UNKNOWN") })}</span>
        ) : result ? (
          <>
            {t("catalog.groups.matchCount", { n: result.count })}
            {result.sample.length > 0 && <span className="text-muted"> · {result.sample.map((d) => d.name).join(" · ")}</span>}
          </>
        ) : (
          t("common.loading")
        )}
      </div>
    </div>
  );
}

export function DevicePicker({ initial = [], search = defaultSearch, name = "deviceIds" }: { initial?: DeviceLite[]; search?: SearchFn; name?: string }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<DeviceLite[]>(initial);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<DeviceLite[] | null>(null);
  const [failed, setFailed] = useState(false);
  const run = async () => {
    const answer = await search(q.trim());
    if (answer.ok) {
      setFound(answer.data.responses ?? []);
      setFailed(false);
    } else setFailed(true);
  };
  return (
    <div className="flex flex-col gap-2">
      {selected.map((d) => (
        <input key={d.id} type="hidden" name={name} value={d.id} />
      ))}
      <div className="flex items-end gap-2">
        <TextField
          label={t("catalog.groups.searchDevice")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void run();
            }
          }}
        />
        <Button onClick={() => void run()}>{t("common.search")}</Button>
      </div>
      {failed && <Alert tone="danger">{t("errors.UNKNOWN")}</Alert>}
      {found && (
        <ul className="flex flex-col gap-1" aria-label={t("catalog.groups.searchResult")}>
          {found.length === 0 && <li className="text-[12.5px] text-muted">{t("catalog.groups.noMatchDevice")}</li>}
          {found.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 text-[13px]">
              <span>
                {d.name} <span className="font-mono text-[11.5px] text-muted">{d.externalId}</span>
              </span>
              <Button disabled={selected.some((s) => s.id === d.id)} onClick={() => setSelected((s) => [...s, d])}>
                {t("common.add")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[12.5px] text-muted">{t("catalog.groups.selected", { n: selected.length })}</p>
      {selected.length > GROUP_LIMIT && <Alert tone="danger">{t("catalog.validation.groupLimit")}</Alert>}
      <ul className="flex flex-wrap gap-2">
        {selected.map((d) => (
          <li key={d.id} className="flex items-center gap-1 rounded border border-line px-2 py-0.5 text-[12.5px]">
            {d.name}
            <button type="button" aria-label={t("catalog.groups.unselect", { name: d.name })} className="text-muted hover:text-bad-ink" onClick={() => setSelected((s) => s.filter((x) => x.id !== d.id))}>
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
