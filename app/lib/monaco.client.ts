/**
 * Monaco 편집기(MIT)를 필요한 부분만 불러온다: 편집기 본체, JavaScript 문법 강조, JS 언어 서비스(자동완성).
 * 워커는 Vite가 같은 출처 파일로 내보낸다(CSP `script-src 'self'`에 맞음). 브라우저에서만 동적으로 불러온다.
 */
import * as monaco from "monaco-editor/editor/editor.api";
import "monaco-editor/languages/definitions/javascript/register";
import { javascriptDefaults } from "monaco-editor/languages/features/typescript/register";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import TsWorker from "monaco-editor/languages/features/typescript/ts.worker?worker";

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    return label === "typescript" || label === "javascript" ? new TsWorker() : new EditorWorker();
  },
};

let extraLib: { dispose(): void } | null = null;

/** 스크립트 계약 타입(`msg`, `ctx`, `ctx.util` …)을 자동완성에 넣는다(SCR-03.01) */
export function setContractTypes(dts: string) {
  extraLib?.dispose();
  extraLib = javascriptDefaults.addExtraLib(dts, "file:///data2flow-script.d.ts");
  javascriptDefaults.setCompilerOptions({ allowNonTsExtensions: true, checkJs: true, noLib: false, target: 99 });
}

export { monaco };
