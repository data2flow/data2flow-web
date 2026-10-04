/**
 * 섀도우 비교(UI-FLW-12, FLW-06.08, API-FLW-18): 실행 버전과 섀도우 버전의 분기별 건수·행동 횟수 비교, 달라진 메시지, 섀도우 오류,
 * [중단] [vN으로 전환]. 섀도우는 실제 행동 없이 나란히 돈다(BR-FLW-24, 기간 10분~24시간).
 */
import { useTranslation } from "react-i18next";
import { Button, Table } from "~/components/ui";
import { formatDateTime } from "~/lib/format";
import type { ShadowStatus } from "../model/types";

export const SHADOW_MIN_MINUTES = 10;
export const SHADOW_MAX_MINUTES = 1440;

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** 진행 시간·남은 시간(분) */
export function shadowProgress(shadow: ShadowStatus, now: number): { elapsed: number; total: number } | null {
  if (!shadow.startedAt || !shadow.endsAt) return null;
  const start = Date.parse(shadow.startedAt);
  const end = Date.parse(shadow.endsAt);
  return { elapsed: Math.max(0, Math.floor((Math.min(now, end) - start) / 60_000)), total: Math.max(0, Math.round((end - start) / 60_000)) };
}

export function ShadowPanel({ shadow, activeVersion, now, timezone, canWrite, busy, nameOf, onPromote, onCancel }: { shadow: ShadowStatus; activeVersion: number | null; now: number; timezone: string; canWrite: boolean; busy?: boolean; nameOf: (id: string) => string; onPromote: () => void; onCancel: () => void }) {
  const { t, i18n } = useTranslation();
  const progress = shadowProgress(shadow, now);
  const active = shadow.stats?.actions?.active ?? {};
  const candidate = shadow.stats?.actions?.shadow ?? {};
  const running = shadow.status === "RUNNING";
  const v = shadow.version ?? "";
  return (
    <section aria-label={t("flows.shadow.title")} className="flex flex-col gap-2 text-[12.5px]">
      <p className="font-semibold">
        {t("flows.shadow.heading", { active: activeVersion ?? "–", shadow: v })}
        {progress && <span className="ml-2 font-normal text-muted">{t("flows.shadow.progress", { elapsed: progress.elapsed, total: progress.total })}</span>}
      </p>
      <p className="text-muted">{t(`flows.shadow.status.${shadow.status}`, { defaultValue: shadow.status })}</p>
      <Table>
        <thead>
          <tr>
            <th>{t("flows.shadow.item")}</th>
            <th>{t("flows.shadow.activeCol", { v: activeVersion ?? "–" })}</th>
            <th>{t("flows.shadow.shadowCol", { v })}</th>
            <th>{t("flows.shadow.delta")}</th>
          </tr>
        </thead>
        <tbody>
          {(shadow.stats?.branches ?? []).map((b) => (
            <tr key={`${b.nodeId}:${b.port}`}>
              <td>{t("flows.shadow.branch", { name: nameOf(b.nodeId), port: b.port })}</td>
              <td>{b.active}</td>
              <td>{b.shadow}</td>
              <td>{signed(b.shadow - b.active)}</td>
            </tr>
          ))}
          {(["command", "notify", "sink"] as const).map((kind) => (
            <tr key={kind}>
              <td>{t(`flows.shadow.action.${kind}`)}</td>
              <td>{active[kind] ?? 0}</td>
              <td>{candidate[kind] ?? 0}</td>
              <td>{signed((candidate[kind] ?? 0) - (active[kind] ?? 0))}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      {(candidate.command ?? 0) !== (active.command ?? 0) && <p className="font-semibold">{t("flows.shadow.wouldControl", { v, delta: signed((candidate.command ?? 0) - (active.command ?? 0)) })}</p>}
      <p className={(shadow.stats?.errors?.shadow ?? 0) > 0 ? "text-bad" : "text-muted"}>{t("flows.shadow.errors", { n: shadow.stats?.errors?.shadow ?? 0 })}</p>
      {(shadow.diffs ?? []).length > 0 && (
        <details>
          <summary className="cursor-pointer">{t("flows.shadow.diffs", { n: shadow.diffs!.length })}</summary>
          <ul className="flex flex-col gap-1">
            {shadow.diffs!.map((d) => (
              <li key={d.messageId} className="font-mono text-[11.5px]">
                {formatDateTime(d.at, timezone, i18n.language, true)} · {d.messageId} · v{activeVersion ?? "–"} {JSON.stringify(d.active)} / v{v} {JSON.stringify(d.shadow)}
              </li>
            ))}
          </ul>
        </details>
      )}
      {canWrite && running && (
        <div className="flex gap-2">
          <Button onClick={onCancel} disabled={busy}>
            {t("flows.shadow.cancel")}
          </Button>
          <Button variant="primary" onClick={onPromote} disabled={busy}>
            {t("flows.shadow.promote", { v })}
          </Button>
        </div>
      )}
    </section>
  );
}
