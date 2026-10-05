/**
 * AI 답변 본문을 그리는 작은 마크다운 해석기. HTML은 해석하지 않고(글자 그대로), 문단·목록·굵게·링크만 다룬다.
 * 링크 중 `#result-…`(해설 숫자의 근거, AIA-01.02)는 결과 화면 안 표·차트·카드로 옮겨 가는 버튼, `/`로 시작하는 화면 주소는 링크,
 * 그 밖의 외부 주소는 글자만 보여 준다(데이터 속 지시가 외부로 이끄는 것을 막는다, AIA-07.02).
 */
import type { ReactNode } from "react";
import { Link } from "react-router";

export type CiteHandler = (anchor: string) => void;

function inline(text: string, onCite: CiteHandler | undefined, mismatches: string[], keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;
  let last = 0;
  let n = 0;
  const pushText = (s: string) => {
    if (!s) return;
    if (mismatches.length === 0) {
      out.push(s);
      return;
    }
    const escaped = mismatches.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    for (const part of s.split(new RegExp(`(${escaped.join("|")})`, "g")))
      if (part)
        out.push(
          mismatches.includes(part) ? (
            <mark key={`${keyPrefix}-m${n++}`} data-mismatch className="rounded bg-bad-soft px-0.5 text-bad">
              {part}
            </mark>
          ) : (
            part
          ),
        );
  };
  for (const m of text.matchAll(pattern)) {
    pushText(text.slice(last, m.index));
    const key = `${keyPrefix}-${n++}`;
    if (m[3] !== undefined) out.push(<strong key={key}>{m[3]}</strong>);
    else {
      const [label, href] = [m[1], m[2]];
      if (href.startsWith("#result-") && onCite)
        out.push(
          <button key={key} type="button" data-cite={href.slice(1)} onClick={() => onCite(href.slice(1))} className="font-medium text-accent underline decoration-dotted underline-offset-2">
            {label}
          </button>,
        );
      else if (href.startsWith("/") && !href.startsWith("//"))
        out.push(
          <Link key={key} to={href} className="text-accent underline">
            {label}
          </Link>,
        );
      else out.push(<span key={key}>{label}</span>);
    }
    last = (m.index ?? 0) + m[0].length;
  }
  pushText(text.slice(last));
  return out;
}

export function AiMarkdown({ text, onCite, mismatches = [] }: { text: string; onCite?: CiteHandler; mismatches?: string[] }) {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return (
    <div className="flex flex-col gap-2 text-[13px] leading-relaxed">
      {blocks.map((block, i) => {
        const lines = block.split("\n").filter((l) => l.trim() !== "");
        if (lines.length > 0 && lines.every((l) => /^\s*[-*]\s+/.test(l)))
          return (
            <ul key={i} className="list-disc pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-*]\s+/, ""), onCite, mismatches, `${i}-${j}`)}</li>
              ))}
            </ul>
          );
        const heading = /^#{1,6}\s+(.*)$/.exec(lines[0] ?? "");
        if (heading && lines.length === 1)
          return (
            <p key={i} className="font-semibold">
              {inline(heading[1], onCite, mismatches, `${i}`)}
            </p>
          );
        return (
          <p key={i} className="whitespace-pre-wrap">
            {inline(lines.join("\n"), onCite, mismatches, `${i}`)}
          </p>
        );
      })}
    </div>
  );
}
