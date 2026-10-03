/**
 * 정적 검사 문제 목록(SCR-04.05, UI-SCR-02): 줄·열, 심각도, 메시지. 누르면 편집기의 그 줄로 이동한다.
 */
import { useTranslation } from "react-i18next";
import { Badge } from "~/components/ui";
import { countBySeverity, type Problem } from "./model/script-model";

export function problemText(problem: Problem): string {
  return `${problem.message} (${problem.line}:${problem.col})`;
}

export function ProblemsList({ problems, checking, onSelect }: { problems: Problem[]; checking: boolean; onSelect: (problem: Problem) => void }) {
  const { t } = useTranslation();
  const counts = countBySeverity(problems);
  return (
    <section aria-label={t("scripts.problems.title")} className="mt-2 rounded-md border border-line">
      <header className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[12.5px]">
        <span className="font-semibold">{t("scripts.problems.title")}</span>
        <span className="text-muted" role="status">
          {checking ? t("scripts.problems.checking") : t("scripts.problems.summary", counts)}
        </span>
      </header>
      {problems.length === 0 ? (
        <p className="px-3 py-2 text-[12.5px] text-muted">{t("scripts.problems.none")}</p>
      ) : (
        <ul className="max-h-40 overflow-y-auto">
          {problems.map((p, i) => (
            <li key={`${p.line}:${p.col}:${i}`}>
              <button type="button" onClick={() => onSelect(p)} className="flex w-full items-center gap-2 px-3 py-1 text-left text-[12.5px] hover:bg-bg">
                <Badge tone={p.severity === "ERROR" ? "danger" : "warning"}>{t(`scripts.problems.${p.severity}`)}</Badge>
                <span className={p.severity === "ERROR" ? "text-bad" : "text-warn"}>{problemText(p)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
