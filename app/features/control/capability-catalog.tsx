/**
 * UI-ACT-10 기능 카탈로그(ACT-01.01~04, API-ACT-25). 조회 OPERATOR 이상, 사용자 정의 기능 추가·수정 CAPABILITY_MANAGE(ADMIN·INTEGRATOR).
 * - 목록: 이름, 버전, 표준/사용자 정의, 속성 수, 명령 수
 * - 상세: 속성 표(이름·타입·단위·범위·읽기 전용), 명령 표(이름·바꾸는 속성), 기대 효과, Matter 대응 클러스터
 * - 사용자 정의 기능 편집: JSON 정의 + 컨트롤 미리보기(기기 상세 제어 패널과 같은 입력 부품). 이름은 `custom.`으로 시작(BR-ACT-22)
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Badge, Button, Card, EmptyState, Table, TextArea } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { controlAdminApi, type ControlAdminApi } from "./admin-api";
import { AttributeInput } from "./control-panel";
import { CUSTOM_CAPABILITY_TEMPLATE, parseCapabilityJson, type CapabilityDefinition, type CapabilitySummaryRow } from "./model/admin";
import { attributeRange, writableAttributes } from "./model/control";

export function CapabilityPreview({ definition }: { definition: CapabilityDefinition }) {
  const { t } = useTranslation();
  const capability = { name: definition.name, attributes: definition.attributes, commands: definition.commands };
  const writable = new Set(writableAttributes(capability).map((a) => a.name));
  return (
    <section aria-label={t("control.capabilities.preview")} className="flex flex-col gap-2 rounded-md border border-line p-3">
      {definition.attributes.map((a) => (
        <div key={a.name} className="grid gap-1 sm:grid-cols-[160px_1fr] sm:items-center">
          <span className="text-[13px] font-medium">{a.name}</span>
          {writable.has(a.name) ? (
            <AttributeInput capability={definition.name} attribute={a} range={attributeRange(capability, a.name)} value={undefined} disabled onChange={() => undefined} />
          ) : (
            <span className="text-[12.5px] text-muted">{t("control.capabilities.readOnlyAttr")}</span>
          )}
        </div>
      ))}
    </section>
  );
}

function DefinitionTables({ definition }: { definition: CapabilityDefinition }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <Table>
        <thead>
          <tr>
            <th>{t("control.capabilities.attrName")}</th>
            <th>{t("control.capabilities.attrType")}</th>
            <th>{t("control.capabilities.unit")}</th>
            <th>{t("control.capabilities.range")}</th>
            <th>{t("control.capabilities.readOnly")}</th>
          </tr>
        </thead>
        <tbody>
          {definition.attributes.map((a) => (
            <tr key={a.name}>
              <td className="font-mono">{a.name}</td>
              <td>{a.type}</td>
              <td>{a.unit ?? ""}</td>
              <td className="font-mono">{a.enum ? a.enum.join(" · ") : a.min != null || a.max != null ? `${a.min ?? ""}~${a.max ?? ""}${a.step ? ` (${a.step})` : ""}` : ""}</td>
              <td>{a.readOnly ? "✓" : ""}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Table>
        <thead>
          <tr>
            <th>{t("control.capabilities.command")}</th>
            <th>{t("control.capabilities.sets")}</th>
          </tr>
        </thead>
        <tbody>
          {definition.commands.length === 0 ? (
            <tr>
              <td colSpan={2} className="text-muted">
                {t("control.capabilities.noCommands")}
              </td>
            </tr>
          ) : (
            definition.commands.map((c) => (
              <tr key={c.name}>
                <td className="font-mono">{c.name}</td>
                <td className="font-mono">{(c.sets ?? []).join(", ")}</td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
      {(definition.expectedEffects ?? []).length > 0 && (
        <ul className="text-[12.5px]">
          {definition.expectedEffects!.map((e, i) => (
            <li key={i}>{t("control.capabilities.effect", { metric: e.metric, direction: e.direction === "down" ? "↓" : "↑", minutes: e.withinMinutes, when: JSON.stringify(e.when) })}</li>
          ))}
        </ul>
      )}
      <p className="text-[12.5px] text-muted">{t("control.capabilities.matter", { cluster: definition.matterCluster ?? "–" })}</p>
    </div>
  );
}

export interface CapabilityCatalogProps {
  initial: CapabilitySummaryRow[];
  failed?: boolean;
  canManage: boolean;
  api?: ControlAdminApi;
}

export function CapabilityCatalog({ initial, failed, canManage, api = controlAdminApi }: CapabilityCatalogProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState(initial);
  const [detail, setDetail] = useState<CapabilityDefinition | null>(null);
  const [editor, setEditor] = useState<{ name: string | null; text: string } | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const parsed = useMemo(() => (editor ? parseCapabilityJson(editor.text) : null), [editor]);

  const open = async (name: string) => {
    setNotice(null);
    const result = await api.capability(name);
    if (result.ok) setDetail(result.data);
    else setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
  };

  const save = async () => {
    if (!editor || !parsed?.definition) return;
    const { name, ...rest } = parsed.definition;
    const body = { attributes: rest.attributes, commands: rest.commands, expectedEffects: rest.expectedEffects ?? [], matterCluster: rest.matterCluster ?? null };
    const result = editor.name ? await api.updateCapability(editor.name, body) : await api.createCapability({ name, ...body });
    if (!result.ok) {
      setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
      return;
    }
    const d = result.data;
    const row: CapabilitySummaryRow = {
      name: d.name,
      version: d.version ?? 1,
      standard: false,
      matterCluster: d.matterCluster ?? null,
      attributeCount: d.attributes.length,
      commandCount: d.commands.length,
    };
    setRows((list) => (list.some((r) => r.name === row.name) ? list.map((r) => (r.name === row.name ? row : r)) : [...list, row]));
    setDetail(d);
    setEditor(null);
    setNotice({ tone: "success", text: t("control.capabilities.saved") });
  };

  return (
    <div className="flex flex-col gap-4">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <Card
        title={t("control.capabilities.title")}
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setEditor({ name: null, text: CUSTOM_CAPABILITY_TEMPLATE })}>
              {t("control.capabilities.new")}
            </Button>
          )
        }
      >
        {failed && <Alert tone="warning">{t("control.common.loadFailed")}</Alert>}
        {rows.length === 0 && !failed ? (
          <EmptyState title={t("control.capabilities.empty")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("control.capabilities.name")}</th>
                <th>{t("control.capabilities.version")}</th>
                <th>{t("control.capabilities.kind")}</th>
                <th>{t("control.capabilities.attributes")}</th>
                <th>{t("control.capabilities.commands")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name}>
                  <td>
                    <button type="button" className="font-mono text-accent hover:underline" onClick={() => void open(row.name)}>
                      {row.name}
                    </button>
                  </td>
                  <td className="font-mono">v{row.version}</td>
                  <td>{row.standard ? <Badge tone="info">{t("control.capabilities.standard")}</Badge> : <Badge tone="neutral">{t("control.capabilities.custom")}</Badge>}</td>
                  <td className="font-mono">{row.attributeCount ?? "–"}</td>
                  <td className="font-mono">{row.commandCount ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {detail && !editor && (
        <Card
          title={<span className="font-mono">{`${detail.name} v${detail.version ?? 1}`}</span>}
          actions={
            <>
              {canManage && !detail.standard && (
                <Button
                  onClick={() =>
                    setEditor({
                      name: detail.name,
                      text: JSON.stringify(
                        {
                          name: detail.name,
                          matterCluster: detail.matterCluster ?? undefined,
                          attributes: detail.attributes,
                          commands: detail.commands,
                          expectedEffects: detail.expectedEffects ?? [],
                        },
                        null,
                        2,
                      ),
                    })
                  }
                >
                  {t("common.edit")}
                </Button>
              )}
              <Button onClick={() => setDetail(null)}>{t("common.close")}</Button>
            </>
          }
        >
          <DefinitionTables definition={detail} />
          <h3 className="mb-1 mt-3 text-[13px] font-semibold">{t("control.capabilities.preview")}</h3>
          <CapabilityPreview definition={detail} />
        </Card>
      )}

      {editor && (
        <Card
          title={editor.name ? t("control.capabilities.editCustom", { name: editor.name }) : t("control.capabilities.new")}
          actions={<Button onClick={() => setEditor(null)}>{t("common.close")}</Button>}
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <TextArea label={t("control.capabilities.json")} value={editor.text} rows={18} onChange={(e) => setEditor({ ...editor, text: e.target.value })} />
              {parsed && parsed.problems.length > 0 && (
                <ul role="alert" className="mt-1 text-[12.5px] text-bad">
                  {parsed.problems.map((p) => (
                    <li key={p}>{p === "CAPABILITY_NAME_RESERVED" ? t("errors.CAPABILITY_NAME_RESERVED") : t(`control.capabilities.problems.${p}`)}</li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="mb-1 text-[13px] font-semibold">{t("control.capabilities.preview")}</h3>
              {parsed?.definition ? <CapabilityPreview definition={parsed.definition} /> : <p className="text-[12.5px] text-muted">{t("control.capabilities.previewUnavailable")}</p>}
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button variant="primary" disabled={!parsed?.definition} onClick={() => void save()}>
              {t("common.save")}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
