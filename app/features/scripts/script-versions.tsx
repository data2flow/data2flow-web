/**
 * 버전 목록(UI-SCR-03 일부): 버전, 상태, 작성자, 저장 시각, 배포 메모·배포자, 강제 배포 표시, [코드 보기](API-SCR-06).
 * 비교·롤백은 SCR-03.04 화면(다음 단계)에서 붙인다.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Badge, Button, Table } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import type { ScriptApi, ScriptVersionRow } from "./api";

const TONE = { ACTIVE: "success", DRAFT: "info", ARCHIVED: "neutral" } as const;

export function ScriptVersions({ scriptId, versions, timezone, api }: { scriptId: string; versions: ScriptVersionRow[]; timezone: string; api: Pick<ScriptApi, "version"> }) {
  const { t, i18n } = useTranslation();
  const [shown, setShown] = useState<{ versionNo: number; code: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fmt = (iso?: string | null) => formatDateTime(iso, timezone, i18n.language);
  if (versions.length === 0) return <p className="py-6 text-center text-muted">{t("scripts.versions.empty")}</p>;
  const view = async (versionId: string) => {
    setError(null);
    const result = await api.version(scriptId, versionId);
    if (result.ok) setShown({ versionNo: result.data.versionNo, code: result.data.code });
    else setError(errorText(t, result) ?? null);
  };
  return (
    <>
      <Table>
        <thead>
          <tr>
            <th>{t("scripts.versions.no")}</th>
            <th>{t("scripts.versions.status")}</th>
            <th>{t("scripts.versions.savedBy")}</th>
            <th>{t("scripts.versions.savedAt")}</th>
            <th>{t("scripts.versions.memo")}</th>
            <th>{t("scripts.versions.deployed")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.versionId}>
              <td className="font-mono">v{v.versionNo}</td>
              <td>
                <Badge tone={TONE[v.status] ?? "neutral"}>{v.status}</Badge> {v.forced && <Badge tone="warning">{t("scripts.versions.forced")}</Badge>}
              </td>
              <td>{v.savedBy ?? "–"}</td>
              <td>{fmt(v.savedAt)}</td>
              <td>{v.deployMemo ?? "–"}</td>
              <td>{v.deployedAt ? `${v.deployedBy ?? ""} ${fmt(v.deployedAt)}` : "–"}</td>
              <td>
                <Button variant="ghost" onClick={() => void view(v.versionId)}>
                  {t("scripts.versions.view")}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      {error && <Alert tone="danger">{error}</Alert>}
      {shown && (
        <section className="mt-3" aria-label={`v${shown.versionNo}`}>
          <p className="text-[12.5px] font-semibold">v{shown.versionNo}</p>
          <pre className="max-h-80 overflow-auto rounded-md border border-line p-2 font-mono text-[12px]">{shown.code}</pre>
        </section>
      )}
    </>
  );
}
