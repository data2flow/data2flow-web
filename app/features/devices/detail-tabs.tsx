/**
 * UI-DEV-06 기기 상세 M4 탭(DEV-02.07): 규칙·알람(이 기기에 적용되는 규칙과 경유, 열린 알람), 변경 이력(API-DEV-27).
 * 규칙 목록은 RULE_READ가 있을 때만 읽는다(VIEWER는 열린 알람만).
 */
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Alert, Badge, ButtonLink, Card, EmptyState, Table } from "~/components/ui";
import { formatDateTime } from "~/lib/format";
import { actorName, changeLines, historyAction, severityTone, type AlarmRow, type HistoryEntry, type RuleRow, type RuleVia } from "./model/detail";

export function DeviceRulesTab({
  rules,
  alarms,
  rulesFailed,
  alarmsFailed,
  canReadRules,
  canWriteRules,
  deviceId,
  spaceId,
  timezone,
  lang,
}: {
  rules: { rule: RuleRow; via: RuleVia }[];
  alarms: AlarmRow[];
  rulesFailed?: boolean;
  alarmsFailed?: boolean;
  canReadRules: boolean;
  canWriteRules: boolean;
  deviceId: string;
  spaceId?: string | null;
  timezone: string;
  lang: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-4">
      <Card title={t("devices.rules.openAlarms", { n: alarms.length })}>
        {alarmsFailed && <Alert tone="warning">{t("devices.rules.alarmsUnavailable")}</Alert>}
        {alarms.length === 0 && !alarmsFailed ? (
          <EmptyState title={t("devices.rules.noAlarms")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("devices.rules.severity")}</th>
                <th>{t("devices.rules.alarm")}</th>
                <th>{t("devices.rules.alarmStatus")}</th>
                <th>{t("devices.rules.raisedAt")}</th>
              </tr>
            </thead>
            <tbody>
              {alarms.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Badge tone={severityTone(a.severity)}>{t(`devices.rules.severities.${a.severity}`, { defaultValue: a.severity })}</Badge>
                  </td>
                  <td>
                    <Link to={`/alarms/${encodeURIComponent(a.id)}`} className="text-accent hover:underline">
                      {a.title}
                    </Link>
                  </td>
                  <td>{t(`devices.rules.alarmStatuses.${a.status}`, { defaultValue: a.status })}</td>
                  <td>{formatDateTime(a.raisedAt, timezone, lang)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {canReadRules && (
        <Card
          title={t("devices.rules.applied", { n: rules.length })}
          actions={
            canWriteRules && (
              <ButtonLink to={`/rules/new?deviceId=${encodeURIComponent(deviceId)}${spaceId ? `&spaceId=${encodeURIComponent(spaceId)}` : ""}`}>{t("devices.rules.applyTemplate")}</ButtonLink>
            )
          }
        >
          {rulesFailed && <Alert tone="warning">{t("devices.rules.rulesUnavailable")}</Alert>}
          {rules.length === 0 && !rulesFailed ? (
            <EmptyState title={t("devices.rules.noRules")} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>{t("devices.rules.rule")}</th>
                  <th>{t("devices.rules.condition")}</th>
                  <th>{t("devices.rules.via")}</th>
                  <th>{t("devices.rules.severity")}</th>
                  <th>{t("devices.rules.ruleStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {rules.map(({ rule, via }) => (
                  <tr key={rule.ruleId}>
                    <td>
                      <Link to={`/rules/${encodeURIComponent(rule.ruleId)}`} className="text-accent hover:underline">
                        {rule.name}
                      </Link>
                    </td>
                    <td className="font-mono text-[12px]">{rule.conditionSummary ?? "–"}</td>
                    <td>{t(`devices.rules.viaKind.${via}`)}</td>
                    <td>
                      <Badge tone={severityTone(rule.severity)}>{t(`devices.rules.severities.${rule.severity}`, { defaultValue: rule.severity })}</Badge>
                    </td>
                    <td>{t(`devices.rules.ruleStatuses.${rule.status}`, { defaultValue: rule.status })}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}

export function DeviceHistoryTab({ entries, failed, timezone, lang, moreHref }: { entries: HistoryEntry[]; failed?: boolean; timezone: string; lang: string; moreHref?: string | null }) {
  const { t } = useTranslation();
  return (
    <Card title={t("devices.history.title")}>
      {failed && <Alert tone="warning">{t("devices.history.unavailable")}</Alert>}
      {entries.length === 0 && !failed ? (
        <EmptyState title={t("devices.history.empty")} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t("devices.history.at")}</th>
              <th>{t("devices.history.actor")}</th>
              <th>{t("devices.history.action")}</th>
              <th>{t("devices.history.changes")}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={e.id ?? `${e.at}-${i}`}>
                <td className="whitespace-nowrap">{formatDateTime(e.at, timezone, lang, true)}</td>
                <td>{actorName(e.actor)}</td>
                <td>{t(`devices.history.actions.${historyAction(e.action)}`, { defaultValue: e.action })}</td>
                <td>
                  <ul className="font-mono text-[12px]">
                    {changeLines(e.changes).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {moreHref && (
        <div className="mt-2 flex justify-end">
          <ButtonLink to={moreHref}>{t("common.more")}</ButtonLink>
        </div>
      )}
    </Card>
  );
}
