/**
 * UI-AIA-07 MCP 연결 안내(AIA-08.01·08.04, API-AIA-17). 엔드포인트와 클라이언트별 설정 예시, 도구 목록(이름·버전·필요 범위·설명, 범위로 거르기),
 * 내 MCP 토큰(API-AIA-09 = API-IAM-40~44 `kind=MCP`). 조직 AI가 꺼져 있으면 도구 목록 대신 안내를 보인다.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Card, SelectField, Table, cx } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { MCP_ENDPOINT, mcpConfig } from "~/features/tokens/model";
import type { McpTool } from "../model/types";

const CLIENTS = ["claude-desktop", "claude-code", "json"] as const;

export function McpConnect({ tools, toolsError }: { tools: McpTool[]; toolsError: { code: string; message?: string } | null }) {
  const { t } = useTranslation();
  const [client, setClient] = useState<(typeof CLIENTS)[number]>("claude-desktop");
  const [scope, setScope] = useState("");
  const [copied, setCopied] = useState(false);
  const scopes = [...new Set(tools.map((tool) => tool.scope))].sort();
  const shown = scope ? tools.filter((tool) => tool.scope === scope) : tools;
  return (
    <div className="flex flex-col gap-3">
      <Card title={t("ai.mcp.endpoint")}>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded border border-line bg-bg p-2 font-mono text-[12.5px]">{MCP_ENDPOINT}</code>
          <Button
            onClick={() =>
              void navigator.clipboard
                ?.writeText(MCP_ENDPOINT)
                .then(() => setCopied(true))
                .catch(() => setCopied(false))
            }
          >
            {copied ? t("common.copied") : t("common.copy")}
          </Button>
        </div>
        <p className="mt-2 text-[12px] text-muted">{t("ai.mcp.transport")}</p>
        <div className="mt-3 flex gap-1 border-b border-line" role="tablist">
          {CLIENTS.map((c) => (
            <button key={c} type="button" role="tab" aria-selected={client === c} onClick={() => setClient(c)} className={cx("-mb-px border-b-2 px-3 py-1.5 text-[12.5px]", client === c ? "border-accent font-semibold text-accent" : "border-transparent text-muted")}>
              {t(`ai.mcp.clients.${c}`)}
            </button>
          ))}
        </div>
        <pre aria-label={t("ai.mcp.example")} className="mt-2 overflow-auto rounded border border-line bg-bg p-2 font-mono text-[11.5px]">
          {mcpConfig(client, t("ai.mcp.tokenPlaceholder"))}
        </pre>
      </Card>
      <Card title={t("ai.mcp.tools")} actions={scopes.length > 1 ? <SelectField label={t("ai.mcp.scopeFilter")} value={scope} onChange={(e) => setScope(e.target.value)}><option value="">{t("common.all")}</option>{scopes.map((s) => <option key={s} value={s}>{s}</option>)}</SelectField> : undefined}>
        {toolsError ? (
          <Alert tone="info">{toolsError.code === "AI_DISABLED" ? t("ai.unavailable.mcpDisabled") : errorText(t, toolsError)}</Alert>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("ai.mcp.tool")}</th>
                <th>{t("ai.mcp.version")}</th>
                <th>{t("ai.mcp.scope")}</th>
                <th>{t("ai.mcp.description")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((tool) => (
                <tr key={tool.name}>
                  <td className="font-mono">{tool.name}</td>
                  <td>{tool.version}</td>
                  <td className="font-mono text-[12px]">{tool.scope}</td>
                  <td>{tool.description}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="mt-2 text-[12px] text-muted">{t("ai.mcp.noControl")}</p>
      </Card>
    </div>
  );
}
