/**
 * 코드 편집기(SCR-03.01, UI-SCR-02): 브라우저에서는 Monaco(문법 강조, 계약 타입 자동완성, 정적 검사 표시),
 * 서버 렌더링·스크립트를 불러오기 전·테스트에서는 같은 값을 다루는 textarea(frontend.md §3.4 "Monaco 대역").
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export interface EditorProblem {
  line: number;
  col: number;
  severity: "ERROR" | "WARNING";
  message: string;
  code?: string;
}

export interface EditorApi {
  setValue(value: string): void;
  getValue(): string;
  setProblems(problems: EditorProblem[]): void;
  reveal(line: number, col: number): void;
  dispose(): void;
}

export type EditorFactory = (element: HTMLDivElement, options: { value: string; readOnly: boolean; contractTypes?: string; onChange: (value: string) => void }) => Promise<EditorApi | null>;

const monacoFactory: EditorFactory = async (element, options) => {
  const { monaco, setContractTypes } = await import("~/lib/monaco.client");
  if (options.contractTypes) setContractTypes(options.contractTypes);
  const dark = typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const editor = monaco.editor.create(element, {
    value: options.value,
    language: "javascript",
    readOnly: options.readOnly,
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
    fontFamily: "JetBrains Mono, ui-monospace, monospace",
    theme: dark ? "vs-dark" : "vs",
    scrollBeyondLastLine: false,
  });
  editor.onDidChangeModelContent(() => options.onChange(editor.getValue()));
  return {
    setValue: (value) => {
      if (editor.getValue() !== value) editor.setValue(value);
    },
    getValue: () => editor.getValue(),
    setProblems: (problems) => {
      const model = editor.getModel();
      if (!model) return;
      monaco.editor.setModelMarkers(
        model,
        "data2flow",
        problems.map((p) => ({
          startLineNumber: p.line,
          startColumn: p.col,
          endLineNumber: p.line,
          endColumn: p.col + 1,
          message: p.message,
          severity: p.severity === "ERROR" ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
        })),
      );
    },
    reveal: (line, col) => {
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column: col });
      editor.focus();
    },
    dispose: () => editor.dispose(),
  };
};

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  problems?: EditorProblem[];
  readOnly?: boolean;
  contractTypes?: string;
  label: string;
  height?: number;
  /** 테스트·SSR에서는 null을 돌려주는 팩토리로 textarea만 쓴다 */
  factory?: EditorFactory;
  /** 문제 목록에서 줄을 누르면 부르는 핸들(편집기로 이동) */
  apiRef?: { current: EditorApi | null };
}

export function CodeEditor({ value, onChange, problems = [], readOnly = false, contractTypes, label, height = 420, factory = monacoFactory, apiRef }: CodeEditorProps) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<EditorApi | null>(null);
  const [loaded, setLoaded] = useState(false);
  const change = useRef(onChange);
  useEffect(() => {
    change.current = onChange;
  }, [onChange]);
  const initial = useRef(value);

  useEffect(() => {
    let disposed = false;
    const node = host.current;
    if (!node) return;
    factory(node, { value: initial.current, readOnly, contractTypes, onChange: (v) => change.current(v) })
      .then((created) => {
        if (!created) return;
        if (disposed) return created.dispose();
        api.current = created;
        if (apiRef) apiRef.current = created;
        setLoaded(true);
      })
      .catch(() => setLoaded(false));
    return () => {
      disposed = true;
      api.current?.dispose();
      api.current = null;
      if (apiRef) apiRef.current = null;
    };
  }, [factory, readOnly, contractTypes, apiRef]);

  useEffect(() => {
    api.current?.setValue(value);
  }, [value, loaded]);

  useEffect(() => {
    api.current?.setProblems(problems);
  }, [problems, loaded]);

  return (
    <div className="rounded-md border border-line">
      <div ref={host} style={{ height: loaded ? height : 0 }} />
      {!loaded && (
        <textarea
          aria-label={label}
          value={value}
          readOnly={readOnly}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          style={{ height }}
          className="block w-full resize-y bg-panel p-2 font-mono text-[13px] text-text outline-none"
        />
      )}
      {loaded && <span className="sr-only">{t("editor.loaded", { label })}</span>}
    </div>
  );
}
