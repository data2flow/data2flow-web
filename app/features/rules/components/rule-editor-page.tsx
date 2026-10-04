/**
 * 규칙 만들기·수정 화면 틀(UI-RUL-02 + UI-RUL-03). loader가 준 규칙 원본을 폼 상태로 바꾸고, 저장은 라우트 action으로 보낸다(본문 JSON 한 칸).
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigation, useRouteLoaderData, useSubmit } from "react-router";
import { hasAny } from "~/lib/permissions";
import { errorText } from "~/lib/error-text";
import type { RootData } from "~/root";
import { rulesApi, type RulesApi } from "../api";
import { applyTemplate, formFromRule, type RuleFormState } from "../model/rule-form";
import type { MetricInfo, RuleDetail, RuleTemplate, ScopeDevice } from "../model/types";
import type { SpaceNode } from "~/lib/spaces";
import { RuleEditor, type PolicyOption } from "./rule-editor";

export interface RuleEditorLoaderData {
  rule: (Partial<RuleDetail> & { ruleId?: string }) | null;
  /** 복제·차트 초안처럼 저장되지 않은 시작값 */
  draft?: Partial<RuleDetail> | null;
  templateKey?: string | null;
  copySuffix?: string;
  templates: RuleTemplate[];
  policies: PolicyOption[];
  spaces: SpaceNode[];
  devices: ScopeDevice[];
  models: { code: string; name: string }[];
  metrics: MetricInfo[];
  openSimulation?: boolean;
  warnings?: string[];
  saved?: boolean;
  draftError?: { code: string; message?: string } | null;
}

export interface RuleEditorActionData {
  error?: { code: string; message?: string };
  fieldErrors?: Record<string, { key: string; params?: Record<string, string> }>;
}

export function initialForm(data: RuleEditorLoaderData): RuleFormState {
  const source = data.rule ?? data.draft ?? {};
  const form = formFromRule(source, { copySuffix: data.copySuffix });
  if (!data.rule && !data.draft && data.templateKey) return applyTemplate(form, data.templates.find((t) => t.key === data.templateKey));
  return form;
}

export function RuleEditorPage({ data, actionData, api = rulesApi }: { data: RuleEditorLoaderData; actionData?: RuleEditorActionData; api?: RulesApi }) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const submit = useSubmit();
  const navigation = useNavigation();
  const initial = useMemo(() => initialForm(data), [data]);
  const rule = data.rule?.ruleId
    ? { ruleId: data.rule.ruleId, version: data.rule.version ?? 0, status: data.rule.status ?? "ACTIVE", errorReason: data.rule.errorReason, targetCount: data.rule.scope?.targetCount ?? null, flowId: data.rule.flowId }
    : null;
  const conflict = actionData?.error?.code === "VERSION_CONFLICT" || actionData?.error?.code === "FLOW_VERSION_CONFLICT";
  const serverError = actionData?.error ? (conflict ? t("rules.form.conflict") : errorText(t, actionData.error)) : data.draftError ? errorText(t, data.draftError) : null;
  const warnings = (data.warnings ?? []).map((w) => t(`rules.warnings.${w}`, { defaultValue: w }));
  return (
    <>
      {data.saved && <p role="status" className="mb-3 rounded-md border border-good/30 bg-good-soft px-3 py-2 text-[13px] text-good">{t("common.saved")}</p>}
      <RuleEditor
        key={`${rule?.ruleId ?? "new"}:${rule?.version ?? 0}`}
        initial={initial}
        rule={rule}
        templates={data.templates}
        policies={data.policies}
        spaces={data.spaces}
        devices={data.devices}
        models={data.models}
        metrics={data.metrics}
        canWrite={hasAny(root?.me?.permissions, ["RULE_WRITE"])}
        serverProblems={actionData?.fieldErrors}
        serverError={serverError}
        warnings={warnings}
        busy={navigation.state !== "idle"}
        openSimulation={data.openSimulation}
        api={api}
        onSave={(payload) => submit({ intent: "save", payload: JSON.stringify(payload), _csrf: root?.csrfToken ?? "" }, { method: "post" })}
      />
    </>
  );
}
