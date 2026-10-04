/**
 * "데이터 표로 보기"(DSH-11.03, TC-DSH-097): 캡션·열 머리글(scope)이 있는 표, 값 복사, 스크린 리더 요약(aria-describedby).
 */
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Table } from "~/components/ui";
import type { TableView } from "../model/data";

/** 표를 탭 구분 텍스트로(스프레드시트에 붙여 넣기) */
export function tableToTsv(view: TableView): string {
  return [view.columns, ...view.rows].map((row) => row.map((v) => (v === null ? "" : String(v))).join("\t")).join("\n");
}

export function DataTable({ view, caption, summary, maxRows = 200 }: { view: TableView; caption: string; summary: string; maxRows?: number }) {
  const { t } = useTranslation();
  const summaryId = useId();
  const [copied, setCopied] = useState(false);
  const rows = view.rows.slice(-maxRows);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tableToTsv({ columns: view.columns, rows }));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="max-h-72 overflow-auto">
      <p id={summaryId} className="sr-only">
        {summary}
      </p>
      <div className="mb-1 flex justify-end">
        <Button variant="ghost" onClick={copy}>
          {copied ? t("dashboards.table.copied") : t("dashboards.table.copy")}
        </Button>
      </div>
      {view.columns.length === 0 ? (
        <p className="text-[13px] text-muted">{t("dashboards.widget.noData")}</p>
      ) : (
        <div aria-describedby={summaryId}>
          <Table>
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr>
                {view.columns.map((c, i) => (
                  <th scope="col" key={`${c}-${i}`}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {row.map((v, i) => (
                    <td key={i} className={typeof v === "number" ? "font-mono" : undefined}>
                      {v === null ? "–" : String(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  );
}
