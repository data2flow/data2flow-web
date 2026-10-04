/**
 * UI-FLW-20 Git 동기화 설정(FLW-11.04, UC-FLW-28, BR-FLW-35). 권한 GIT_SYNC_MANAGE(ADMIN·INTEGRATOR, 경로 가드).
 * API: 설정 조회·저장·연결 테스트 API-FLW-67, 내보내기 커밋 API-FLW-68, 가져오기 미리보기(dryRun)·적용 API-FLW-69.
 * 가져오기는 DRAFT로만 반영되고 적용은 플로우 화면에서 따로 한다. 충돌은 객체마다 플랫폼/Git을 고르기 전에는 아무것도 바뀌지 않는다.
 * 비밀값은 저장소에 쓰지 않는다: 인증은 `credentialRef`(k8s Secret 참조 이름)만 적는다.
 */
import { useTranslation } from "react-i18next";
import { Form, data, useRouteLoaderData } from "react-router";
import { callApi, field, newIdempotencyKey } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Button, ButtonLink, Card, CsrfField, PageHeader, SelectField, Table, TextField } from "~/components/ui";
import { GIT_AUTH_TYPES, GIT_TARGETS, normalizeImport, readGitSyncForm, readResolutions, validateCommitMessage, validateGitSync, type GitSyncErrors, type GitSyncSettings, type ImportPreview } from "~/features/flowops/model/git-sync";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import type { RootData } from "~/root";
import type { Route } from "./+types/git-sync";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const result = await callApi<GitSyncSettings>(bff(context), request, "/api/v1/core/git-sync");
  // 아직 설정하지 않았으면 404 → 빈 폼
  if (!result.ok && result.status !== 404) return { settings: null, loadError: { code: result.code } };
  return { settings: result.ok ? result.data : null, loadError: null };
}

type ActionData = {
  intent: string;
  done?: boolean;
  values?: GitSyncSettings;
  fieldErrors?: GitSyncErrors;
  test?: { ok: boolean; latencyMs?: number; headCommit?: string | null; error?: { kind: string; message?: string } | null };
  exported?: { commit: string; files: string[] };
  messageError?: string;
  preview?: ImportPreview;
  missing?: string[];
  applied?: ImportPreview;
  error?: { code: string; message?: string };
};

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const fail = (status: number, body: ActionData) => data<ActionData>(body, { status });
  const failure = (result: { status: number; code: string; message?: string }, extra: Partial<ActionData> = {}) => fail(result.status, { intent, ...extra, error: { code: result.code, message: result.message } });

  if (intent === "save" || intent === "test") {
    const values = readGitSyncForm(form);
    const fieldErrors = validateGitSync(values);
    if (Object.keys(fieldErrors).length > 0) return fail(400, { intent, values, fieldErrors });
    if (intent === "test") {
      const result = await callApi<ActionData["test"]>(ctx, request, "/api/v1/core/git-sync/test", { method: "POST", body: { repoUrl: values.repoUrl, branch: values.branch, auth: values.auth } });
      return result.ok ? ({ intent, values, test: result.data } satisfies ActionData) : failure(result, { values });
    }
    const result = await callApi<GitSyncSettings>(ctx, request, "/api/v1/core/git-sync", { method: "PUT", body: { ...values, baseVersion: Number(field(form, "baseVersion")) || 0 } });
    return result.ok ? ({ intent, done: true } satisfies ActionData) : failure(result, { values });
  }
  if (intent === "export") {
    const message = field(form, "message");
    const messageError = validateCommitMessage(message);
    if (messageError) return fail(400, { intent, messageError });
    const result = await callApi<{ commit: string; files: string[] }>(ctx, request, "/api/v1/core/git-sync/export", { method: "POST", body: { message: message.trim() }, idempotencyKey: newIdempotencyKey() });
    return result.ok ? ({ intent, exported: result.data } satisfies ActionData) : failure(result);
  }
  if (intent === "preview") {
    const result = await callApi<unknown>(ctx, request, "/api/v1/core/git-sync/import", { method: "POST", body: { dryRun: true, resolutions: [] } });
    return result.ok ? ({ intent, preview: normalizeImport(result.data) } satisfies ActionData) : failure(result);
  }
  if (intent === "apply") {
    const conflictKeys = form.getAll("conflicts").filter((v): v is string => typeof v === "string");
    const { resolutions, missing } = readResolutions(form, conflictKeys);
    // 충돌을 모두 고르기 전에는 보내지 않는다(서버도 409 GIT_SYNC_CONFLICT로 막는다, TC-FLW-257)
    if (missing.length > 0) {
      // 미리보기를 다시 받아(dryRun, 바뀌는 것 없음) 고르지 않은 충돌을 강조해 보여 준다
      const again = await callApi<unknown>(ctx, request, "/api/v1/core/git-sync/import", { method: "POST", body: { dryRun: true, resolutions: [] } });
      return fail(409, { intent, missing, preview: again.ok ? normalizeImport(again.data) : undefined, error: { code: "GIT_SYNC_CONFLICT" } });
    }
    const result = await callApi<unknown>(ctx, request, "/api/v1/core/git-sync/import", { method: "POST", body: { dryRun: false, resolutions }, idempotencyKey: newIdempotencyKey() });
    return result.ok ? ({ intent, applied: normalizeImport(result.data) } satisfies ActionData) : failure(result);
  }
  return fail(400, { intent, error: { code: "INVALID_REQUEST" } });
}

function PreviewView({ preview, missing }: { preview: ImportPreview; missing?: string[] }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <p>{t("flowops.git.previewSummary", { changes: preview.changes.length, conflicts: preview.conflicts.length, errors: preview.errors.length })}</p>
      {preview.changes.length > 0 && (
        <ul className="list-disc pl-5">
          {preview.changes.map((c) => (
            <li key={c.objectKey}>{`${t(`flowops.git.changeKinds.${c.kind}`, { defaultValue: c.kind })} · ${c.objectKey} — ${c.summary}`}</li>
          ))}
        </ul>
      )}
      {preview.errors.length > 0 && (
        <Alert tone="danger">
          {preview.errors.map((e) => t("flowops.git.fileError", { file: e.file, line: e.line ?? "–", code: t(`flowops.git.errorCodes.${e.code}`, { defaultValue: e.code }) })).join(" · ")}
        </Alert>
      )}
      <Form method="post" className="flex flex-col gap-2">
        <CsrfField />
        <input type="hidden" name="intent" value="apply" />
        {preview.conflicts.length > 0 && (
          <Table>
            <thead>
              <tr>
                <th>{t("flowops.git.conflictObject")}</th>
                <th>{t("flowops.git.conflictChoose")}</th>
              </tr>
            </thead>
            <tbody>
              {preview.conflicts.map((c) => (
                <tr key={c.objectKey} className={missing?.includes(c.objectKey) ? "bg-bad-soft" : undefined}>
                  <td>
                    <input type="hidden" name="conflicts" value={c.objectKey} />
                    <p>{c.objectKey}</p>
                    <p className="text-[12px] text-muted">{t("flowops.git.conflictDetail", { at: c.platformUpdatedAt ?? "–", commit: (c.gitCommit ?? "").slice(0, 8) || "–" })}</p>
                  </td>
                  <td>
                    {(["PLATFORM", "GIT"] as const).map((side) => (
                      <label key={side} className="mr-3 inline-flex items-center gap-1">
                        <input type="radio" name={`resolve.${c.objectKey}`} value={side} />
                        {t(`flowops.git.sides.${side}`)}
                      </label>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="text-[12px] text-muted">{t("flowops.git.draftOnly")}</p>
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={preview.changes.length === 0 && preview.conflicts.length === 0}>
            {t("flowops.git.apply")}
          </Button>
        </div>
      </Form>
    </div>
  );
}

export default function GitSync({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const result = actionData as ActionData | undefined;
  const settings = loaderData.settings;
  const values = result?.values ?? settings;
  const errors = result?.fieldErrors;
  const err = (key: keyof GitSyncErrors) => (errors?.[key] ? t(`flowops.git.errors.${key}.${errors[key]}`) : undefined);
  const preview = result?.preview;
  return (
    <>
      <PageHeader crumb={t("flowops.git.crumb")} title={t("flowops.git.title")} actions={<ButtonLink to="/automation/pipelines">{t("flowops.areas.pipelines")}</ButtonLink>} />
      {loaderData.loadError && <Alert tone="danger">{errorText(t, loaderData.loadError)}</Alert>}
      {result?.error && <Alert tone="danger">{result.missing ? t("flowops.git.resolveAll", { count: result.missing.length }) : errorText(t, result.error)}</Alert>}
      {result?.done && <Alert tone="success">{t("flowops.git.saved")}</Alert>}
      {result?.test &&
        (result.test.ok ? (
          <Alert tone="success">{t("flowops.git.testOk", { ms: result.test.latencyMs ?? 0, commit: (result.test.headCommit ?? "").slice(0, 8) || "–" })}</Alert>
        ) : (
          <Alert tone="danger">{t("flowops.git.testFailed", { reason: t(`flowops.sinks.kinds.${result.test.error?.kind ?? "OTHER"}`, { defaultValue: result.test.error?.kind }) })}</Alert>
        ))}
      {result?.exported && <Alert tone="success">{t("flowops.git.exported", { commit: result.exported.commit.slice(0, 8), count: result.exported.files.length })}</Alert>}
      {result?.applied && <Alert tone="success">{t("flowops.git.applied", { count: result.applied.changes.length })}</Alert>}
      <div className="flex flex-col gap-4">
        <Card title={t("flowops.git.connection")}>
          <Form method="post" className="grid gap-3 md:grid-cols-2">
            <CsrfField />
            <input type="hidden" name="baseVersion" value={String(settings?.version ?? 0)} />
            <TextField label={t("flowops.git.repoUrl")} name="repoUrl" defaultValue={values?.repoUrl ?? ""} placeholder="ssh://git@github.com/org/automation.git" error={err("repoUrl")} />
            <TextField label={t("flowops.git.branch")} name="branch" defaultValue={values?.branch ?? "main"} maxLength={100} error={err("branch")} />
            <TextField label={t("flowops.git.path")} name="path" defaultValue={values?.path ?? "/"} maxLength={200} error={err("path")} />
            <SelectField label={t("flowops.git.authType")} name="authType" defaultValue={values?.auth.type ?? "SSH_KEY"}>
              {GIT_AUTH_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`flowops.git.authTypes.${type}`)}
                </option>
              ))}
            </SelectField>
            <TextField label={t("flowops.git.credentialRef")} name="credentialRef" defaultValue={values?.auth.credentialRef ?? ""} hint={t("flowops.git.credentialHint")} error={err("credentialRef")} />
            <fieldset className="flex flex-wrap items-center gap-3 text-[13px]">
              <legend className="mb-1 text-[12.5px] font-medium">{t("flowops.git.targets")}</legend>
              {GIT_TARGETS.map((target) => (
                <label key={target} className="inline-flex items-center gap-1">
                  <input type="checkbox" name="targets" value={target} defaultChecked={values ? values.targets.includes(target) : target !== "RULE"} />
                  {t(`flowops.git.targetNames.${target}`)}
                </label>
              ))}
            </fieldset>
            {settings?.updatedAt && <p className="text-[12px] text-muted md:col-span-2">{t("flowops.git.updated", { name: settings.updatedBy?.name ?? "–", at: formatDateTime(settings.updatedAt, root?.timezone ?? "Asia/Seoul", i18n.language) })}</p>}
            <div className="flex justify-end gap-2 md:col-span-2">
              <Button type="submit" name="intent" value="test">
                {t("flowops.git.test")}
              </Button>
              <Button type="submit" name="intent" value="save" variant="primary">
                {t("common.save")}
              </Button>
            </div>
          </Form>
        </Card>
        {settings && (
          <Card title={t("flowops.git.operations")}>
            <div className="flex flex-col gap-4">
              <Form method="post" className="flex flex-wrap items-end gap-2">
                <CsrfField />
                <input type="hidden" name="intent" value="export" />
                <TextField label={t("flowops.git.commitMessage")} name="message" maxLength={200} error={result?.messageError ? t(`flowops.git.errors.message.${result.messageError}`) : undefined} />
                <Button type="submit">{t("flowops.git.export")}</Button>
              </Form>
              <Form method="post">
                <CsrfField />
                <input type="hidden" name="intent" value="preview" />
                <Button type="submit">{t("flowops.git.preview")}</Button>
              </Form>
              {preview && <PreviewView preview={preview} missing={result?.missing} />}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
