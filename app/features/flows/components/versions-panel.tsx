/**
 * 버전 기록·비교(UI-FLW-05, FLW-01.06): 버전 목록(번호, 상태, 적용자, 시각, 메모), [비교](캔버스 위 색으로 노드 차이), [롤백](ACTIVE가 아닌 버전, 확인 대화상자).
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Badge, Button, Dialog, Table, TextArea } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import type { FlowApi } from "../api";
import type { VersionDiff, VersionRow } from "../model/types";
import { MEMO_MAX } from "./apply-dialog";

export function VersionsPanel({ flowId, api, canWrite, timezone, onDiff, onRolledBack }: { flowId: string; api: Pick<FlowApi, "versions" | "diff" | "rollback">; canWrite: boolean; timezone: string; onDiff: (diff: VersionDiff | null, label?: string) => void; onRolledBack: (version?: number) => void }) {
  const { t, i18n } = useTranslation();
  const [rows, setRows] = useState<VersionRow[] | null>(null);
  const [failed, setFailed] = useState<string | undefined>();
  const [comparing, setComparing] = useState<number | null>(null);
  const [rollbackTo, setRollbackTo] = useState<number | null>(null);
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    const result = await api.versions(flowId);
    if (result.ok) {
      setRows(result.data.responses ?? []);
      setFailed(undefined);
    } else setFailed(errorText(t, result));
  }, [api, flowId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const latest = rows?.[0]?.version;
  const compare = async (version: number) => {
    if (latest === undefined) return;
    if (comparing === version) {
      setComparing(null);
      onDiff(null);
      return;
    }
    const result = await api.diff(flowId, version, latest);
    if (result.ok) {
      setComparing(version);
      onDiff(result.data, `v${version} → v${latest}`);
    } else setError(errorText(t, result));
  };

  const rollback = async () => {
    if (rollbackTo === null) return;
    setBusy(true);
    const result = await api.rollback(flowId, { toVersion: rollbackTo, memo: memo.trim() || undefined });
    setBusy(false);
    if (!result.ok) {
      setError(errorText(t, result));
      return;
    }
    setRollbackTo(null);
    setMemo("");
    onRolledBack(result.data.appliedVersion);
    void load();
  };

  if (failed) return <Alert tone="danger">{failed}</Alert>;
  if (!rows) return <p className="text-[12.5px] text-muted">{t("common.loading")}</p>;
  if (rows.length === 0) return <p className="text-[12.5px] text-muted">{t("flows.versions.empty")}</p>;
  return (
    <>
      {error && <Alert tone="danger">{error}</Alert>}
      <Table>
        <thead>
          <tr>
            <th>{t("flows.versions.version")}</th>
            <th>{t("flows.versions.state")}</th>
            <th>{t("flows.versions.appliedBy")}</th>
            <th>{t("flows.versions.appliedAt")}</th>
            <th>{t("flows.versions.memo")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.version}>
              <td className="font-mono">v{row.version}</td>
              <td>
                <Badge tone={row.state === "ACTIVE" ? "success" : row.state === "DRAFT" ? "info" : "neutral"}>{t(`flows.versionState.${row.state}`, { defaultValue: row.state })}</Badge>
              </td>
              <td>{row.appliedBy?.name ?? "–"}</td>
              <td>{row.appliedAt ? formatDateTime(row.appliedAt, timezone, i18n.language) : "–"}</td>
              <td>{row.memo ?? ""}</td>
              <td className="flex gap-1">
                {row.version !== latest && (
                  <Button onClick={() => void compare(row.version)} aria-pressed={comparing === row.version}>
                    {comparing === row.version ? t("flows.versions.stopCompare") : t("flows.versions.compare", { v: row.version })}
                  </Button>
                )}
                {canWrite && row.state !== "ACTIVE" && row.state !== "DRAFT" && (
                  <Button variant="danger" onClick={() => setRollbackTo(row.version)}>
                    {t("flows.versions.rollback", { v: row.version })}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Dialog
        open={rollbackTo !== null}
        title={t("flows.versions.rollbackTitle", { v: rollbackTo ?? "" })}
        onClose={() => setRollbackTo(null)}
        footer={
          <>
            <Button onClick={() => setRollbackTo(null)}>{t("common.cancel")}</Button>
            <Button variant="danger" disabled={busy || memo.length > MEMO_MAX} onClick={() => void rollback()}>
              {busy ? t("common.processing") : t("flows.versions.rollbackConfirm")}
            </Button>
          </>
        }
      >
        <p className="text-[13px]">{t("flows.versions.rollbackBody", { v: rollbackTo ?? "" })}</p>
        <TextArea label={t("flows.apply.memo")} rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} />
      </Dialog>
    </>
  );
}
