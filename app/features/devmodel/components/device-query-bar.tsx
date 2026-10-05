/**
 * UI-DEV-19 기기 검색 질의(목록 상단, DEV-13.03). 검색식 입력(입력 중 문법 검사·오류 위치 밑줄·자동완성) / 저장된 검색 드롭다운 /
 * [검색 저장](이름, 공유) / 결과 수와 소요 시간. 판정은 서버가 다시 한다(400 DEVICE_QUERY_INVALID의 열을 그대로 보여 준다).
 */
import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Checkbox, Dialog, TextField } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import type { DevModelApi } from "../api";
import { applySuggestion, looksLikeExpression, parseDeviceQuery, splitAtColumn, suggest } from "../model/query";
import type { QueryCounts, QueryProblem, SavedSearch } from "../model/types";

export interface DeviceQueryBarProps {
  initial: string;
  counts?: QueryCounts | null;
  /** 서버가 거부한 검색식의 위치 */
  problem?: QueryProblem | null;
  saved: SavedSearch[];
  savedId?: string | null;
  canSave: boolean;
  meId?: string;
  api: DevModelApi;
  onSearch: (q: string, savedId?: string) => void;
}

export function DeviceQueryBar({ initial, counts, problem, saved: initialSaved, savedId, canSave, meId, api, onSearch }: DeviceQueryBarProps) {
  const { t } = useTranslation();
  const inputId = useId();
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(initialSaved);
  const [saveOpen, setSaveOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  useEffect(() => setText(initial), [initial]);
  useEffect(() => setSaved(initialSaved), [initialSaved]);

  const expression = looksLikeExpression(text);
  const local = useMemo(() => (expression ? parseDeviceQuery(text) : null), [expression, text]);
  // 서버 오류는 같은 검색식일 때만 보인다. 고치기 시작하면 입력 중 검사로 바뀐다
  const localMessage = local && !local.ok ? t(`devmodel.query.errors.${local.code}`, { detail: local.detail ?? "" }) : null;
  const shownProblem =
    text === initial && problem
      ? { column: problem.column, message: localMessage ?? problem.message ?? t(`errors.${problem.code}`, { defaultValue: problem.code }) }
      : local && !local.ok
        ? { column: local.column, message: localMessage as string }
        : null;
  const hints = useMemo(() => (focused ? suggest(text) : null), [focused, text]);
  const current = saved.find((s) => s.id === savedId);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (local && !local.ok) return;
    onSearch(text.trim() ? text : "");
  };

  return (
    <section aria-label={t("devmodel.query.label")} className="mb-3 flex flex-col gap-2">
      <form role="search" onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-[280px] flex-1 flex-col gap-1">
          <label htmlFor={inputId} className="text-[12.5px] font-medium text-muted">
            {t("devmodel.query.label")}
          </label>
          <input
            id={inputId}
            name="q"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            placeholder={t("devmodel.query.placeholder")}
            aria-invalid={shownProblem ? true : undefined}
            aria-describedby={shownProblem ? `${inputId}-error` : `${inputId}-hint`}
            spellCheck={false}
            autoComplete="off"
            className="w-full rounded-md border border-line bg-panel px-3 py-1.5 font-mono text-[13px]"
          />
          {shownProblem ? (
            <p id={`${inputId}-error`} role="alert" className="text-[12.5px] text-bad-ink">
              <span className="font-mono whitespace-pre" aria-hidden="true">
                {splitAtColumn(text, shownProblem.column).before}
                <mark className="bg-bad/20 text-bad-ink underline decoration-wavy">{splitAtColumn(text, shownProblem.column).at}</mark>
                {splitAtColumn(text, shownProblem.column).after}
              </span>
              <span className="block">{t("devmodel.query.errorAt", { column: shownProblem.column, message: shownProblem.message })}</span>
            </p>
          ) : (
            <p id={`${inputId}-hint`} className="text-[12px] text-muted">
              {t("devmodel.query.hint")}
            </p>
          )}
          {hints && hints.items.length > 0 && (
            <ul role="listbox" aria-label={t("devmodel.query.suggestions")} className="flex flex-wrap gap-1">
              {hints.items.slice(0, 12).map((item) => (
                <li key={item} role="option" aria-selected={false}>
                  <button
                    type="button"
                    className="rounded border border-line px-1.5 py-0.5 font-mono text-[12px] hover:border-accent"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setText(applySuggestion(text, hints.replaceFrom, item))}
                  >
                    {item}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Button type="submit" variant="primary" disabled={Boolean(local && !local.ok)}>
          {t("common.search")}
        </Button>
      </form>
      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        <label className="flex items-center gap-1">
          <span className="text-muted">{t("devmodel.saved.label")}</span>
          <select
            className="rounded-md border border-line bg-panel px-2 py-1"
            value={savedId ?? ""}
            onChange={(e) => {
              const pick = saved.find((s) => s.id === e.target.value);
              if (pick) onSearch(pick.query, pick.id);
            }}
          >
            <option value="">{t("devmodel.saved.choose")}</option>
            {saved.map((s) => (
              <option key={s.id} value={s.id}>
                {s.shared ? `${s.name} · ${t("devmodel.saved.sharedMark")}` : s.name}
              </option>
            ))}
          </select>
        </label>
        {canSave && (
          <Button onClick={() => setSaveOpen(true)} disabled={!expression || Boolean(local && !local.ok)}>
            {t("devmodel.saved.save")}
          </Button>
        )}
        {current && canSave && (!current.ownerId || current.ownerId === meId) && (
          <Button
            variant="ghost"
            onClick={async () => {
              const result = await api.deleteSearch(current.id);
              if (result.ok) {
                setSaved((list) => list.filter((s) => s.id !== current.id));
                setNotice(t("devmodel.saved.deleted", { name: current.name }));
              } else setNotice(errorText(t, result) ?? null);
            }}
          >
            {t("devmodel.saved.delete")}
          </Button>
        )}
        {counts && (
          <span role="status" className="ml-auto font-mono text-muted">
            {t("devmodel.query.counts", { total: counts.total, ms: counts.tookMs })}
          </span>
        )}
      </div>
      {notice && <Alert tone="info">{notice}</Alert>}
      <SaveSearchDialog
        open={saveOpen}
        query={text.trim()}
        current={current && current.query === text.trim() ? current : undefined}
        api={api}
        onClose={() => setSaveOpen(false)}
        onSaved={(item) => {
          setSaved((list) => [...list.filter((s) => s.id !== item.id), item]);
          setSaveOpen(false);
          setNotice(t("devmodel.saved.savedNotice", { name: item.name }));
        }}
      />
    </section>
  );
}

function SaveSearchDialog({ open, query, current, api, onClose, onSaved }: { open: boolean; query: string; current?: SavedSearch; api: DevModelApi; onClose: () => void; onSaved: (item: SavedSearch) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(current?.name ?? "");
  const [shared, setShared] = useState(current?.shared ?? false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setName(current?.name ?? "");
      setShared(current?.shared ?? false);
      setError(null);
    }
  }, [open, current]);
  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 100) {
      setError(t("devmodel.saved.nameRequired"));
      return;
    }
    setBusy(true);
    const result = await api.saveSearch({ name: trimmed, query, shared }, current?.id);
    setBusy(false);
    if (result.ok) onSaved(result.data);
    else setError(errorText(t, result) ?? null);
  };
  return (
    <Dialog
      title={t("devmodel.saved.save")}
      open={open}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <p className="font-mono text-[12.5px]">{query}</p>
      <TextField label={t("devmodel.saved.name")} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} error={error ?? undefined} />
      <Checkbox label={t("devmodel.saved.shared")} checked={shared} onChange={(e) => setShared(e.target.checked)} />
    </Dialog>
  );
}
