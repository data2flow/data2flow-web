/**
 * UI-SIM-12 기대 결과별 판정과 근거(SIM-04.06): 통과 ✔·실패 ✖·판정 불가 – 배지, 기대 결과 설명("10:30까지 ERV-1 power=ON", "알람 == 1건"),
 * 근거 시각(근거 화면 링크)과 값, 실패 항목의 실제값과 알람 ID 링크.
 */
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Badge, Table } from "~/components/ui";
import { formatDateTime } from "~/lib/format";
import { describeExpectation, evidenceAlarmIds, evidenceLink, verdictOf, type ReportExpectation } from "../model/report";
import type { Expectation } from "../model/types";

const VERDICT = { PASSED: { tone: "success", icon: "✔" }, FAILED: { tone: "danger", icon: "✖" }, SKIPPED: { tone: "neutral", icon: "–" } } as const;

const show = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

export function ReportExpectations({ items, definitions, timezone, lang, deviceNames = {} }: { items: ReportExpectation[]; definitions: Expectation[]; timezone: string; lang: string; deviceNames?: Record<string, string> }) {
  const { t } = useTranslation();
  if (items.length === 0) return <p className="text-[12.5px] text-muted">{t("sim.run.noExpectations")}</p>;
  return (
    <Table>
      <thead>
        <tr>
          <th scope="col">{t("sim.reportX.expectation")}</th>
          <th scope="col">{t("sim.reportX.verdict")}</th>
          <th scope="col">{t("sim.reportX.evidence")}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((x) => {
          const verdict = verdictOf(x);
          const def = definitions.find((d) => d.id === x.id);
          const description = describeExpectation(def, deviceNames);
          const link = evidenceLink(def);
          const at = x.evidence?.at ? formatDateTime(x.evidence.at, timezone, lang) : null;
          const alarmIds = evidenceAlarmIds(x);
          return (
            <tr key={x.id} data-expectation={x.id} data-verdict={verdict}>
              <td>
                <span className="font-semibold">{t(`sim.expectation.${x.kind}`, { defaultValue: x.kind })}</span>
                {description && (
                  <span className="block text-[12.5px] text-muted">
                    {t(`sim.reportX.describe.${description.key}`, { ...description.values, deadline: description.values.deadline ? formatDateTime(description.values.deadline, timezone, lang) : "" })}
                  </span>
                )}
              </td>
              <td>
                <Badge tone={VERDICT[verdict].tone}>
                  <span aria-hidden>{VERDICT[verdict].icon} </span>
                  {t(`sim.reportX.verdicts.${verdict}`)}
                </Badge>
              </td>
              <td className="text-[12.5px]">
                {at && (link ? <Link to={link} className="font-mono text-accent hover:underline">{at}</Link> : <span className="font-mono">{at}</span>)}
                {x.evidence?.value !== undefined && x.evidence.value !== null && <span className="ml-2 font-mono">{show(x.evidence.value)}</span>}
                {verdict === "FAILED" && x.evidence?.actual !== undefined && x.evidence.actual !== null && <span className="ml-2 font-semibold text-bad-ink">{t("sim.reportX.actual", { value: show(x.evidence.actual) })}</span>}
                {alarmIds.length > 0 && (
                  <span className="ml-2">
                    {alarmIds.map((id) => (
                      <Link key={id} to={`/alarms/${encodeURIComponent(id)}`} className="mr-1 font-mono text-accent hover:underline">
                        {`#${id}`}
                      </Link>
                    ))}
                  </span>
                )}
                {!at && !link && verdict !== "FAILED" && x.evidence?.value === undefined && <span className="text-muted">–</span>}
                {!at && link && verdict === "FAILED" && (
                  <Link to={link} className="ml-2 text-accent hover:underline">
                    {t("sim.reportX.check")}
                  </Link>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
